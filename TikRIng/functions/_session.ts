import type { Env } from './_types';

export interface SessionData {
  userId: string;
  expiresAt: number;
}

export interface GoodActorData {
  actorId: string;
  actorType: 'user' | 'guest';
  setCookie?: string;
}

const SESSION_TTL = 60 * 60 * 24 * 30; // 30日（秒）
const GOOD_ACTOR_COOKIE = 'good_actor';
const GOOD_ACTOR_TTL = 60 * 60 * 24 * 365; // 365日（秒）

function getCookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const pattern = new RegExp(`(?:^|; )${name}=([^;]+)`);
  const match = cookie.match(pattern);
  return match ? match[1] : null;
}

function buildCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

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
  const match = getCookieValue(request, 'session');
  if (!match) return null;

  const raw = await env.SESSIONS.get(`session_${match}`);
  if (!raw) return null;

  const data: SessionData = JSON.parse(raw);
  if (Date.now() > data.expiresAt) return null;

  return data;
}

export function setSessionCookie(token: string): string {
  return buildCookie('session', token, SESSION_TTL);
}

export function clearSessionCookie(): string {
  return `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function resolveGoodActor(env: Env, request: Request): Promise<GoodActorData> {
  const session = await getSession(env, request);
  if (session) {
    return {
      actorId: session.userId,
      actorType: 'user',
    };
  }

  const existingGuestActor = getCookieValue(request, GOOD_ACTOR_COOKIE);
  if (existingGuestActor) {
    return {
      actorId: existingGuestActor,
      actorType: 'guest',
    };
  }

  const actorId = crypto.randomUUID();
  return {
    actorId,
    actorType: 'guest',
    setCookie: buildCookie(GOOD_ACTOR_COOKIE, actorId, GOOD_ACTOR_TTL),
  };
}
