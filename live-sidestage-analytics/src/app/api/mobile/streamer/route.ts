import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";
import { resolveUserByMobileToken, signMobileToken } from "@/lib/mobile-auth";
import { normalizeTiktokId, resolveRoomForStreamer } from "@/lib/tiktok-room";
import {
  checkNewHandleAtEntry,
  fillHostUserIdAtEntryIfEligible,
  upsertTiktokIdMergeJob,
} from "@/lib/tiktok-id-migration";

export async function POST(req: NextRequest) {
  const auth = resolveUserByMobileToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { tiktokId } = await req.json();
  const cleanTiktokId = String(tiktokId ?? "").replace(/^@/, "").trim();
  if (!cleanTiktokId) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: { streamer: true },
  });
  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 401 });
  }

  if (user.streamer) {
    return NextResponse.json({ error: "既にTikTokアカウントが登録されています" }, { status: 409 });
  }

  // 入口の実在確認(書き込み前)。MISSING(明示的なuser_not_found)だけ拒否する(fail-open)。
  const normalized = normalizeTiktokId(cleanTiktokId);
  const entryCheck = await checkNewHandleAtEntry(normalized);
  if (entryCheck.rejected) {
    return NextResponse.json(
      { error: "そのTikTok IDは見つかりません。数分後に再試行してください" },
      { status: 400 }
    );
  }

  // 登録は無条件で許可する(Web版と同様、他アカウントとの重複登録も可)。
  //
  // **verified: true を書かない。** かつてモバイル登録は無条件に verified を立てていたが、
  // このフローは所有の根拠を1つも確認していない。証明していないものを証明済みとして
  // 記録すると、将来 BIO 認証を何かの前提に戻したときモバイル経由の全ユーザーが
  // 無審査で通ってしまう(CLAUDE.md の「User.email はそのメールの所有者であることを
  // 証明していない」と同型の罠)。BIO 認証は現在どの機能の前提でもないので、
  // 既定の false のままで機能上の差は無い。
  const apiKey = crypto.randomBytes(32).toString("hex");
  const streamer = await prisma.$transaction(async (tx) => {
    const created = await tx.streamer.create({
      data: {
        userId: user.id,
        tiktokId: cleanTiktokId,
        verificationCode: generateVerificationCode(),
        apiKey,
      },
    });
    await upsertTiktokIdMergeJob(tx, created.id, normalized);
    return created;
  });

  // 同じtiktokIdを共有するTiktokRoomへ紐付ける。
  const roomId = await resolveRoomForStreamer(streamer.id);
  if (entryCheck.userId) {
    await fillHostUserIdAtEntryIfEligible(roomId, entryCheck.userId);
  }

  const token = signMobileToken({ userId: user.id, streamerId: streamer.id });

  return NextResponse.json(
    {
      token,
      streamer: {
        id: streamer.id,
        tiktokId: streamer.tiktokId,
        verified: streamer.verified,
        apiKey: streamer.apiKey,
      },
    },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const auth = resolveUserByMobileToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { tiktokId } = await req.json();
  const cleanTiktokId = String(tiktokId ?? "").replace(/^@/, "").trim();
  if (!cleanTiktokId) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: { streamer: true },
  });
  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 401 });
  }
  if (!user.streamer) {
    return NextResponse.json({ error: "TikTokアカウントが未登録です" }, { status: 404 });
  }

  // 入口の実在確認(書き込み前)。MISSING(明示的なuser_not_found)だけ拒否する(fail-open)。
  const normalized = normalizeTiktokId(cleanTiktokId);
  const entryCheck = await checkNewHandleAtEntry(normalized);
  if (entryCheck.rejected) {
    return NextResponse.json(
      { error: "そのTikTok IDは見つかりません。数分後に再試行してください" },
      { status: 400 }
    );
  }

  const streamer = await prisma.$transaction(async (tx) => {
    const updated = await tx.streamer.update({
      where: { id: user.streamer!.id },
      data: { tiktokId: cleanTiktokId },
    });
    await upsertTiktokIdMergeJob(tx, updated.id, normalized);
    return updated;
  });

  // 新しいtiktokIdに対応するTiktokRoomへ付け替える。
  const roomId = await resolveRoomForStreamer(streamer.id);
  if (entryCheck.userId) {
    await fillHostUserIdAtEntryIfEligible(roomId, entryCheck.userId);
  }

  return NextResponse.json({
    streamer: {
      id: streamer.id,
      tiktokId: streamer.tiktokId,
      verified: streamer.verified,
      apiKey: streamer.apiKey,
    },
  });
}
