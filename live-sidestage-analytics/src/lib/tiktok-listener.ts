import { WebcastPushConnection } from "tiktok-live-connector";
import { prisma } from "./prisma";
import { getOrCreateDeviceId } from "./device-id";

export type ListenerStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "retrying"
  | "error";

interface ListenerState {
  streamerId: string;
  tiktokId: string;
  status: ListenerStatus;
  message: string;
  updatedAt: string;
}

interface ListenerInstance {
  state: ListenerState;
  connection: WebcastPushConnection | null;
  connectPromise: Promise<void> | null;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatInterval: NodeJS.Timeout | null;
  pendingCombos: Map<string, { repeatCount: number; [key: string]: unknown }>;
  stopped: boolean;
}

export interface GiftLogEntry {
  ts: string;
  streamerId: string;
  action: "combo" | "non-combo" | "dropped";
  reason?: string;
  giftType: unknown;
  giftName: unknown;
  uniqueId: unknown;
  giftId: unknown;
  groupId: unknown;
  orderId: unknown;
  repeatCount: unknown;
  repeatEnd: unknown;
  diamondCount: unknown;
  isCombo: boolean;
  delta?: number;
  prevRepeat?: number;
}

const GIFT_LOG_MAX = 200;

// Use global to survive Next.js module re-instantiation across route bundles and hot reloads.
const g = global as typeof globalThis & {
  __tiktokListeners?: Map<string, ListenerInstance>;
  __giftLog?: GiftLogEntry[];
};
if (!g.__tiktokListeners) g.__tiktokListeners = new Map();
if (!g.__giftLog) g.__giftLog = [];
const listeners = g.__tiktokListeners;
const giftLog = g.__giftLog;

function appendGiftLog(entry: GiftLogEntry) {
  giftLog.push(entry);
  if (giftLog.length > GIFT_LOG_MAX) giftLog.splice(0, giftLog.length - GIFT_LOG_MAX);
}

export function getGiftLog(streamerId?: string): GiftLogEntry[] {
  return streamerId ? giftLog.filter((e) => e.streamerId === streamerId) : [...giftLog];
}

const RECONNECT_DELAY_MS = 10_000;
const OFFLINE_RECONNECT_DELAY_MS = 30_000;

function isUserOfflineError(error: unknown): boolean {
  const candidates = [
    error,
    (error as { exception?: unknown })?.exception,
    (error as { cause?: unknown })?.cause,
    (error as { response?: { data?: unknown } })?.response?.data,
    (error as { error?: unknown })?.error,
  ].filter(Boolean);

  const text = candidates
    .map((c) => {
      const e = c as { message?: string; info?: string };
      return typeof e?.message === "string"
        ? e.message
        : typeof e?.info === "string"
        ? e.info
        : String(c || "");
    })
    .join("\n");

  const hasName = candidates.some(
    (c) => (c as { name?: string })?.name === "UserOfflineError"
  );
  return hasName || /isn't online|user.+offline|requested user.+online/i.test(text);
}

function isAlreadyConnectedError(error: unknown): boolean {
  const msg =
    typeof (error as { message?: string })?.message === "string"
      ? (error as { message: string }).message
      : String(error || "");
  return /already connected!?/i.test(msg);
}

async function persistState(streamerId: string, status: ListenerStatus, message: string) {
  try {
    await prisma.streamer.update({
      where: { id: streamerId },
      data: { listenerStatus: status, listenerMessage: message, listenerUpdatedAt: new Date() },
    });
  } catch (err) {
    console.error("[listener] persistState error:", err);
  }
}

function updateState(
  inst: ListenerInstance,
  status: ListenerStatus,
  message: string
) {
  inst.state.status = status;
  inst.state.message = message;
  inst.state.updatedAt = new Date().toISOString();

  // Manage heartbeat interval
  if (status === "connected") {
    if (!inst.heartbeatInterval) {
      inst.heartbeatInterval = setInterval(() => {
        persistState(inst.state.streamerId, "connected", inst.state.message);
      }, 30_000);
    }
  } else {
    if (inst.heartbeatInterval) {
      clearInterval(inst.heartbeatInterval);
      inst.heartbeatInterval = null;
    }
  }

  persistState(inst.state.streamerId, status, message);
}

