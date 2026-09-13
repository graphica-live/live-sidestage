import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";
import { resolveUserByDesktopToken, signDesktopToken } from "@/lib/desktop-auth";
import { normalizeTiktokId, resolveRoomForStreamer } from "@/lib/tiktok-room";
import { requireExistingTiktokAccount } from "@/lib/tiktok-existence";

async function checkTiktokExistence(
  tiktokHandle: string
): Promise<{ error: NextResponse; tiktokUid?: undefined } | { error: null; tiktokUid: string | null }> {
  const existence = await requireExistingTiktokAccount(tiktokHandle, undefined, {
    skipPositiveCache: true,
  });
  if (existence.ok) return { error: null, tiktokUid: existence.tiktokUid };
  return {
    error: NextResponse.json(
      {
        error:
          existence.reason === "MISSING"
            ? "このTikTok IDのアカウントが見つかりません。IDを確認してください"
            : "TikTok上の実在確認ができませんでした。しばらくしてから再試行してください",
      },
      { status: existence.reason === "MISSING" ? 400 : 503 }
    ),
  };
}

export async function POST(req: NextRequest) {
  const auth = resolveUserByDesktopToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { tiktokHandle } = await req.json();
  const cleanTiktokHandle = String(tiktokHandle ?? "").replace(/^@/, "").trim();
  if (!cleanTiktokHandle) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const user = await prisma.principal.findUnique({
    where: { id: auth.principalId },
    include: { streamer: true },
  });
  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 401 });
  }

  if (user.streamer) {
    return NextResponse.json({ error: "既にTikTokアカウントが登録されています" }, { status: 409 });
  }

  const normalized = normalizeTiktokId(cleanTiktokHandle);
  const entryCheck = await checkTiktokExistence(normalized);
  if (entryCheck.error) return entryCheck.error;

  if (!entryCheck.tiktokUid) {
    return NextResponse.json(
      { error: "TikTok 上の実在確認ができませんでした。しばらくしてから再試行してください。" },
      { status: 503 },
    );
  }
  const streamer = await prisma.$transaction(async (tx) => {
    return tx.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: entryCheck.tiktokUid!,
        tiktokHandle: normalized,
        verificationCode: generateVerificationCode(),
        tiktokHandleChangedAt: new Date(),
      },
    });
  });

  await resolveRoomForStreamer(streamer.id);

  const token = signDesktopToken({ principalId: user.id, streamerId: streamer.id });

  return NextResponse.json(
    {
      token,
      streamer: {
        id: streamer.id,
        tiktokHandle: streamer.tiktokHandle,
        verified: streamer.verified,
      },
    },
    { status: 201 }
  );
}