import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) redirect("/login");

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
  });

  // verified未完了でもTikTok ID登録済みならダッシュボード(オーバーレイ)を即時利用できる。
  if (streamer) redirect("/analytics");

  // 配信者としての登録が無い場合、管理者に登録された事務所アカウントなら事務所コンソールへ送る。
  // 両方持つユーザーは配信者画面を既定とし、ヘッダーのリンクで行き来する。
  if (session.user.email) {
    const agency = await prisma.agency.findUnique({
      where: { email: session.user.email.toLowerCase() },
      select: { id: true },
    });
    if (agency) redirect("/agency");
  }

  redirect("/setup");
}
