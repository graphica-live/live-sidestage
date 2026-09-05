// GET /api/admin/proxy — 認証ゲートと、AppSetting破損データへの耐性を検証する。
// DBには触れない(getSetting/getAdminSessionをモックする)ためunitで完結する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAdminSessionMock, getSettingMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  getSettingMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/settings", () => ({ getSetting: getSettingMock }));

import { GET } from "./route";

describe("GET /api/admin/proxy", () => {
  beforeEach(() => {
    getAdminSessionMock.mockReset();
    getSettingMock.mockReset();
  });

  it("管理者セッションが無ければ 401", async () => {
    getAdminSessionMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(getSettingMock).not.toHaveBeenCalled();
  });

  it("ログを新しい順(reverse)で返す", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "graphicatestlive@gmail.com" } });
    getSettingMock.mockResolvedValue(
      JSON.stringify([
        { at: "2026-01-01T00:00:00.000Z", outcome: "success" },
        { at: "2026-01-02T00:00:00.000Z", outcome: "failure" },
      ])
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.log.map((e: { at: string }) => e.at)).toEqual([
      "2026-01-02T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("設定値が無ければ空配列を返す(エラーにしない)", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "graphicatestlive@gmail.com" } });
    getSettingMock.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.log).toEqual([]);
  });

  it("破損したJSONでも空配列にフォールバックする", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "graphicatestlive@gmail.com" } });
    getSettingMock.mockResolvedValue("not json");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.log).toEqual([]);
  });

  it("配列でない値が保存されていても空配列にフォールバックする", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "graphicatestlive@gmail.com" } });
    getSettingMock.mockResolvedValue(JSON.stringify({ unexpected: "shape" }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.log).toEqual([]);
  });
});
