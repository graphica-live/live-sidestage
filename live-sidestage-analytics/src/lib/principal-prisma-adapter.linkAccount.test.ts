// linkAccountRestrictedAdapter() の単体テスト。
//
// design-review(HIGH)で判明した「既存ログインセッション中に別プロバイダのOAuthへ入ると、
// next-authがメール・プロバイダ種別を一切見ずに現在の User へ linkAccount() する」経路を
// 塞げているかを、next-authやDBを介さずアダプタ単体で固定する。
// (`signIn`コールバックはこの経路を検知できないため、ここでの担保が唯一の防波堤)
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import jwt from "jsonwebtoken";

vi.mock("./web-apple-auth", () => ({
  webAppleConfig: vi.fn(),
}));

import { linkAccountRestrictedAdapter } from "./principal-prisma-adapter";
import { webAppleConfig } from "./web-apple-auth";

const webAppleConfigMock = vi.mocked(webAppleConfig);

function fakePrisma(existingCount: number): { prisma: PrismaClient; count: ReturnType<typeof vi.fn> } {
  const count = vi.fn().mockResolvedValue(existingCount);
  const prisma = { oAuthAccount: { count } } as unknown as PrismaClient;
  return { prisma, count };
}

function fakeBase(): { base: Adapter; linkAccount: ReturnType<typeof vi.fn> } {
  const linkAccount = vi.fn().mockImplementation(async (data: AdapterAccount) => data);
  const base = { linkAccount } as unknown as Adapter;
  return { base, linkAccount };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkAccountRestrictedAdapter", () => {
  it("link先Userが既にAccountを1件以上持っていれば拒否する(既存ログインセッション中の暗黙統合を防ぐ)", async () => {
    const { prisma, count } = fakePrisma(1);
    const { base, linkAccount } = fakeBase();
    const adapter = linkAccountRestrictedAdapter(prisma, base);

    const account: AdapterAccount = {
      provider: "google",
      type: "oauth",
      providerAccountId: "google-sub",
      userId: "existing-user-id",
    };

    await expect(adapter.linkAccount!(account)).rejects.toThrow(/implicit account linking refused/);
    expect(count).toHaveBeenCalledWith({ where: { userId: "existing-user-id" } });
    expect(linkAccount).not.toHaveBeenCalled();
  });

  it("Apple→Google方向も同じルールで拒否する(逆方向の確認)", async () => {
    const { prisma } = fakePrisma(1);
    const { base, linkAccount } = fakeBase();
    const adapter = linkAccountRestrictedAdapter(prisma, base);

    const account: AdapterAccount = {
      provider: "apple",
      type: "oauth",
      providerAccountId: "apple-sub",
      userId: "existing-user-id-from-apple-session",
      id_token: jwt.sign({ email: "leak@example.test" }, "test-secret"),
    };

    await expect(adapter.linkAccount!(account)).rejects.toThrow(/implicit account linking refused/);
    expect(linkAccount).not.toHaveBeenCalled();
  });

  it("Account 0件のUserへのlinkAccountは通す(新規作成・メール一致リンクの正当経路)", async () => {
    const { prisma } = fakePrisma(0);
    const { base, linkAccount } = fakeBase();
    const adapter = linkAccountRestrictedAdapter(prisma, base);

    const account: AdapterAccount = {
      provider: "google",
      type: "oauth",
      providerAccountId: "google-sub",
      userId: "new-user-id",
    };

    await adapter.linkAccount!(account);
    expect(linkAccount).toHaveBeenCalledWith(account);
  });

  it("provider!==appleならaccountをそのまま(providerEmail等を書き込まず)linkAccountへ渡す", async () => {
    const { prisma } = fakePrisma(0);
    const { base, linkAccount } = fakeBase();
    const adapter = linkAccountRestrictedAdapter(prisma, base);

    const account: AdapterAccount = {
      provider: "google",
      type: "oauth",
      providerAccountId: "google-sub",
      userId: "new-user-id",
      id_token: jwt.sign({ email: "should-not-be-read@example.test" }, "test-secret"),
    };

    await adapter.linkAccount!(account);
    const passed = linkAccount.mock.calls[0][0] as AdapterAccount & { providerEmail?: unknown };
    expect(passed.providerEmail).toBeUndefined();
  });

  it("provider===appleならid_tokenのemailクレームをdecodeしproviderEmail/appleClientIdへ書き込む", async () => {
    webAppleConfigMock.mockReturnValue({
      teamId: "team",
      keyId: "key",
      privateKey: "pk",
      servicesId: "com.example.web",
      bundleId: null,
    });
    const { prisma } = fakePrisma(0);
    const { base, linkAccount } = fakeBase();
    const adapter = linkAccountRestrictedAdapter(prisma, base);

    const idToken = jwt.sign({ email: "User@Example.TEST" }, "test-secret");
    const account: AdapterAccount = {
      provider: "apple",
      type: "oauth",
      providerAccountId: "apple-sub",
      userId: "new-user-id",
      id_token: idToken,
      refresh_token: "refresh-abc",
    };

    await adapter.linkAccount!(account);
    const passed = linkAccount.mock.calls[0][0] as AdapterAccount & {
      providerEmail?: unknown;
      appleClientId?: unknown;
    };
    // normalizeEmail() でtrim + 小文字化されること。
    expect(passed.providerEmail).toBe("user@example.test");
    expect(passed.appleClientId).toBe("com.example.web");
    expect(passed.refresh_token).toBe("refresh-abc");
  });

  it("apple providerでもid_tokenが無ければproviderEmailはnull(例外にしない)", async () => {
    webAppleConfigMock.mockReturnValue(null);
    const { prisma } = fakePrisma(0);
    const { base, linkAccount } = fakeBase();
    const adapter = linkAccountRestrictedAdapter(prisma, base);

    const account: AdapterAccount = {
      provider: "apple",
      type: "oauth",
      providerAccountId: "apple-sub",
      userId: "new-user-id",
    };

    await adapter.linkAccount!(account);
    const passed = linkAccount.mock.calls[0][0] as AdapterAccount & {
      providerEmail?: unknown;
      appleClientId?: unknown;
    };
    expect(passed.providerEmail).toBeNull();
    expect(passed.appleClientId).toBeNull();
  });
});
