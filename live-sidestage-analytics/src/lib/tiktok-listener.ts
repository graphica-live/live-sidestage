import { WebcastPushConnection } from "tiktok-live-connector";
import { ProxyAgent } from "proxy-agent";
import { prisma } from "./prisma";
import { getOrCreateDeviceId } from "./device-id";
import { emitOverlaySnapshot } from "./overlay";
import { emitChatComment, type ChatCommentPayload } from "./chat-feed";
import { getEulerSignApiKey } from "./settings";

export type ListenerStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "retrying"
  | "error";

interface ListenerState {
  roomId: string;
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
  // この部屋(TiktokRoom)を購読しているStreamer.idの集合。ギフトデータの書き込み先ではなく、
  // オーバーレイ更新通知・チャット配信を「誰に」送るかを決めるためだけに使う
  // (ギフトデータ自体はroomId単位で1回だけ保存され、登録者全員が同じ行を参照する)。
  subscriberIds: Set<string>;
  stopped: boolean;
  lastEventAt: number;
  // TikTok側が払い出すWebcastChatMessage.common.msgIdの直近受信履歴(FIFO)。
  // TikTokのWebSocketは再接続直後やネットワーク瞬断の前後で同一チャットメッセージを
  // 再送してくることがあり、これをそのまま配信すると全クライアントで二重に届く。
  recentChatMsgIds: Set<string>;
  recentChatMsgIdOrder: string[];
}

const CHAT_DEDUP_CACHE_SIZE = 300;

