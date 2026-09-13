import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";
import {
  issueRefreshToken,
  rotateRefreshToken,
  verifyMobileToken,
  type AuthClient,
  type MobileTokenPayload,
} from "@/lib/mobile-auth";
import { markLastActive } from "@/lib/mark-last-active";

export const DESKTOP_JWT_AUDIENCE = "desktop";
const ACCESS_TOKEN_TTL = "1h";

function getDesktopSecret(): string {
  const secret = process.env.DESKTOP_JWT_SECRET;
  if (!secret) throw new Error("DESKTOP_JWT_SECRET is not set");
  return secret;
}

export type DesktopTokenPayload = MobileTokenPayload;

export function signDesktopToken(payload: DesktopTokenPayload): string {
  return jwt.sign(payload, getDesktopSecret(), {
    expiresIn: ACCESS_TOKEN_TTL,
    audience: DESKTOP_JWT_AUDIENCE,
  });
}

export function verifyDesktopToken(token: string): DesktopTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getDesktopSecret(), { audience: DESKTOP_JWT_AUDIENCE });
    if (typeof decoded === "string") return null;
    const { principalId, streamerId, iat } = decoded as Partial<DesktopTokenPayload> & { iat?: number };
    if (!principalId) return null;
    if (typeof iat !== "number") return null;
    return { principalId, streamerId: streamerId || undefined };
  } catch {
    return null;
  }
}

export function resolveUserByDesktopToken(req: NextRequest): { principalId: string } | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const payload = verifyDesktopToken(header.slice("Bearer ".length));
  if (!payload) return null;
  void markLastActive(payload.principalId);
  return { principalId: payload.principalId };
}

export async function issueDesktopRefreshToken(input: {
  principalId: string;
  streamerId?: string | null;
}): Promise<string> {
  return issueRefreshToken({
    principalId: input.principalId,
    streamerId: input.streamerId ?? null,
    client: "desktop" satisfies AuthClient,
  });
}

export async function rotateDesktopRefreshToken(rawToken: string) {
  return rotateRefreshToken(rawToken, {
    client: "desktop",
    signAccessToken: (payload) => signDesktopToken(payload),
  });
}

export function isMobileToken(token: string): boolean {
  return verifyMobileToken(token) !== null;
}