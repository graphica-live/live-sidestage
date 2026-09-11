import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";
import { normalizeTiktokId, resolveRoomForStreamer } from "@/lib/tiktok-room";
import { isValidNormalizedTiktokHandle } from "@/lib/agency/params";
import { requireExistingTiktokAccount, formatExistenceGateError } from "@/lib/tiktok-existence";
import {
  checkTiktokHandleChangeAllowed,
  checkTiktokUidMatch,
  formatTiktokHandleLockError,
  formatTiktokUidMismatchError,
} from "@/lib/tiktok-id-lock";
import { isAdminEmail } from "@/lib/admin";

// GET: return existing pending code for current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: session.user.id },
    select: { tiktokHandle: true, verificationCode: true, verified: true },
  });

  if (!streamer) return NextResponse.json({});

  if (streamer.verified) {
    return NextResponse.json({ verified: true, tiktokHandle: streamer.tiktokHandle });
  }

  return NextResponse.json({
    tiktokHandle: streamer.tiktokHandle,
    code: streamer.verificationCode,
  });
}

// POST: create or update the streamer's TikTok ID
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tiktokHandle } = await req.json();
  const clean = String(tiktokHandle || "")
    .replace(/^@/, "")
    .trim();

  if (!clean) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  // TikTok上に実在しないIDは登録させない(fail-closed)。テスト用の適当な文字列や
  // 打ち間違いが登録され、誰も配信しない room を無期限に監視し続ける実害を防ぐ。
  // フォーマット検証も含め、確認モーダル用の /api/verify/preview と同じ判定に揃える。
  const normalized = normalizeTiktokId(clean);
  if (!isValidNormalizedTiktokHandle(normalized)) {
    const { error, status } = formatExistenceGateError("INVALID_FORMAT");
    return NextResponse.json({ error }, { status });
  }

  // 事前チェック: 7日ロック中なら外部照会(requireExistingTiktokAccount)を省いて即409で返す。
  // ロック中の利用者が異なるIDを繰り返し送るだけで共有の外部照会枠を消費するのを防ぐ。
  const existingPreCheck = await prisma.streamer.findUnique({
    where: { principalId: session.user.id },
    select: { tiktokHandle: true, tiktokHandleChangedAt: true },
  });
  // デバッグ用アカウント(ADMIN_EMAIL)は7日ロックの対象外。
  const lockExempt = isAdminEmail(session.user.email);

  if (existingPreCheck && !lockExempt) {
    const currentNormalized = normalizeTiktokId(existingPreCheck.tiktokHandle);
    const preCheck = checkTiktokHandleChangeAllowed(
      { normalizedTiktokHandle: currentNormalized, tiktokHandleChangedAt: existingPreCheck.tiktokHandleChangedAt },
      normalized
    );
    if (!preCheck.ok) {
      const { error, code, retryAfter } = formatTiktokHandleLockError(preCheck.retryAfter);
      return NextResponse.json({ error, code, retryAfter }, { status: 409 });
    }
  }

  // Streamer 登録は tiktokUid を所有の根拠として永続化するので positive キャッシュを読まない。
  const existence = await requireExistingTiktokAccount(normalized, undefined, {
    skipPositiveCache: true,
  });
  if (!existence.ok) {
    const { error, status } = formatExistenceGateError(
      existence.reason === "MISSING" ? "USER_NOT_FOUND" : "CHECK_UNVERIFIED"
    );
    return NextResponse.json({ error }, { status });
  }

  // 所有の根拠として tiktokUid を必ず保存する。取れなければ登録を通さない(fail-closed)。
  const registerTiktokUid = existence.tiktokUid;
  if (!registerTiktokUid) {
    const { error, status } = formatExistenceGateError("CHECK_UNVERIFIED");
    return NextResponse.json({ error }, { status });
  }

  // 登録は無条件で許可する(他アカウントとの重複登録も可)。
  // BIO認証(Streamer.verified)はどの機能の前提にもしない方針。ここで発行するコードは
  // /api/verify/* の実装として残しているだけで、認証結果を条件にした表示制御は
  // analytics/page.tsx から撤去済み。setup画面のUIからもBIO認証ステップは撤去済み(2026-09)。
  const code = generateVerificationCode();
  const now = new Date();

  // tiktokHandleの変更にはCAS(楽観的排他)を使う: read(現在のtiktokHandleChangedAt)→判定→
  // updateManyのwhereに読み取り時点の値を条件として含める。同時リクエストが同じ値を読んで
  // 両方ロック判定を通過しても、後勝ちのupdateManyは0件になり競合として検知できる。
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.streamer.findUnique({
      where: { principalId: session.user.id },
      select: { id: true, tiktokUid: true, tiktokHandle: true, tiktokHandleChangedAt: true },
    });

    if (!current) {
      const created = await tx.streamer.create({
        data: {
          principalId: session.user.id,
          tiktokUid: registerTiktokUid,
          tiktokHandle: clean,
          verificationCode: code,
          tiktokHandleChangedAt: now,
        },
      });
      return { kind: "ok" as const, streamer: created };
    }

    const currentNormalized = normalizeTiktokId(current.tiktokHandle);

    // UID mismatchチェックは現在一時的に無効化されており(isTiktokUidMismatchCheckDisabled()参照)、
    // lockExempt(ADMIN_EMAIL)以外の通常ユーザーも別アカウントへの付け替えが通る状態にある
    // (別件、本修正では変更しない)。tiktokUid は resolveRoomForStreamer() がroom解決のキーに
    // 使うため、検証済みの現在値(registerTiktokUid)へ常に追従させる。冪等リトライ(ハンドル
    // 正規化後不変)でも実在確認はPOST入口で完了済みのため、通常変更分岐と同じくここでチェックする
    // (このチェックを飛ばすと、無効化フラグが有効化された将来にも冪等分岐だけmismatch検知を
    // すり抜ける経路が残ってしまう)。
    if (!checkTiktokUidMatch({ tiktokUid: current.tiktokUid }, registerTiktokUid, { exempt: lockExempt }).ok) {
      return { kind: "uid_mismatch" as const };
    }

    if (currentNormalized === normalized) {
      // 冪等リトライ: tiktokHandleは実質変わらない。ロック判定・tiktokHandleChangedAt更新はしない。
      const updated = await tx.streamer.update({
        where: { id: current.id },
        data: {
          tiktokUid: registerTiktokUid,
          tiktokHandle: clean,
          verificationCode: code,
          verified: false,
          verifiedAt: null,
        },
      });
      return { kind: "ok" as const, streamer: updated };
    }

    if (!lockExempt) {
      const check = checkTiktokHandleChangeAllowed(
        { normalizedTiktokHandle: currentNormalized, tiktokHandleChangedAt: current.tiktokHandleChangedAt },
        normalized,
        now
      );
      if (!check.ok) {
        return { kind: "locked" as const, retryAfter: check.retryAfter };
      }
    }

    const { count } = await tx.streamer.updateMany({
      where: { id: current.id, tiktokHandleChangedAt: current.tiktokHandleChangedAt },
      data: {
        tiktokUid: registerTiktokUid,
        tiktokHandle: clean,
        verificationCode: code,
        verified: false,
        verifiedAt: null,
        tiktokHandleChangedAt: now,
      },
    });
    if (count === 0) {
      return { kind: "conflict" as const };
    }
    const updated = await tx.streamer.findUniqueOrThrow({ where: { id: current.id } });
    return { kind: "ok" as const, streamer: updated };
  });

  if (result.kind === "uid_mismatch") {
    return NextResponse.json(formatTiktokUidMismatchError(), { status: 409 });
  }
  if (result.kind === "locked") {
    const { error, code: lockCode, retryAfter } = formatTiktokHandleLockError(result.retryAfter);
    return NextResponse.json({ error, code: lockCode, retryAfter }, { status: 409 });
  }
  if (result.kind === "conflict") {
    return NextResponse.json(
      { error: "他のリクエストと競合しました。もう一度お試しください", code: "CONFLICT" },
      { status: 409 }
    );
  }

  const streamer = result.streamer;

  // 同じtiktokHandleを共有するTiktokRoomへ即座に紐付ける(Workerのensure loopを待たずに
  // オーバーレイ/ギフトデータ共有を反映するため)。
  await resolveRoomForStreamer(streamer.id);

  return NextResponse.json({ tiktokHandle: clean, code });
}