function jstDateKey(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

async function loadPendingCombos(
  streamerId: string
): Promise<Map<string, { repeatCount: number }>> {
  const dayKey = jstDateKey();
  const rows = await prisma.gift.groupBy({
    by: ["groupId"],
    where: { streamerId, dayKey, groupId: { not: null } },
    _sum: { repeatCount: true },
  });
  const map = new Map<string, { repeatCount: number }>();
  for (const row of rows) {
    if (row.groupId) map.set(row.groupId, { repeatCount: row._sum.repeatCount ?? 0 });
  }
  return map;
}

async function saveGift(
  streamerId: string,
  data: Record<string, unknown>,
  count: number
) {
  try {
    const dayKey = jstDateKey();
    const diamondCount = Number(data.diamondCount) || 0;
    const orderId = data.orderId ? String(data.orderId) : null;
    const groupId = data.groupId ? String(data.groupId) : null;
    await prisma.gift.create({
      data: {
        streamerId,
        uniqueId: String(data.uniqueId || ""),
        nickname: String(data.nickname || ""),
        profileImageUrl: data.profilePictureUrl
          ? String(data.profilePictureUrl)
          : null,
        giftId: Number(data.giftId) || 0,
        giftName: String(data.giftName || ""),
        giftPictureUrl: data.giftPictureUrl
          ? String(data.giftPictureUrl)
          : null,
        repeatCount: count,
        diamondCount,
        totalDiamonds: diamondCount * count,
        dayKey,
        orderId,
        groupId,
      },
    });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "P2002") {
      console.log("[gift] dedup: duplicate orderId skipped", data.orderId);
      return;
    }
    console.error("[listener] gift save error:", err);
  }
}

function createConnection(
  tiktokId: string,
  deviceId: string
): WebcastPushConnection {
  return new WebcastPushConnection(`@${tiktokId}`, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: true,
    enableRequestPolling: false,
    disableEulerFallbacks: true,
    sessionId: undefined,
    authenticateWs: false,
    webClientParams: {
      app_language: "ja",
      device_platform: "web",
      device_id: deviceId,
    },
    wsClientParams: {
      app_language: "ja",
      device_platform: "web",
      device_id: deviceId,
    },
  } as Record<string, unknown>);
}

async function connectInstance(streamerId: string) {
  const inst = listeners.get(streamerId);
  if (!inst || inst.stopped) return;

  if (inst.connectPromise) return inst.connectPromise;

  // disconnect stale connection before creating a new one
  if (inst.connection) {
    inst.connection.removeAllListeners?.();
    try { inst.connection.disconnect?.(); } catch {}
    inst.connection = null;
  }

  const deviceId = await getOrCreateDeviceId(streamerId);

  // re-check after async gap
  if (inst.stopped || inst.connectPromise) return inst.connectPromise ?? undefined;

  const conn = createConnection(inst.state.tiktokId, deviceId);
  inst.connection = conn;

  conn.on("disconnected", () => {
    if (inst.connectPromise) return;
    scheduleReconnect(streamerId, "disconnected");
  });

  conn.on("streamEnd", () => {
    if (inst.connectPromise) return;
    scheduleReconnect(streamerId, "stream_end");
  });

  conn.on("error", (err: unknown) => {
    if (inst.connectPromise) return;
    scheduleReconnect(
      streamerId,
      isUserOfflineError(err) ? "user_offline" : "error"
    );
  });

  conn.on("gift", (data: Record<string, unknown>) => {
    const isCombo = data.giftType === 1;
    const groupId = data.groupId ? String(data.groupId) : null;
    const comboKey = isCombo ? (groupId ?? `${data.uniqueId}:${data.giftId}`) : null;
    const currentRepeat = Math.max(1, Number(data.repeatCount) || 1);

    const baseLog = {
      ts: new Date().toISOString(),
      streamerId,
      giftType: data.giftType,
      giftName: data.giftName,
      uniqueId: data.uniqueId,
      giftId: data.giftId,
      groupId: data.groupId,
      orderId: data.orderId,
      repeatCount: data.repeatCount,
      repeatEnd: data.repeatEnd,
      diamondCount: data.diamondCount,
      isCombo,
    };

    console.log("[gift]", JSON.stringify(baseLog));

    if (isCombo) {
      const prev = inst.pendingCombos.get(comboKey!);
      const prevRepeat = prev ? Number(prev.repeatCount) || 0 : 0;
      const delta = Math.max(0, currentRepeat - prevRepeat);
      if (data.repeatEnd) {
        inst.pendingCombos.delete(comboKey!);
      } else {
        inst.pendingCombos.set(comboKey!, { ...data, repeatCount: currentRepeat });
      }
      console.log("[gift/combo]", { comboKey, prevRepeat, currentRepeat, delta, repeatEnd: data.repeatEnd, saving: delta > 0 });
      appendGiftLog({ ...baseLog, action: "combo", delta, prevRepeat });
      if (delta > 0) saveGift(streamerId, data, delta);
      return;
    }

    // Non-combo: use orderId for dedup, fall back to groupId (e.g. giftType=2 gifts like Compact send empty orderId)
    const orderId =
      (data.orderId ? String(data.orderId) : null) ||
      (data.groupId ? String(data.groupId) : null);
    if (!orderId) {
      console.error("[gift/non-combo] missing orderId and groupId — dropping event", {
        uniqueId: data.uniqueId,
        giftId: data.giftId,
        giftName: data.giftName,
      });
      appendGiftLog({ ...baseLog, action: "dropped", reason: "missing_orderId_and_groupId" });
      return;
    }
    console.log("[gift/non-combo]", { orderId, uniqueId: data.uniqueId });
    appendGiftLog({ ...baseLog, action: "non-combo" });
    saveGift(streamerId, data, currentRepeat);
  });

  if (conn.clientParams) {
    (conn.clientParams as Record<string, string>).room_id = "";
    (conn.clientParams as Record<string, string>).cursor = "";
  }

  updateState(inst, "connecting", "接続中...");

  inst.connectPromise = (async () => {
    try {
      await conn.connect();
      updateState(inst, "connected", "接続済み");
    } catch (err) {
      if (isAlreadyConnectedError(err)) {
        updateState(inst, "connected", "接続済み");
        return;
      }
      if (!isUserOfflineError(err)) {
        console.error("[listener] connect error:", err);
      }
      if (!inst.stopped) {
        scheduleReconnect(
          streamerId,
          isUserOfflineError(err) ? "user_offline" : "connect_failed"
        );
      }
    } finally {
      inst.connectPromise = null;
    }
  })();

  return inst.connectPromise;
}

