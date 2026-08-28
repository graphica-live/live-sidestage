import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import { mobileAuthResponseBody } from "@/lib/mobile-oauth";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/// idToken の `aud` として許容するクライアントID。
///
/// **プラットフォームごとに aud が違う。**
/// - Android: Dart から渡した `serverClientId`(= ウェブ用の `GOOGLE_CLIENT_ID`)
/// - iOS: アプリ自身の **iOS 用クライアントID**
///
/// iOS でも `serverClientId` は渡しているが、google_sign_in_ios はそれを
/// serverAuthCode の取得にしか使わず、idToken の aud は `Info.plist` の
/// `GIDClientID` になる(FLTGoogleSignInPlugin.m: configurationWithClientIdentifier)。
/// Android の `requestIdToken(serverClientId)` とは挙動が違うので、
/// **ウェブ用の1つだけを許容すると iOS のログインが必ず 401 になる。**
///
/// `GOOGLE_IOS_CLIENT_ID` は iOS 版を出すときだけ設定する。未設定なら従来どおり
/// ウェブ用の1つだけを許容するので、**Android の挙動は変わらない**。
function allowedAudiences(): string[] {
  const web = process.env.GOOGLE_CLIENT_ID?.trim();
  const ios = process.env.GOOGLE_IOS_CLIENT_ID?.trim();
  return [web, ios].filter((value): value is string => !!value);
}

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "idTokenが必要です" }, { status: 400 });
  }

  // 空配列のまま verifyIdToken へ渡すと aud を検証しないので、設定漏れは
  // 通信を試す前に fail closed で止める(Apple 版 `../apple/route.ts` と同じ方針)。
  const audience = allowedAudiences();
  if (audience.length === 0) {
    return NextResponse.json({ error: "Google認証が設定されていません" }, { status: 503 });
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch {
    return NextResponse.json({ error: "Google認証トークンの検証に失敗しました" }, { status: 401 });
  }

  if (!payload?.sub || !payload.email) {
    return NextResponse.json({ error: "不正なトークンです" }, { status: 401 });
  }
  if (payload.email_verified === false) {
    return NextResponse.json({ error: "メールアドレスが未確認です" }, { status: 401 });
  }

  const providerAccountId = payload.sub;
  const email = payload.email.toLowerCase();

  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId } },
    include: { user: { include: { streamer: true } } },
  });

  let user;
  if (account) {
    user = account.user;
  } else {
    // メール一致で既存 User へ繋いでよいのは **Account を1件も持たない User だけ**。
    //
    // この経路は 5a3e97a 以前の「メール/パスワード登録」で作られた User を Google へ
    // 移行させるために残してある。旧 User は Account を持たないので移行経路は保たれる。
    //
    // 一方、既に Account を持つ User（＝現役の OAuth 利用者）へメール一致で繋ぐと、
    // 同じメールを後から入手できた別人がそのアカウントへ正面からログインできてしまう。
    // `User.email` は「そのメールの所有者である」ことを証明しておらず
    // （旧 register / dev-login / Workspace のメール再利用）、リンクの根拠にならない。
    //
    // apple の Account だけを持つ User に繋がないことも、ここで同時に担保される
    // （Google と Apple を統合しない方針。src/lib/apple-account.ts 参照）。
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { streamer: true, accounts: { select: { id: true }, take: 1 } },
    });

    if (existingUser && existingUser.accounts.length > 0) {
      // ここで新規作成へ倒すと User.email の unique に当たって P2002 になる。
      // 500 にせず、意図的に拒否していることが分かる形で返す。
      return NextResponse.json(
        { error: "このメールアドレスは別のアカウントで使用されています" },
        { status: 409 },
      );
    }

    if (existingUser) {
      await prisma.account.create({
        data: { userId: existingUser.id, type: "oauth", provider: "google", providerAccountId },
      });
      user = existingUser;
    } else {
      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: { email, name: payload!.name ?? null, image: payload!.picture ?? null },
        });
        await tx.account.create({
          data: { userId: newUser.id, type: "oauth", provider: "google", providerAccountId },
        });
        return { ...newUser, streamer: null };
      });
    }
  }

  // レスポンスの形は Apple 版(`../apple/route.ts`)と共通にしてある。
  // 端末の AuthSession.fromJson は1つしかないので、ここが食い違うと片方が壊れる。
  return NextResponse.json(mobileAuthResponseBody(user));
}
