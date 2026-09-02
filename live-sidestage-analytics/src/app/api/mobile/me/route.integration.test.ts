// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// getUserPlan / getBetaStatuses → hasFeatureAccessSync → GET /api/mobile/me /
// GET /api/mobile/entitlement/probe の配管を、モック無しの実DBとJWTで通しで確認する。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { setSetting } from "@/lib/settings";
import {
  MOBILE_MIN_SUPPORTED_VERSION_SETTING,
  MOBILE_LATEST_VERSION_SETTING,
  MOBILE_MAINTENANCE_MODE_SETTING,
} from "@/lib/mobile-settings";
import { betaSettingKey } from "@/lib/plan/beta-settings";
import { GET as mePost } from "./route";
import { GET as probeGet } from "../entitlement/probe/route";

const PREFIX = "itest-me-";

process.env.MOBILE_JWT_SECRET ||= "itest-me-secret";

function authedRequest(url: string, token: string) {
  return new NextRequest(url, { headers: { authorization: `Bearer ${token}` } });
}

async function cleanup() {
  await prisma.subscription.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await setSetting(betaSettingKey("mobile"), null);
  await setSetting(betaSettingKey("analytics"), null);
  await setSetting(betaSettingKey("events"), null);
  await setSetting(MOBILE_MIN_SUPPORTED_VERSION_SETTING, null);
  await setSetting(MOBILE_LATEST_VERSION_SETTING, null);
  await setSetting(MOBILE_MAINTENANCE_MODE_SETTING, null);
}

beforeEach(cleanup);
afterAll(cleanup);

describe("GET /api/mobile/me", () => {
  it("トークンが無ければ401", async () => {
    const response = await mePost(new NextRequest("https://example.test/api/mobile/me"));
    expect(response.status).toBe(401);
  });

  it("DBに存在しないUserのトークンは401(削除済みUser対策)", async () => {
    const token = signMobileToken({ userId: `${PREFIX}deleted-user` });
    const response = await mePost(authedRequest("https://example.test/api/mobile/me", token));
    expect(response.status).toBe(401);
  });

  it("β無効・Subscription無しはFREE、mobileBetaActive=false", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}free@local.test` } });
    const token = signMobileToken({ userId: user.id });

    const response = await mePost(authedRequest("https://example.test/api/mobile/me", token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan).toBe("FREE");
    expect(body.mobileBetaActive).toBe(false);
    expect(body.planLabel).toBe("FREE");
    expect(body.effectivePlan).toBeUndefined();
    expect(body.betaAccess).toBeUndefined();
    expect(body.features).toEqual([]);
    expect(body.minimumSupportedVersion).toBe("0.0.0");
    expect(body.latestVersion).toBeNull();
    expect(body.maintenanceMode).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("mobileβ有効でもSubscription無しならplanはFREEのまま、planLabelだけβFREEになる", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}beta@local.test` } });
    const token = signMobileToken({ userId: user.id });
    await setSetting(betaSettingKey("mobile"), "true");

    const response = await mePost(authedRequest("https://example.test/api/mobile/me", token));
    const body = await response.json();

    expect(body.plan).toBe("FREE");
    expect(body.mobileBetaActive).toBe(true);
    expect(body.planLabel).toBe("βFREE");
    // mobile.entitlementProbeにはbetaAreaを紐づけていないため、mobileβはこの機能を解放しない。
    expect(body.features).not.toContain("mobile.entitlementProbe");
  });

  it("analyticsβ有効ならFREEでもmobile.history.extendedRangeが解放される(実プランはFREEのまま)", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}analytics-beta@local.test` } });
    const token = signMobileToken({ userId: user.id });
    await setSetting(betaSettingKey("analytics"), "true");

    const response = await mePost(authedRequest("https://example.test/api/mobile/me", token));
    const body = await response.json();

    expect(body.plan).toBe("FREE");
    expect(body.planLabel).toBe("FREE"); // バッジ表記はmobile領域のβだけを見る
    expect(body.features).toContain("mobile.history.extendedRange");
    expect(body.features).toContain("mobile.history.listenerFilter");
    expect(body.features).not.toContain("mobile.entitlementProbe");
  });

  it("β無効時はSubscriptionのplanをそのまま反映する", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}pro@local.test` } });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "PRO",
        provider: "STRIPE",
        providerSubscriptionId: `${PREFIX}sub-pro`,
        entitlementActive: true,
      },
    });
    const token = signMobileToken({ userId: user.id });

    const response = await mePost(authedRequest("https://example.test/api/mobile/me", token));
    const body = await response.json();

    expect(body.plan).toBe("PRO");
    expect(body.mobileBetaActive).toBe(false);
  });

  it("mobileMinSupportedVersion/mobileMaintenanceModeをAppSettingから反映する", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}settings@local.test` } });
    const token = signMobileToken({ userId: user.id });
    await setSetting(MOBILE_MIN_SUPPORTED_VERSION_SETTING, "2.1.0");
    await setSetting(MOBILE_LATEST_VERSION_SETTING, "2.3.0");
    await setSetting(MOBILE_MAINTENANCE_MODE_SETTING, "true");

    const response = await mePost(authedRequest("https://example.test/api/mobile/me", token));
    const body = await response.json();

    expect(body.minimumSupportedVersion).toBe("2.1.0");
    expect(body.latestVersion).toBe("2.3.0");
    expect(body.maintenanceMode).toBe(true);
  });
});

describe("GET /api/mobile/entitlement/probe (requireFeatureの実証)", () => {
  it("FREEプランは403", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}probe-free@local.test` } });
    const token = signMobileToken({ userId: user.id });

    const response = await probeGet(authedRequest("https://example.test/api/mobile/entitlement/probe", token));

    expect(response.status).toBe(403);
  });

  it("mobileβが有効でもbetaArea未設定の機能は403のまま(betaAccessのULTRA昇格は廃止済み)", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}probe-mobilebeta@local.test` } });
    const token = signMobileToken({ userId: user.id });
    await setSetting(betaSettingKey("mobile"), "true");

    const response = await probeGet(authedRequest("https://example.test/api/mobile/entitlement/probe", token));

    expect(response.status).toBe(403);
  });

  it("PRO以上は200", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}probe-pro@local.test` } });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "PRO",
        provider: "STRIPE",
        providerSubscriptionId: `${PREFIX}sub-probe-pro`,
        entitlementActive: true,
      },
    });
    const token = signMobileToken({ userId: user.id });

    const response = await probeGet(authedRequest("https://example.test/api/mobile/entitlement/probe", token));

    expect(response.status).toBe(200);
  });

  it("Flutter側でボタンを隠しただけでは意味がないことの実証: トークンさえあればプラン不足は必ずサーバー側で弾かれる", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}probe-direct@local.test` } });
    const token = signMobileToken({ userId: user.id });

    // クライアント側の分岐を一切経由せず、直接APIへ到達した想定。
    const response = await probeGet(authedRequest("https://example.test/api/mobile/entitlement/probe", token));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBeTruthy();
  });
});
