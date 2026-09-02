"use client";

import { useOverlayKindSettings } from "./useOverlayKindSettings";

type Payload = {
  title: string;
  interval: number;
  soundVolume: number;
  balloonDesignKey: string;
  countFontSize: number;
  nameFontSize: number;
};

export default function LikeContributionSettings() {
  const { settings, loading, error, update } = useOverlayKindSettings<Payload>("like-contribution");

  if (loading) return <p className="text-sm text-muted">読み込み中...</p>;
  if (!settings) return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null;

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div>
        <label className="label" htmlFor="like-contribution-title">
          表示タイトル
        </label>
        <input
          id="like-contribution-title"
          type="text"
          value={settings.title}
          onChange={(e) => update({ title: e.target.value })}
          className="input-field text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="like-contribution-interval">
            何タップごとに通知
          </label>
          <input
            id="like-contribution-interval"
            type="number"
            min={1}
            value={settings.interval}
            onChange={(e) => update({ interval: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="like-contribution-count-size">
            タップ数の文字サイズ
          </label>
          <input
            id="like-contribution-count-size"
            type="number"
            min={8}
            max={120}
            value={settings.countFontSize}
            onChange={(e) => update({ countFontSize: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="like-contribution-name-size">
            リスナー名の文字サイズ
          </label>
          <input
            id="like-contribution-name-size"
            type="number"
            min={8}
            max={120}
            value={settings.nameFontSize}
            onChange={(e) => update({ nameFontSize: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="label mb-0" htmlFor="like-contribution-volume">
            通知音量
          </label>
          <span className="text-xs text-muted">{settings.soundVolume}</span>
        </div>
        <input
          id="like-contribution-volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.soundVolume}
          onChange={(e) => update({ soundVolume: Number(e.target.value) }, true)}
          className="w-full mt-1.5"
          style={{ accentColor: "#fe2c55" }}
        />
      </div>
    </div>
  );
}
