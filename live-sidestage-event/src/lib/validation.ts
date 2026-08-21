// イベントの入力検証。すべて純粋関数にしてテストで固定する。

export const EVENT_FORMATS = ["TOURNAMENT", "DIAMOND_RACE", "DEATHMATCH"] as const;
export const ENTRY_MODES = ["SOLO", "TEAM"] as const;
export const TEAM_PRESETS = ["GENERIC", "PREFECTURE"] as const;
export const VISIBILITIES = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;
export const EVENT_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "RUNNING",
  "FINISHED",
  "ARCHIVED",
] as const;

export type EventFormat = (typeof EVENT_FORMATS)[number];
export type EntryMode = (typeof ENTRY_MODES)[number];
export type TeamPreset = (typeof TEAM_PRESETS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];

// チーム数の上限。DB制約ではなくここで弾く。
export const MAX_TEAMS = 100;
// 1イベントの参加者数の上限。2vs2 で100チーム = 200人を上限とする。
// TikTok 接続は analytics 側の有限な資源(プロキシ・署名サーバー)を消費するので、
// 1つのイベントが枠を食い潰さないようにここで止める。
export const MAX_PARTICIPANTS = 200;
export const MAX_DISPLAY_NAME_LENGTH = 60;
export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 4000;
// イベント期間の上限。無制限にすると集計対象が青天井になる。
export const MAX_EVENT_DAYS = 90;

export type EventInput = {
  title: string;
  description?: string | null;
  format: string;
  entryMode: string;
  teamPreset?: string;
  visibility?: string;
  startAt: string | Date;
  endAt: string | Date;
};

export type ValidatedEventInput = {
  title: string;
  description: string | null;
  format: EventFormat;
  entryMode: EntryMode;
  teamPreset: TeamPreset;
  visibility: Visibility;
  startAt: Date;
  endAt: Date;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function parseDate(value: string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function validateEventInput(input: EventInput): ValidationResult<ValidatedEventInput> {
  const errors: string[] = [];

  const title = (input.title ?? "").trim();
  if (!title) {
    errors.push("イベント名を入力してください。");
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push(`イベント名は${MAX_TITLE_LENGTH}文字以内で入力してください。`);
  }

  const description = (input.description ?? "").trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`説明は${MAX_DESCRIPTION_LENGTH}文字以内で入力してください。`);
  }

  if (!EVENT_FORMATS.includes(input.format as EventFormat)) {
    errors.push("イベント種目の指定が不正です。");
  }
  if (!ENTRY_MODES.includes(input.entryMode as EntryMode)) {
    errors.push("参加形式の指定が不正です。");
  }

  const teamPreset = (input.teamPreset ?? "GENERIC") as TeamPreset;
  if (!TEAM_PRESETS.includes(teamPreset)) {
    errors.push("チーム形式の指定が不正です。");
  }
  if (input.entryMode === "SOLO" && teamPreset !== "GENERIC") {
    errors.push("個人戦ではチーム形式を指定できません。");
  }

  const visibility = (input.visibility ?? "UNLISTED") as Visibility;
  if (!VISIBILITIES.includes(visibility)) {
    errors.push("公開範囲の指定が不正です。");
  }

  const startAt = parseDate(input.startAt);
  const endAt = parseDate(input.endAt);
  if (!startAt) errors.push("開始日時の指定が不正です。");
  if (!endAt) errors.push("終了日時の指定が不正です。");
  if (startAt && endAt) {
    if (startAt >= endAt) {
      errors.push("終了日時は開始日時より後にしてください。");
    } else {
      const days = (endAt.getTime() - startAt.getTime()) / 86_400_000;
      if (days > MAX_EVENT_DAYS) {
        errors.push(`イベント期間は${MAX_EVENT_DAYS}日以内にしてください。`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title,
      description: description || null,
      format: input.format as EventFormat,
      entryMode: input.entryMode as EntryMode,
      teamPreset,
      visibility,
      startAt: startAt!,
      endAt: endAt!,
    },
  };
}

export function validateTeamCount(count: number): ValidationResult<number> {
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, errors: ["チーム数の指定が不正です。"] };
  }
  if (count > MAX_TEAMS) {
    return { ok: false, errors: [`チームは${MAX_TEAMS}個までです。`] };
  }
  return { ok: true, value: count };
}

// TikTok ID の正規化。analytics の normalizeTiktokId(src/lib/tiktok-room.ts)と
// **同じ規則**にすること。ずれると同じ配信者が別 room 扱いになり、ギフトが分裂する。
// analytics 側: raw.trim().replace(/^@/, "").toLowerCase() — 先頭の @ は1個だけ除去する。
//
// analytics 側に形式検証はないが、event は主催者が他人の ID を代理入力するので、
// 正規化後に形式を検査して弾く(`@@user` のような入力はここで null になる)。
export function normalizeTiktokId(raw: string): string | null {
  const normalized = (raw ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z0-9._]{1,64}$/.test(normalized)) return null;
  return normalized;
}
