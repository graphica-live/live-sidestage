// ギフト履歴の編集機能まわりのロジックと、履歴一覧の取得クエリ。ルートハンドラから分離してテスト可能にしている。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { escapeLikePattern } from "@/lib/mobile-analytics-query";

export type GiftEditInput =
  | { ok: true; giftName: string; totalDiamonds: number }
  | { ok: false; error: string };

export function parseGiftEditInput(body: unknown): GiftEditInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const giftName = typeof b.giftName === "string" ? b.giftName.trim() : "";
  if (!giftName) {
    return { ok: false, error: "ギフト名を入力してください。" };
  }

  const totalDiamonds = Number(b.totalDiamonds);
  if (!Number.isInteger(totalDiamonds)) {
    return { ok: false, error: "コイン数は整数で指定してください。" };
  }

  return { ok: true, giftName, totalDiamonds };
}

export type GiftHistoryRow = {
  giftName: string;
  totalDiamonds: number;
  edit: { giftName: string; totalDiamonds: number } | null;
};

// TikTok受信時点のオリジナル値(giftName/totalDiamonds)はそのまま残し、
// GiftEditが存在する行だけ表示用に上書きする。オリジナルGiftレコード自体は書き換えない。
export function applyGiftEdit<T extends GiftHistoryRow>(
  row: T
): Omit<T, "edit"> & { edited: boolean } {
  const { edit, ...rest } = row;
  return {
    ...rest,
    giftName: edit?.giftName ?? row.giftName,
    totalDiamonds: edit?.totalDiamonds ?? row.totalDiamonds,
    edited: edit !== null,
  };
}

export type GiftHistoryEvent = {
  id: string;
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: string;
  edited: boolean;
};

// roomId: 集計対象のTikTokアカウント(TiktokRoom)。データは同じroomIdを持つ全登録者で共有される。
// viewerStreamerId: 閲覧者本人のGiftEdit(リネーム・非表示)を適用するために使う。他の登録者の編集は見えない。
//
// **hidden除外はDBクエリのwhere句で行う(取得後にfilterしない)。** limit件を取ってから非表示行を
// 弾く実装だと、非表示行がlimitを消費して表示可能な件数が減り、totalも「取得できたページ内の合計」に
// なってしまう(queryGifts()と同じ理由でここも先に除外する)。
export async function queryGiftHistory(
  roomId: string,
  viewerStreamerId: string,
  where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } },
  limit: number,
  listenerQuery?: string | null
): Promise<{ events: GiftHistoryEvent[]; total: { count: number; diamonds: number }; hasMore: boolean }> {
  const hiddenEdits = await prisma.giftEdit.findMany({
    where: { streamerId: viewerStreamerId, hidden: true, gift: { roomId } },
    select: { giftId: true },
  });
  const hiddenIds = hiddenEdits.map((e) => e.giftId);

  // イベント単位の一覧なので、そのイベント自身のuniqueId/nicknameが一致するかで素直に
  // フィルタしてよい(queryGiftsのような表示名変更による過少集計問題はここには当てはまらない
  // — 各行は「受信当時の記録」をそのまま出す一覧のため)。
  const fullWhere = {
    roomId,
    ...(hiddenIds.length > 0 ? { id: { notIn: hiddenIds } } : {}),
    ...(listenerQuery
      ? {
          OR: [
            { uniqueId: { contains: escapeLikePattern(listenerQuery), mode: Prisma.QueryMode.insensitive } },
            { nickname: { contains: escapeLikePattern(listenerQuery), mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
    ...where,
  };

  // limit+1件取ることで、取得後にスライスするだけでhasMoreを判定できる(追加のcountクエリ不要)。
  const rows = await prisma.gift.findMany({
    where: fullWhere,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      uniqueId: true,
      nickname: true,
      profileImageUrl: true,
      giftId: true,
      giftName: true,
      giftPictureUrl: true,
      repeatCount: true,
      totalDiamonds: true,
      receivedAt: true,
      edits: { where: { streamerId: viewerStreamerId }, select: { giftName: true, totalDiamonds: true } },
    },
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const events = pageRows.map((row) => {
    const { edits, receivedAt, ...base } = row;
    const edit = edits[0] ? { giftName: edits[0].giftName, totalDiamonds: edits[0].totalDiamonds } : null;
    return { ...applyGiftEdit({ ...base, edit }), receivedAt: receivedAt.toISOString() };
  });

  const total = events.reduce(
    (acc, e) => ({ count: acc.count + e.repeatCount, diamonds: acc.diamonds + e.totalDiamonds }),
    { count: 0, diamonds: 0 }
  );

  return { events, total, hasMore };
}
