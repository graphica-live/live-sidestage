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
  if (!streamer) redirect("/setup");

  redirect("/analytics");
}
