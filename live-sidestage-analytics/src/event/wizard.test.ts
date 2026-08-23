import { describe, it, expect } from "vitest";
import { MATCH_RULES_DEFAULT } from "./match-rules";
import {
  nextDay,
  validateWizardDraft,
  validateWizardStep,
  type EventDraft,
} from "./wizard";

const baseDraft: EventDraft = {
  format: "DIAMOND_RACE",
  title: "第1回 全国ライバー対抗戦",
  description: "",
  entryMode: "SOLO",
  teamPreset: "GENERIC",
  visibility: "PRIVATE",
  sessions: [{ name: "", startAt: "2026-09-01T22:00", endAt: "2026-09-01T23:00" }],
  matchRules: MATCH_RULES_DEFAULT,
  bracketMethod: "STANDARD",
  prizeText: "",
  noticeText: "",
};

describe("validateWizardStep", () => {
  it("種目が未選択なら次へ進ませない", () => {
    expect(validateWizardStep("format", { ...baseDraft, format: null })).toEqual([
      "種目を選んでください。",
    ]);
  });

  it("種目を選んでいれば通す", () => {
    expect(validateWizardStep("format", { ...baseDraft, format: "TOURNAMENT" })).toEqual([]);
  });

  it("トーナメントで不戦勝方式が不正なら弾く", () => {
    expect(
      validateWizardStep("format", {
        ...baseDraft,
        format: "TOURNAMENT",
        bracketMethod: "INVALID" as never,
      })
    ).toEqual(["トーナメント表の方式を選んでください。"]);
  });

  it("トーナメント以外では不戦勝方式を見ない", () => {
    expect(
      validateWizardStep("format", {
        ...baseDraft,
        format: "DIAMOND_RACE",
        bracketMethod: "INVALID" as never,
      })
    ).toEqual([]);
  });

  it("イベント名が空なら弾く", () => {
    expect(validateWizardStep("title", { ...baseDraft, title: "   " })).toEqual([
      "イベント名を入力してください。",
    ]);
  });

  it("イベント名が長すぎれば弾く", () => {
    const errors = validateWizardStep("title", { ...baseDraft, title: "あ".repeat(101) });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("100文字以内");
  });

  it("個人戦でチーム形式を指定していたら弾く", () => {
    expect(
      validateWizardStep("entry", { ...baseDraft, entryMode: "SOLO", teamPreset: "PREFECTURE" })
    ).toEqual(["個人戦ではチーム形式を指定できません。"]);
  });

  it("チーム戦ならチーム形式を指定できる", () => {
    expect(
      validateWizardStep("entry", { ...baseDraft, entryMode: "TEAM", teamPreset: "PREFECTURE" })
    ).toEqual([]);
  });

  it("日程の日時が空欄なら弾く", () => {
    const errors = validateWizardStep("sessions", {
      ...baseDraft,
      sessions: [{ name: "", startAt: "", endAt: "2026-09-01T23:00" }],
    });
    expect(errors).toEqual(["1つ目の日程の開始日時と終了日時を入力してください。"]);
  });

  it("実在しない日時を弾く(サーバーと同じ parseJstLocal を通す)", () => {
    const errors = validateWizardStep("sessions", {
      ...baseDraft,
      sessions: [{ name: "", startAt: "2026-02-31T22:00", endAt: "2026-03-01T23:00" }],
    });
    expect(errors).toEqual(["1つ目の日程の開始日時と終了日時を入力してください。"]);
  });

  it("終了が開始より前なら弾く", () => {
    const errors = validateWizardStep("sessions", {
      ...baseDraft,
      sessions: [{ name: "", startAt: "2026-09-01T23:00", endAt: "2026-09-01T22:00" }],
    });
    expect(errors).toEqual(["1つ目の日程は終了日時を開始日時より後にしてください。"]);
  });

  it("日程が重なっていたら弾く", () => {
    const errors = validateWizardStep("sessions", {
      ...baseDraft,
      sessions: [
        { name: "予選", startAt: "2026-09-01T22:00", endAt: "2026-09-01T23:30" },
        { name: "決勝", startAt: "2026-09-01T23:00", endAt: "2026-09-02T00:00" },
      ],
    });
    expect(errors).toEqual([
      "開催日程が重なっています。時間帯が重ならないようにしてください。",
    ]);
  });

  it("最初の日程から最後の日程までが90日を超えたら弾く", () => {
    const errors = validateWizardStep("sessions", {
      ...baseDraft,
      sessions: [
        { name: "", startAt: "2026-09-01T22:00", endAt: "2026-09-01T23:00" },
        { name: "", startAt: "2026-12-15T22:00", endAt: "2026-12-15T23:00" },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("90日以内");
  });

  it("matchRulesは選択肢しか作らせないので常に通す", () => {
    expect(validateWizardStep("matchRules", baseDraft)).toEqual([]);
  });

  it("優勝賞品が長すぎれば弾く", () => {
    const errors = validateWizardStep("prize", { ...baseDraft, prizeText: "あ".repeat(301) });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("300文字以内");
  });

  it("注意事項が長すぎれば弾く", () => {
    const errors = validateWizardStep("notice", { ...baseDraft, noticeText: "あ".repeat(8001) });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("8000文字以内");
  });

  it("複数日程が正しければ通す", () => {
    expect(
      validateWizardStep("sessions", {
        ...baseDraft,
        sessions: [
          { name: "予選", startAt: "2026-09-01T22:00", endAt: "2026-09-01T23:00" },
          { name: "決勝", startAt: "2026-09-02T22:00", endAt: "2026-09-02T23:00" },
        ],
      })
    ).toEqual([]);
  });
});

describe("validateWizardDraft", () => {
  it("全手順を満たしていれば空", () => {
    expect(validateWizardDraft(baseDraft)).toEqual([]);
  });

  it("手順を飛ばした値(種目未選択)を送らせない", () => {
    expect(validateWizardDraft({ ...baseDraft, format: null })).toContain("種目を選んでください。");
  });
});

describe("nextDay", () => {
  it("日付だけ1日進める", () => {
    expect(nextDay("2026-09-01T22:00")).toBe("2026-09-02T22:00");
  });

  it("月をまたぐ", () => {
    expect(nextDay("2026-09-30T22:00")).toBe("2026-10-01T22:00");
  });

  it("形式が違えばそのまま返す", () => {
    expect(nextDay("")).toBe("");
  });
});
