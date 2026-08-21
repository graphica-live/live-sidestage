import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

/** 集計はトランザクション内から呼ぶので、通常のクライアントとトランザクションの両方を受ける。 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

// analytics(public スキーマ)への読み取りをここに集約する。**ここ以外から public を触らない。**
//
// Prisma の multiSchema は raw SQL を自動修飾しないので、テーブル/view は
// `public.event_gift_v` のように完全修飾し、大文字小文字も正確に書く。
// 値は必ずタグ付きテンプレートでパラメータ化する($queryRawUnsafe は使わない)。
//
// 読める範囲は列を絞った view だけ。定義は
// live-sidestage-analytics/sql/event-integration.sql にある。

export type StreamerLink = {
  /** 共通 public."User".id。この tiktokId を登録している会員がいれば入る */
  userId: string;
  /** analytics の BIO 認証を通っているか */
  verified: boolean;
};

/**
 * roomId から「その配信者が当サービスに会員登録しているか」を引く。
 *
 * 1つの room は複数の Streamer に共有されうる(同じ tiktokId を複数人が登録できる)ので、
 * 認証済みの登録を優先して1件に畳む。参加者一覧の認証バッジ用。
 */
export async function findStreamerLinks(roomIds: string[]): Promise<Map<string, StreamerLink>> {
  if (roomIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    { roomId: string; userId: string; verified: boolean }[]
  >`
    SELECT DISTINCT ON ("roomId") "roomId", "userId", verified
    FROM public.event_streamer_v
    WHERE "roomId" = ANY(${roomIds}::text[])
    ORDER BY "roomId", verified DESC
  `;

  return new Map(rows.map((r) => [r.roomId, { userId: r.userId, verified: r.verified }]));
}

export type RoomStatus = {
  tiktokId: string;
  /** analytics の TikTok 接続状態。"connected" 等。未接続なら null */
  listenerStatus: string | null;
  listenerUpdatedAt: Date | null;
};

/**
 * room の TikTok 接続状態を引く。参加者一覧で「監視中か」を出すために使う。
 *
 * 監視要求を出してから Worker の reconcile(60秒間隔)が拾うまではここが null のままになる。
 * UI では「まもなく監視を開始します」と出す。
 */
export async function findRoomStatuses(roomIds: string[]): Promise<Map<string, RoomStatus>> {
  if (roomIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    { id: string; tiktokId: string; listenerStatus: string | null; listenerUpdatedAt: Date | null }[]
  >`
    SELECT id, "tiktokId", "listenerStatus", "listenerUpdatedAt"
    FROM public.event_room_v
    WHERE id = ANY(${roomIds}::text[])
  `;

  return new Map(
    rows.map((r) => [
      r.id,
      {
        tiktokId: r.tiktokId,
        listenerStatus: r.listenerStatus,
        listenerUpdatedAt: r.listenerUpdatedAt,
      },
    ])
  );
}

export type GiftAggregateRow = {
  roomId: string;
  uniqueId: string;
  diamonds: bigint;
  giftCount: number;
};

/**
 * 倍率が一定な1区間について、room × リスナー単位でギフトを集約する。
 *
 * 期間は `[start, end)` の半開区間。analytics の索引は `(roomId, receivedAt)` なので
 * roomId の IN + receivedAt の範囲でそのまま効く。
 *
 * ギフト1件ずつを JS に載せると数十万件になるため、集約は必ず DB 側で行う。
 */
export async function aggregateGiftsBySegment(
  client: DbClient,
  params: { roomIds: string[]; start: Date; end: Date }
): Promise<GiftAggregateRow[]> {
  if (params.roomIds.length === 0) return [];

  // giftCount は analytics の集計(src/lib/gift-analytics.ts)に合わせて
  // レコード数ではなく repeatCount の合計にする。TikTok のギフトは連打がまとまって
  // 1レコードになるため、レコード数だと「投げた回数」とずれる。
  return client.$queryRaw<GiftAggregateRow[]>`
    SELECT "roomId",
           "uniqueId",
           SUM("totalDiamonds")::bigint AS diamonds,
           SUM("repeatCount")::int AS "giftCount"
    FROM public.event_gift_v
    WHERE "roomId" = ANY(${params.roomIds}::text[])
      AND "receivedAt" >= ${params.start}
      AND "receivedAt" < ${params.end}
    GROUP BY "roomId", "uniqueId"
  `;
}

export type BattleRow = {
  roomId: string;
  battleId: string;
  action: number;
  startedAt: Date;
  startedAtEstimated: boolean;
  endedAt: Date | null;
  durationSec: number | null;
  hostUserIds: string[];
  hostDisplayIds: string[];
  hostScores: Record<string, string> | null;
  updatedAt: Date;
};

/**
 * 参加者の room で観測されたバトルを引く。
 *
 * 1つのバトルにつき、両サイドの room ぶんの行が返る(両方を監視している場合)。
 * `battleId` でグループ化すれば「そのバトルに誰が参加したか」が分かる。
 *
 * 期間は `[start, end]` の閉区間で `startedAt` を見る。対戦カードの時間枠より
 * 広めに取って、時間枠の外で始まったバトルも取り込んでおく(照合側で弾く)。
 */
export async function fetchBattles(
  client: DbClient,
  params: { roomIds: string[]; start: Date; end: Date }
): Promise<BattleRow[]> {
  if (params.roomIds.length === 0) return [];

  return client.$queryRaw<BattleRow[]>`
    SELECT "roomId",
           "battleId",
           action,
           "startedAt",
           "startedAtEstimated",
           "endedAt",
           "durationSec",
           "hostUserIds",
           "hostDisplayIds",
           "hostScores",
           "updatedAt"
    FROM public.event_battle_v
    WHERE "roomId" = ANY(${params.roomIds}::text[])
      AND "startedAt" >= ${params.start}
      AND "startedAt" <= ${params.end}
    ORDER BY "startedAt"
  `;
}

export type ListenerProfile = { nickname: string; profileImageUrl: string | null };

/**
 * リスナーの表示名とアイコン。期間中で最後に観測したものを採る。
 *
 * 区間ごとの集約とは別に1回だけ引く(倍率と無関係なので分ける必要がない)。
 * TikTok のハンドル変更で表示名が変わることがあるため、最新のものを出す。
 */
export async function fetchListenerProfiles(
  client: DbClient,
  params: { roomIds: string[]; start: Date; end: Date }
): Promise<Map<string, ListenerProfile>> {
  if (params.roomIds.length === 0) return new Map();

  const rows = await client.$queryRaw<
    { uniqueId: string; nickname: string; profileImageUrl: string | null }[]
  >`
    SELECT DISTINCT ON ("uniqueId") "uniqueId", nickname, "profileImageUrl"
    FROM public.event_gift_v
    WHERE "roomId" = ANY(${params.roomIds}::text[])
      AND "receivedAt" >= ${params.start}
      AND "receivedAt" < ${params.end}
    ORDER BY "uniqueId", "receivedAt" DESC
  `;

  return new Map(
    rows.map((r) => [r.uniqueId, { nickname: r.nickname, profileImageUrl: r.profileImageUrl }])
  );
}
