"use client";

import {
  OVERLAY_DISPLAY_SPEED_MAX,
  OVERLAY_DISPLAY_SPEED_MIN,
  OVERLAY_HEADING_BACKGROUNDS,
  type OverlayHeadingBackground,
  type OverlaySettingsPayload,
} from "@/lib/overlay/contracts";
import type { OverlaySettingsPatch } from "./useOverlaySettings";

const HEADING_BACKGROUND_LABELS: Record<OverlayHeadingBackground, string> = {
  clear: "クリア",
  "crystal-blue": "ブルー",
  "sakura-pink": "ピンク",
  black: "ブラック",
  white: "ホワイト",
};

const CHOICE_BASE = "text-xs px-2 py-2 rounded-lg border transition-colors";
const CHOICE_ON = "border-brand text-brand bg-brand/10";
const CHOICE_OFF = "border-border text-gray-400 hover:text-white hover:border-white/30";

export default function ContributionSettings({
  settings,
  update,
}: {
  settings: OverlaySettingsPayload;
  update: (patch: OverlaySettingsPatch, immediate?: boolean) => void;
}) {
  const displayDateLabel = new Date(`${settings.displayDate}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });

  return (
    <div className="space-y-5">
      <div>
        <span className="label">表示する日</span>
        <div className="flex items-center gap-2">
          <button onClick={() => update({ nav: "prev" }, true)} className="btn-secondary">
            ‹ 前日
          </button>
          <span className="text-sm font-medium text-white text-center flex-1">{displayDateLabel}</span>
          <button
            onClick={() => update({ nav: "next" }, true)}
            disabled={settings.isToday}
            className="btn-secondary"
          >
            翌日 ›
          </button>
        </div>
        {!settings.isToday && (
          <button onClick={() => update({ nav: "today" }, true)} className="text-xs text-brand hover:underline mt-2">
            今日に戻す
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="overlay-threshold">
            何コイン以上で表示
          </label>
          <input
            id="overlay-threshold"
            type="number"
            min={100}
            step={100}
            value={settings.threshold}
            onChange={(e) => update({ threshold: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="overlay-goal-count">
            目標人数
          </label>
          <input
            id="overlay-goal-count"
            type="number"
            min={0}
            value={settings.goalCount}
            onChange={(e) => update({ goalCount: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="overlay-visible-rows">
            スクロールなし一括表示人数
          </label>
          <input
            id="overlay-visible-rows"
            type="number"
            min={1}
            value={settings.visibleRows}
            onChange={(e) => update({ visibleRows: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="overlay-name-max-width">
            名前の最大幅(px)
          </label>
          <input
            id="overlay-name-max-width"
            type="number"
            min={40}
            step={10}
            value={settings.nameMaxWidth}
            onChange={(e) => update({ nameMaxWidth: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
      </div>

      <div>
        <span className="label">整列方向</span>
        <div className="grid grid-cols-2 gap-2">
          {(["left", "right"] as const).map((value) => (
            <button
              key={value}
              onClick={() => update({ align: value }, true)}
              className={`${CHOICE_BASE} ${settings.align === value ? CHOICE_ON : CHOICE_OFF}`}
            >
              {value === "left" ? "左寄せ" : "右寄せ"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">見出し背景</span>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {OVERLAY_HEADING_BACKGROUNDS.map((bg) => (
            <button
              key={bg}
              onClick={() => update({ headingBackground: bg }, true)}
              className={`${CHOICE_BASE} ${settings.headingBackground === bg ? CHOICE_ON : CHOICE_OFF}`}
            >
              {HEADING_BACKGROUND_LABELS[bg]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="label mb-0" htmlFor="overlay-display-speed">
            表示速度
          </label>
          <span className="text-xs text-gray-400">{settings.displaySpeed}</span>
        </div>
        <input
          id="overlay-display-speed"
          type="range"
          min={OVERLAY_DISPLAY_SPEED_MIN}
          max={OVERLAY_DISPLAY_SPEED_MAX}
          step={1}
          value={settings.displaySpeed}
          onChange={(e) => update({ displaySpeed: Number(e.target.value) }, true)}
          className="w-full mt-1.5"
          style={{ accentColor: "#fe2c55" }}
        />
        <div className="flex items-center justify-between text-[10px] text-gray-500 mt-0.5">
          <span>遅い</span>
          <span>速い</span>
        </div>
      </div>
    </div>
  );
}
