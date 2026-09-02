"use client";

import {
  BOOSTER_LEVEL_LABELS,
  GLOVE_LEVEL_LABELS,
  RETRY_LEVEL_LABELS,
  VIOLATION_HANDLING_LABELS,
  WIN_CONDITION_LABELS,
} from "@/event/labels";
import {
  BOOSTER_LEVELS,
  GLOVE_LEVELS,
  RETRY_LEVELS,
  VIOLATION_HANDLINGS,
  WIN_CONDITIONS,
  type BoosterLevel,
  type GloveLevel,
  type MatchRules,
  type RetryLevel,
  type ViolationHandling,
  type WinCondition,
} from "@/event/match-rules";

/**
 * 対戦ルール(グローブ/ブースター/ボーナスタイム/ミスト/違反時の取り扱い)の入力欄。
 * 作成ウィザードと設定フォームで同じものを使う(`SessionsField` と同じ位置づけ)。
 */
export function MatchRulesField({
  value,
  onChange,
}: {
  value: MatchRules;
  onChange: (value: MatchRules) => void;
}) {
  const set = <K extends keyof MatchRules>(key: K, next: MatchRules[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-4">
      <div>
        <label className="label" htmlFor="matchRules-winCondition">
          勝利条件
        </label>
        <select
          id="matchRules-winCondition"
          className="input-field"
          value={value.winCondition}
          onChange={(e) => set("winCondition", e.target.value as WinCondition)}
        >
          {WIN_CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {WIN_CONDITION_LABELS[condition]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="matchRules-glove">
            グローブ
          </label>
          <select
            id="matchRules-glove"
            className="input-field"
            value={value.glove}
            onChange={(e) => set("glove", e.target.value as GloveLevel)}
          >
            {GLOVE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {GLOVE_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="matchRules-booster">
            ブースター
          </label>
          <select
            id="matchRules-booster"
            className="input-field"
            value={value.booster}
            onChange={(e) => set("booster", e.target.value as BoosterLevel)}
          >
            {BOOSTER_LEVELS.map((level) => (
              <option key={level} value={level}>
                {BOOSTER_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ToggleField
          label="ボーナスタイム"
          value={value.bonusTime}
          onChange={(next) => set("bonusTime", next)}
        />
        <ToggleField label="ミスト" value={value.mist} onChange={(next) => set("mist", next)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="matchRules-violation">
            違反時の取り扱い
          </label>
          <select
            id="matchRules-violation"
            className="input-field"
            value={value.violation}
            onChange={(e) => set("violation", e.target.value as ViolationHandling)}
          >
            {VIOLATION_HANDLINGS.map((v) => (
              <option key={v} value={v}>
                {VIOLATION_HANDLING_LABELS[v]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="matchRules-retry">
            やり直し
          </label>
          <select
            id="matchRules-retry"
            className="input-field"
            value={value.retry}
            onChange={(e) => set("retry", e.target.value as RetryLevel)}
          >
            {RETRY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {RETRY_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-2">
        {[
          { value: false, text: "なし" },
          { value: true, text: "あり" },
        ].map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              value === opt.value
                ? "border-brand bg-brand/5 text-strong"
                : "border-border bg-panel text-muted hover:text-strong"
            }`}
          >
            {opt.text}
          </button>
        ))}
      </div>
    </div>
  );
}