function scheduleReconnect(streamerId: string, reason: string) {
  const inst = listeners.get(streamerId);
  if (!inst || inst.stopped) return;
  if (inst.reconnectTimer) return;

  const delay =
    reason === "user_offline" ? OFFLINE_RECONNECT_DELAY_MS : RECONNECT_DELAY_MS;

  updateState(inst, "retrying", `再接続待機中... (${reason})`);

  inst.reconnectTimer = setTimeout(async () => {
    inst.reconnectTimer = null;
    await connectInstance(streamerId);
  }, delay);
}

export async function startListener(streamerId: string, tiktokId: string) {
  const existing = listeners.get(streamerId);
  if (existing && !existing.stopped) {
    if (
      existing.state.status === "connected" ||
      existing.state.status === "connecting"
    ) {
      return existing.state;
    }
  }

  if (existing) {
    await stopListener(streamerId);
  }

  const pendingCombos = await loadPendingCombos(streamerId);

  const inst: ListenerInstance = {
    state: {
      streamerId,
      tiktokId,
      status: "idle",
      message: "起動中",
      updatedAt: new Date().toISOString(),
    },
    connection: null,
    connectPromise: null,
    reconnectTimer: null,
    heartbeatInterval: null,
    pendingCombos,
    stopped: false,
  };

  listeners.set(streamerId, inst);
  await connectInstance(streamerId);
  return inst.state;
}

export async function stopListener(streamerId: string) {
  const inst = listeners.get(streamerId);
  if (!inst) return;

  inst.stopped = true;

  if (inst.heartbeatInterval) {
    clearInterval(inst.heartbeatInterval);
    inst.heartbeatInterval = null;
  }

  if (inst.reconnectTimer) {
    clearTimeout(inst.reconnectTimer);
    inst.reconnectTimer = null;
  }

  persistState(inst.state.streamerId, "idle", "停止中");

  if (inst.connection) {
    inst.connection.removeAllListeners?.();
    try {
      await Promise.resolve(inst.connection.disconnect?.());
    } catch {}
  }

  listeners.delete(streamerId);
}

export function getListenerStatus(streamerId: string): ListenerState | null {
  return listeners.get(streamerId)?.state ?? null;
}

export async function resumeAllListeners() {
  const streamers = await prisma.streamer.findMany({
    where: { verified: true },
  });

  console.log(`[listener] resumeAllListeners: found ${streamers.length} verified streamer(s)`);

  for (const s of streamers) {
    console.log(`[listener] starting listener for @${s.tiktokId} (${s.id})`);
    await startListener(s.id, s.tiktokId).catch((err) =>
      console.error(`[listener] resume failed for ${s.tiktokId}:`, err)
    );
    console.log(`[listener] listener state for @${s.tiktokId}:`, listeners.get(s.id)?.state.status);
  }
}

export async function ensureAllListenersAlive() {
  const streamers = await prisma.streamer.findMany({
    where: { verified: true },
  });

  for (const s of streamers) {
    if (!listeners.has(s.id)) {
      console.log(`[listener] ensureAlive: restarting missing listener for @${s.tiktokId}`);
      await startListener(s.id, s.tiktokId).catch((err) =>
        console.error(`[listener] ensureAlive failed for ${s.tiktokId}:`, err)
      );
    }
  }
}
