import type { Env } from './_types';

const ADMIN_EMAILS = new Set(['joe.graphica@gmail.com']);
const ANONYMOUS_NAME_DIGITS = 6;

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function normalizeDisplayName(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

export function formatAnonymousUserDisplayName(anonymousNumber: number): string {
  return `User${Math.max(anonymousNumber, 0).toString().padStart(ANONYMOUS_NAME_DIGITS, '0')}`;
}

export async function ensureAnonymousUserNumber(env: Env, userId: string, email: string | null | undefined): Promise<number | null> {
  if (isAdminEmail(email)) {
    return null;
  }

  const result = await env.DB.prepare(
    `INSERT INTO anonymous_user_numbers (user_id)
     VALUES (?)
     ON CONFLICT(user_id) DO UPDATE SET user_id = excluded.user_id
     RETURNING id`
  )
    .bind(userId)
    .first<{ id: number }>();

  return result?.id ?? null;
}

export function getResolvedUserDisplayName(options: {
  userId: string | null | undefined;
  email: string | null | undefined;
  anonymousDisplayNumber?: number | null;
  customDisplayName?: string | null;
  displayName?: string | null;
  fallback?: string;
}): string {
  const { userId, email, anonymousDisplayNumber, customDisplayName, displayName, fallback } = options;
  if (!isAdminEmail(email)) {
    if (typeof anonymousDisplayNumber === 'number' && Number.isFinite(anonymousDisplayNumber) && anonymousDisplayNumber > 0) {
      return formatAnonymousUserDisplayName(anonymousDisplayNumber);
    }

    const normalizedDisplayName = normalizeDisplayName(customDisplayName) || normalizeDisplayName(displayName);
    if (/^User\d+$/.test(normalizedDisplayName)) {
      return normalizedDisplayName;
    }

    return fallback ?? 'User000000';
  }

  const preferredName = normalizeDisplayName(customDisplayName) || normalizeDisplayName(displayName);
  if (preferredName) {
    return preferredName;
  }

  return fallback ?? `User${normalizeDisplayName(userId)}`;
}

export function getInitialUserDisplayName(
  anonymousNumber: number | null | undefined,
  email: string | null | undefined,
  providerDisplayName: string | null | undefined,
): string {
  if (!isAdminEmail(email)) {
    return typeof anonymousNumber === 'number' && anonymousNumber > 0
      ? formatAnonymousUserDisplayName(anonymousNumber)
      : 'User000000';
  }

  return normalizeDisplayName(providerDisplayName) || 'User000000';
}

export function getEffectivePlan(plan: string | null | undefined, email: string | null | undefined): string {
  if (isAdminEmail(email)) {
    return 'pro';
  }

  return plan ?? 'free';
}

export function isEffectivePro(plan: string | null | undefined, email: string | null | undefined): boolean {
  return getEffectivePlan(plan, email) === 'pro';
}