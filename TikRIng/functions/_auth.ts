const ADMIN_EMAILS = new Set(['joe.graphica@gmail.com']);

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function normalizeDisplayName(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

export function getAnonymousUserDisplayName(userId: string | null | undefined): string {
  const seed = (userId ?? '').trim();
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 10000;
  }

  return `User${hash.toString().padStart(4, '0')}`;
}

export function getResolvedUserDisplayName(options: {
  userId: string | null | undefined;
  email: string | null | undefined;
  customDisplayName?: string | null;
  displayName?: string | null;
  fallback?: string;
}): string {
  const { userId, email, customDisplayName, displayName, fallback } = options;
  if (!isAdminEmail(email)) {
    return getAnonymousUserDisplayName(userId);
  }

  const preferredName = normalizeDisplayName(customDisplayName) || normalizeDisplayName(displayName);
  if (preferredName) {
    return preferredName;
  }

  return fallback ?? getAnonymousUserDisplayName(userId);
}

export function getInitialUserDisplayName(
  userId: string | null | undefined,
  email: string | null | undefined,
  providerDisplayName: string | null | undefined,
): string {
  if (!isAdminEmail(email)) {
    return getAnonymousUserDisplayName(userId);
  }

  return normalizeDisplayName(providerDisplayName) || getAnonymousUserDisplayName(userId);
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