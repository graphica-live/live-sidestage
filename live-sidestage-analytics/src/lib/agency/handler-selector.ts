import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { agencyAuthOptions } from "@/lib/agency/auth";
import { AGENCY_APPLE_PROVIDER_ID, AGENCY_GOOGLE_PROVIDER_ID } from "@/lib/agency/session-cookie";

export const streamerHandler = NextAuth(authOptions);
export const agencyHandler = NextAuth(agencyAuthOptions);

export type NextAuthContext = { params: { nextauth?: string[] } };

// 事務所セッションは /api/agency-auth に分離しているが、Google/Apple OAuth の
// redirect_uri だけはここへ戻ってくる。NextAuth v4 が redirect_uri を必ず
// `<origin>/api/auth/callback/<providerId>` として組み立てるため
// (詳細は AGENCY_GOOGLE_PROVIDER_ID のコメント)。
//
// 事務所用プロバイダには専用 id を与えてあるので、パスの2要素目で振り分けられる。
// これで Cookie は別のまま(事務所は agency-auth.* を読み書きする)、
// 配信者側の /api/auth/callback/google / /api/auth/callback/apple とも衝突しない。
const AGENCY_PROVIDER_IDS = new Set([AGENCY_GOOGLE_PROVIDER_ID, AGENCY_APPLE_PROVIDER_ID]);

export function handlerFor(context: NextAuthContext) {
  const providerId = context.params?.nextauth?.[1] ?? "";
  return AGENCY_PROVIDER_IDS.has(providerId) ? agencyHandler : streamerHandler;
}
