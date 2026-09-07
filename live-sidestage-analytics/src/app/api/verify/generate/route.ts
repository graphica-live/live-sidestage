import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";
import { normalizeTiktokId, resolveRoomForStreamer } from "@/lib/tiktok-room";
import { isValidNormalizedTiktokId } from "@/lib/agency/params";
import { upsertTiktokIdMergeJob } from "@/lib/tiktok-id-migration";
import { requireExistingTiktokAccount, formatExistenceGateError } from "@/lib/tiktok-existence";
import { checkTiktokIdChangeAllowed, formatTiktokIdLockError } from "@/lib/tiktok-id-lock";

// GET: return existing pending code for current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { tiktokId: true, verificationCode: true, verified: true },
  });

  if (!streamer) return NextResponse.json({});

  if (streamer.verified) {
    return NextResponse.json({ verified: true, tiktokId: streamer.tiktokId });
  }

  return NextResponse.json({
    tiktokId: streamer.tiktokId,
    code: streamer.verificationCode,
  });
}

// POST: create or update the streamer's TikTok ID
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tiktokId } = await req.json();
  const clean = String(tiktokId || "")
    .replace(/^@/, "")
    .trim();

  if (!clean) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  // TikTok上に実在しないIDは登録させない(fail-closed)。テスト用の適当な文字列や
  // 打ち間違いが登録され、誰も配信しない room を無期限に監視し続ける実害を防ぐ。
  // フォーマット検証も含め、確認モーダル用の /api/verify/preview と同じ判定に揃える。
  const normalized = normalizeTiktokId(clean);
  if (!isValidNormalizedTiktokId(normalized)) {
    const { error, status } = formatExistenceGateError("INVALID_FORMAT");
    return NextResponse.json({ error }, { status });
  }

  // 事前チェック: 7日ロック中なら外部照会(requireExistingTiktokAccount)を省いて即409で返す。
  // ロック中の利用者が異なるIDを繰り返し送るだけで共有の外部照会枠を消費するのを防ぐ。
  const existingPreCheck = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { tiktokId: true, tiktokIdChangedAt: true },
  });
  if (existingPreCheck) {
    const currentNormalized = normalizeTiktokId(existingPreCheck.tiktokId);
    const preCheck = checkTiktokIdChangeAllowed(
      { normalizedTiktokId: currentNormalized, tiktokIdChangedAt: existingPreCheck.tiktokIdChangedAt },
      normalized
    );
    if (!preCheck.ok) {
      const { error, code, retryAfter } = formatTiktokIdLockError(preCheck.retryAfter);
      return NextResponse.json({ error, code, retryAfter }, { status: 409 });
    }
  }

  const existence = await requireExistingTiktokAccount(normalized);
  if (!existence.ok) {
    const { error, status } = formatExistenceGateError(
      existence.reason === "MISSING" ? "USER_NOT_FOUND" : "CHECK_UNVERIFIED"
    );
    return NextResponse.json({ error }, { status });
  }

  // 登録は無条件で許可する(他アカウントとの重複登録も可)。
  // BIO認証(Streamer.verified)はどの機能の前提にもしない方針。ここで発行するコードは
  // /api/verify/* の実装として残しているだけで、認証結果を条件にした表示制御は
  // analytics/page.tsx から撤去済み。setup画面のUIからもBIO認証ステップは撤去済み(2026-09)。
  const code = generateVerificationCode();
  const now = new Date();

  // tiktokIdの変更にはCAS(楽観的排他)を使う: read(現在のtiktokIdChangedAt)→判定→
  // updateManyのwhereに読み取り時点の値を条件として含める。同時リクエストが同じ値を読んで
  // 両方ロック判定を通過しても、後勝ちのupdateManyは0件になり競合として検知できる。
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.streamer.findUnique({
      where: { userId: session.user.id },
      select: { id: true, tiktokId: true, tiktokIdChangedAt: true },
    });

    if (!current) {
      const created = await tx.streamer.create({
        data: {
          userId: session.user.id,
          tiktokId: clean,
          verificationCode: code,
          tiktokIdChangedAt: now,
        },
      });
      await upsertTiktokIdMergeJob(tx, created.id, normalized);
      return { kind: "ok" as const, streamer: created };
    }

    const currentNormalized = normalizeTiktokId(current.tiktokId);
    if (currentNormalized === normalized) {
      // 冪等リトライ: tiktokIdは実質変わらない。ロック判定・tiktokIdChangedAt更新はしない。
      const updated = await tx.streamer.update({
        where: { id: current.id },
        data: { tiktokId: clean, verificationCode: code, verified: false, verifiedAt: null },
      });
      await upsertTiktokIdMergeJob(tx, updated.id, normalized);
      return { kind: "ok" as const, streamer: updated };
    }

    const check = checkTiktokIdChangeAllowed(
      { normalizedTiktokId: currentNormalized, tiktokIdChangedAt: current.tiktokIdChangedAt },
      normalized,
      now
    );
    if (!check.ok) {
      return { kind: "locked" as const, retryAfter: check.retryAfter };
    }

    const { count } = await tx.streamer.updateMany({
      where: { id: current.id, tiktokIdChangedAt: current.tiktokIdChangedAt },
      data: {
        tiktokId: clean,
        verificationCode: code,
        verified: false,
        verifiedAt: null,
        tiktokIdChangedAt: now,
      },
    });
    if (count === 0) {
      return { kind: "conflict" as const };
    }
    const updated = await tx.streamer.findUniqueOrThrow({ where: { id: current.id } });
    await upsertTiktokIdMergeJob(tx, updated.id, normalized);
    return { kind: "ok" as const, streamer: updated };
  });

  if (result.kind === "locked") {
    const { error, code: lockCode, retryAfter } = formatTiktokIdLockError(result.retryAfter);
    return NextResponse.json({ error, code: lockCode, retryAfter }, { status: 409 });
  }
  if (result.kind === "conflict") {
    return NextResponse.json(
      { error: "他のリクエストと競合しました。もう一度お試しください", code: "CONFLICT" },
      { status: 409 }
    );
  }

  const streamer = result.streamer;

  // 同じtiktokIdを共有するTiktokRoomへ即座に紐付ける(Workerのensure loopを待たずに
  // オーバーレイ/ギフトデータ共有を反映するため)。
  await resolveRoomForStreamer(streamer.id);

  return NextResponse.json({ tiktokId: clean, code });
}
