import { NextRequest, NextResponse } from "next/server";
import { resolveUserByMobileToken } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { previewTiktokAccount, formatExistenceGateError } from "@/lib/tiktok-existence";

/** 15分/20回。確認シート用の打ち直しを潰さず、連続照会で共有 TikTok 枠を食い潰すのを遅らせる。 */
const PREVIEW_RATE_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

/**
 * モバイル初回登録の確認シート用。フォーマット検証+実在確認だけ行い、
 * DBへは一切書き込まない（確定は POST /api/mobile/streamer）。
 * Web の POST /api/verify/preview と同じ JSON 形。認証だけモバイル JWT。
 */
export async function POST(req: NextRequest) {
  const auth = resolveUserByMobileToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  if (isRateLimited(`mobile-streamer-preview:${auth.principalId}`, PREVIEW_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "試行回数が上限に達しました。しばらくしてからもう一度お試しください" },
      { status: 429 },
    );
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

  let tiktokHandle: unknown;
  try {
    ({ tiktokHandle } = await req.json());
  } catch {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  if (typeof tiktokHandle !== "string" || tiktokHandle.trim().length === 0) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const result = await previewTiktokAccount(tiktokHandle);
  if (!result.ok) {
    const { error, status } = formatExistenceGateError(result.code);
    return NextResponse.json({ error, code: result.code }, { status });
  }

  return NextResponse.json({
    ok: true,
    tiktokHandle: result.tiktokHandle,
    nickname: result.nickname,
    avatarUrl: result.preview.avatarUrl,
    signature: result.preview.signature,
    followingCount: result.preview.followingCount,
    followerCount: result.preview.followerCount,
  });
}
