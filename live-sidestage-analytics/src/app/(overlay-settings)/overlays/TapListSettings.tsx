"use client";

import { useState } from "react";
import { useOverlayKindSettings } from "./useOverlayKindSettings";

const CHOICE_BASE = "text-xs px-2 py-2 rounded-lg border transition-colors";
const CHOICE_ON = "border-brand text-brand bg-brand/10";
const CHOICE_OFF = "border-border text-gray-400 hover:text-white hover:border-white/30";

type Payload = {
  bgStyle: "transparent" | "semi";
  maxEntries: number;
  rowGap: number;
};

export default function TapListSettings() {
  const { settings, loading, error, update } = useOverlayKindSettings<Payload>("tap-list");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  if (loading) return <p className="text-sm text-gray-400">読み込み中...</p>;
  if (!settings) return error ? <p className="text-sm text-red-400">{error}</p> : null;

  const handleReset = async () => {
    if (!confirm("本日のいいね数をリセットします。同じTikTokアカウントを登録している他の配信者にも影響します。よろしいですか？")) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch("/api/streamer/overlay-settings/tap-list/reset", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setResetError(body?.error ?? "リセットに失敗しました。");
      }
    } catch {
      setResetError("リセットに失敗しました。通信を確認してください。");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {resetError && <p className="text-sm text-red-400">{resetError}</p>}

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
          <label className="label" htmlFor="tap-list-max-entries">
            最大表示件数
          </label>
          <input
            id="tap-list-max-entries"
            type="number"
            min={1}
            max={100}
            value={settings.maxEntries}
            onChange={(e) => update({ maxEntries: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="tap-list-row-gap">
            行間(px)
          </label>
          <input
            id="tap-list-row-gap"
            type="number"
            value={settings.rowGap}
            onChange={(e) => update({ rowGap: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
      </div>

      <div>
        <button onClick={handleReset} disabled={resetting} className="btn-secondary text-red-400 border-red-500/30">
          {resetting ? "リセット中..." : "本日のいいね数をリセット"}
        </button>
        <p className="text-[11px] text-gray-500 mt-1.5">
          Like貢献通知の累計もあわせてリセットされます。同じTikTokアカウントを登録している他の配信者にも影響します。
        </p>
      </div>
    </div>
  );
}