export interface GiftLogEntry {
  ts: string;
  roomId: string;
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

export function getGiftLog(roomId?: string): GiftLogEntry[] {
  return roomId ? giftLog.filter((e) => e.roomId === roomId) : [...giftLog];
}

const RECONNECT_DELAY_MS = 10_000;
const OFFLINE_RECONNECT_DELAY_MS = 30_000;
// 署名発行APIのレート制限中は、サーバーが返すretryAfterに従って待機する。
// retryAfterが取得できない場合のフォールバック、および異常値(バグ・API変更)に
// 対する下限・上限のガードレール。
const RATE_LIMIT_MIN_DELAY_MS = 60_000;
const RATE_LIMIT_MAX_DELAY_MS = 30 * 60_000;
const RATE_LIMIT_FALLBACK_DELAY_MS = 10 * 60_000;

// WEB_INTERNAL_URLが設定されているプロセス = Workerプロセス。
// Webプロセス(またはローカル単一プロセス開発)はこれを設定しないため、
// gift通知はin-process(appendGiftLog/emitOverlaySnapshot直接呼び出し)のままになる。
const isWorkerProcess = Boolean(process.env.WEB_INTERNAL_URL);

// roomId等の文字列を決定的にmod分散するためのハッシュ。
// 乱数を使わないのは、複数プロセスが同時にresolve*ForRoom()を呼んでも
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
// WORKER_COUNTが変わらない限り、再起動やWorker再編を挟んでも同じ部屋(TiktokRoom)は
// 同じworkerIdになる。同じtiktokIdを複数人が登録しても部屋は1つなので、必ず同じWorkerが担当する。
export async function resolveWorkerForRoom(
  roomId: string,
  workerCount: number
): Promise<number> {
  const room = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { workerId: true },
  });
  if (room?.workerId != null) return room.workerId;

  const workerId = hashToIndex(roomId, workerCount);
  await prisma.tiktokRoom.update({
    where: { id: roomId },
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
export async function resolveProxyForRoom(roomId: string): Promise<string | null> {
  const pool = getProxyPool();
  if (pool.length === 0) return null;

  const room = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { proxyKey: true },
  });

  const existingIdx = room?.proxyKey != null ? Number(room.proxyKey) : NaN;
  if (Number.isInteger(existingIdx) && existingIdx >= 0 && existingIdx < pool.length) {
    return pool[existingIdx];
  }

  const idx = hashToIndex(roomId, pool.length);
  await prisma.tiktokRoom.update({
    where: { id: roomId },
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

async function notifyChatComment(chat: ChatCommentPayload) {
  if (!isWorkerProcess) {
    emitChatComment(chat).catch((err) => console.error("[chat] emit error:", err));
    return;
  }
  await forwardToWeb({ streamerId: chat.streamerId, chatEvent: chat });
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

// 配信の署名発行(WebSocket接続用の署名)を担う外部APIが、アカウント単位の時間あたり
// リクエスト数上限に達したときに投げるエラー。retryAfter(ms)が付与されていれば
// それに従って待機する — 固定10秒で再試行し続けるとさらにクォータを消費し、
// 制限が解けるまでの時間を実質的に引き延ばしてしまう。
function parseSignatureRateLimitError(error: unknown): {
  isRateLimited: boolean;
  retryAfterMs: number | null;
} {
  const candidates = [
    error,
    (error as { exception?: unknown })?.exception,
    (error as { cause?: unknown })?.cause,
  ].filter(Boolean);

  const isRateLimited = candidates.some((c) => {
    const e = c as { name?: string; message?: string; reason?: string };
    return (
      e?.name === "SignatureRateLimitError" ||
      e?.reason === "Rate Limited" ||
      /rate.?limit/i.test(e?.message ?? "")
    );
  });

  if (!isRateLimited) return { isRateLimited: false, retryAfterMs: null };

  const withRetryAfter = candidates.find(
    (c) => typeof (c as { retryAfter?: unknown })?.retryAfter === "number"
  ) as { retryAfter?: number } | undefined;

  return { isRateLimited: true, retryAfterMs: withRetryAfter?.retryAfter ?? null };
}

async function persistState(roomId: string, status: ListenerStatus, message: string) {
  try {
    await prisma.tiktokRoom.update({
      where: { id: roomId },
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
        persistState(inst.state.roomId, "connected", inst.state.message);
      }, 30_000);
    }
  } else {
    if (inst.heartbeatInterval) {
      clearInterval(inst.heartbeatInterval);
      inst.heartbeatInterval = null;
    }
  }

  persistState(inst.state.roomId, status, message);
}

function jstDateKey(date: Date = new Date()): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * TikTok共通メッセージヘッダの createTime(epoch ms)を優先し、
 * 欠落・不正値の場合のみサーバー受信時刻にフォールバックする。
 * フォールバックは呼び出し側で必ずログに残すこと(サイレントフォールバック禁止)。
 */
function resolveEventTime(data: Record<string, unknown>): { time: Date; source: "tiktok" | "fallback" } {
  const raw = Number(data.createTime);
  if (Number.isFinite(raw) && raw > 0) {
    return { time: new Date(raw), source: "tiktok" };
  }
  return { time: new Date(), source: "fallback" };
}

async function loadPendingCombos(
  roomId: string
): Promise<Map<string, { repeatCount: number }>> {
  const dayKey = jstDateKey();
  const rows = await prisma.gift.groupBy({
    by: ["groupId"],
    where: { roomId, dayKey, groupId: { not: null } },
    _sum: { repeatCount: true },
  });
  const map = new Map<string, { repeatCount: number }>();
  for (const row of rows) {
    if (row.groupId) map.set(row.groupId, { repeatCount: row._sum.repeatCount ?? 0 });
  }
  return map;
}

// 保存に成功したらtrueを返す(呼び出し側はこれを見てオーバーレイ通知の要否を判断する)。
async function saveGift(
  roomId: string,
  data: Record<string, unknown>,
  count: number,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback"
): Promise<boolean> {
  try {
    const dayKey = jstDateKey(receivedAt);
    const diamondCount = Number(data.diamondCount) || 0;
    const orderId = data.orderId ? String(data.orderId) : null;
    const groupId = data.groupId ? String(data.groupId) : null;
    await prisma.gift.create({
      data: {
        roomId,
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
    return true;
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "P2002") {
      console.log("[gift] dedup: duplicate orderId skipped", data.orderId);
      return false;
    }
    console.error("[listener] gift save error:", err);
    return false;
  }
}

function createConnection(
  tiktokId: string,
  deviceId: string,
  proxyUrl: string | null,
  eulerSignApiKey: string | null
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
    // 管理画面で設定されたEulerAPIキー。未設定ならtiktok-live-connectorのデフォルト(匿名)にフォールバックする。
    ...(eulerSignApiKey ? { signApiKey: eulerSignApiKey } : {}),
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
    // プロキシ先を解決する形式に変わっている。部屋(TiktokRoom)ごとに固定のプロキシURLを
    // 返すだけのコールバックを渡すことで、sticky割当を実現する。
    ...(proxyUrl
      ? {
          webClientOptions: { httpsAgent: new ProxyAgent({ getProxyForUrl: () => proxyUrl }) },
          wsClientOptions: { agent: new ProxyAgent({ getProxyForUrl: () => proxyUrl }) },
        }
      : {}),
  } as Record<string, unknown>);
}

async function connectInstance(roomId: string) {
  const inst = listeners.get(roomId);
  if (!inst || inst.stopped) return;

  if (inst.connectPromise) return inst.connectPromise;

  // connectPromiseは同期的に(awaitを一切挟まず)ここで確定させる。
  // 呼び出し直後にconnectInstanceが再度呼ばれても、上のガードが必ず
  // このPromiseを拾えるようにするため — 以前は接続処理の途中(非同期処理や
  // イベントハンドラ登録)を挟んでから代入していたため、watchdog等による
  // 短時間の連続呼び出しでガードをすり抜け、複数のライブ接続が並行して
  // 張られてコメントが多重配信される不具合があった。
  inst.connectPromise = (async () => {
    try {
      // disconnect stale connection before creating a new one
      if (inst.connection) {
        inst.connection.removeAllListeners?.();
        try { inst.connection.disconnect?.(); } catch {}
        inst.connection = null;
      }

      const deviceId = await getOrCreateDeviceId(roomId);
      const proxyUrl = await resolveProxyForRoom(roomId);
      const eulerSignApiKey = await getEulerSignApiKey().catch(() => null);

      if (inst.stopped) return;

      await connectAndAttach(roomId, inst, deviceId, proxyUrl, eulerSignApiKey);
    } finally {
      inst.connectPromise = null;
    }
  })();

  return inst.connectPromise;
}

async function connectAndAttach(
  roomId: string,
  inst: ListenerInstance,
  deviceId: string,
  proxyUrl: string | null,
  eulerSignApiKey: string | null
) {
  const conn = createConnection(inst.state.tiktokId, deviceId, proxyUrl, eulerSignApiKey);
  inst.connection = conn;

  conn.on("disconnected", () => {
    if (inst.connectPromise) return;
    scheduleReconnect(roomId, "disconnected");
  });

  conn.on("streamEnd", () => {
    if (inst.connectPromise) return;
    scheduleReconnect(roomId, "stream_end");
  });

  conn.on("error", (err: unknown) => {
    if (inst.connectPromise) return;
    const rateLimit = parseSignatureRateLimitError(err);
    if (rateLimit.isRateLimited) {
      scheduleReconnect(roomId, "rate_limited", rateLimit.retryAfterMs ?? undefined);
      return;
    }
    scheduleReconnect(
      roomId,
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

  conn.on("chat", (data: Record<string, unknown>) => {
    const rawMsgId = (data.common as { msgId?: unknown } | undefined)?.msgId;
    const msgId = typeof rawMsgId === "string" && rawMsgId ? rawMsgId : null;
    if (msgId) {
      if (inst.recentChatMsgIds.has(msgId)) return;
      inst.recentChatMsgIds.add(msgId);
      inst.recentChatMsgIdOrder.push(msgId);
      if (inst.recentChatMsgIdOrder.length > CHAT_DEDUP_CACHE_SIZE) {
        const oldest = inst.recentChatMsgIdOrder.shift();
        if (oldest !== undefined) inst.recentChatMsgIds.delete(oldest);
      }
    }

    const { time: eventTime } = resolveEventTime(data);
    const payload = {
      uniqueId: String(data.uniqueId || ""),
      nickname: String(data.nickname || ""),
      profilePictureUrl: data.profilePictureUrl ? String(data.profilePictureUrl) : null,
      comment: String(data.comment || ""),
      receivedAt: eventTime.toISOString(),
      msgId,
    };
    // 同じ部屋を複数のStreamerが購読している場合、全員分のchatルームへ配信する。
    for (const streamerId of Array.from(inst.subscriberIds)) {
      notifyChatComment({ streamerId, ...payload });
    }
  });

  conn.on("gift", (data: Record<string, unknown>) => {
    markAlive();
    const isCombo = data.giftType === 1;
    const groupId = data.groupId ? String(data.groupId) : null;
    const comboKey = isCombo ? (groupId ?? `${data.uniqueId}:${data.giftId}`) : null;
    const currentRepeat = Math.max(1, Number(data.repeatCount) || 1);
    const { time: eventTime, source: timeSource } = resolveEventTime(data);

    if (timeSource === "fallback") {
      console.warn("[gift] createTime missing/invalid — falling back to server time", {
        roomId,
        uniqueId: data.uniqueId,
        giftId: data.giftId,
        orderId: data.orderId,
        rawCreateTime: data.createTime,
      });
    }

    const baseLog = {
      ts: new Date().toISOString(),
      roomId,
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

    // ギフトデータはroomId単位で1行だけ保存される(登録者全員で共有)。
    // 保存に成功したときだけ、購読している全Streamerのオーバーレイへ更新通知を送る。
    const notifyAllSubscribers = () => {
      for (const streamerId of Array.from(inst.subscriberIds)) {
        notifyOverlayUpdate(streamerId);
      }
    };

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
      if (delta > 0) {
        saveGift(roomId, data, delta, eventTime, timeSource).then((saved) => {
          if (saved) notifyAllSubscribers();
        });
      }
      return;
    }

    // Non-combo: use orderId for dedup, fall back to groupId (e.g. giftType=2 gifts like Compact send empty orderId).
    // orderId/groupIdが両方欠落するケースもある(一部のgiftType=2ギフト) — dedupキーが無いだけで
    // ギフト自体は実際に届いているため、保存せず捨てるとダイヤ数がそのまま失われる。
    // orderIdカラムは(roomId, orderId)複合ユニーク制約付きだがPostgresはNULL同士を重複とみなさないため、
    // orderId=nullのまま保存してもDB側の衝突は起きない。
    const orderId =
      (data.orderId ? String(data.orderId) : null) ||
      (data.groupId ? String(data.groupId) : null);
    if (!orderId) {
      console.warn("[gift/non-combo] missing orderId and groupId — saving without dedup key", {
        uniqueId: data.uniqueId,
        giftId: data.giftId,
        giftName: data.giftName,
      });
      notifyGiftLog({ ...baseLog, action: "non-combo", reason: "missing_orderId_and_groupId" });
      saveGift(roomId, data, currentRepeat, eventTime, timeSource).then((saved) => {
        if (saved) notifyAllSubscribers();
      });
      return;
    }
    console.log("[gift/non-combo]", { orderId, uniqueId: data.uniqueId });
    notifyGiftLog({ ...baseLog, action: "non-combo" });
    saveGift(roomId, data, currentRepeat, eventTime, timeSource).then((saved) => {
      if (saved) notifyAllSubscribers();
    });
  });

  if (conn.clientParams) {
    (conn.clientParams as Record<string, string>).room_id = "";
    (conn.clientParams as Record<string, string>).cursor = "";
  }

  updateState(inst, "connecting", "接続中...");

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
      const rateLimit = parseSignatureRateLimitError(err);
      if (rateLimit.isRateLimited) {
        scheduleReconnect(roomId, "rate_limited", rateLimit.retryAfterMs ?? undefined);
      } else {
        scheduleReconnect(
          roomId,
          isUserOfflineError(err) ? "user_offline" : "connect_failed"
        );
      }
    }
  }
}

function scheduleReconnect(roomId: string, reason: string, retryAfterMs?: number) {
  const inst = listeners.get(roomId);
  if (!inst || inst.stopped) return;
  if (inst.reconnectTimer) return;

  let delay: number;
  let message: string;

  if (reason === "rate_limited") {
    delay = Math.min(
      RATE_LIMIT_MAX_DELAY_MS,
      Math.max(RATE_LIMIT_MIN_DELAY_MS, retryAfterMs ?? RATE_LIMIT_FALLBACK_DELAY_MS)
    );
    const minutes = Math.ceil(delay / 60_000);
    message = `配信認証の混雑により接続を待機中です。約${minutes}分後に自動で再接続します`;
  } else {
    delay = reason === "user_offline" ? OFFLINE_RECONNECT_DELAY_MS : RECONNECT_DELAY_MS;
    message = `再接続待機中... (${reason})`;
  }

  updateState(inst, "retrying", message);

  inst.reconnectTimer = setTimeout(async () => {
    inst.reconnectTimer = null;
    await connectInstance(roomId);
  }, delay);
}

export async function startListener(
  roomId: string,
  tiktokId: string,
  subscriberIds: string[] = []
) {
  const existing = listeners.get(roomId);
  if (existing && !existing.stopped) {
    existing.subscriberIds = new Set(subscriberIds);
    if (
      existing.state.status === "connected" ||
      existing.state.status === "connecting"
    ) {
      return existing.state;
    }
  }

  if (existing) {
    await stopListener(roomId);
  }

  const pendingCombos = await loadPendingCombos(roomId);

  const inst: ListenerInstance = {
    state: {
      roomId,
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
    subscriberIds: new Set(subscriberIds),
    stopped: false,
    lastEventAt: Date.now(),
    recentChatMsgIds: new Set(),
    recentChatMsgIdOrder: [],
  };

  listeners.set(roomId, inst);
  await connectInstance(roomId);
  return inst.state;
}

export async function stopListener(roomId: string) {
  const inst = listeners.get(roomId);
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

  persistState(inst.state.roomId, "idle", "停止中");

  if (inst.connection) {
    inst.connection.removeAllListeners?.();
    try {
      await Promise.resolve(inst.connection.disconnect?.());
    } catch {}
  }

  listeners.delete(roomId);
}

export function getListenerStatus(roomId: string): ListenerState | null {
  return listeners.get(roomId)?.state ?? null;
}

type MyRoom = { id: string; tiktokId: string; subscriberIds: string[] };

// 自分(このWorkerプロセス)が担当する部屋(TiktokRoom)だけを返す。
// workerId未割当の部屋は resolveWorkerForRoom() で決定的にハッシュ割当し、
// 自分の担当だった場合のみ含める(複数Workerが同時に処理しても同じ結果になるため競合しない)。
// 登録者(Streamer)が1人もいない部屋(全員が退会/re-registration済み)は除外する。
async function getMyRooms(): Promise<MyRoom[]> {
  const { index, count } = getWorkerConfig();

  const assigned = await prisma.tiktokRoom.findMany({
    where: { workerId: index, streamers: { some: {} } },
    include: { streamers: { select: { id: true } } },
  });

  const unassigned = await prisma.tiktokRoom.findMany({
    where: { workerId: null, streamers: { some: {} } },
    include: { streamers: { select: { id: true } } },
  });
  const claimed: typeof unassigned = [];
  for (const r of unassigned) {
    const workerId = await resolveWorkerForRoom(r.id, count);
    if (workerId === index) claimed.push(r);
  }

  return [...assigned, ...claimed].map((r) => ({
    id: r.id,
    tiktokId: r.tiktokId,
    subscriberIds: r.streamers.map((s) => s.id),
  }));
}

// 起動時の初回接続を束ねる同時実行数。無制限並列だとEuler署名サーバー/TikTok側への
// 同時アクセスが集中するため、小さめの上限で束ねてバッチ処理する。
const RESUME_CONCURRENCY = 5;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) {
      await task(item);
    }
  });
  await Promise.all(workers);
}

export async function resumeAllListeners() {
  const rooms = await getMyRooms();

  console.log(`[listener] resumeAllListeners: found ${rooms.length} room(s)`);

  await runWithConcurrency(rooms, RESUME_CONCURRENCY, async (r) => {
    console.log(`[listener] starting listener for @${r.tiktokId} (room ${r.id}, ${r.subscriberIds.length} subscriber(s))`);
    await startListener(r.id, r.tiktokId, r.subscriberIds).catch((err) =>
      console.error(`[listener] resume failed for ${r.tiktokId}:`, err)
    );
    console.log(`[listener] listener state for @${r.tiktokId}:`, listeners.get(r.id)?.state.status);
  });
}

// デプロイ時のグレースフルシャットダウン用。担当中の全部屋のTikTok接続を明示的に切断する。
export async function stopAllListeners() {
  const roomIds = Array.from(listeners.keys());
  console.log(`[listener] stopAllListeners: disconnecting ${roomIds.length} room(s)`);
  await Promise.all(roomIds.map((id) => stopListener(id)));
}

// 60秒間隔で呼ばれるreconcileループ。以下をすべてここで一貫処理する:
//  - まだ接続していない担当部屋の起動
//  - 購読者(subscriberIds)が変わった部屋の更新(再接続はしない)
//  - 購読者がゼロになった/担当替えで自分の担当でなくなった部屋の切断
//    (tiktokId変更による旧部屋の切断・Streamer削除・Worker再編のすべてがこの1箇所を通る)
export async function ensureAllListenersAlive() {
  const rooms = await getMyRooms();
  const myRoomIds = new Set(rooms.map((r) => r.id));

  for (const r of rooms) {
    const existing = listeners.get(r.id);
    if (existing) {
      existing.subscriberIds = new Set(r.subscriberIds);
      continue;
    }
    console.log(`[listener] ensureAlive: restarting missing listener for @${r.tiktokId}`);
    await startListener(r.id, r.tiktokId, r.subscriberIds).catch((err) =>
      console.error(`[listener] ensureAlive failed for ${r.tiktokId}:`, err)
    );
  }

  for (const roomId of Array.from(listeners.keys())) {
    if (!myRoomIds.has(roomId)) {
      console.log(`[listener] ensureAlive: tearing down orphaned/reassigned room ${roomId}`);
      await stopListener(roomId).catch((err) =>
        console.error(`[listener] ensureAlive teardown failed for ${roomId}:`, err)
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
  listeners.forEach((inst, roomId) => {
    if (inst.stopped) return;
    if (inst.state.status !== "connected") return;
    if (inst.connectPromise) return;

    const silentFor = now - inst.lastEventAt;
    if (silentFor > WATCHDOG_SILENCE_MS) {
      console.warn(
        `[listener] watchdog: @${inst.state.tiktokId} silent for ${silentFor}ms, forcing reconnect`
      );
      connectInstance(roomId).catch((err) =>
        console.error(`[listener] watchdog reconnect failed for ${inst.state.tiktokId}:`, err)
      );
    }
  });
}
