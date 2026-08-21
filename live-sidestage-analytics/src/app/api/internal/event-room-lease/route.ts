import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeTiktokId } from "@/lib/tiktok-room";

// live-sidestage-event が「この配信者を期限付きで監視してほしい」と要求するための内部API。
// Railway private networking経由でのみ叩かれる想定。
//
// 認証は EVENT_INTERNAL_API_SECRET。/api/internal/gift-event の INTERNAL_API_SECRET とは
// 必ず別の値にすること — 使い回すと event 側から任意のchatEvent/overlay更新を注入できてしまう。

// 1回のリクエストで延長できる期限の上限。
// イベント期間の上限(90日)+ 猶予 + ある程度の事前登録期間を吸収できる値にしてある。
// **live-sidestage-event の ANALYTICS_MAX_LEASE_DAYS(src/lib/room-lease.ts)と揃えること。**
const MAX_LEASE_DAYS = 120;
// monitorUntilが未来の部屋の総数上限。TikTok接続はプロキシとEuler署名の枠を消費するので、
// 外部サービスからの要求で無制限に増えないようにする。恒常的に足りなくなったらこの値を見直す。
const MAX_ACTIVE_LEASES = 500;

// normalizeTiktokId は正規化しかしないので、外部入力として使う前にここで形式を検証する。
// TikTokのユーザー名に使える文字は英数字・アンダースコア・ピリオド。
const TIKTOK_ID_PATTERN = /^[a-z0-9._]{1,64}$/;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.EVENT_INTERNAL_API_SECRET;
  const provided = req.headers.get("x-event-secret");
  return Boolean(secret) && provided === secret;
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    tiktokId?: string;
    monitorUntil?: string;
  } | null;

  if (!body?.tiktokId || !body.monitorUntil) {
    return NextResponse.json({ error: "tiktokId and monitorUntil are required" }, { status: 400 });
  }

  const tiktokId = normalizeTiktokId(body.tiktokId);
  if (!TIKTOK_ID_PATTERN.test(tiktokId)) {
    return NextResponse.json({ error: "Invalid tiktokId" }, { status: 400 });
  }

  const requested = new Date(body.monitorUntil);
  if (Number.isNaN(requested.getTime())) {
    return NextResponse.json({ error: "Invalid monitorUntil" }, { status: 400 });
  }

  const now = new Date();
  const maxUntil = new Date(now.getTime() + MAX_LEASE_DAYS * 24 * 60 * 60 * 1000);
  if (requested <= now) {
    return NextResponse.json({ error: "monitorUntil must be in the future" }, { status: 400 });
  }
  if (requested > maxUntil) {
    return NextResponse.json(
      { error: `monitorUntil must be within ${MAX_LEASE_DAYS} days` },
      { status: 400 }
    );
  }

  const existing = await prisma.tiktokRoom.findUnique({
    where: { tiktokId },
    select: { id: true, monitorUntil: true },
  });

  // 上限は「まだ監視中でない部屋を新たに監視対象にする」ときだけ確認する。
  // 既に監視中の部屋の期限を延ばすだけなら総数は増えない。
  // 同時リクエストで数件超過しうるソフトリミット(接続資源の暴走を止めるのが目的で、
  // 厳密な数え上げが要件ではないため、トランザクションでの直列化はしない)。
  const alreadyMonitored = existing?.monitorUntil != null && existing.monitorUntil > now;
  if (!alreadyMonitored) {
    const activeLeases = await prisma.tiktokRoom.count({
      where: { monitorUntil: { gt: now } },
    });
    if (activeLeases >= MAX_ACTIVE_LEASES) {
      return NextResponse.json(
        { error: "Too many monitored rooms", limit: MAX_ACTIVE_LEASES },
        { status: 429 }
      );
    }
  }

  // 期限は max(既存, 要求)。別のイベントがより長い期限で確保している部屋を短くしない。
  const monitorUntil =
    existing?.monitorUntil && existing.monitorUntil > requested ? existing.monitorUntil : requested;

  const room = existing
    ? await prisma.tiktokRoom.update({
        where: { id: existing.id },
        data: { monitorUntil },
        select: { id: true, tiktokId: true, monitorUntil: true },
      })
    : await prisma.tiktokRoom.create({
        data: { tiktokId, monitorUntil },
        select: { id: true, tiktokId: true, monitorUntil: true },
      });

  return NextResponse.json({
    roomId: room.id,
    tiktokId: room.tiktokId,
    monitorUntil: room.monitorUntil,
    created: !existing,
  });
}

// 監視要求の解除。実際の切断は次のreconcile(最大60秒)で行われる。
// 部屋とGiftは消さない — 後からその部屋を指定したStreamer登録があれば監視が再開される。
export async function DELETE(req: NextRequest) {
  if (!authorize(req)) return unauthorized();

  const body = (await req.json().catch(() => null)) as { roomId?: string } | null;
  if (!body?.roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const updated = await prisma.tiktokRoom.updateMany({
    where: { id: body.roomId },
    data: { monitorUntil: null },
  });

  return NextResponse.json({ ok: true, released: updated.count });
}
