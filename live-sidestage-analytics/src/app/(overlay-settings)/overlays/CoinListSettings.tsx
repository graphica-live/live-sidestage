"use client";

import { useOverlayKindSettings } from "./useOverlayKindSettings";

const CHOICE_BASE = "text-xs px-2 py-2 rounded-lg border transition-colors";
const CHOICE_ON = "border-brand text-brand bg-brand/10";
const CHOICE_OFF = "border-border text-muted hover:text-strong hover:border-brand/40";

type Payload = {
  bgStyle: "transparent" | "semi";
  sortOrder: "asc" | "desc";
  maxEntries: number;
  rowGap: number;
};

export default function CoinListSettings() {
  const { settings, loading, error, update } = useOverlayKindSettings<Payload>("coin-list");

  if (loading) return <p className="text-sm text-muted">読み込み中...</p>;
  if (!settings) return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null;

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div>
        <span className="label">並び順</span>
        <div className="grid grid-cols-2 gap-2">
          {(["desc", "asc"] as const).map((value) => (
            <button
              key={value}
              onClick={() => update({ sortOrder: value }, true)}
              className={`${CHOICE_BASE} ${settings.sortOrder === value ? CHOICE_ON : CHOICE_OFF}`}
            >
              {value === "desc" ? "多い順" : "少ない順"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">背景</span>
        <div className="grid grid-cols-2 gap-2">
          {(["transparent", "semi"] as const).map((value) => (
            <button
              key={value}
              onClick={() => update({ bgStyle: value }, true)}
              className={`${CHOICE_BASE} ${settings.bgStyle === value ? CHOICE_ON : CHOICE_OFF}`}
            >
              {value === "transparent" ? "透明" : "半透明"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="coin-list-max-entries">
            最大表示件数
          </label>
          <input
            id="coin-list-max-entries"
            type="number"
            min={1}
            max={100}
            value={settings.maxEntries}
            onChange={(e) => update({ maxEntries: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="coin-list-row-gap">
            行間(px)
          </label>
          <input
            id="coin-list-row-gap"
            type="number"
            value={settings.rowGap}
            onChange={(e) => update({ rowGap: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
      </div>
    </div>
  );
}
