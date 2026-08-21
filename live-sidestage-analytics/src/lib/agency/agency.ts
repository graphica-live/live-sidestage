import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeTiktokId, upsertRoom } from "@/lib/tiktok-room";
import { getWorkerCount, resolveWorkerForRoom } from "@/lib/tiktok-listener";
import { isValidNormalizedTiktokId } from "./params";

// 企業向けAPIキーは平文で保存しない。参照は常にキー本体のSHA-256で引く。
export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export type AgencyRecord = {
  id: string;
  name: string;
  approved: boolean;
  maxWatchTargets: number;
  hasApiKey: boolean;
  watchCount: number;
};

export type WatchRecord = {
  id: string;
  tiktokId: string;
  label: string | null;
  createdAt: string;
  listenerStatus: string | null;
  listenerMessage: string | null;
  listenerUpdatedAt: string | null;
};

export async function getAgencyByUserId(userId: string): Promise<AgencyRecord | null> {
  const agency = await prisma.agency.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      approved: true,
      maxWatchTargets: true,
      apiKeyHash: true,
      _count: { select: { watches: true } },
    },
  });
  if (!agency) return null;

  return {
    id: agency.id,
    name: agency.name,
    approved: agency.approved,
    maxWatchTargets: agency.maxWatchTargets,
    hasApiKey: Boolean(agency.apiKeyHash),
    watchCount: agency._count.watches,
  };
}

export async function createAgency(userId: string, rawName: string): Promise<AgencyRecord> {
  const agency = await prisma.agency.create({
    data: { userId, name: rawName.trim() },
    select: { id: true, name: true, approved: true, maxWatchTargets: true, apiKeyHash: true },
  });

  return {
    id: agency.id,
    name: agency.name,
    approved: agency.approved,
    maxWatchTargets: agency.maxWatchTargets,
    hasApiKey: Boolean(agency.apiKeyHash),
    watchCount: 0,
  };
}

// APIキーを新規発行(または再発行)する。平文を返すのはこの瞬間だけで、DBにはハッシュしか残らない。
// 再発行するとハッシュが置き換わるため、旧キーは即座に認証を通らなくなる。
export async function issueAgencyApiKey(agencyId: string): Promise<string> {
  const apiKey = crypto.randomBytes(32).toString("hex");
  await prisma.agency.update({
    where: { id: agencyId },
    data: { apiKeyHash: hashApiKey(apiKey) },
  });
  return apiKey;
}

export async function listWatches(agencyId: string): Promise<WatchRecord[]> {
  const watches = await prisma.agencyWatch.findMany({
    where: { agencyId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tiktokId: true,
      label: true,
      createdAt: true,
      room: {
        select: { listenerStatus: true, listenerMessage: true, listenerUpdatedAt: true },
      },
    },
  });

  return watches.map((w) => ({
    id: w.id,
    tiktokId: w.tiktokId,
    label: w.label,
    createdAt: w.createdAt.toISOString(),
    listenerStatus: w.room.listenerStatus,
    listenerMessage: w.room.listenerMessage,
    listenerUpdatedAt: w.room.listenerUpdatedAt?.toISOString() ?? null,
  }));
}

export type AddWatchResult =
  | { ok: true; watch: WatchRecord }
  | { ok: false; code: "invalid" | "unapproved" | "limit" | "duplicate" | "conflict"; error: string };

