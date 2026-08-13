import { WebcastPushConnection } from "tiktok-live-connector";
import { ProxyAgent } from "proxy-agent";
import { prisma } from "./prisma";
import { getOrCreateDeviceId } from "./device-id";
import { emitOverlaySnapshot } from "./overlay";

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
  lastEventAt: number;
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
  timeSource: "tiktok" | "fallback";
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

export function appendGiftLog(entry: GiftLogEntry) {
  giftLog.push(entry);
  if (giftLog.length > GIFT_LOG_MAX) giftLog.splice(0, giftLog.length - GIFT_LOG_MAX);
}

export function getGiftLog(streamerId?: string): GiftLogEntry[] {
  return streamerId ? giftLog.filter((e) => e.streamerId === streamerId) : [...giftLog];
}

const RECONNECT_DELAY_MS = 10_000;
const OFFLINE_RECONNECT_DELAY_MS = 30_000;

// WEB_INTERNAL_URLが設定されているプロセス = Workerプロセス。
// Webプロセス(またはローカル単一プロセス開発)はこれを設定しないため、
// gift通知はin-process(appendGiftLog/emitOverlaySnapshot直接呼び出し)のままになる。
const isWorkerProcess = Boolean(process.env.WEB_INTERNAL_URL);

// streamerId等の文字列を決定的にmod分散するためのハッシュ。
// 乱数を使わないのは、複数プロセスが同時にresolve*ForStreamer()を呼んでも
// 常に同じ結果になり、割当の競合が起きないようにするため。
function hashToIndex(value: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}

export function getWorkerCount(): number {
  const count = Number(process.env.WORKER_COUNT);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("WORKER_COUNT must be a positive integer");
  }
  return count;
}

function getWorkerConfig(): { index: number; count: number } {
  const count = getWorkerCount();
  const index = Number(process.env.WORKER_INDEX);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error("WORKER_INDEX must be an integer in [0, WORKER_COUNT)");
  }
  return { index, count };
}

// deviceId(src/lib/device-id.ts)と同じ「初回決定→永続化→再利用」パターン。
// WORKER_COUNTが変わらない限り、再起動やWorker再編を挟んでも同じ配信者は同じworkerIdになる。
export async function resolveWorkerForStreamer(
  streamerId: string,
  workerCount: number
): Promise<number> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { workerId: true },
  });
  if (streamer?.workerId != null) return streamer.workerId;

  const workerId = hashToIndex(streamerId, workerCount);
  await prisma.streamer.update({
    where: { id: streamerId },
    data: { workerId },
  });
  return workerId;
}

function getProxyPool(): string[] {
  const raw = process.env.TIKTOK_PROXY_POOL;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    console.error("[listener] TIKTOK_PROXY_POOL is not valid JSON — ignoring, connecting directly");
    return [];
  }
}

// proxyKeyはTIKTOK_PROXY_POOL配列内のインデックスを文字列で保持する(sticky割当)。
// 新しいプロキシを追加する場合は配列の末尾に足すこと — 途中への挿入や削除は
// 既存の割当をずらしてしまう(deviceIdと違い値そのものを保存できないため)。
export async function resolveProxyForStreamer(streamerId: string): Promise<string | null> {
  const pool = getProxyPool();
  if (pool.length === 0) return null;

  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { proxyKey: true },
  });

  const existingIdx = streamer?.proxyKey != null ? Number(streamer.proxyKey) : NaN;
  if (Number.isInteger(existingIdx) && existingIdx >= 0 && existingIdx < pool.length) {
    return pool[existingIdx];
  }

  const idx = hashToIndex(streamerId, pool.length);
  await prisma.streamer.update({
    where: { id: streamerId },
    data: { proxyKey: String(idx) },
  });
  return pool[idx];
}

