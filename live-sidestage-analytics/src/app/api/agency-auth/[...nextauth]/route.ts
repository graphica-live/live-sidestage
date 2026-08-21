import NextAuth from "next-auth";
import { agencyAuthOptions } from "@/lib/agency/auth";

// 事務所コンソール専用のNextAuthエンドポイント。配信者/管理者側の /api/auth とは
// Cookieもセッションも独立している(詳細は src/lib/agency/auth.ts)。
const handler = NextAuth(agencyAuthOptions);

export { handler as GET, handler as POST };
