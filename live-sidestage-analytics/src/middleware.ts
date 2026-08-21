import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { AGENCY_LOGIN_PATH, AGENCY_SESSION_COOKIE } from "@/lib/agency/session-cookie";

// 認証は2系統ある。どちらのセッションを見るかをパスで振り分ける。
//
//   /agency, /api/agency  → 事務所セッション(Cookie: agency-auth.session-token)
//   それ以外              → 配信者/管理者セッション(Cookie: next-auth.session-token)
//
// Cookie が別なので、同じブラウザで両方に同時ログインでき、片方のログアウトは
// もう片方に影響しない。詳細は src/lib/agency/session-cookie.ts を参照。
//
// このファイルは Edge ランタイムで動くため、Prisma を引き込むモジュール
// (src/lib/agency/auth.ts など)を import してはいけない。
const AGENCY_PREFIXES = ["/agency", "/api/agency"];

function isAgencyPath(pathname: string): boolean {
  return AGENCY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const agency = isAgencyPath(pathname);

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    ...(agency ? { cookieName: AGENCY_SESSION_COOKIE } : {}),
  });

  if (token) return NextResponse.next();

  const loginUrl = new URL(agency ? AGENCY_LOGIN_PATH : "/login", req.url);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

// 除外リスト方式。ここに書いたパスだけが認証なしで通り、それ以外はすべてログインを要求する。
//
// **各エントリには必ず境界 `(?:/|$)` を付けること。** 境界がないと単なる前置一致になり、
// 例えば `e` を境界なしで書くと `/events`(主催者向け管理画面)まで公開されてしまう。
//
// 公開してよいものだけを列挙している:
//   login / register  — 配信者/管理者のログイン導線そのもの
//   agency/login      — 事務所のログイン導線そのもの(保護すると自分自身へ無限リダイレクトする)
//   e                 — イベントの公開ページ(URLを知っていれば誰でも閲覧可)
//   api/public        — 上記が読む公開API
//   api/auth          — NextAuth(配信者/管理者)
//   api/agency-auth   — NextAuth(事務所)
//   api/mobile        — Flutter アプリ(JWT で自前認証)
//   api/health        — ヘルスチェック
//   api/debug         — token 保護のデバッグ用
//   api/internal      — INTERNAL_API_SECRET 保護の Worker → Web
//   api/analytics/monthly-contributors — デスクトップ版(APIキー保護)
//   api/agency/gifts  — 企業向けAPI(x-api-keyヘッダ認証)専用のサブツリー。認可はroute内の
//                       resolveAgencyByApiKey()が唯一の境界になる。事務所セッションで守る
//                       /api/agency, /api/agency/watches, /api/agency/api-key は対象のまま残すこと
//   api/overlay, overlay — OBS ブラウザソース(overlayToken 保護)
//
// 変更したら src/middleware.test.ts も更新すること(matcher を直接評価している)。
export const config = {
  matcher: [
    "/((?!login(?:/|$)|register(?:/|$)|agency/login(?:/|$)|e(?:/|$)|api/auth(?:/|$)|api/agency-auth(?:/|$)|api/public(?:/|$)|api/mobile(?:/|$)|api/health(?:/|$)|api/debug(?:/|$)|api/internal(?:/|$)|api/analytics/monthly-contributors(?:/|$)|api/agency/gifts(?:/|$)|api/overlay(?:/|$)|overlay(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon.ico$).*)",
  ],
};
