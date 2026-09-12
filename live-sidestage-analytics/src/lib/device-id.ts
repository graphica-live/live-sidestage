import { prisma } from "./prisma";

function generateDeviceId(): string {
  return Array.from({ length: 19 }, () => Math.floor(Math.random() * 10)).join("");
}

export async function getOrCreateDeviceId(roomId: string): Promise<string> {
  const room = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { deviceId: true },
  });

  if (!room) {
    throw new Error(`TiktokRoom not found: ${roomId}`);
  }

  if (room.deviceId) return room.deviceId;

  const deviceId = generateDeviceId();
  // updateMany: roomIdが呼び出しの合間に削除されているレース(P2025)を無視して進める。
  // 0件更新でも例外を投げないため、deviceIdは永続化されないままだが呼び出し元は
  // 未接続のroomへ接続を試みるだけで、次回reconcileで自然に終息する。
  await prisma.tiktokRoom.updateMany({
    where: { id: roomId },
    data: { deviceId },
  });

  return deviceId;
}
