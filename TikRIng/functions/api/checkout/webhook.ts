import Stripe from 'stripe';
import type { Env } from '../../_types';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const stripe = new Stripe(ctx.env.STRIPE_SECRET_KEY);
  const body = await ctx.request.text();
  const signature = ctx.request.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, ctx.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    try {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (userId) {
        await ctx.env.DB.prepare(
          'UPDATE users SET plan = ? WHERE id = ?'
        ).bind('pro', userId).run();
      }
    } catch (err) {
      console.error('Webhook handler error (checkout.session.completed):', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  if (event.type === 'customer.subscription.updated') {
    try {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

      // statusがactive/trialing以外なら無料へ（cancel_at_period_end=trueでもstatusがactiveの間はPro継続）
      const isPro = subscription.status === 'active' || subscription.status === 'trialing';
      await ctx.env.DB.prepare(
        'UPDATE users SET plan = ? WHERE stripe_customer_id = ?'
      ).bind(isPro ? 'pro' : 'free', customerId).run();
    } catch (err) {
      console.error('Webhook handler error (customer.subscription.updated):', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    try {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

      // 1) stripe_customer_idからuserのidを取得
      const userRow = await ctx.env.DB.prepare(
        'SELECT id FROM users WHERE stripe_customer_id = ?'
      ).bind(customerId).first<{ id: string }>();

      // 2) 無期限(expires_at IS NULL)のフレームを「現在+90日」に切り替え
      if (userRow?.id) {
        const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
        const newExpiresAt = Date.now() + ninetyDaysMs;
        await ctx.env.DB.prepare(
          'UPDATE frames SET expires_at = ? WHERE owner_id = ? AND expires_at IS NULL'
        ).bind(newExpiresAt, userRow.id).run();
      }

      // 3) usersテーブルのplanをfreeに更新
      await ctx.env.DB.prepare(
        "UPDATE users SET plan = 'free' WHERE stripe_customer_id = ?"
      ).bind(customerId).run();
    } catch (err) {
      console.error('Webhook handler error (customer.subscription.deleted):', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  return new Response('ok', { status: 200 });
};
