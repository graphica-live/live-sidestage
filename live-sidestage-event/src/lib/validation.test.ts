import { describe, it, expect } from "vitest";
import {
  MAX_EVENT_DAYS,
  MAX_TEAMS,
  normalizeTiktokId,
  validateEventInput,
  validateTeamCount,
} from "./validation";

const baseInput = {
  title: "第1回 全国ライバー対抗戦",
  description: "テスト",
  format: "DIAMOND_RACE",
  entryMode: "TEAM",
  teamPreset: "PREFECTURE",
  visibility: "UNLISTED",
  startAt: new Date("2026-09-01T11:00:00.000Z"),
  endAt: new Date("2026-09-08T11:00:00.000Z"),
};

describe("validateEventInput", () => {
  it("正しい入力を通す", () => {
    const result = validateEventInput(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("第1回 全国ライバー対抗戦");
      expect(result.value.teamPreset).toBe("PREFECTURE");
    }
  });

  it("タイトルが空なら弾く", () => {
    const result = validateEventInput({ ...baseInput, title: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("イベント名");
  });

  it("種目が不正なら弾く", () => {
    const result = validateEventInput({ ...baseInput, format: "UNKNOWN" });
    expect(result.ok).toBe(false);
  });

  it("終了が開始より前なら弾く", () => {
    const result = validateEventInput({
      ...baseInput,
      startAt: new Date("2026-09-08T11:00:00.000Z"),
      endAt: new Date("2026-09-01T11:00:00.000Z"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("終了日時");
  });

  it("期間が上限を超えたら弾く", () => {
    const start = new Date("2026-09-01T00:00:00.000Z");
    const end = new Date(start.getTime() + (MAX_EVENT_DAYS + 1) * 86_400_000);
    const result = validateEventInput({ ...baseInput, startAt: start, endAt: end });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain(`${MAX_EVENT_DAYS}日`);
  });

  it("個人戦にチーム形式を指定したら弾く", () => {
    const result = validateEventInput({ ...baseInput, entryMode: "SOLO", teamPreset: "PREFECTURE" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("個人戦");
  });

  it("teamPresetの既定はGENERIC", () => {
    const { teamPreset, ...withoutPreset } = baseInput;
    const result = validateEventInput(withoutPreset);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.teamPreset).toBe("GENERIC");
  });
});

describe("validateTeamCount", () => {
  it("上限ちょうどは通す", () => {
    expect(validateTeamCount(MAX_TEAMS).ok).toBe(true);
  });

  it("上限を超えたら弾く", () => {
    const result = validateTeamCount(MAX_TEAMS + 1);
    expect(result.ok).toBe(false);
  });

  it("負の数を弾く", () => {
    expect(validateTeamCount(-1).ok).toBe(false);
  });
});

describe("normalizeTiktokId", () => {
  it("analyticsと同じ規則で正規化する(trim・先頭@を1つ除去・小文字化)", () => {
    expect(normalizeTiktokId("  @LiveUser01 ")).toBe("liveuser01");
    expect(normalizeTiktokId("Live.User_01")).toBe("live.user_01");
  });

  it("@を2つ重ねた入力は形式検査で弾く", () => {
    // analytics の正規化は先頭の @ を1つしか外さないので "@user" が残る。
    // event は代理入力なので、ここで不正として弾く。
    expect(normalizeTiktokId("@@user")).toBeNull();
  });

  it("使えない文字を含むなら弾く", () => {
    expect(normalizeTiktokId("user name")).toBeNull();
    expect(normalizeTiktokId("ユーザー")).toBeNull();
    expect(normalizeTiktokId("")).toBeNull();
  });
});
