// イベントの入力検証。すべて純粋関数にしてテストで固定する。

import { AVATAR_ZOOM_MAX, AVATAR_ZOOM_MIN } from "./avatar-frame";
import type { BracketMethod } from "./bracket";
import { normalizePlacementDepth, parseBracketMethod } from "./bracket-rules";
import { type MatchRules, parseMatchRules } from "./match-rules";
import {
  MAX_EVENT_DAYS,
  normalizeSessionInputs,
  type NormalizedSession,
  type SessionInput,
} from "./sessions";

// 期間の検証そのものは sessions.ts が持つ(日程が複数あるため)。
// 既存の import 元のために、上限値だけここからも見えるようにしておく。
export { MAX_EVENT_DAYS };
export { MAX_EVENT_SESSIONS, MAX_SESSION_NAME_LENGTH } from "./sessions";

export const EVENT_FORMATS = ["TOURNAMENT", "DIAMOND_RACE", "DEATHMATCH"] as const;
export const ENTRY_MODES = ["SOLO", "TEAM"] as const;
export const TEAM_PRESETS = ["GENERIC", "PREFECTURE"] as const;
export const VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
export const EVENT_STATUSES = ["SCHEDULED", "RUNNING", "FINISHED", "ARCHIVED"] as const;

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
export const MAX_PRIZE_LENGTH = 300;
export const MAX_NOTICE_LENGTH = 8000;

export type EventInput = {
  title: string;
  description?: string | null;
  format: string;
  entryMode: string;
  teamPreset?: string;
  visibility?: string;
  /** 開催日程。1件以上。重なりは許さない(sessions.ts が検証する) */
  sessions: SessionInput[];
  /** 優勝賞品。任意。 */
  prizeText?: string | null;
  /** 注意事項+FAQ。任意。 */
  noticeText?: string | null;
  /** グローブ/ブースター等。不正値・欠損は既定へ丸める(parseMatchRules)ので型は緩い。 */
  matchRules?: unknown;
  /** トーナメント表の不戦勝配分方式。不正値・欠損は既定(STANDARD)へ丸める。TOURNAMENT以外では無視。 */
  bracketMethod?: unknown;
  /**
   * 順位決定戦をどの深さまで行うかの希望値。不正値・欠損は 0(行わない)へ丸める。
   * **実際に組める深さは参加人数が確定してから決まる**ので、ここでは上限だけ見る。
   */
  placementDepth?: unknown;
};

export type ValidatedEventInput = {
  title: string;
  description: string | null;
  format: EventFormat;
  entryMode: EntryMode;
  teamPreset: TeamPreset;
  visibility: Visibility;
  /** 全日程を覆う外枠。sessions からの派生値 */
  startAt: Date;
  endAt: Date;
  sessions: NormalizedSession[];
  prizeText: string | null;
  noticeText: string | null;
  /** 常に正規化済み(parseMatchRulesが不正値を既定へ丸める)。 */
  matchRules: MatchRules;
  /** 常に正規化済み(parseBracketMethodが不正値を既定へ丸める)。 */
  bracketMethod: BracketMethod;
  /** 常に正規化済み(normalizePlacementDepthが不正値を0へ丸める)。 */
  placementDepth: number;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

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

  const prizeText = (input.prizeText ?? "").trim();
  if (prizeText.length > MAX_PRIZE_LENGTH) {
    errors.push(`優勝賞品は${MAX_PRIZE_LENGTH}文字以内で入力してください。`);
  }

  const noticeText = (input.noticeText ?? "").trim();
  if (noticeText.length > MAX_NOTICE_LENGTH) {
    errors.push(`注意事項は${MAX_NOTICE_LENGTH}文字以内で入力してください。`);
  }

  // 不正値・欠損は既定へ丸める(deathmatchRulesと同じ方針)ので、ここではエラーを積まない。
  const matchRules = parseMatchRules({ matchRules: input.matchRules });
  const bracketMethod = parseBracketMethod({ bracket: { method: input.bracketMethod } });
  const placementDepth = normalizePlacementDepth(input.placementDepth);

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

  const visibility = (input.visibility ?? "PRIVATE") as Visibility;
  if (!VISIBILITIES.includes(visibility)) {
    errors.push("公開範囲の指定が不正です。");
  }

  // 期間は日程ごと。外枠(startAt/endAt)はここで作った min/max を保存する。
  const sessions = normalizeSessionInputs(input.sessions ?? []);
  if (!sessions.ok) errors.push(...sessions.errors);

  if (errors.length > 0 || !sessions.ok) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title,
      description: description || null,
      format: input.format as EventFormat,
      entryMode: input.entryMode as EntryMode,
      teamPreset,
      visibility,
      startAt: sessions.startAt,
      endAt: sessions.endAt,
      sessions: sessions.value,
      prizeText: prizeText || null,
      noticeText: noticeText || null,
      matchRules,
      bracketMethod,
      placementDepth,
    },
  };
}

