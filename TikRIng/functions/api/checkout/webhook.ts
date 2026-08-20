import Stripe from 'stripe';
import type { Env } from '../../_types';

function getCustomerId(subscription: Stripe.Subscription): string | null {
  if (!subscription.customer) {
    return null;
  }

  return typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;
}

function getStripeConfig(env: Env): { secretKey: string; webhookSecret: string } | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!secretKey || !webhookSecret) {
    console.error('Stripe webhook configuration is missing', {
      hasSecretKey: Boolean(secretKey),
      hasWebhookSecret: Boolean(webhookSecret),
    });
    return null;
  }

  return { secretKey, webhookSecret };
}

async function handleCheckoutCompleted(ctx: EventContext<Env, string, unknown>, event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const userId = session.metadata?.userId;

  if (!userId) {
    console.warn('Stripe webhook checkout.session.completed missing metadata.userId', {
      eventId: event.id,
      sessionId: session.id,
    });
    return;
  }

  await ctx.env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind('pro', userId).run();
}

async function handleSubscriptionUpdated(ctx: EventContext<Env, string, unknown>, event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = getCustomerId(subscription);

  if (!customerId) {
    console.warn('Stripe webhook customer.subscription.updated missing customer', {
      eventId: event.id,
      subscriptionId: subscription.id,
    });
    return;
  }

  const isPro = subscription.status === 'active' || subscription.status === 'trialing';

  if (!isPro) {
    const userRow = await ctx.env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
      .bind(customerId)
      .first<{ id: string }>();

    if (userRow?.id) {
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      const newExpiresAt = Date.now() + ninetyDaysMs;
      await ctx.env.DB.prepare(
        'UPDATE frames SET expires_at = ? WHERE owner_id = ? AND expires_at IS NULL'
      ).bind(newExpiresAt, userRow.id).run();
    }
  }

  await ctx.env.DB.prepare('UPDATE users SET plan = ? WHERE stripe_customer_id = ?')
    .bind(isPro ? 'pro' : 'free', customerId)
    .run();
}

async function handleSubscriptionDeleted(ctx: EventContext<Env, string, unknown>, event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = getCustomerId(subscription);

  if (!customerId) {
    console.warn('Stripe webhook customer.subscription.deleted missing customer', {
      eventId: event.id,
      subscriptionId: subscription.id,
    });
    return;
  }

  const userRow = await ctx.env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
    .bind(customerId)
    .first<{ id: string }>();

  if (userRow?.id) {
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const newExpiresAt = Date.now() + ninetyDaysMs;
    await ctx.env.DB.prepare(
      'UPDATE frames SET expires_at = ? WHERE owner_id = ? AND expires_at IS NULL'
    ).bind(newExpiresAt, userRow.id).run();
  }

  await ctx.env.DB.prepare("UPDATE users SET plan = 'free' WHERE stripe_customer_id = ?")
    .bind(customerId)
    .run();
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const stripeConfig = getStripeConfig(ctx.env);
  if (!stripeConfig) {
    return new Response('Stripe webhook is not configured', { status: 500 });
  }

  const signature = ctx.request.headers.get('stripe-signature')?.trim();
  if (!signature) {
    console.error('Stripe webhook request is missing stripe-signature header');
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const stripe = new Stripe(stripeConfig.secretKey);
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  const body = await ctx.request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      stripeConfig.webhookSecret,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    console.error('Stripe webhook signature verification failed', {
      error: err,
    });
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(ctx, event);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(ctx, event);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(ctx, event);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Stripe webhook handler error', {
      eventId: event.id,
      eventType: event.type,
      error: err,
    });
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
};
