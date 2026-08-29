import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { mobileAuthResponseBody } from "@/lib/mobile-oauth";
import { normalizeEmail, readPassword, MIN_PASSWORD_LENGTH } from "@/lib/email-auth";
import { isRateLimited } from "@/lib/rate-limit";

const REGISTER_RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

/** Railway は `X-Real-IP` を付与する。ローカル開発等で無ければ `X-Forwarded-For` の先頭を使う。 */
function clientIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export async function POST(req: NextRequest) {
  if (isRateLimited(`email-register:${clientIp(req)}`, REGISTER_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "試行回数が上限に達しました。しばらくしてからもう一度お試しください" },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }

  const password = readPassword(body.password);
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください` },
      { status: 400 },
    );
  }

  // Google/Apple版と違い、メール一致で既存Userへ一切リンクしない。**Accountの有無を問わず、
  // 既に同じメールのUserが存在すれば常に409で拒否する。**
  //
  // ここは「メールアドレスを入力しただけ」で所有権の証明が無い(確認メールはスコープ外)。
  // Account 0件の旧User(5a3e97a以前の「メール/パスワード登録」由来)への相乗りも許可しない —
  // それを許すと、相手のメールを知っているだけの第三者が新しいパスワードを設定して
  // 正面から入れてしまう。Google/Appleの移行はOAuth自体が所有権を証明するので別物。
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    return NextResponse.json({ error: "このメールアドレスは既に登録されています" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let user: { id: string; name: string | null; email: string | null };
  try {
    // User と Account(provider: "email") を1回のnested writeで原子的に作る。
    //
    // **ここでAccount行を作ることが、この機能全体の安全性の核心。** Account行を作らず
    // User.passwordだけを立てる案は設計レビューでCriticalな欠陥が見つかり撤回した:
    // 後からGoogle/Appleに「Account 0件のUserだけメール一致でリンクする」既存の移行経路
    // (../google/route.ts, src/lib/auth.ts の emailLinkRestrictedAdapter())が働いてしまい、
    // 攻撃者が他人のメールで先に登録してJWTを取得→本物の所有者が後日Googleでログイン→
    // 被害者のGoogle Accountが攻撃者の作ったUser行にリンクされる、というアカウント乗っ取りが
    // 成立してしまう。ここでAccountを同時に作ることで「Accountを持つUser」に即座に分類され、
    // 上記2箇所の既存の不変条件がコード変更なしでそのまま防御になる。
    user = await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        accounts: { create: { type: "credentials", provider: "email", providerAccountId: email } },
      },
      select: { id: true, name: true, email: true },
    });
  } catch (error) {
    // 事前チェックとcreateの間に同じメールで2重登録が走った場合のフォールバック。
    // P2002の発生源はUser.emailのuniqueかAccountの複合uniqueのどちらかだが、
    // どちらも「そのメールは使用済み」を意味するので409へ畳み込んでよい。
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: "このメールアドレスは既に登録されています" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json(mobileAuthResponseBody({ ...user, streamer: null }));
}
