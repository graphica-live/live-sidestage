import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/((?!login|register|api/auth|api/mobile|api/health|api/debug|api/internal|api/analytics/monthly-contributors|api/overlay|overlay|_next/static|_next/image|favicon.ico).*)",
  ],
};
