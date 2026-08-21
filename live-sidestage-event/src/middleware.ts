import { withAuth } from "next-auth/middleware";

export default withAuth({ pages: { signIn: "/login" } });

// 保護するパスだけを列挙する(analytics の除外リスト方式とは逆)。
// 公開ページ(/e/*)と公開API(/api/public/*)を誤ってブロックしないため。
export const config = {
  matcher: ["/events/:path*", "/api/events/:path*"],
};
