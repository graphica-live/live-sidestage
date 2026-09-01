import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { syncSubscriptionFromGoogle } from "@/lib/plan/sync-subscription-google";

export const runtime = "nodejs";

const oauthClient = new OAuth2Client();

// Pub/Sub Pushのボディ形式(https://cloud.google.com/pubsub/docs/push)。
interface PubSubPushBody {
  message?: { data?: string; messageId?: string };
  subscription?: string;
}

// RTDNのdataフィールドをdecodeしたJSON(Real-time developer notifications reference)。
interface DeveloperNotification {
  subscriptionNotification?: { purchaseToken?: string };
}

async function verifyOidcToken(authorizationHeader: string | null): Promise<boolean> {
  const audience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  const expectedEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  if (!audience || !expectedEmail) return false;
  if (!authorizationHeader?.startsWith("Bearer ")) return false;

  const token = authorizationHeader.slice("Bearer ".length);
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    return payload?.email === expectedEmail && payload.email_verified === true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const authorized = await verifyOidcToken(req.headers.get("authorization"));
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as PubSubPushBody | null;
  const data = body?.message?.data;
  if (!data) {
    return NextResponse.json({ error: "missing message.data" }, { status: 400 });
  }

  let notification: DeveloperNotification;
  try {
    notification = JSON.parse(Buffer.from(data, "base64").toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "invalid message.data" }, { status: 400 });
  }

  const purchaseToken = notification.subscriptionNotification?.purchaseToken;
  if (!purchaseToken) {
    // テストのUnknown通知等、purchaseTokenが無い通知は無視して成功扱いにする。
    return NextResponse.json({ received: true });
  }

  try {
    await syncSubscriptionFromGoogle(purchaseToken);
  } catch (err) {
    // 握り潰して200を返さない。Pub/Sub Push側の自動再送に乗せる
    // (verify-purchase未到達によるPendingPurchaseIntent未解決もここで拾われる)。
    console.error("google-play webhook handler failed", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
