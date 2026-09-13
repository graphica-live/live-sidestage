import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { jstDateKey } from "../src/lib/overlay/day-key";
import { watchedRoomFilter } from "../src/lib/watched-room-filter";
import {
  IOS_REVIEW_EMAIL,
  IOS_REVIEW_HANDLE,
  IOS_REVIEW_HOST_UID,
  IOS_REVIEW_PASSWORD,
  purgeIosReviewAccount,
  seedIosReviewAccount,
} from "./seed-ios-review-account";

process.env.MOBILE_JWT_SECRET ||= "itest-ios-review-account-secret";

const { POST: loginPost } = await import("../src/app/api/mobile/auth/email/login/route");
const { GET: rankingGet } = await import("../src/app/api/mobile/analytics/ranking/route");
const { GET: giftHistoryGet } = await import("../src/app/api/mobile/analytics/gift-history/route");
const { GET: battlesGet } = await import("../src/app/api/mobile/analytics/battles/route");

function loginRequest() {
  return new NextRequest("https://example.test/api/mobile/auth/email/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: IOS_REVIEW_EMAIL, password: IOS_REVIEW_PASSWORD }),
  });
}

function authedGet(path: string, token: string) {
  const today = jstDateKey();
  return new NextRequest(`https://example.test${path}?period=day&date=${today}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("iOS審査用アカウントseed", () => {
  beforeAll(async () => {
    await purgeIosReviewAccount();
    await seedIosReviewAccount();
  }, 30_000);

  afterAll(async () => {
    await purgeIosReviewAccount();
  }, 30_000);

  it("短いパスワードでもメールログインでき、オンボーディング済みになる", async () => {
    const response = await loginPost(loginRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.user.email).toBe(IOS_REVIEW_EMAIL);
    expect(body.onboardingRequired).toBe(false);
    expect(body.streamer?.tiktokHandle).toBe(IOS_REVIEW_HANDLE);
    expect(typeof body.token).toBe("string");
  });

  it("偽TikTok roomはhandleStaleAtでWorker接続対象外になる", async () => {
    await loginPost(loginRequest());
    const room = await prisma.tiktokRoom.findUnique({
      where: { hostTiktokUid: IOS_REVIEW_HOST_UID },
      select: { handleStaleAt: true },
    });
    expect(room?.handleStaleAt).not.toBeNull();
    const selected = await prisma.tiktokRoom.findMany({
      where: { handleStaleAt: null, ...watchedRoomFilter() },
      select: { hostTiktokUid: true },
    });
    expect(selected.some((r) => r.hostTiktokUid === IOS_REVIEW_HOST_UID)).toBe(false);
  });

  it("貢献・ギフト・バトル履歴の当日データが空でない", async () => {
    const login = await loginPost(loginRequest());
    const session = await login.json();
    const token = session.token as string;

    const ranking = await rankingGet(authedGet("/api/mobile/analytics/ranking", token));
    const rankingBody = await ranking.json();
    expect(ranking.status).toBe(200);
    expect(rankingBody.users.length).toBeGreaterThan(0);
    expect(rankingBody.total.totalDiamonds).toBeGreaterThan(0);

    const gifts = await giftHistoryGet(authedGet("/api/mobile/analytics/gift-history", token));
    const giftsBody = await gifts.json();
    expect(gifts.status).toBe(200);
    expect(giftsBody.events.length).toBeGreaterThan(0);

    const battles = await battlesGet(authedGet("/api/mobile/analytics/battles", token));
    const battlesBody = await battles.json();
    expect(battles.status).toBe(200);
    expect(battlesBody.battles.length).toBeGreaterThan(0);
  });
});

describe("ios-review-account purge isolation", () => {
  const bystanderEmail = "itest-ios-review-bystander@local.test";
  const bystanderUid = "7700000000000999999";

  afterAll(async () => {
    await prisma.principal.deleteMany({ where: { email: bystanderEmail } });
    await prisma.tiktokRoom.deleteMany({ where: { hostTiktokUid: bystanderUid } });
    await prisma.tikTokUser.deleteMany({ where: { tiktokUid: bystanderUid } });
  });

  it("purge keeps unrelated principal and room", async () => {
    await prisma.tikTokUser.upsert({
      where: { tiktokUid: bystanderUid },
      update: { tiktokHandle: "bystander_room", nickname: "bystander" },
      create: { tiktokUid: bystanderUid, tiktokHandle: "bystander_room", nickname: "bystander" },
    });
    const room = await prisma.tiktokRoom.upsert({
      where: { hostTiktokUid: bystanderUid },
      update: {},
      create: { hostTiktokUid: bystanderUid, tiktokHandle: "bystander_room" },
    });
    const user = await prisma.principal.create({ data: { email: bystanderEmail, name: "bystander" } });

    await seedIosReviewAccount();
    await purgeIosReviewAccount();

    expect(await prisma.principal.findUnique({ where: { email: bystanderEmail } })).not.toBeNull();
    expect(await prisma.tiktokRoom.findUnique({ where: { id: room.id } })).not.toBeNull();
    expect(await prisma.principal.findUnique({ where: { email: IOS_REVIEW_EMAIL } })).toBeNull();
    expect(user.id).toBeTruthy();
  });
});
