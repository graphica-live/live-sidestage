import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { mobileAuthResponseBody } from "@/lib/mobile-oauth";
import { markLastActive } from "@/lib/mark-last-active";
import { normalizeEmail, readPassword } from "@/lib/email-auth";
import { isRateLimited, resetRateLimit } from "@/lib/rate-limit";

// 15分/10回。メール単位でカウントする — 攻撃者がIPを分散しても、狙っている
// アカウントへの試行回数そのものは変わらないため。裏返しとして、悪意ある第三者が
// 他人のメールへ大量の誤試行を送ることで一時的にロックアウトできてしまう(DoS)が、
// 現状の利用規模では許容する。
const LOGIN_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

const GENERIC_ERROR = "メールアドレスまたはパスワードが正しくありません";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = readPassword(body.password);
  if (!email || !password) {
    return NextResponse.json({ error: "メールアドレスとパスワードを入力してください" }, { status: 400 });
  }

  const rateLimitKey = `email-login:${email}`;
  if (isRateLimited(rateLimitKey, LOGIN_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "試行回数が上限に達しました。しばらくしてからもう一度お試しください" },
      { status: 429 },
    );
  }

  // ログインは **`provider: "email"` の Account を持つ User にのみ**許可する。
  // Accountテーブルを直接引くことで、5a3e97a以前の旧パスワードUser(Account 0件、
  // 所有権未確認のハッシュ)を構造的にログイン対象から除外する。旧行の唯一の出口は
  // 従来どおりGoogleへの移行経路のまま(register側もAccountの有無を問わず409で
  // 旧行への相乗りを防いでいる。詳細は ../register/route.ts のコメント参照)。
  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: "email", providerAccountId: email } },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          password: true,
          streamer: { select: { id: true, tiktokId: true, verified: true, apiKey: true } },
        },
      },
    },
  });

  if (!account || !account.user.password) {
    // このメールがGoogleアカウントとして登録済みなら、その旨だけ案内する。
    // ここで account 自体(email Accountの有無)ではなく、別途 provider を見て
    // 判定するのは、旧register由来やdev-login由来の password あり/なし行を
    // 誤って「Googleアカウント」と案内しないため。
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { accounts: { select: { provider: true } } },
    });
    if (existing?.accounts.some((a) => a.provider === "google")) {
      return NextResponse.json(
        {
          error:
            "このメールアドレスはGoogleアカウントとして登録されています。Googleでログインしてください",
        },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, account.user.password);
  if (!valid) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  resetRateLimit(rateLimitKey);
  await markLastActive(account.user.id);
  return NextResponse.json(mobileAuthResponseBody(account.user));
}
