const ADMIN_EMAILS = new Set(['joe.graphica@gmail.com']);

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.has(normalizeEmail(email));
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