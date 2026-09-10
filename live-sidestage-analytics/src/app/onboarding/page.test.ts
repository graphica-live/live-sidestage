import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetServerSession = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: { streamer: { findUnique: (...args: unknown[]) => mockFindUnique(...args) } },
}));
vi.mock("./OnboardingScreen", () => ({
  OnboardingScreen: () => "ONBOARDING_SCREEN",
}));

import OnboardingPage from "./page";
import { OnboardingScreen } from "./OnboardingScreen";

describe("OnboardingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未ログインなら/loginへredirectする", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(OnboardingPage()).rejects.toThrow("REDIRECT:/login");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("Streamer登録済みなら/analyticsへredirectする", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "principal-1" } });
    mockFindUnique.mockResolvedValue({ id: "streamer-1" });

    await expect(OnboardingPage()).rejects.toThrow("REDIRECT:/analytics");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { principalId: "principal-1" } });
  });

  it("未登録ならredirectせずOnboardingScreenを描画する", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "principal-1" } });
    mockFindUnique.mockResolvedValue(null);

    const result = await OnboardingPage();

    expect(result.type).toBe(OnboardingScreen);
  });
});