// 監視対象を追加する。src/app/api/listener/start/route.ts と同じく、ここでは部屋の解決と
// 担当Workerの割当までを行い、実際のTikTok接続は担当Workerのensureループ(最大60秒間隔)が拾う。
export async function addWatch(
  agencyId: string,
  rawTiktokId: string,
  rawLabel: string | null
): Promise<AddWatchResult> {
  const normalized = normalizeTiktokId(rawTiktokId ?? "");
  if (!normalized) {
    return { ok: false, code: "invalid", error: "TikTok IDを入力してください。" };
  }
  if (!isValidNormalizedTiktokId(normalized)) {
    return {
      ok: false,
      code: "invalid",
      error: "TikTok IDの形式が正しくありません(英数字・アンダースコア・ドットの2〜24文字)。",
    };
  }

  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { approved: true },
  });
  if (!agency) {
    return { ok: false, code: "invalid", error: "事務所情報が見つかりません。" };
  }
  if (!agency.approved) {
    return {
      ok: false,
      code: "unapproved",
      error: "この事務所はまだ承認されていません。承認後に監視対象を追加できます。",
    };
  }

  const room = await upsertRoom(normalized);
  const label = rawLabel?.trim() || null;

  // 上限チェックと作成を1トランザクションに閉じる。READ COMMITTEDだと同時リクエストが
  // 同じ件数を読んで両方通ってしまうため、Serializableにして競合をDBに検出させる。
  let created;
  try {
    created = await prisma.$transaction(
      async (tx) => {
        const target = await tx.agency.findUniqueOrThrow({
          where: { id: agencyId },
          select: { maxWatchTargets: true },
        });
        const current = await tx.agencyWatch.count({ where: { agencyId } });
        if (current >= target.maxWatchTargets) {
          throw new WatchLimitError(target.maxWatchTargets);
        }

        return tx.agencyWatch.create({
          data: { agencyId, roomId: room.id, tiktokId: rawTiktokId.trim(), label },
          select: {
            id: true,
            tiktokId: true,
            label: true,
            createdAt: true,
            room: {
              select: { listenerStatus: true, listenerMessage: true, listenerUpdatedAt: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof WatchLimitError) {
      return {
        ok: false,
        code: "limit",
        error: `監視対象は最大${err.max}件までです。不要な対象を削除してください。`,
      };
    }
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return { ok: false, code: "duplicate", error: "このTikTok IDはすでに監視対象です。" };
    }
    // Serializableの書き込み競合。呼び出し元が再試行すれば通る。
    if (code === "P2034") {
      return { ok: false, code: "conflict", error: "処理が競合しました。もう一度お試しください。" };
    }
    throw err;
  }

  // 担当Workerを確定させる。すでに他の登録者/事務所が同じ部屋を使っていれば既存の割当が返る。
  await resolveWorkerForRoom(room.id, getWorkerCount());

  return {
    ok: true,
    watch: {
      id: created.id,
      tiktokId: created.tiktokId,
      label: created.label,
      createdAt: created.createdAt.toISOString(),
      listenerStatus: created.room.listenerStatus,
      listenerMessage: created.room.listenerMessage,
      listenerUpdatedAt: created.room.listenerUpdatedAt?.toISOString() ?? null,
    },
  };
}

class WatchLimitError extends Error {
  constructor(readonly max: number) {
    super(`watch limit ${max} reached`);
  }
}

// 監視対象を外す。TiktokRoomとGiftは削除しない — 同じ部屋を他の事務所や配信者本人(Streamer)が
// 参照している可能性があるため。購読者が誰もいなくなった部屋は
// ensureAllListenersAlive()が次の周回で切断する。
// agencyIdをwhereに含めるので、他事務所のwatchは削除できない(IDOR対策)。
export async function removeWatch(agencyId: string, watchId: string): Promise<boolean> {
  const result = await prisma.agencyWatch.deleteMany({ where: { id: watchId, agencyId } });
  return result.count > 0;
}

export type WatchedRoomRef = {
  roomId: string;
  normalizedTiktokId: string;
  tiktokId: string;
  label: string | null;
  watchStartedAt: string;
  listenerStatus: string | null;
  listenerUpdatedAt: string | null;
};

// 企業向けAPIの認可境界。この事務所の監視対象だけを返し、以降の集計対象をここに閉じる。
export async function listWatchedRooms(agencyId: string): Promise<WatchedRoomRef[]> {
  const watches = await prisma.agencyWatch.findMany({
    where: { agencyId },
    orderBy: { createdAt: "asc" },
    select: {
      roomId: true,
      tiktokId: true,
      label: true,
      createdAt: true,
      room: { select: { tiktokId: true, listenerStatus: true, listenerUpdatedAt: true } },
    },
  });

  return watches.map((w) => ({
    roomId: w.roomId,
    normalizedTiktokId: w.room.tiktokId,
    tiktokId: w.tiktokId,
    label: w.label,
    watchStartedAt: w.createdAt.toISOString(),
    listenerStatus: w.room.listenerStatus,
    listenerUpdatedAt: w.room.listenerUpdatedAt?.toISOString() ?? null,
  }));
}
