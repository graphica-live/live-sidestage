import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

// 除外リスト方式。ここに書いたパスだけが認証なしで通り、それ以外はすべてログインを要求する。
//
// **各エントリには必ず境界 `(?:/|$)` を付けること。** 境界がないと単なる前置一致になり、
// 例えば `e` を境界なしで書くと `/events`(主催者向け管理画面)まで公開されてしまう。
//
// 公開してよいものだけを列挙している:
//   login / register  — ログイン導線そのもの
//   e                 — イベントの公開ページ(URLを知っていれば誰でも閲覧可)
//   api/public        — 上記が読む公開API
//   api/auth          — NextAuth
//   api/mobile        — Flutter アプリ(JWT で自前認証)
//   api/health        — ヘルスチェック
//   api/debug         — token 保護のデバッグ用
//   api/internal      — INTERNAL_API_SECRET 保護の Worker → Web
//   api/analytics/monthly-contributors — デスクトップ版(APIキー保護)
//   api/overlay, overlay — OBS ブラウザソース(overlayToken 保護)
//
// 変更したら src/middleware.test.ts も更新すること(matcher を直接評価している)。
export const config = {
  matcher: [
    "/((?!login(?:/|$)|register(?:/|$)|e(?:/|$)|api/auth(?:/|$)|api/public(?:/|$)|api/mobile(?:/|$)|api/health(?:/|$)|api/debug(?:/|$)|api/internal(?:/|$)|api/analytics/monthly-contributors(?:/|$)|api/overlay(?:/|$)|overlay(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon.ico$).*)",
  ],
};
