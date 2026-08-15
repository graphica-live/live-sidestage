import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

export interface MobileTokenPayload {
  userId: string;
  streamerId?: string;
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
    if (!userId) return null;
    return { userId, streamerId: streamerId || undefined };
  } catch {
    return null;
  }
}

function extractPayload(req: NextRequest): MobileTokenPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifyMobileToken(header.slice("Bearer ".length));
}

export function resolveStreamerByMobileToken(req: NextRequest): { id: string; userId: string } | null {
  const payload = extractPayload(req);
  if (!payload?.streamerId) return null;

  return { id: payload.streamerId, userId: payload.userId };
}

export function resolveUserByMobileToken(req: NextRequest): { userId: string } | null {
  const payload = extractPayload(req);
  if (!payload) return null;

  return { userId: payload.userId };
}
