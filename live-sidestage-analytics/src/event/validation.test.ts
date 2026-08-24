import { describe, it, expect } from "vitest";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EVENT_DAYS,
  MAX_TEAMS,
  normalizeTiktokId,
  parseParticipantPatch,
  resolveEventFormatForUpdate,
  resolveParticipantDisplayName,
  validateEventInput,
  validateTeamCount,
} from "./validation";

const baseInput = {
  title: "第1回 全国ライバー対抗戦",
  description: "テスト",
  format: "DIAMOND_RACE",
  entryMode: "TEAM",
  teamPreset: "PREFECTURE",
  visibility: "PRIVATE",
  sessions: [
    {
      startAt: new Date("2026-09-01T11:00:00.000Z"),
      endAt: new Date("2026-09-08T11:00:00.000Z"),
    },
  ],
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

  it("複数の日程を受け付け、外枠は全日程のmin/maxになる", () => {
    const result = validateEventInput({
      ...baseInput,
      sessions: [
        // 順不同で渡しても startAt 昇順に並ぶ。
        {
          startAt: new Date("2026-09-02T13:00:00.000Z"),
          endAt: new Date("2026-09-02T14:00:00.000Z"),
          name: "決勝",
        },
        {
          startAt: new Date("2026-09-01T13:00:00.000Z"),
          endAt: new Date("2026-09-01T14:00:00.000Z"),
          name: "予選",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessions.map((s) => s.name)).toEqual(["予選", "決勝"]);
      expect(result.value.startAt.toISOString()).toBe("2026-09-01T13:00:00.000Z");
      expect(result.value.endAt.toISOString()).toBe("2026-09-02T14:00:00.000Z");
    }
  });

  it("日程が1件もなければ弾く", () => {
    const result = validateEventInput({ ...baseInput, sessions: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("開催日程");
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
      sessions: [
        {
          startAt: new Date("2026-09-08T11:00:00.000Z"),
          endAt: new Date("2026-09-01T11:00:00.000Z"),
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("終了日時");
  });

  it("日程が重なっていたら弾く", () => {
    const result = validateEventInput({
      ...baseInput,
      sessions: [
        {
          startAt: new Date("2026-09-01T13:00:00.000Z"),
          endAt: new Date("2026-09-01T15:00:00.000Z"),
        },
        {
          startAt: new Date("2026-09-01T14:00:00.000Z"),
          endAt: new Date("2026-09-01T16:00:00.000Z"),
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("重なって");
  });

  it("期間が上限を超えたら弾く", () => {
    const start = new Date("2026-09-01T00:00:00.000Z");
    const end = new Date(start.getTime() + (MAX_EVENT_DAYS + 1) * 86_400_000);
    const result = validateEventInput({ ...baseInput, sessions: [{ startAt: start, endAt: end }] });
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

describe("resolveEventFormatForUpdate", () => {
  it("種目を省略したリクエストは現在の種目のまま通す", () => {
    const result = resolveEventFormatForUpdate("TOURNAMENT", undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("TOURNAMENT");
  });

  it("現在と同じ種目を送ってきたら通す(読み取り専用のフォームがそのまま送る)", () => {
    const result = resolveEventFormatForUpdate("DEATHMATCH", "DEATHMATCH");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("DEATHMATCH");
  });

  it("違う種目への変更は拒否する", () => {
    const result = resolveEventFormatForUpdate("TOURNAMENT", "DIAMOND_RACE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("変更できません");
  });

  it("現在の種目が不正な値なら弾く", () => {
    expect(resolveEventFormatForUpdate("UNKNOWN", undefined).ok).toBe(false);
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

describe("resolveParticipantDisplayName", () => {
  it("前後の空白を落とす", () => {
    const result = resolveParticipantDisplayName("  ライバーA  ", "liveuser01");
    expect(result).toEqual({ ok: true, value: "ライバーA" });
  });

  it("空・空白のみ・null・undefined は fallback へ丸める", () => {
    for (const raw of ["", "   ", null, undefined]) {
      expect(resolveParticipantDisplayName(raw, "liveuser01")).toEqual({
        ok: true,
        value: "liveuser01",
      });
    }
  });

  it("上限ちょうどは通し、1文字超えたら弾く", () => {
    expect(resolveParticipantDisplayName("あ".repeat(MAX_DISPLAY_NAME_LENGTH), "u").ok).toBe(true);
    expect(resolveParticipantDisplayName("あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1), "u").ok).toBe(
      false
    );
  });

  it("fallback は上限を超えていても通す(TikTok ID は64文字まで許すため)", () => {
    // 61〜64文字のハンドルを持つ参加者が「名前を空にして TikTok ID へ戻す」をできなくなる。
    const longHandle = "a".repeat(64);
    expect(resolveParticipantDisplayName("", longHandle)).toEqual({ ok: true, value: longHandle });
  });

  it("文字列以外は弾く(HTTP境界から数値やオブジェクトが来ても落とさない)", () => {
    expect(resolveParticipantDisplayName(123, "u").ok).toBe(false);
    expect(resolveParticipantDisplayName(["a"], "u").ok).toBe(false);
    expect(resolveParticipantDisplayName({ a: 1 }, "u").ok).toBe(false);
  });
});

describe("parseParticipantPatch", () => {
  it("teamId だけの従来のリクエストを通す", () => {
    expect(parseParticipantPatch({ teamId: "team_1" })).toEqual({
      ok: true,
      value: { teamId: "team_1" },
    });
    expect(parseParticipantPatch({ teamId: null })).toEqual({ ok: true, value: { teamId: null } });
  });

  it("displayName だけのリクエストを通す", () => {
    expect(parseParticipantPatch({ displayName: "ライバーA" })).toEqual({
      ok: true,
      value: { displayName: "ライバーA" },
    });
    expect(parseParticipantPatch({ displayName: "" })).toEqual({
      ok: true,
      value: { displayName: "" },
    });
  });

  it("両方送られたら両方を拾う", () => {
    expect(parseParticipantPatch({ teamId: "team_1", displayName: "ライバーA" })).toEqual({
      ok: true,
      value: { teamId: "team_1", displayName: "ライバーA" },
    });
  });

  it("更新対象が1つも無いボディは弾く", () => {
    expect(parseParticipantPatch({}).ok).toBe(false);
    expect(parseParticipantPatch({ teamId: undefined }).ok).toBe(false);
    expect(parseParticipantPatch({ other: "x" }).ok).toBe(false);
  });

  it("オブジェクト以外のボディを弾く", () => {
    expect(parseParticipantPatch(null).ok).toBe(false);
    expect(parseParticipantPatch("teamId=1").ok).toBe(false);
    expect(parseParticipantPatch([{ teamId: "team_1" }]).ok).toBe(false);
  });

  it("型が違う値を弾く", () => {
    expect(parseParticipantPatch({ teamId: 1 }).ok).toBe(false);
    expect(parseParticipantPatch({ displayName: 123 }).ok).toBe(false);
    expect(parseParticipantPatch({ displayName: { a: 1 } }).ok).toBe(false);
  });
});
