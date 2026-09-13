// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { POST } from "./route";

const TIKTOK_ID = "itest_mobile_ranking_avatars";

let principalId: string;
let roomId: string;
let noRoomPrincipalId: string;
let token: string;
let noRoomToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-ranking-avatars-secret";

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: TIKTOK_ID, hostTiktokUid: makeTiktokUid(TIKTOK_ID) },
  });
  roomId = room.id;

  const user = await prisma.principal.create({
    data: { email: `itest-mobile-ranking-avatars-${Date.now()}@local.test` },
  });
  principalId = user.id;
  await prisma.streamer.create({
    data: {
      principalId,
      tiktokUid: makeTiktokUid(TIKTOK_ID),
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: false,
      roomId,
    },
  });
  token = signMobileToken({ principalId });

  const noRoom = await prisma.principal.create({
    data: { email: `itest-mobile-ranking-avatars-noroom-${Date.now()}@local.test` },
  });
  noRoomPrincipalId = noRoom.id;
  noRoomToken = signMobileToken({ principalId: noRoomPrincipalId });
});

afterAll(async () => {
  await prisma.principal.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: noRoomPrincipalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {});
  await prisma.$disconnect();
});

function request(bearer: string | undefined, body: unknown) {
  return new NextRequest("http://localhost/api/mobile/analytics/ranking/avatars", {
    method: "POST",
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/analytics/ranking/avatars", () => {
  it("returns 401 without a token", async () => {
    const res = await POST(request(undefined, { uids: [] }));
    expect(res.status).toBe(401);
  });

  it("unregistered streamer gets 200 { avatars: [] }", async () => {
    const res = await POST(request(noRoomToken, { uids: ["7000000000000000001"] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ avatars: [] });
  });

  it("rejects malformed uids with 400", async () => {
    expect((await POST(request(token, { uids: "nope" }))).status).toBe(400);
    expect((await POST(request(token, {}))).status).toBe(400);
    expect((await POST(request(token, { uids: [""] }))).status).toBe(400);
    expect((await POST(request(token, { uids: [1] }))).status).toBe(400);
    expect((await POST(request(token, { uids: Array.from({ length: 201 }, () => "a") }))).status).toBe(
      400
    );
  });

  it("authenticated empty uids returns { avatars: [] }", async () => {
    const res = await POST(request(token, { uids: [] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ avatars: [] });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