async function forwardToWeb(payload: Record<string, unknown>) {
  try {
    const res = await fetch(`${process.env.WEB_INTERNAL_URL}/api/internal/gift-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[listener] internal notify failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[listener] internal notify error:", err);
  }
}

// Workerプロセスから実行中のギフトイベントをWebプロセスへ転送する。
// Webプロセス(global.__ioを持つ)ではin-processのappendGiftLog/emitOverlaySnapshotに委譲する。
async function notifyGiftLog(logEntry: GiftLogEntry) {
  if (!isWorkerProcess) {
    appendGiftLog(logEntry);
    return;
  }
  await forwardToWeb({ logEntry });
}

async function notifyOverlayUpdate(streamerId: string) {
  if (!isWorkerProcess) {
    emitOverlaySnapshot(streamerId).catch((err) => console.error("[overlay] emit error:", err));
    return;
  }
  await forwardToWeb({ streamerId, emitOverlay: true });
}

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
    inst.lastEventAt = Date.now();
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

function jstDateKey(date: Date = new Date()): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * TikTok共通メッセージヘッダの createTime（epoch ms）を優先し、
 * 欠落・不正値の場合のみサーバー受信時刻にフォールバックする。
 * フォールバックは呼び出し側で必ずログに残すこと（サイレントフォールバック禁止）。
 */
function resolveEventTime(data: Record<string, unknown>): { time: Date; source: "tiktok" | "fallback" } {
  const raw = Number(data.createTime);
  if (Number.isFinite(raw) && raw > 0) {
    return { time: new Date(raw), source: "tiktok" };
  }
  return { time: new Date(), source: "fallback" };
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
  count: number,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback"
) {
  try {
    const dayKey = jstDateKey(receivedAt);
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
        receivedAt,
        timeSource,
        dayKey,
        orderId,
        groupId,
      },
    });
    notifyOverlayUpdate(streamerId);
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
  deviceId: string,
  proxyUrl: string | null
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
    // proxy-agent v6は `new ProxyAgent(url)` ではなく、getProxyForUrlコールバックで
    // プロキシ先を解決する形式に変わっている。streamerごとに固定のプロキシURLを
    // 返すだけのコールバックを渡すことで、sticky割当を実現する。
    ...(proxyUrl
      ? {
          webClientOptions: { httpsAgent: new ProxyAgent({ getProxyForUrl: () => proxyUrl }) },
          wsClientOptions: { agent: new ProxyAgent({ getProxyForUrl: () => proxyUrl }) },
        }
      : {}),
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
  const proxyUrl = await resolveProxyForStreamer(streamerId);

  // re-check after async gap
  if (inst.stopped || inst.connectPromise) return inst.connectPromise ?? undefined;

  const conn = createConnection(inst.state.tiktokId, deviceId, proxyUrl);
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

  const markAlive = () => {
    inst.lastEventAt = Date.now();
  };
  conn.on("chat", markAlive);
  conn.on("member", markAlive);
  conn.on("roomUser", markAlive);
  conn.on("social", markAlive);
  conn.on("like", markAlive);

  conn.on("gift", (data: Record<string, unknown>) => {
    markAlive();
    const isCombo = data.giftType === 1;
    const groupId = data.groupId ? String(data.groupId) : null;
    const comboKey = isCombo ? (groupId ?? `${data.uniqueId}:${data.giftId}`) : null;
    const currentRepeat = Math.max(1, Number(data.repeatCount) || 1);
    const { time: eventTime, source: timeSource } = resolveEventTime(data);

    if (timeSource === "fallback") {
      console.warn("[gift] createTime missing/invalid — falling back to server time", {
        streamerId,
        uniqueId: data.uniqueId,
        giftId: data.giftId,
        orderId: data.orderId,
        rawCreateTime: data.createTime,
      });
    }

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
      timeSource,
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
      notifyGiftLog({ ...baseLog, action: "combo", delta, prevRepeat });
      if (delta > 0) saveGift(streamerId, data, delta, eventTime, timeSource);
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
      notifyGiftLog({ ...baseLog, action: "dropped", reason: "missing_orderId_and_groupId" });
      return;
    }
    console.log("[gift/non-combo]", { orderId, uniqueId: data.uniqueId });
    notifyGiftLog({ ...baseLog, action: "non-combo" });
    saveGift(streamerId, data, currentRepeat, eventTime, timeSource);
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
    lastEventAt: Date.now(),
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

// 自分(このWorkerプロセス)が担当する配信者だけを返す。
// workerId未割当の配信者は resolveWorkerForStreamer() で決定的にハッシュ割当し、
// 自分の担当だった場合のみ含める(複数Workerが同時に処理しても同じ結果になるため競合しない)。
async function getMyStreamers() {
  const { index, count } = getWorkerConfig();

  const assigned = await prisma.streamer.findMany({
    where: { verified: true, workerId: index },
  });

  const unassigned = await prisma.streamer.findMany({
    where: { verified: true, workerId: null },
  });
  const claimed: typeof unassigned = [];
  for (const s of unassigned) {
    const workerId = await resolveWorkerForStreamer(s.id, count);
    if (workerId === index) claimed.push(s);
  }

  return [...assigned, ...claimed];
}

export async function resumeAllListeners() {
  const streamers = await getMyStreamers();

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
  const streamers = await getMyStreamers();

  for (const s of streamers) {
    if (!listeners.has(s.id)) {
      console.log(`[listener] ensureAlive: restarting missing listener for @${s.tiktokId}`);
      await startListener(s.id, s.tiktokId).catch((err) =>
        console.error(`[listener] ensureAlive failed for ${s.tiktokId}:`, err)
      );
    }
  }
}

const WATCHDOG_SILENCE_MS = 10_000;

// Detects zombie WebSocket connections: status stays "connected" but no
// events (gift/chat/member/...) have arrived, meaning the socket died
// without firing disconnected/streamEnd.
export function checkWatchdogs() {
  const now = Date.now();
  listeners.forEach((inst, streamerId) => {
    if (inst.stopped) return;
    if (inst.state.status !== "connected") return;
    if (inst.connectPromise) return;

    const silentFor = now - inst.lastEventAt;
    if (silentFor > WATCHDOG_SILENCE_MS) {
      console.warn(
        `[listener] watchdog: @${inst.state.tiktokId} silent for ${silentFor}ms, forcing reconnect`
      );
      connectInstance(streamerId).catch((err) =>
        console.error(`[listener] watchdog reconnect failed for ${inst.state.tiktokId}:`, err)
      );
    }
  });
}
