// イベント作成ウィザードの手順と、手順ごとの入力検証。
//
// 1画面で全部を触らせず、種目 → 名前 → 参加形式 → 開催日程 → 公開範囲 の順に1つずつ決めさせる。
// **種目だけは作成後に変更できない**ので最初に決めさせ、確認画面まで戻れるようにしてある。
//
// 検証そのものは新しく書かず、サーバーと同じ `normalizeSessionInputs()` / `parseJstLocal()` を
// 呼ぶ。ここは「次へ進ませない」ための早期表示で、正本はあくまでサーバー側
// (`validateEventInput()`)。二重に規則を書くとサーバーとずれる。

import { parseJstLocal } from "./datetime";
import type { MatchRules } from "./match-rules";
import { normalizeSessionInputs } from "./sessions";
import {
  ENTRY_MODES,
  EVENT_FORMATS,
  MAX_DESCRIPTION_LENGTH,
  MAX_NOTICE_LENGTH,
  MAX_PRIZE_LENGTH,
  MAX_TITLE_LENGTH,
  TEAM_PRESETS,
  VISIBILITIES,
  type EntryMode,
  type EventFormat,
  type TeamPreset,
  type Visibility,
} from "./validation";

/** 1つの開催日程。日時は `<input type="datetime-local">` の値 = JST の "YYYY-MM-DDTHH:mm"。 */
export type SessionFormValue = {
  name: string;
  startAt: string;
  endAt: string;
};

/**
 * 作成ウィザードが持つ値。**種目は未選択(null)から始める** —
 * 既定値を入れておくと、後から変えられない項目を選ばないまま通過できてしまう。
 */
export type EventDraft = {
  format: EventFormat | null;
  title: string;
  description: string;
  entryMode: EntryMode;
  teamPreset: TeamPreset;
  visibility: Visibility;
  sessions: SessionFormValue[];
  matchRules: MatchRules;
  prizeText: string;
  noticeText: string;
};

export const WIZARD_STEPS = [
  "format",
  "title",
  "entry",
  "sessions",
  "matchRules",
  "prize",
  "notice",
  "publish",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const WIZARD_STEP_TITLES: Record<WizardStep, string> = {
  format: "種目を選ぶ",
  title: "イベント名を決める",
  entry: "参加形式を決める",
  sessions: "開催日程(監視対象)を決める",
  matchRules: "ルールを決める",
  prize: "優勝賞品を決める",
  notice: "注意事項を決める",
  publish: "内容を確認して作成する",
};

export const WIZARD_STEP_HINTS: Record<WizardStep, string> = {
  format: "何を競うイベントか。作成すると変更できない。",
  title: "公開ページに出る名前。あとから変更できる。",
  entry: "1人ずつ競うか、チームでまとめて競うか。",
  sessions: "ギフトを集計する時間帯。この時間だけ配信者を監視対象にする。日を分けて開催するなら日程を足す。",
  matchRules: "対戦で使う装備と、違反があったときの扱い。公開ページに表示される。",
  prize: "優勝者に贈るもの。公開ページに表示される。空でもよい。",
  notice: "参加者・視聴者向けの注意事項とFAQ。テンプレートを自由に編集できる。",
  publish: "内容を確認してイベントを作る。作成後は続けて参加者登録に進む。",
};

/**
 * "YYYY-MM-DDTHH:mm" の日付だけ1日進める。日程を足すときの初期値用。
 *
 * 文字列のまま `Date` を経由せずに計算する — ブラウザのタイムゾーンで解釈すると
 * JST 以外の環境で日付がずれる。
 */
export function nextDay(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!m) return value;
  const [, year, month, day, time] = m;
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${time}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * その手順で決める項目だけを検証する。空配列なら次へ進んでよい。
 *
 * 日程は文字列比較で済ませず `parseJstLocal()` → `normalizeSessionInputs()` を通す
 * (実在しない日付・重なり・90日上限をサーバーと同じ規則で見るため)。
 */
export function validateWizardStep(step: WizardStep, values: EventDraft): string[] {
  switch (step) {
    case "format":
      return values.format && EVENT_FORMATS.includes(values.format)
        ? []
        : ["種目を選んでください。"];

    case "title": {
      const errors: string[] = [];
      const title = values.title.trim();
      if (!title) {
        errors.push("イベント名を入力してください。");
      } else if (title.length > MAX_TITLE_LENGTH) {
        errors.push(`イベント名は${MAX_TITLE_LENGTH}文字以内で入力してください。`);
      }
      if (values.description.trim().length > MAX_DESCRIPTION_LENGTH) {
        errors.push(`説明は${MAX_DESCRIPTION_LENGTH}文字以内で入力してください。`);
      }
      return errors;
    }

    case "entry": {
      const errors: string[] = [];
      if (!ENTRY_MODES.includes(values.entryMode)) {
        errors.push("参加形式を選んでください。");
      }
      if (!TEAM_PRESETS.includes(values.teamPreset)) {
        errors.push("チーム形式の指定が不正です。");
      }
      if (values.entryMode === "SOLO" && values.teamPreset !== "GENERIC") {
        errors.push("個人戦ではチーム形式を指定できません。");
      }
      return errors;
    }

    case "sessions": {
      const parsed: { startAt: Date; endAt: Date; name: string }[] = [];
      const errors: string[] = [];
      for (const [index, session] of values.sessions.entries()) {
        const startAt = parseJstLocal(session.startAt);
        const endAt = parseJstLocal(session.endAt);
        if (!startAt || !endAt) {
          errors.push(`${index + 1}つ目の日程の開始日時と終了日時を入力してください。`);
          continue;
        }
        parsed.push({ startAt, endAt, name: session.name });
      }
      if (errors.length > 0) return errors;

      const normalized = normalizeSessionInputs(parsed);
      return normalized.ok ? [] : normalized.errors;
    }

    case "matchRules":
      // 全項目 <select> / 2択ボタンでしか値を作らせないため、不正な組み合わせは起きない。
      return [];

    case "prize": {
      const prizeText = values.prizeText.trim();
      return prizeText.length > MAX_PRIZE_LENGTH
        ? [`優勝賞品は${MAX_PRIZE_LENGTH}文字以内で入力してください。`]
        : [];
    }

    case "notice": {
      const noticeText = values.noticeText.trim();
      return noticeText.length > MAX_NOTICE_LENGTH
        ? [`注意事項は${MAX_NOTICE_LENGTH}文字以内で入力してください。`]
        : [];
    }

    case "publish":
      return VISIBILITIES.includes(values.visibility) ? [] : ["公開範囲を選んでください。"];
  }
}

/** 送信前に全手順を検証する。手順を飛ばして送られた値をそのまま POST しないため。 */
export function validateWizardDraft(values: EventDraft): string[] {
  return WIZARD_STEPS.flatMap((step) => validateWizardStep(step, values));
}
