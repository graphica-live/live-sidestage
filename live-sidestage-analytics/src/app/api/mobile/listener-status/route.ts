import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserByMobileToken } from "@/lib/mobile-auth";
import { activityOf, resolveLiveness } from "@/lib/listener-liveness";

// モバイルアプリのステータス表示用。「配信中」と「配信開始待ち」を区別するために、
// TiktokRoom の listener 状態(Worker が持っている TikTok Live 接続の状態)を返す。
//
// **これは socket push (chat:listener) の保険。**
// push は Worker → Web → socket の経路で、Web が落ちていれば届かず、
// Worker が crash すれば「配信中」のまま止まる。定期的にここを叩いて必ず収束させる。
//
// Web管理画面の /api/listener/status とは別ルート。あちらは NextAuth セッション認証で、
// レスポンス形も DashboardHeader.tsx / analytics/page.tsx が依存している。
// 共有するのは鮮度判定の純粋関数だけに留める。
//
// 認証はモバイルJWT(Authorization: Bearer)の1系統のみ。背景 Isolate も
// 同じ access token を持つ(socket 認証・HTTP API と同一の資格情報)。

// 状態は毎回変わるので、ビルド時の静的化とキャッシュを明示的に切る。
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const streamerId = await resolveStreamerId(req);
  if (!streamerId) {
    return noStore(NextResponse.json({ error: "認証が必要です" }, { status: 401 }));
  }

  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: {
      roomId: true,
      room: {
        select: {
          listenerStatus: true,
          listenerMessage: true,
          listenerUpdatedAt: true,
          listenerActivity: true,
          listenerHealth: true,
          listenerReason: true,
          listenerRevision: true,
        },
      },
    },
  });

  const now = new Date();

  // 部屋がまだ割り当たっていない(登録直後)。エラーではないので null を返す。
  if (!streamer?.roomId || !streamer.room) {
    return noStore(NextResponse.json({ listener: null, observedAt: now.toISOString() }));
  }

  const room = streamer.room;
  const activity = activityOf(room);
  const { live, stale } = resolveLiveness(activity, room.listenerUpdatedAt, now);

  return noStore(
    NextResponse.json({
      listener: {
        // 端末は (roomId, revision) で push と poll の新旧を判定する。壁時計は比較しない。
        roomId: streamer.roomId,
        revision: room.listenerRevision?.toString() ?? "0",
        status: room.listenerStatus,
        activity,
        health: room.listenerHealth,
        reason: room.listenerReason,
        message: room.listenerMessage,
        updatedAt: room.listenerUpdatedAt?.toISOString() ?? null,
        live,
        stale,
      },
      observedAt: now.toISOString(),
    })
  );
}

/**
 * モバイルJWT から streamerId を解決する。
 *
 * **JWTペイロードの streamerId クレームは信用せず、principalId から Streamer を
 * 引き直す。** ここは他人のコメント・ギフト状態へのアクセス境界なので、
 * socket 認証(server.js の io.use)・resolveMobileAnalyticsContext() と同じ規律に
 * 揃える。オンボーディング完了前に発行された(streamerId クレームを持たない)
 * トークンでも、その principal に Streamer が出来ていれば正しく解決できる。
 *
 * モバイルはBIO認証ゲート対象外なので verified は問わない。
 */
async function resolveStreamerId(req: NextRequest): Promise<string | null> {
  const auth = resolveUserByMobileToken(req);
  if (!auth) return null;

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: auth.principalId },
    select: { id: true },
  });
  return streamer?.id ?? null;
}

// カスタム認証のGETなので、経路上のどこかでユーザー間キャッシュされる余地を残さない。
function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  return res;
}
