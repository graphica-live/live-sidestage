export interface Env {
  FRAMES_BUCKET: R2Bucket;
  DB: D1Database;
  SESSIONS: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_MONTHLY_PRICE_ID: string;
  STRIPE_YEARLY_PRICE_ID: string;
  // backward compatibility (older deployments)
  STRIPE_PRICE_ID?: string;
  // Optional: Stripe Billing Portal configuration id
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID?: string;
  RECAPTCHA_SECRET_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  LINE_CHANNEL_ID: string;
  LINE_CHANNEL_SECRET: string;
  SITE_URL: string;
}
