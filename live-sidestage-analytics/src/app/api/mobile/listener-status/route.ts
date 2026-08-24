import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveStreamerByMobileToken } from "@/lib/mobile-auth";
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
// 認証は2系統。**背景 Isolate は JWT を持たず apiKey しか持たない**ので、
// socket 認証(server.js)と同じ apiKey も受け付ける。同じ資格情報で同じ配信者の
// コメント・ギフトを既に配信しているため、実質的な権限拡大にはならない。

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
 * モバイルJWT または apiKey から streamerId を解決する。
 *
 * 両方が同時に来た場合は**同一の配信者を指しているときだけ通す**。片方が他人のもの
 * だった場合に「たまたま通った方」で応答すると、資格情報の取り違えを隠してしまう。
 */
async function resolveStreamerId(req: NextRequest): Promise<string | null> {
  const byToken = resolveStreamerByMobileToken(req)?.id ?? null;

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return byToken;

  // socket 認証(server.js の io.use)と同じ条件で引く。
  const byApiKey = await prisma.streamer.findFirst({
    where: { apiKey, verified: true },
    select: { id: true },
  });
  if (!byApiKey) return null;
  if (byToken && byToken !== byApiKey.id) return null;
  return byApiKey.id;
}

// カスタム認証のGETなので、経路上のどこかでユーザー間キャッシュされる余地を残さない。
function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  return res;
}
