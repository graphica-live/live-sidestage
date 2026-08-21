import { prisma } from "./prisma";

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
