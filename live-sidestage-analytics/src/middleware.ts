import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { AGENCY_SESSION_COOKIE } from "@/lib/agency/session-cookie";
import { isAgencyPath, loginPathFor } from "@/lib/login-path";
import { requestHost, ROOT_REDIRECT_TARGETS } from "@/lib/canonical-origin";

// セッションは2系統ある。どちらの Cookie を見るかをパスで振り分ける。
//
//   /agency, /api/agency  → 事務所セッション(Cookie: agency-auth.session-token)
//   それ以外              → 配信者/管理者セッション(Cookie: next-auth.session-token)
//
// Cookie が別なので、同じブラウザで両方に同時ログインでき、片方のログアウトは
// もう片方に影響しない。詳細は src/lib/agency/session-cookie.ts を参照。
//
// **ログイン画面は3系統ある**(analytics / イベント / 事務所)。イベントは表向き別サービス
// として分離してあるので、/events から弾かれたユーザーを analytics ブランドの /login へ
// 送らない。飛び先の判定は src/lib/login-path.ts の loginPathFor() に集約してある。
// **セッション Cookie はホストごとに独立している(host-onlyデフォルトのまま)ため、
// analyticsでログインしていてもeventsでは別途ログインが必要**——変わるのは飛び先だけでなく、
// eventsでは実際に未ログイン扱いになる(意図した挙動)。保護範囲(matcher)自体は動かない。
//
// このファイルは Edge ランタイムで動くため、Prisma を引き込むモジュール
// (src/lib/agency/auth.ts など)を import してはいけない。
export default async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // サブドメインの裸の `/` だけ、host別の代表パスへ307リダイレクトする。
  // 対象外のパスは従来どおりどのhostからでも到達可能なまま(パスレベルの
  // 相互アクセス制限は今回のスコープ外。詳細はプラン4節参照)。
  if (pathname === "/") {
    const host = requestHost(req);
    const target = host ? ROOT_REDIRECT_TARGETS.find(([h]) => h === host)?.[1] : undefined;
    if (target) {
      const url = new URL(target, req.url);
      url.search = search;
      return NextResponse.redirect(url);
    }
  }

  const agency = isAgencyPath(pathname);

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    ...(agency ? { cookieName: AGENCY_SESSION_COOKIE } : {}),
  });

  if (token) return NextResponse.next();

  const loginUrl = new URL(loginPathFor(pathname), req.url);
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
//   event/login       — イベント主催者のログイン導線そのもの(同上)。`e` は境界付きなので
//                       /event/login にはマッチせず、専用エントリが要る
//   e                 — イベントの公開ページ(URLを知っていれば誰でも閲覧可)
//   api/public        — 上記が読む公開API
//   api/auth          — NextAuth(配信者/管理者)
//   api/agency-auth   — NextAuth(事務所)
//   api/mobile        — Flutter アプリ(JWT で自前認証)
//   api/health        — ヘルスチェック
//   api/debug         — token 保護のデバッグ用
//   api/internal      — INTERNAL_API_SECRET 保護の Worker → Web
//   api/webhooks/stripe — Stripe → Web(署名検証で保護。NextAuthセッションを要求できない)
//   api/webhooks/google-play — Google Play RTDN(Pub/Sub Push) → Web(OIDC IDトークン検証で保護)
//   api/webhooks/apple — App Store Server Notifications V2 → Web(JWS署名検証で保護)
//   api/analytics/monthly-contributors — デスクトップ版(APIキー保護)
//   api/agency/gifts  — 企業向けAPI(x-api-keyヘッダ認証)専用のサブツリー。認可はroute内の
//                       resolveAgencyByApiKey()が唯一の境界になる。事務所セッションで守る
//                       /api/agency, /api/agency/watches, /api/agency/api-key は対象のまま残すこと
//   api/overlay, overlay — OBS ブラウザソース(overlayToken 保護)
//   images            — public/images 配下の静的画像。公開ページ(トーナメント表の優勝トロフィー等)から参照する
//   privacy           — プライバシーポリシー(App Store Connect登録・アプリ内リンクの両方から未ログインで開ける必要がある)
//   terms             — 利用規約(ログイン画面の同意文言から未ログインで開ける必要がある)
//
// 変更したら src/middleware.test.ts も更新すること(matcher を直接評価している)。
export const config = {
  matcher: [
    "/((?!login(?:/|$)|register(?:/|$)|agency/login(?:/|$)|event/login(?:/|$)|e(?:/|$)|api/auth(?:/|$)|api/agency-auth(?:/|$)|api/public(?:/|$)|api/mobile(?:/|$)|api/health(?:/|$)|api/debug(?:/|$)|api/internal(?:/|$)|api/webhooks/stripe(?:/|$)|api/webhooks/google-play(?:/|$)|api/webhooks/apple(?:/|$)|api/analytics/monthly-contributors(?:/|$)|api/agency/gifts(?:/|$)|api/overlay(?:/|$)|overlay(?:/|$)|images(?:/|$)|privacy(?:/|$)|terms(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon.ico$).*)",
  ],
};
