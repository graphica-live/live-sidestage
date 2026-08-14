import { prisma } from "@/lib/prisma";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export const EULER_SIGN_API_KEY_SETTING = "eulerSignApiKey";

export async function getEulerSignApiKey(): Promise<string | null> {
  return getSetting(EULER_SIGN_API_KEY_SETTING);
}
