import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { agencyAuthOptions } from "@/lib/agency/auth";
import { isAllowedHost, AGENCY_AUTH_ALLOWED_HOSTS } from "@/lib/canonical-origin";

// 事務所コンソール専用のNextAuthエンドポイント。配信者/管理者側の /api/auth とは
// Cookieもセッションも独立している(詳細は src/lib/agency/auth.ts)。
const handler = NextAuth(agencyAuthOptions);

type NextAuthContext = { params: { nextauth?: string[] } };

// AUTH_TRUST_HOST=1 はプロセス全体に効くため、/api/auth 側の allowlist だけでは
// このルート(NextAuth(agencyAuthOptions) を独立に呼ぶ別エントリポイント)への
// 防御が漏れる。ここでも agency host のみを許可する allowlist を独立に持つ。
function rejectUnknownHost(req: NextRequest) {
  if (isAllowedHost(req, AGENCY_AUTH_ALLOWED_HOSTS)) return null;
  return new Response("Invalid host", { status: 400 });
}

export async function GET(req: NextRequest, context: NextAuthContext) {
  const rejected = rejectUnknownHost(req);
  if (rejected) return rejected;
  return handler(req, context);
}

export async function POST(req: NextRequest, context: NextAuthContext) {
  const rejected = rejectUnknownHost(req);
  if (rejected) return rejected;
  return handler(req, context);
}
