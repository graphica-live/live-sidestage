import Stripe from 'stripe';
import type { Env } from '../../_types';
import { getSession } from '../../_session';
import { ensureStripeCustomer, getStripeSecretKey } from './_stripe';

const DONATION_CURRENCY = 'jpy';
const MIN_DONATION_YEN = 100;
const MAX_DONATION_YEN = 100000;
const DONATION_UNIT_YEN = 100;

function getSafeReturnPath(rawValue: unknown): string {
  if (typeof rawValue !== 'string' || !rawValue.startsWith('/')) {
    return '/';
  }

  if (rawValue.startsWith('//')) {
    return '/';
  }

  return rawValue;
}

function normalizeDonationAmount(rawValue: unknown): number | null {
  const amount = typeof rawValue === 'number' ? rawValue : Number(rawValue);

  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return null;
  }

  if (amount < MIN_DONATION_YEN || amount > MAX_DONATION_YEN) {
    return null;
  }

  if (amount % DONATION_UNIT_YEN !== 0) {
    return null;
  }

  return amount;
}

function getStripeErrorDetails(error: unknown): { message: string | null; code: string | null; type: string | null } {
  if (!error || typeof error !== 'object') {
    return { message: null, code: null, type: null };
  }

  const candidate = error as { message?: unknown; code?: unknown; type?: unknown };

  return {
    message: typeof candidate.message === 'string' ? candidate.message : null,
    code: typeof candidate.code === 'string' ? candidate.code : null,
    type: typeof candidate.type === 'string' ? candidate.type : null,
  };
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const body = await ctx.request.json().catch(() => ({} as Record<string, unknown>));
  const returnPath = getSafeReturnPath(body.returnPath);
  const amount = normalizeDonationAmount(body.amount);

  if (amount === null) {
    return new Response(JSON.stringify({ error: 'INVALID_DONATION_AMOUNT' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const session = await getSession(ctx.env, ctx.request);
    const secretKey = getStripeSecretKey(ctx.env);
    if (!secretKey) {
      console.error('Donation checkout configuration is missing STRIPE_SECRET_KEY');
      return new Response(JSON.stringify({ error: 'MISSING_STRIPE_SECRET_KEY' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(secretKey);
    const siteUrl = new URL(ctx.request.url).origin;
    const successUrl = new URL(returnPath, siteUrl);
    successUrl.searchParams.set('support', 'success');

    const cancelUrl = new URL(returnPath, siteUrl).toString();

    let customerId: string | undefined;
    const userId = session?.userId ?? null;

    if (userId) {
      const user = await ctx.env.DB.prepare(
        'SELECT id, email, stripe_customer_id FROM users WHERE id = ?'
      ).bind(userId).first<{ id: string; email: string; stripe_customer_id: string | null }>();

      if (user) {
        customerId = await ensureStripeCustomer(ctx.env, stripe, user);
      }
    }

    const checkoutParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: DONATION_CURRENCY,
          unit_amount: amount,
          product_data: {
            name: 'TikRing Support Donation',
          },
        },
        quantity: 1,
      }],
      success_url: successUrl.toString(),
      cancel_url: cancelUrl,
      payment_method_types: ['card'],
      metadata: userId
        ? { userId, purpose: 'donation', amountYen: String(amount) }
        : { purpose: 'donation', amountYen: String(amount) },
    };

    if (customerId) {
      checkoutParams.customer = customerId;
    }

    const checkoutSession = await stripe.checkout.sessions.create(checkoutParams);

    return new Response(JSON.stringify({ url: checkoutSession.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const stripeError = getStripeErrorDetails(error);

    console.error('Donation checkout creation failed', {
      error,
      amount,
      stripeError,
    });

    return new Response(JSON.stringify({
      error: 'DONATION_CHECKOUT_FAILED',
      details: stripeError.message,
      code: stripeError.code,
      type: stripeError.type,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};