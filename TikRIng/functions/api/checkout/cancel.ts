import Stripe from 'stripe';
import type { Env } from '../../_types';
import { getSession } from '../../_session';
import { isAdminEmail } from '../../_auth';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const session = await getSession(ctx.env, ctx.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await ctx.env.DB.prepare(
    'SELECT id, email, plan, stripe_customer_id FROM users WHERE id = ?'
  )
    .bind(session.userId)
    .first<{ id: string; email: string | null; plan: string; stripe_customer_id: string | null }>();

  if (!user) {
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (isAdminEmail(user.email)) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
      status: 403,
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

  const returnUrl = `${ctx.env.SITE_URL}/?dashboard=1`;
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: returnUrl,
  });

  return new Response(JSON.stringify({ ok: true, url: portalSession.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
