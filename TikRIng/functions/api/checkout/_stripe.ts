import Stripe from 'stripe';
import type { Env } from '../../_types';

interface StripeUserRecord {
  id: string;
  email: string | null;
  stripe_customer_id: string | null;
}

function isDeletedCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer): customer is Stripe.DeletedCustomer {
  return 'deleted' in customer && customer.deleted === true;
}

function isMissingCustomerError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: unknown; param?: unknown; message?: unknown; statusCode?: unknown };

  if (candidate.code === 'resource_missing' && candidate.param === 'customer') {
    return true;
  }

  if (candidate.statusCode === 404 && typeof candidate.message === 'string' && candidate.message.includes('No such customer')) {
    return true;
  }

  return false;
}

export function getStripeSecretKey(env: Env): string | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  return secretKey || null;
}

async function createAndPersistCustomer(
  env: Env,
  stripe: Stripe,
  user: StripeUserRecord,
): Promise<string> {
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { userId: user.id },
  });

  await env.DB.prepare(
    'UPDATE users SET stripe_customer_id = ? WHERE id = ?'
  ).bind(customer.id, user.id).run();

  return customer.id;
}

export async function ensureStripeCustomer(
  env: Env,
  stripe: Stripe,
  user: StripeUserRecord,
): Promise<string> {
  const existingCustomerId = user.stripe_customer_id?.trim();

  if (!existingCustomerId) {
    return createAndPersistCustomer(env, stripe, user);
  }

  try {
    const customer = await stripe.customers.retrieve(existingCustomerId);
    if (isDeletedCustomer(customer)) {
      return createAndPersistCustomer(env, stripe, user);
    }

    return existingCustomerId;
  } catch (error) {
    if (!isMissingCustomerError(error)) {
      throw error;
    }

    return createAndPersistCustomer(env, stripe, user);
  }
}