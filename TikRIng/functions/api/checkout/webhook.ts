import Stripe from 'stripe';
import type { Env } from '../../_types';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const stripe = new Stripe(ctx.env.STRIPE_SECRET_KEY);
  const body = await ctx.request.text();
  const signature = ctx.request.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, ctx.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    if (userId) {
      await ctx.env.DB.prepare(
        'UPDATE users SET plan = ? WHERE id = ?'
      ).bind('pro', userId).run();
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    await ctx.env.DB.prepare(
      'UPDATE users SET plan = ? WHERE stripe_customer_id = ?'
    ).bind('free', subscription.customer as string).run();
  }

  return new Response('ok', { status: 200 });
};
