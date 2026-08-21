import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

// api/agency/gifts 配下は企業向けAPI(x-api-keyヘッダ認証)専用のサブツリーなので、
// NextAuthセッションを要求するこのmiddlewareの対象から外す。認可はroute内の
// resolveAgencyByApiKey()が唯一の境界になる。
// セッション認証の /api/agency, /api/agency/watches, /api/agency/api-key は対象のまま残すこと。
export const config = {
  matcher: [
    "/((?!login|register|api/auth|api/mobile|api/health|api/debug|api/internal|api/analytics/monthly-contributors|api/agency/gifts|api/overlay|overlay|_next/static|_next/image|favicon.ico).*)",
  ],
};