/**
 * 更新リクエストで使う種目を決める。**種目は作成時にだけ決められる。**
 *
 * 種目は集計の仕方（`aggregate.ts`）・対戦の組み方・公開ページの見せ方を切り替えるので、
 * 参加者や対戦が入った後に変えると、既にある結果と噛み合わなくなる。
 * リクエストの値は「今の種目と同じか」の確認にしか使わない。
 *
 * - 省略(`undefined` / `null`)は現在の種目のまま。フォームが送らなくても通す
 * - 同じ値なら通す。現在の値を読み取り専用で送ってくるフォーム用
 * - 違う値は拒否する。黙って無視すると、変更できたと誤解したまま運用される
 */
export function resolveEventFormatForUpdate(
  current: string,
  requested: unknown
): ValidationResult<EventFormat> {
  if (!EVENT_FORMATS.includes(current as EventFormat)) {
    return { ok: false, errors: ["このイベントの種目が不正です。"] };
  }
  if (requested == null || requested === "") {
    return { ok: true, value: current as EventFormat };
  }
  if (requested === current) {
    return { ok: true, value: current as EventFormat };
  }
  return { ok: false, errors: ["イベントの種目は作成後に変更できません。"] };
}

export const MAX_TEAM_NAME_LENGTH = 40;

export type TeamInput = {
  name: string;
  colorHex?: string | null;
  prefectureCode?: string | null;
  teamPreset: TeamPreset;
};

export type ValidatedTeamInput = {
  name: string;
  colorHex: string | null;
  prefectureCode: string | null;
};

// 都道府県プリセットでは prefectureCode が主キー相当になる(名前はそこから決まる)。
// 汎用グループでは名前だけを使い、prefectureCode は必ず null にする
// (@@unique([eventId, prefectureCode]) があるので、値を入れると他イベント形式と混ざる)。
export function validateTeamInput(
  input: TeamInput,
  resolvePrefectureName: (code: string) => string | null
): ValidationResult<ValidatedTeamInput> {
  const errors: string[] = [];

  if (input.teamPreset === "PREFECTURE") {
    const code = (input.prefectureCode ?? "").trim();
    const name = code ? resolvePrefectureName(code) : null;
    if (!name) {
      errors.push("都道府県の指定が不正です。");
      return { ok: false, errors };
    }
    return { ok: true, value: { name, colorHex: normalizeColor(input.colorHex), prefectureCode: code } };
  }

  const name = (input.name ?? "").trim();
  if (!name) {
    errors.push("チーム名を入力してください。");
  } else if (name.length > MAX_TEAM_NAME_LENGTH) {
    errors.push(`チーム名は${MAX_TEAM_NAME_LENGTH}文字以内で入力してください。`);
  }

  if (input.colorHex && normalizeColor(input.colorHex) === null) {
    errors.push("色の指定が不正です(#rrggbb 形式)。");
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: { name, colorHex: normalizeColor(input.colorHex), prefectureCode: null } };
}

function normalizeColor(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
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

/**
 * 主催者が明示した表示名だけを検証する。空(未入力・空白のみ・null)なら
 * まだ確定していないことを示す `value: null` を返す(fallback をいつ・何で埋めるかは
 * 呼び出し側の責務 — 登録時は TikTok 実在確認の結果を待ってから決めるため)。
 *
 * `raw` は HTTP 境界から来るので `unknown` で受け、文字列以外は弾く。
 */
export function validateExplicitDisplayName(raw: unknown): ValidationResult<string | null> {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return { ok: false, errors: ["表示名の指定が不正です。"] };
  }
  const name = (raw ?? "").trim();
  if (!name) return { ok: true, value: null };
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      ok: false,
      errors: [`表示名は${MAX_DISPLAY_NAME_LENGTH}文字以内で入力してください。`],
    };
  }
  return { ok: true, value: name };
}

/**
 * 参加者の表示名を決める。空(未入力・空白のみ・null)なら fallback(TikTok ID)へ丸める。
 * 改名時(`updateParticipant`)はこの1箇所を通す。
 *
 * **fallback は長さ検査の対象外にする。** TikTok ID は64文字まで許すのに表示名の上限は
 * 60文字なので、fallback まで検査すると 61〜64文字のハンドルを持つ参加者が
 * 「名前を空にして TikTok ID へ戻す」をできなくなる(登録も通らない)。
 * 上限は主催者が入力した名前にだけ効かせる。
 */
export function resolveParticipantDisplayName(
  raw: unknown,
  fallback: string
): ValidationResult<string> {
  const explicit = validateExplicitDisplayName(raw);
  if (!explicit.ok) return explicit;
  return { ok: true, value: explicit.value ?? fallback };
}

