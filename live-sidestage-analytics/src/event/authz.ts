import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * ログイン中のユーザーがそのイベントの主催者であることを確認する。
 *
 * 権限がない場合と存在しない場合を呼び出し側で区別できないよう、どちらも null を返す
 * (他人のイベントIDの存在を漏らさないため、API は一律 404 を返す)。
 */
export async function requireEventOwner(
  eventId: string
): Promise<{ id: string; ownerUserId: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerUserId: true },
  });
  if (!event || event.ownerUserId !== session.user.id) return null;

  return event;
}
