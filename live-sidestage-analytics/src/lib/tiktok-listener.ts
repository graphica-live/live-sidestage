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
  pendingCombos: Map<string, { repeatCount: number; [key: string]: unknown }>;
  stopped: boolean;
}

const listeners = new Map<string, ListenerInstance>();

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

function updateState(
  inst: ListenerInstance,
  status: ListenerStatus,
  message: string
) {
  inst.state.status = status;
  inst.state.message = message;
  inst.state.updatedAt = new Date().toISOString();
}

async function saveGift(
  streamerId: string,
  data: Record<string, unknown>,
  count: number
) {
  try {
    const dayKey = new Date().toISOString().slice(0, 10);
    const diamondCount = Number(data.diamondCount) || 0;
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
      },
    });
  } catch (err) {
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

  const deviceId = await getOrCreateDeviceId(streamerId);
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
    const comboKey = isCombo ? `${data.uniqueId}:${data.giftId}` : null;
    const currentRepeat = Math.max(1, Number(data.repeatCount) || 1);

    if (isCombo) {
      const prev = inst.pendingCombos.get(comboKey!);
      const prevRepeat = prev ? Number(prev.repeatCount) || 0 : 0;
      const delta = Math.max(0, currentRepeat - prevRepeat);
      if (data.repeatEnd) {
        inst.pendingCombos.delete(comboKey!);
      } else {
        inst.pendingCombos.set(comboKey!, { ...data, repeatCount: currentRepeat });
      }
      if (delta > 0) saveGift(streamerId, data, delta);
      return;
    }

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
      console.error("[listener] connect error:", err);
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
    pendingCombos: new Map(),
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

  if (inst.reconnectTimer) {
    clearTimeout(inst.reconnectTimer);
    inst.reconnectTimer = null;
  }

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

  for (const s of streamers) {
    await startListener(s.id, s.tiktokId).catch((err) =>
      console.error(`[listener] resume failed for ${s.tiktokId}:`, err)
    );
  }
}