/**
 * TikTok のニックネームを、参加者登録の表示名フォールバックとして採用してよいか判定する。
 *
 * 主催者の明示入力とは違い**外部レスポンス由来の信頼できない文字列**なので、より厳しく検査する:
 * 空・`MAX_DISPLAY_NAME_LENGTH` 超・改行や制御文字を含む場合は不採用にし、呼び出し側で
 * さらに TikTok ID へフォールバックさせる(切り詰めはしない — 絵文字の途中で切ると壊れるため)。
 */
export function sanitizeNicknameFallback(nickname: string | null): string | null {
  if (!nickname) return null;
  if (nickname.length > MAX_DISPLAY_NAME_LENGTH) return null;
  // C0/C1制御文字(改行含む)を含むニックネームは不採用にする。
  // eslint-disable-next-line no-control-regex -- 意図的な制御文字検査
  if (/[ --]/.test(nickname)) return null;
  return nickname;
}

/** 対戦カードに表示するアバターの切り出し位置・ズーム。3値セットでのみ受け付ける。 */
export type AvatarFrameInput = { offsetX: number; offsetY: number; zoom: number };

// 参加者の部分更新(PATCH)。**送られてきたキーだけ**を持つ。
// `undefined` = 触らない、`null` = 明示的に空へ戻す、を型で区別する。
export type ParticipantPatchInput = {
  /** 所属チーム。null で未所属へ戻す */
  teamId?: string | null;
  /** 表示名。null / 空文字なら TikTok ID へ戻る */
  displayName?: string | null;
  /** アバターの表示位置。null で現状のデフォルト(50%/30%/等倍)へ戻る */
  avatarFrame?: AvatarFrameInput | null;
  /**
   * TikTok ID の訂正(生の入力文字列)。登録ミスの後追い訂正専用。
   * teamId/displayName と違い `null` によるクリア概念は無い(DB の tiktokId は NOT NULL)。
   * 正規化(`normalizeTiktokId`)はここでは行わず `updateParticipant` 側に寄せる
   * (register 側の役割分担と揃える)。
   */
  tiktokId?: string;
};

/**
 * PATCH のリクエストボディを検証する。
 *
 * JSON はクライアントが何でも入れられるので、キーの有無と型をここで確定させてから
 * DB 層へ渡す(`{ displayName: 123 }` を `.trim()` に通して 500 にしない)。
 * 更新対象が1つも無いボディは拒否する。
 */
export function parseParticipantPatch(body: unknown): ValidationResult<ParticipantPatchInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が不正です。"] };
  }

  const raw = body as Record<string, unknown>;
  const value: ParticipantPatchInput = {};

  if (raw.teamId !== undefined) {
    if (raw.teamId !== null && typeof raw.teamId !== "string") {
      return { ok: false, errors: ["teamId の指定が不正です。"] };
    }
    value.teamId = raw.teamId;
  }

  if (raw.displayName !== undefined) {
    if (raw.displayName !== null && typeof raw.displayName !== "string") {
      return { ok: false, errors: ["表示名の指定が不正です。"] };
    }
    value.displayName = raw.displayName;
  }

  if (raw.avatarFrame !== undefined) {
    const parsed = parseAvatarFrameInput(raw.avatarFrame);
    if (!parsed.ok) return parsed;
    value.avatarFrame = parsed.value;
  }

  if (raw.tiktokId !== undefined) {
    if (typeof raw.tiktokId !== "string") {
      return { ok: false, errors: ["TikTok ID の指定が不正です。"] };
    }
    value.tiktokId = raw.tiktokId;
  }

  if (
    value.teamId === undefined &&
    value.displayName === undefined &&
    value.tiktokId === undefined &&
    value.avatarFrame === undefined
  ) {
    return { ok: false, errors: ["teamId・displayName・tiktokId・avatarFrame のいずれかが必要です。"] };
  }

  return { ok: true, value };
}

/** null(デフォルトへリセット) か、offsetX/offsetY/zoom が全て揃った有効な数値のオブジェクトだけを通す。 */
function parseAvatarFrameInput(raw: unknown): ValidationResult<AvatarFrameInput | null> {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["avatarFrame の指定が不正です。"] };
  }

  const { offsetX, offsetY, zoom } = raw as Record<string, unknown>;
  if (
    typeof offsetX !== "number" ||
    typeof offsetY !== "number" ||
    typeof zoom !== "number" ||
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(zoom)
  ) {
    return { ok: false, errors: ["avatarFrame の指定が不正です。"] };
  }
  if (offsetX < 0 || offsetX > 100 || offsetY < 0 || offsetY > 100) {
    return { ok: false, errors: ["avatarFrame の位置は0〜100の範囲で指定してください。"] };
  }
  if (zoom < AVATAR_ZOOM_MIN || zoom > AVATAR_ZOOM_MAX) {
    return {
      ok: false,
      errors: [`avatarFrame のズームは${AVATAR_ZOOM_MIN}〜${AVATAR_ZOOM_MAX}の範囲で指定してください。`],
    };
  }

  return { ok: true, value: { offsetX, offsetY, zoom } };
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
