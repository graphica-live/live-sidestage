import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

export interface MobileTokenPayload {
  userId: string;
  streamerId: string;
}

function getSecret(): string {
  const secret = process.env.MOBILE_JWT_SECRET;
  if (!secret) throw new Error("MOBILE_JWT_SECRET is not set");
  return secret;
}

export function signMobileToken(payload: MobileTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "90d" });
}

export function verifyMobileToken(token: string): MobileTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded === "string") return null;
    const { userId, streamerId } = decoded as Partial<MobileTokenPayload>;
    if (!userId || !streamerId) return null;
    return { userId, streamerId };
  } catch {
    return null;
  }
}

export function resolveStreamerByMobileToken(req: NextRequest): { id: string; userId: string } | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const payload = verifyMobileToken(header.slice("Bearer ".length));
  if (!payload) return null;

  return { id: payload.streamerId, userId: payload.userId };
}
