import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

/// パスワード登録。**既定で無効**。
///
/// このエンドポイントで作った User は誰もログインできない — `authOptions` にパスワード用の
/// provider が無いのは変わらず、加えて `/api/mobile/auth/email/login` はモバイルの新規メール
/// 認証(`src/app/api/mobile/auth/email/`)が作った「`provider: "email"` の Account を持つ User」
/// にしかログインを許さない。ここで作った User は Account を1件も持たないため構造的に到達不能。
/// 実質「任意のメールで User 行を先に作れる窓口」でしかなく、`/api/mobile/auth/google` の
/// メール一致リンクと組み合わさると、他人のメールを先取りして後からその人を自分の作った
/// User 行へ吸着させる経路になる。
///
/// 画面(`src/app/(auth)/register/page.tsx`)は既に /login へリダイレクトするだけで、
/// ここを呼ぶ導線は残っていない。将来パスワードログインを復活させる余地を残して
/// コードは消さず、環境変数でだけ開けられるようにしてある。**本番では設定しないこと。**
export async function POST(req: NextRequest) {
  // 本文を読む前に閉じる。壊れたJSONを投げられても DB や bcrypt に到達させない。
  if (process.env.ENABLE_PASSWORD_REGISTER !== "1") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const { name, email, password } = await req.json();

  if (!email || !password || !name) {
    return NextResponse.json({ error: "全項目を入力してください" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "パスワードは8文字以上にしてください" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "このメールアドレスは既に登録されています" },
      { status: 400 }
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword },
  });

  return NextResponse.json({ id: user.id }, { status: 201 });
}
