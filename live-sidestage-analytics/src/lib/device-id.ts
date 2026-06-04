import { prisma } from "./prisma";

function generateDeviceId(): string {
  return Array.from({ length: 19 }, () => Math.floor(Math.random() * 10)).join("");
}

export async function getOrCreateDeviceId(streamerId: string): Promise<string> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { deviceId: true },
  });

  if (streamer?.deviceId) return streamer.deviceId;

  const deviceId = generateDeviceId();
  await prisma.streamer.update({
    where: { id: streamerId },
    data: { deviceId },
  });

  return deviceId;
}
