import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const roomId = searchParams.get("roomId") || undefined;
  const tiktokId = searchParams.get("tiktokId") || undefined;
  const cursor = searchParams.get("cursor") || undefined;
  const limitParam = Number(searchParams.get("limit"));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const rows = await prisma.eulerSignUsage.findMany({
    where: {
      ...(roomId ? { roomId } : {}),
      ...(tiktokId ? { tiktokId } : {}),
    },
    // createdAtだけだと同一ミリ秒の同着行が起こりうる(デプロイ直後のresumeAllListenersで
    // 数百部屋が一斉に再接続するため)。idをtie-breakerに加えないとカーソルページングで
    // 取りこぼし・重複が起きる。
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      requestedAt: true,
      roomId: true,
      tiktokId: true,
      outcome: true,
      errorMessage: true,
      trigger: true,
      reason: true,
      role: true,
      workerIndex: true,
      listenerEpoch: true,
      assignedWorkerId: true,
      credentialMode: true,
      streamerUserIds: true,
      agencyIds: true,
      eventIds: true,
      roomMonitorUntil: true,
    },
  });

  // 表示名解決はページ全体で3クエリにバッチ化する(行ごとのN+1を避ける)。
  // email/name/titleは現在値であって記録時点のスナップショットではない
  // (削除・改名後は当時と異なりうる。IDが常に一次情報)。
  const userIds = Array.from(new Set(rows.flatMap((r) => r.streamerUserIds)));
  const agencyIds = Array.from(new Set(rows.flatMap((r) => r.agencyIds)));
  const eventIds = Array.from(new Set(rows.flatMap((r) => r.eventIds)));

  const [users, agencies, events] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : Promise.resolve([]),
    agencyIds.length
      ? prisma.agency.findMany({ where: { id: { in: agencyIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    eventIds.length
      ? prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u.email]));
  const agencyMap = new Map(agencies.map((a) => [a.id, a.name]));
  const eventMap = new Map(events.map((e) => [e.id, e.title]));

  const data = rows.map((r) => ({
    ...r,
    // BigIntはJSON化できないので文字列にする
    listenerEpoch: r.listenerEpoch?.toString() ?? null,
    streamers: r.streamerUserIds.map((id) => ({ userId: id, email: userMap.get(id) ?? null })),
    agencies: r.agencyIds.map((id) => ({ agencyId: id, name: agencyMap.get(id) ?? null })),
    events: r.eventIds.map((id) => ({ eventId: id, title: eventMap.get(id) ?? null })),
  }));

  const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;

  return NextResponse.json(
    { data, nextCursor },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
