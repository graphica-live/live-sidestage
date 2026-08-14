import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "全項目を入力してください" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { streamer: true },
  });

  if (!user?.password || !(await bcrypt.compare(password, user.password))) {
    return NextResponse.json(
      { error: "メールアドレスまたはパスワードが違います" },
      { status: 400 }
    );
  }

  const token = signMobileToken({ userId: user.id, streamerId: user.streamer?.id ?? "" });

  return NextResponse.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    streamer: user.streamer
      ? {
          id: user.streamer.id,
          tiktokId: user.streamer.tiktokId,
          verified: user.streamer.verified,
          apiKey: user.streamer.apiKey,
        }
      : null,
  });
}
