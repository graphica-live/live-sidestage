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
  )
    .bind(session.userId)
    .first<{ id: string; plan: string; stripe_customer_id: string | null }>();

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

  // アクティブなサブスクリプションを取得
  const subs = await stripe.subscriptions.list({
    customer: user.stripe_customer_id,
    status: 'active',
    limit: 5,
  });

  if (subs.data.length === 0) {
    // trialing も確認
    const trialing = await stripe.subscriptions.list({
      customer: user.stripe_customer_id,
      status: 'trialing',
      limit: 5,
    });
    if (trialing.data.length === 0) {
      return new Response(JSON.stringify({ error: 'NO_ACTIVE_SUBSCRIPTION' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    subs.data.push(...trialing.data);
  }

  // 即時解約
  for (const sub of subs.data) {
    await stripe.subscriptions.cancel(sub.id);
  }

  // DB を即時更新（Webhook の到着を待たない）
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const newExpiresAt = Date.now() + ninetyDaysMs;
  await ctx.env.DB.prepare(
    'UPDATE frames SET expires_at = ? WHERE owner_id = ? AND expires_at IS NULL'
  )
    .bind(newExpiresAt, user.id)
    .run();

  await ctx.env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?')
    .bind('free', user.id)
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
