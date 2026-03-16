import type { Env } from './_types';

export interface SessionData {
  userId: string;
  expiresAt: number;
}

const SESSION_TTL = 60 * 60 * 24 * 30; // 30日（秒）

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const data: SessionData = {
    userId,
    expiresAt: Date.now() + SESSION_TTL * 1000,
  };
  await env.SESSIONS.put(`session_${token}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL,
  });
  return token;
}

export async function getSession(env: Env, request: Request): Promise<SessionData | null> {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;

  const raw = await env.SESSIONS.get(`session_${match[1]}`);
  if (!raw) return null;

  const data: SessionData = JSON.parse(raw);
  if (Date.now() > data.expiresAt) return null;

  return data;
}

export function setSessionCookie(token: string): string {
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie(): string {
  return `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
