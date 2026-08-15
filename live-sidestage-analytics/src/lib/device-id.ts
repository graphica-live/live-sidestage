import { prisma } from "./prisma";

function generateDeviceId(): string {
  return Array.from({ length: 19 }, () => Math.floor(Math.random() * 10)).join("");
}

export async function getOrCreateDeviceId(roomId: string): Promise<string> {
  const room = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { deviceId: true },
  });

  if (room?.deviceId) return room.deviceId;

  const deviceId = generateDeviceId();
  await prisma.tiktokRoom.update({
    where: { id: roomId },
    data: { deviceId },
  });

  return deviceId;
}
