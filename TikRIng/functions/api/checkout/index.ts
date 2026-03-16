import Stripe from 'stripe';
import type { Env } from '../../_types';
import { getSession } from '../../_session';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const session = await getSession(ctx.env, ctx.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await ctx.request.json().catch(() => ({} as any));
  const interval = body?.interval === 'yearly' ? 'yearly' : 'monthly';

  const stripe = new Stripe(ctx.env.STRIPE_SECRET_KEY);
  const user = await ctx.env.DB.prepare(
    'SELECT id, email, stripe_customer_id FROM users WHERE id = ?'
  ).bind(session.userId).first<{ id: string; email: string; stripe_customer_id: string | null }>();

  if (!user) return new Response('Not Found', { status: 404 });

  // Stripe Customerを作成 or 既存を使用
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await ctx.env.DB.prepare(
      'UPDATE users SET stripe_customer_id = ? WHERE id = ?'
    ).bind(customerId, session.userId).run();
  }

  const siteUrl = new URL(ctx.request.url).origin;

  const monthlyPriceId = ctx.env.STRIPE_MONTHLY_PRICE_ID || ctx.env.STRIPE_PRICE_ID;
  const yearlyPriceId = ctx.env.STRIPE_YEARLY_PRICE_ID;
  const priceId = interval === 'yearly' ? yearlyPriceId : monthlyPriceId;
  if (!priceId) {
    return new Response(JSON.stringify({ error: 'MISSING_PRICE_ID' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl}/?checkout=success`,
    cancel_url: `${siteUrl}/`,
    metadata: { userId: session.userId },
  });

  return new Response(JSON.stringify({ url: checkoutSession.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
