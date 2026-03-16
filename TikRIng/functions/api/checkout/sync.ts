import Stripe from 'stripe';
import type { Env } from '../../_types';
import { getSession } from '../../_session';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const session = await getSession(ctx.env, ctx.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await ctx.env.DB.prepare(
    'SELECT id, plan, stripe_customer_id FROM users WHERE id = ?'
  ).bind(session.userId).first<{ id: string; plan: string; stripe_customer_id: string | null }>();

  if (!user) {
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!user.stripe_customer_id) {
    return new Response(JSON.stringify({ error: 'NO_CUSTOMER' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(ctx.env.STRIPE_SECRET_KEY);

  // Webhook遅延/失敗時の救済: Stripe側の現在状態を見て plan を同期する
  const subs = await stripe.subscriptions.list({
    customer: user.stripe_customer_id,
    status: 'all',
    limit: 10,
  });

  const isPro = subs.data.some((s) => s.status === 'active' || s.status === 'trialing');

  const plan = isPro ? 'pro' : 'free';

  // Pro→無料になったら、無期限(expires_at IS NULL)のフレームを「現在+90日」に切り替える
  if (plan === 'free') {
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const newExpiresAt = Date.now() + ninetyDaysMs;
    await ctx.env.DB.prepare(
      'UPDATE frames SET expires_at = ? WHERE owner_id = ? AND expires_at IS NULL'
    ).bind(newExpiresAt, user.id).run();
  }

  await ctx.env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, user.id).run();

  return new Response(JSON.stringify({ plan }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
