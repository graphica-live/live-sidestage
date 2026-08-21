import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth";
import { agencyAuthOptions } from "@/lib/agency/auth";
import { AGENCY_GOOGLE_PROVIDER_ID } from "@/lib/agency/session-cookie";

const streamerHandler = NextAuth(authOptions);
const agencyHandler = NextAuth(agencyAuthOptions);

type NextAuthContext = { params: { nextauth?: string[] } };

// 事務所セッションは /api/agency-auth に分離しているが、Google OAuth の
// redirect_uri だけはここへ戻ってくる。NextAuth v4 が redirect_uri を必ず
// `<origin>/api/auth/callback/<providerId>` として組み立てるため
// (詳細は AGENCY_GOOGLE_PROVIDER_ID のコメント)。
//
// 事務所用プロバイダには専用 id を与えてあるので、パスの2要素目で振り分けられる。
// これで Cookie は別のまま(事務所は agency-auth.* を読み書きする)、
// 配信者側の /api/auth/callback/google とも衝突しない。
function handlerFor(context: NextAuthContext) {
  const providerId = context.params?.nextauth?.[1];
  return providerId === AGENCY_GOOGLE_PROVIDER_ID ? agencyHandler : streamerHandler;
}

export async function GET(req: NextRequest, context: NextAuthContext) {
  return handlerFor(context)(req, context);
}

export async function POST(req: NextRequest, context: NextAuthContext) {
  return handlerFor(context)(req, context);
}
