import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OnboardingScreen } from "./OnboardingScreen";

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: session.user.id },
  });
  if (streamer) redirect("/analytics");

  return <OnboardingScreen />;
}
