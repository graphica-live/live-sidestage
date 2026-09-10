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

import AnalyticsLayout from "./layout";

describe("AnalyticsLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未ログインなら/loginへredirectする", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(AnalyticsLayout({ children: "CHILD" })).rejects.toThrow("REDIRECT:/login");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("ログイン済みだがStreamer未登録なら/onboardingへredirectする", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "principal-1" } });
    mockFindUnique.mockResolvedValue(null);

    await expect(AnalyticsLayout({ children: "CHILD" })).rejects.toThrow("REDIRECT:/onboarding");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { principalId: "principal-1" } });
  });

  it("Streamer登録済みならredirectせずchildrenを描画する", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "principal-1" } });
    mockFindUnique.mockResolvedValue({ id: "streamer-1" });

    const result = await AnalyticsLayout({ children: "CHILD" });

    expect(result.props.children).toBe("CHILD");
  });
});
