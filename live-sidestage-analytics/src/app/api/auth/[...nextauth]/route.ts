import type { NextRequest } from "next/server";
import { handlerFor, type NextAuthContext } from "@/lib/agency/handler-selector";
import { isAllowedHost, STREAMER_AUTH_ALLOWED_HOSTS } from "@/lib/canonical-origin";

// AUTH_TRUST_HOST=1 は転送された Host ヘッダを検証なしに信頼して OAuth の origin を
// 組み立てる。このルートは src/middleware.ts の matcher から除外されているため、
// ここで明示的に Host の正当性を検証する(不正な Host を騙るリクエストを弾く)。
function rejectUnknownHost(req: NextRequest) {
  if (isAllowedHost(req, STREAMER_AUTH_ALLOWED_HOSTS)) return null;
  return new Response("Invalid host", { status: 400 });
}

export async function GET(req: NextRequest, context: NextAuthContext) {
  const rejected = rejectUnknownHost(req);
  if (rejected) return rejected;
  return handlerFor(context)(req, context);
}

export async function POST(req: NextRequest, context: NextAuthContext) {
  const rejected = rejectUnknownHost(req);
  if (rejected) return rejected;
  return handlerFor(context)(req, context);
}
