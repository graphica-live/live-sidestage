// タイマーオーバーレイの状態機械。**サーバー専用**(prisma を引く)。
//
// サーバー側setTimeoutは持たない。終了検知・カウントダウン音の発火はクライアント側
// (timer/page.tsx)がローカルの較正計算で行う — analyticsはtimerページ自身が音を鳴らすため、
// サーバーがoverlay:{streamerId}ルームへ配ってもOBS+プレビューiframeの全インスタンスに
// 届いてしまい多重再生を防げない(desktopがサーバー集中管理していたのは別のeffects
// オーバーレイで鳴らすための多重再生防止だったが、ここでは前提が異なる)。
//
// per-streamer直列キューで、ギフト連動・手動操作(start/pause/reset/adjust)の
// read-modify-writeを直列化する。forwardToWebは同時4並列なので、同一streamerへの
// ギフトtickが並行してここへ来ると、直列化しないと加算が失われる。

import { prisma } from "@/lib/prisma";
import { normalizeOverlayAppearance, OVERLAY_APPEARANCE_DEFAULT, type OverlayAppearance } from "./appearance";
import type { TimerEvent, TimerRuntimePayload } from "./emit";

// **emit.ts は server-kinds.ts → timer.server.ts を経由してこのファイルへ戻ってくる
// (server-kinds.ts が buildTimerSnapshot をここから import するため)。
// emitOverlayUpdate/emitTimerEvent の実行時 import を静的にすると循環参照になるので、
// 呼び出し箇所でのみ動的 import する。型だけは `import type` で解決している
// (型情報はコンパイル時に消えるので循環の実害が無い)。
export async function emitTimerSnapshotUpdate(streamerId: string): Promise<void> {
  const { emitOverlayUpdate } = await import("./emit");
  await emitOverlayUpdate(streamerId, "timer");
}

export async function emitTimerAdHocEvent(streamerId: string, event: TimerEvent): Promise<void> {
  const { emitTimerEvent } = await import("./emit");
  emitTimerEvent(streamerId, event);
}

export type TimerSnapshot = {
  settings: {
    headingText: string;
    endSoundKey: string | null;
    endSoundVolume: number;
    countdownSoundEnabled: boolean;
    countdownSoundThresholdSeconds: number;
    countdownSoundKey: string | null;
    countdownSoundVolume: number;
    minFloorMinutes: number;
    maxCeilingMinutes: number;
  };
  appearance: OverlayAppearance;
  runtime: TimerRuntimePayload;
  serverNow: number;
};

const DEFAULT_DURATION_MINUTES = 10;
const DEFAULT_DURATION_SECONDS = 0;
const DEFAULT_HEADING_TEXT = "カウントダウン";

async function getOrCreateTimerSettings(streamerId: string) {
  const existing = await prisma.overlayTimerSettings.findUnique({ where: { streamerId } });
  if (existing) return existing;
  return prisma.overlayTimerSettings.create({
    data: {
      streamerId,
      durationMinutes: DEFAULT_DURATION_MINUTES,
      durationSeconds: DEFAULT_DURATION_SECONDS,
      headingText: DEFAULT_HEADING_TEXT,
    },
  });
}

async function getOrCreateTimerState(streamerId: string, settings: { durationMinutes: number; durationSeconds: number }) {
  const existing = await prisma.overlayTimerState.findUnique({ where: { streamerId } });
  if (existing) return existing;
  const remainingMs = (settings.durationMinutes * 60 + settings.durationSeconds) * 1000;
  return prisma.overlayTimerState.create({
    data: { streamerId, running: false, endsAt: null, remainingMs },
  });
}

function computeRemainingMs(state: { running: boolean; endsAt: Date | null; remainingMs: number }): number {
  if (state.running && state.endsAt) {
    return Math.max(0, state.endsAt.getTime() - Date.now());
  }
  return Math.max(0, state.remainingMs);
}

function toRuntimePayload(state: { running: boolean; endsAt: Date | null; remainingMs: number }): TimerRuntimePayload {
  return {
    running: state.running,
    endsAt: state.endsAt ? state.endsAt.getTime() : null,
    remainingMs: computeRemainingMs(state),
  };
}

