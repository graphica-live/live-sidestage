import { prisma } from "./prisma";

// TikTokのユーザー名は大文字小文字を区別しないため、部屋(TiktokRoom)のキーとしては
// 正規化した値を使う。Streamer.tiktokId自体はユーザー入力値のまま表示用に残す。
export function normalizeTiktokId(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

// Streamerの現在のtiktokIdに対応するTiktokRoomを解決し、Streamer.roomIdを更新する。
// deviceId/workerId/proxyKey(tiktok-listener.ts)と同じ「初回アクセス時に解決→永続化→再利用」
// パターン。tiktokIdが変更された場合(再登録)は、指しているroomのtiktokIdが現在の値と
// 食い違うため自己修復的に新しいroomへ付け替える。
export async function resolveRoomForStreamer(streamerId: string): Promise<string> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { tiktokId: true, roomId: true, room: { select: { tiktokId: true } } },
  });
  if (!streamer) {
    throw new Error(`resolveRoomForStreamer: streamer ${streamerId} not found`);
  }

  const normalized = normalizeTiktokId(streamer.tiktokId);

  if (streamer.roomId && streamer.room?.tiktokId === normalized) {
    return streamer.roomId;
  }

  const room = await upsertRoom(normalized);

  await prisma.streamer.update({
    where: { id: streamerId },
    data: { roomId: room.id },
  });

  return room.id;
}

async function upsertRoom(tiktokId: string): Promise<{ id: string }> {
  try {
    return await prisma.tiktokRoom.upsert({
      where: { tiktokId },
      update: {},
      create: { tiktokId },
      select: { id: true },
    });
  } catch (err) {
    // 同時に2リクエストが同じ新規tiktokIdをupsertしようとした場合のP2002競合を再フェッチで解決する。
    if ((err as { code?: string })?.code === "P2002") {
      const existing = await prisma.tiktokRoom.findUnique({
        where: { tiktokId },
        select: { id: true },
      });
      if (existing) return existing;
    }
    throw err;
  }
}
