"use client";

import { useOverlayKindSettings } from "./useOverlayKindSettings";

const CHOICE_BASE = "text-xs px-2 py-2 rounded-lg border transition-colors";
const CHOICE_ON = "border-brand text-brand bg-brand/10";
const CHOICE_OFF = "border-border text-muted hover:text-strong hover:border-brand/40";

type Payload = {
  title: string;
  senderDisplayMode: "latest" | "all";
  glowEnabled: boolean;
};

export default function TopGiftSettings() {
  const { settings, loading, error, update } = useOverlayKindSettings<Payload>("top-gift");

  if (loading) return <p className="text-sm text-muted">読み込み中...</p>;
  if (!settings) return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null;

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div>
        <label className="label" htmlFor="top-gift-title">
          表示タイトル
        </label>
        <input
          id="top-gift-title"
          type="text"
          value={settings.title}
          onChange={(e) => update({ title: e.target.value })}
          className="input-field text-sm"
        />
      </div>

      <div>
        <span className="label">同点時の送信者表示</span>
        <div className="grid grid-cols-2 gap-2">
          {(["latest", "all"] as const).map((value) => (
            <button
              key={value}
              onClick={() => update({ senderDisplayMode: value }, true)}
              className={`${CHOICE_BASE} ${settings.senderDisplayMode === value ? CHOICE_ON : CHOICE_OFF}`}
            >
              {value === "latest" ? "最新のみ" : "同額全員"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">発光エフェクト</span>
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              onClick={() => update({ glowEnabled: value }, true)}
              className={`${CHOICE_BASE} ${settings.glowEnabled === value ? CHOICE_ON : CHOICE_OFF}`}
            >
              {value ? "ON" : "OFF"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