export async function buildTimerSnapshot(streamerId: string): Promise<TimerSnapshot | null> {
  const streamer = await prisma.streamer.findUnique({ where: { id: streamerId }, select: { id: true } });
  if (!streamer) return null;

  const settings = await getOrCreateTimerSettings(streamerId);
  const state = await getOrCreateTimerState(streamerId, settings);

  return {
    settings: {
      headingText: settings.headingText,
      endSoundKey: settings.endSoundKey,
      endSoundVolume: settings.endSoundVolume,
      countdownSoundEnabled: settings.countdownSoundEnabled,
      countdownSoundThresholdSeconds: settings.countdownSoundThresholdSeconds,
      countdownSoundKey: settings.countdownSoundKey,
      countdownSoundVolume: settings.countdownSoundVolume,
      minFloorMinutes: settings.minFloorMinutes,
      maxCeilingMinutes: settings.maxCeilingMinutes,
    },
    appearance: normalizeOverlayAppearance(settings ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
    runtime: toRuntimePayload(state),
    serverNow: Date.now(),
  };
}

// ── per-streamer直列書き込みキュー(createWriteQueueと同型) ──────────────────────
const timerWriteQueues = new Map<string, Promise<unknown>>();
function enqueueTimerWrite<T>(streamerId: string, fn: () => Promise<T>): Promise<T> {
  const prev = timerWriteQueues.get(streamerId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  timerWriteQueues.set(
    streamerId,
    next.catch(() => undefined)
  );
  return next;
}

async function startTimerInternal(streamerId: string): Promise<TimerRuntimePayload> {
  const settings = await getOrCreateTimerSettings(streamerId);
  const state = await getOrCreateTimerState(streamerId, settings);
  const remaining = computeRemainingMs(state) > 0 ? computeRemainingMs(state) : (settings.durationMinutes * 60 + settings.durationSeconds) * 1000;
  const next = await prisma.overlayTimerState.update({
    where: { streamerId },
    data: { running: true, endsAt: new Date(Date.now() + remaining), remainingMs: remaining },
  });
  return toRuntimePayload(next);
}

async function pauseTimerInternal(streamerId: string): Promise<TimerRuntimePayload> {
  const state = await prisma.overlayTimerState.findUnique({ where: { streamerId } });
  if (!state) return toRuntimePayload({ running: false, endsAt: null, remainingMs: 0 });
  const remainingMs = computeRemainingMs(state);
  const next = await prisma.overlayTimerState.update({
    where: { streamerId },
    data: { running: false, endsAt: null, remainingMs },
  });
  return toRuntimePayload(next);
}

async function resetTimerInternal(streamerId: string): Promise<TimerRuntimePayload> {
  const settings = await getOrCreateTimerSettings(streamerId);
  const remainingMs = (settings.durationMinutes * 60 + settings.durationSeconds) * 1000;
  const next = await prisma.overlayTimerState.upsert({
    where: { streamerId },
    create: { streamerId, running: false, endsAt: null, remainingMs },
    update: { running: false, endsAt: null, remainingMs },
  });
  return toRuntimePayload(next);
}

async function adjustTimerByMinutesInternal(
  streamerId: string,
  deltaMinutes: number
): Promise<{ runtime: TimerRuntimePayload; blocked: boolean; capped: boolean }> {
  const settings = await getOrCreateTimerSettings(streamerId);
  const state = await getOrCreateTimerState(streamerId, settings);
  const currentMs = computeRemainingMs(state);
  const currentMinutes = currentMs / 60000;

  const floor = settings.minFloorMinutes > 0 ? settings.minFloorMinutes : 0;
  const ceiling = settings.maxCeilingMinutes > 0 ? settings.maxCeilingMinutes : Infinity;

  let nextMinutes = currentMinutes + deltaMinutes;
  let blocked = false;
  let capped = false;
  if (nextMinutes < floor) {
    nextMinutes = floor;
    blocked = deltaMinutes < 0;
  }
  if (nextMinutes > ceiling) {
    nextMinutes = ceiling;
    capped = deltaMinutes > 0;
  }

  const nextMs = Math.max(0, Math.round(nextMinutes * 60000));
  const data = state.running
    ? { endsAt: new Date(Date.now() + nextMs), remainingMs: nextMs }
    : { remainingMs: nextMs };
  const next = await prisma.overlayTimerState.update({ where: { streamerId }, data });

  return { runtime: toRuntimePayload(next), blocked, capped };
}

export async function startTimer(streamerId: string): Promise<TimerRuntimePayload> {
  return enqueueTimerWrite(streamerId, () => startTimerInternal(streamerId));
}
export async function pauseTimer(streamerId: string): Promise<TimerRuntimePayload> {
  return enqueueTimerWrite(streamerId, () => pauseTimerInternal(streamerId));
}
export async function resetTimer(streamerId: string): Promise<TimerRuntimePayload> {
  return enqueueTimerWrite(streamerId, () => resetTimerInternal(streamerId));
}
export async function adjustTimerByMinutes(
  streamerId: string,
  deltaMinutes: number
): Promise<{ runtime: TimerRuntimePayload; blocked: boolean; capped: boolean }> {
  return enqueueTimerWrite(streamerId, () => adjustTimerByMinutesInternal(streamerId, deltaMinutes));
}

/** ギフト連動: 該当ルールがあれば分数を加減算してemitする。無ければ何もしない。 */
export async function applyTimerGiftRule(input: { streamerId: string; giftName: string; units: number }): Promise<void> {
  if (input.units <= 0) return;
  const rule = await prisma.overlayTimerGiftRule.findUnique({
    where: { streamerId_giftName: { streamerId: input.streamerId, giftName: input.giftName } },
  });
  if (!rule || !rule.enabled || rule.minutesDelta === 0) return;

  const deltaMinutes = rule.minutesDelta * input.units;
  const { runtime, blocked, capped } = await adjustTimerByMinutes(input.streamerId, deltaMinutes);
  await emitTimerSnapshotUpdate(input.streamerId);
  await emitTimerAdHocEvent(input.streamerId, {
    type: blocked ? "blocked" : capped ? "capped" : "adjust",
    deltaMinutes,
    source: "gift",
    runtime,
  });
}

/** ギフト名の正規化(trim+小文字化)。設定保存・ギフト連動判定の両方で使う。 */
export function normalizeGiftName(value: string): string {
  return value.trim().toLowerCase();
}
