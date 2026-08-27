"use client";

import { useState } from "react";
import { useOverlayKindSettings } from "./useOverlayKindSettings";
import { useOverlayTimerControls } from "./useOverlayTimerControls";
import { SOUND_PRESETS } from "@/lib/overlay/sound-presets";

type GiftRule = { giftName: string; minutesDelta: number; enabled: boolean };

type Payload = {
  durationMinutes: number;
  durationSeconds: number;
  headingText: string;
  endSoundKey: string | null;
  endSoundVolume: number;
  minFloorMinutes: number;
  maxCeilingMinutes: number;
  countdownSoundEnabled: boolean;
  countdownSoundThresholdSeconds: number;
  countdownSoundKey: string | null;
  countdownSoundVolume: number;
  giftRules: GiftRule[];
};

export default function TimerSettings() {
  const { settings, loading, error, update } = useOverlayKindSettings<Payload>("timer");
  const controls = useOverlayTimerControls();
  const [newGiftName, setNewGiftName] = useState("");
  const [newMinutesDelta, setNewMinutesDelta] = useState("1");

  if (loading) return <p className="text-sm text-gray-400">読み込み中...</p>;
  if (!settings) return error ? <p className="text-sm text-red-400">{error}</p> : null;

  const addGiftRule = () => {
    const giftName = newGiftName.trim();
    const minutesDelta = Number(newMinutesDelta);
    if (!giftName || !Number.isFinite(minutesDelta) || minutesDelta === 0) return;
    update({ giftRules: [...settings.giftRules, { giftName, minutesDelta, enabled: true }] }, true);
    setNewGiftName("");
    setNewMinutesDelta("1");
  };

  const removeGiftRule = (index: number) => {
    update({ giftRules: settings.giftRules.filter((_, i) => i !== index) }, true);
  };

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {controls.error && <p className="text-sm text-red-400">{controls.error}</p>}

      <div>
        <span className="label">操作</span>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => controls.start()} disabled={controls.busy} className="btn-secondary">
            開始
          </button>
          <button onClick={() => controls.pause()} disabled={controls.busy} className="btn-secondary">
            一時停止
          </button>
          <button onClick={() => controls.reset()} disabled={controls.busy} className="btn-secondary">
            リセット
          </button>
          <button onClick={() => controls.adjust(1)} disabled={controls.busy} className="btn-secondary">
            +1分
          </button>
          <button onClick={() => controls.adjust(-1)} disabled={controls.busy} className="btn-secondary">
            -1分
          </button>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="timer-heading">
          見出しテキスト
        </label>
        <input
          id="timer-heading"
          type="text"
          value={settings.headingText}
          onChange={(e) => update({ headingText: e.target.value })}
          className="input-field text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="timer-duration-minutes">
            開始時間(分)
          </label>
          <input
            id="timer-duration-minutes"
            type="number"
            min={0}
            value={settings.durationMinutes}
            onChange={(e) => update({ durationMinutes: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="timer-duration-seconds">
            開始時間(秒)
          </label>
          <input
            id="timer-duration-seconds"
            type="number"
            min={0}
            max={59}
            value={settings.durationSeconds}
            onChange={(e) => update({ durationSeconds: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="timer-floor">
            短縮下限(分)。0=無制限
          </label>
          <input
            id="timer-floor"
            type="number"
            min={0}
            value={settings.minFloorMinutes}
            onChange={(e) => update({ minFloorMinutes: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="timer-ceiling">
            延長上限(分)。0=無制限
          </label>
          <input
            id="timer-ceiling"
            type="number"
            min={0}
            value={settings.maxCeilingMinutes}
            onChange={(e) => update({ maxCeilingMinutes: Number(e.target.value) })}
            className="input-field text-sm"
          />
        </div>
      </div>

      <div>
        <span className="label">終了音</span>
        <div className="flex items-center gap-2">
          <select
            value={settings.endSoundKey ?? ""}
            onChange={(e) => update({ endSoundKey: e.target.value || null }, true)}
            className="input-field text-sm flex-1"
          >
            <option value="">なし</option>
            {SOUND_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <button onClick={() => controls.testEndSound()} disabled={controls.busy} className="btn-secondary shrink-0">
            試聴
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="label mb-0">カウントダウン音</span>
          <button
            onClick={() => update({ countdownSoundEnabled: !settings.countdownSoundEnabled }, true)}
            className={`text-xs px-2 py-1 rounded-lg border ${settings.countdownSoundEnabled ? "border-brand text-brand bg-brand/10" : "border-border text-gray-400"}`}
          >
            {settings.countdownSoundEnabled ? "ON" : "OFF"}
          </button>
        </div>
        {settings.countdownSoundEnabled && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={settings.countdownSoundKey ?? ""}
                onChange={(e) => update({ countdownSoundKey: e.target.value || null }, true)}
                className="input-field text-sm flex-1"
              >
                <option value="">なし</option>
                {SOUND_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button onClick={() => controls.testCountdownSound()} disabled={controls.busy} className="btn-secondary shrink-0">
                試聴
              </button>
            </div>
            <div>
              <label className="label" htmlFor="timer-countdown-threshold">
                残り何秒から鳴らすか
              </label>
              <input
                id="timer-countdown-threshold"
                type="number"
                min={1}
                max={60}
                value={settings.countdownSoundThresholdSeconds}
                onChange={(e) => update({ countdownSoundThresholdSeconds: Number(e.target.value) })}
                className="input-field text-sm"
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <span className="label">ギフト連動(ギフト受信で時間を自動加減算)</span>
        <div className="space-y-2">
          {settings.giftRules.map((rule, i) => (
            <div key={`${rule.giftName}:${i}`} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate text-white">{rule.giftName}</span>
              <span className="text-gray-400 shrink-0">{rule.minutesDelta > 0 ? "+" : ""}{rule.minutesDelta}分</span>
              <button onClick={() => removeGiftRule(i)} className="text-red-400 text-xs shrink-0">
                削除
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            placeholder="ギフト名"
            value={newGiftName}
            onChange={(e) => setNewGiftName(e.target.value)}
            className="input-field text-sm flex-1"
          />
          <input
            type="number"
            step="0.5"
            value={newMinutesDelta}
            onChange={(e) => setNewMinutesDelta(e.target.value)}
            className="input-field text-sm w-20"
          />
          <button onClick={addGiftRule} className="btn-secondary shrink-0">
            追加
          </button>
        </div>
      </div>
    </div>
  );
}
