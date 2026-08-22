import { WebcastPushConnection } from "tiktok-live-connector";
import { ProxyAgent } from "proxy-agent";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getOrCreateDeviceId } from "./device-id";
import { emitOverlaySnapshot } from "./overlay";
import {
  emitChatComment,
  emitChatFollow,
  emitChatGift,
  type ChatCommentPayload,
  type ChatFollowInput,
  type ChatGiftInput,
} from "./chat-feed";
import { getEulerSignApiKey } from "./settings";
import type { GiftCatalogSource } from "./tiktok-gift-catalog";
import {
  mergeBattleState,
  parseArmiesEvent,
  parseBattleEvent,
  type BattleRecordState,
  type ParsedBattle,
} from "./tiktok-battle";

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
  // watchdogが「実イベントが届かない」ことを理由に強制再接続を発動した連続回数。
  // markAlive()(chat/gift/member/roomUser/social/likeのいずれか)が発火すると0にリセットされる。
  // scheduleReconnect()側の再接続には一切関与しない(watchdog経由のconnectInstance呼び出しのみが対象)。
  watchdogTriggerCount: number;
  // 次にwatchdog起因の強制再接続を許可するepoch ms。now < この値の間はsilentForが閾値を超えていてもスキップする。
  watchdogBackoffUntil: number;
  // TikTok側が払い出すWebcastChatMessage.common.msgIdの直近受信履歴(FIFO)。
  // 実際の取り出しはresolveMsgId()経由(平坦化済みのdata.msgId)。
  // TikTokのWebSocketは再接続直後やネットワーク瞬断の前後で同一チャットメッセージを
  // 再送してくることがあり、これをそのまま配信すると全クライアントで二重に届く。
  // (tiktok-live-connectorはProtoMessageFetchResult内のisHistoryフラグを握りつぶして
  //  emitするため、再送バッチをライブラリ側で見分ける手段がなく、msgIdでの後追い判定に頼るしかない)
  recentChatMsgIds: Set<string>;
  recentChatMsgIdOrder: string[];
  // ギフト版。chatと同じくTikTok側の再送で同一イベントが2回届くことがあり、
  // non-comboの保存パスは無条件にinsertするためそのまま二重計上になる
  // (comboはdelta=0になるので元々弾かれる)。実データで1件確認済み。
  recentGiftMsgIds: Set<string>;
  recentGiftMsgIdOrder: string[];
}

// ack未達等によるTikTok側の再送バッチは、盛り上がっている配信だと直近のコメントとの間隔が
// 数百件を優に超えることがある。小さすぎるFIFOだと再送到達前に対象msgIdが枠から追い出され、
// dedupをすり抜けて二重配信してしまう(2026-08-18に発覚)。msgId文字列は軽量なので余裕を持たせる。
const CHAT_DEDUP_CACHE_SIZE = 3000;

// ギフトはコメントよりずっと流量が少ないので、同じ再送バッチを覆うのに必要な枠も小さい。
const GIFT_DEDUP_CACHE_SIZE = 1000;

// msgIdのFIFOキャッシュ。未登録なら記録してtrueを返し、既に入っていれば(=再送)falseを返す。
function rememberMsgId(
  seen: Set<string>,
  order: string[],
  msgId: string,
  capacity: number
): boolean {
  if (seen.has(msgId)) return false;
  seen.add(msgId);
  order.push(msgId);
  if (order.length > capacity) {
    const oldest = order.shift();
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}

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
//
// 部屋が消えていた場合は null を返す。**投げてはいけない** — findUniqueとupdateのあいだに
// tiktokId変更やStreamer削除で部屋が消えることがあり、投げると getMyRooms() が丸ごと失敗して
// 無関係な部屋まで巻き添えで再接続されなくなる。
export async function resolveWorkerForRoom(
  roomId: string,
  workerCount: number
): Promise<number | null> {
  const room = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { workerId: true },
  });
  if (!room) return null;
  if (room.workerId != null) return room.workerId;

  const workerId = hashToIndex(roomId, workerCount);
  // 部屋が消えていても落とさない(updateMany は0件でも例外を投げない)。
  // getMyRooms が一覧を読んでからここへ来るまでの間に、最後の Streamer が
  // 部屋を外して削除されることがある。
  const { count } = await prisma.tiktokRoom.updateMany({
    where: { id: roomId },
    data: { workerId },
  });
  return count === 0 ? null : workerId;
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

// Worker→Web転送のdelivery semantics: best effort。Webが落ちている/詰まっている間の
// イベントはドロップし、復旧後にreplayしない。オーバーレイはスナップショット再送で、
// チャット/ギフトは「その瞬間鳴らせなければ意味がない」ので、遅れて届くより捨てる方がよい。
const FORWARD_TIMEOUT_MS = 5000;
// 同時に飛ばすリクエスト数の上限。timeoutだけではWeb障害時に最大5秒分の
// リクエストが無制限に並行してしまう。
const FORWARD_MAX_CONCURRENCY = 4;
// 待ち行列の上限。溢れた分は捨ててカウンタだけ残す。
const FORWARD_MAX_QUEUE = 256;

let forwardInFlight = 0;
const forwardQueue: Array<() => void> = [];
let forwardDroppedCount = 0;
let forwardDropLoggedAt = 0;

function releaseForwardSlot() {
  forwardInFlight--;
  const next = forwardQueue.shift();
  if (next) next();
}

function acquireForwardSlot(): Promise<boolean> {
  if (forwardInFlight < FORWARD_MAX_CONCURRENCY) {
    forwardInFlight++;
    return Promise.resolve(true);
  }
  if (forwardQueue.length >= FORWARD_MAX_QUEUE) {
    forwardDroppedCount++;
    // 溢れている間は毎回ログを出すと、それ自体が負荷になるので間引く。
    const now = Date.now();
    if (now - forwardDropLoggedAt > 10_000) {
      console.error("[listener] internal notify dropped (queue full)", { dropped: forwardDroppedCount });
      forwardDropLoggedAt = now;
    }
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    forwardQueue.push(() => {
      forwardInFlight++;
      resolve(true);
    });
  });
}

async function forwardToWeb(payload: Record<string, unknown>) {
  const acquired = await acquireForwardSlot();
  if (!acquired) return;

  try {
    const res = await fetch(`${process.env.WEB_INTERNAL_URL}/api/internal/gift-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[listener] internal notify failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[listener] internal notify error:", err);
  } finally {
    releaseForwardSlot();
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

// ギフト/フォローは同じ部屋を購読している全Streamerへ配る。購読者ごとにHTTPを撃つと
// 人数分の同時リクエストになるため、streamerIdsをまとめて1リクエストにする。
async function notifyChatGift(streamerIds: string[], gift: Omit<ChatGiftInput, "streamerId">) {
  if (streamerIds.length === 0) return;

  if (!isWorkerProcess) {
    for (const streamerId of streamerIds) {
      emitChatGift({ streamerId, ...gift }).catch((err) => console.error("[gift] chat emit error:", err));
    }
    return;
  }
  await forwardToWeb({ streamerIds, chatGiftEvent: gift });
}

async function notifyChatFollow(streamerIds: string[], follow: Omit<ChatFollowInput, "streamerId">) {
  if (streamerIds.length === 0) return;

  if (!isWorkerProcess) {
    for (const streamerId of streamerIds) {
      emitChatFollow({ streamerId, ...follow }).catch((err) => console.error("[follow] chat emit error:", err));
    }
    return;
  }
  await forwardToWeb({ streamerIds, chatFollowEvent: follow });
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
 * TikTok共通メッセージヘッダの msgId を取り出す。
 *
 * tiktok-live-connector の WebcastPushConnection(レガシー互換クラス)は simplifyObject() で
 * ネストしたprotobufを平坦化する際、common の中身をトップレベルへ Object.assign したうえで
 * common 自体を delete する
 * (node_modules/tiktok-live-connector/dist/lib/_legacy/data-converter.js)。
 *
 *   Object.assign(webcastObject, webcastObject.common);
 *   delete webcastObject.common;
 *
 * つまりハンドラに届く時点で data.common は存在せず、msgId はトップレベルにある。
 * 以前ここは data.common?.msgId を読んでおり、msgId が常に null になっていたため、
 * listenerインスタンス側(recentChatMsgIds)とWebプロセス側(isDuplicateChatEvent)の
 * 2層のdedupがどちらも一度も発動していなかった。
 */
// common.msgId は protobuf の int64 なので、届く値は必ず正の10進数文字列になる。
// 一方でメッセージ側がフィールドを持たない場合、デコーダは既定値の "0" をそのまま埋める
// (types/tiktok/data.js の createBaseCommonMessageData)。"0" を実IDとして扱うと、
// 無関係なイベント同士が同じキーを共有して dedup が誤爆する — 同じ既定値の流入は
// groupId="0" が本番に3591件ある実績で確認済み。実IDとして使えない値はすべて null に倒す。
const MSG_ID_PATTERN = /^[1-9][0-9]{0,31}$/;

export function resolveMsgId(data: Record<string, unknown>): string | null {
  const raw = data.msgId;
  if (typeof raw !== "string") return null;
  return MSG_ID_PATTERN.test(raw) ? raw : null;
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

// 同じギフトイベントを二重に保存しないための時刻窓。
//
// 二重保存が起きる経路は主に2つ。
//   1. TikTok側の再送(再接続直後やネットワーク瞬断の前後)
//   2. デプロイ中の新旧Worker並走(RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=10)
// どちらも数秒〜十数秒の範囲なので、5分あれば十分に覆える。
//
// 1はgiftハンドラ側のrecentGiftMsgIds(プロセス内FIFO)が先に落とす。こちらの
// DB照会は主に2 — 別プロセスが既に書いた行を見つけるため — を担当する。
// プロセス内キャッシュだけでは新旧Worker並走を防げず、DB照会だけでは同一tickの
// 再送を防げないので、両方が要る。
//
// **DBのunique制約ではなくアプリ側の時刻窓で弾いている理由**:
// Gift.roomIdはTikTokの配信セッションIDではなく永続的なTiktokRoom.idなので、
// (roomId, msgId)をunique制約にすると「将来の別ライブで同じmsgIdが来たら弾かれる」
// 可能性を永久に抱える。msgIdは実測でsnowflake(上位ビットがms時刻、1msあたりの
// 増分が2^22)と確認できており再利用の心配はほぼ無いが、外したときの被害が
// 「正当なギフトを黙って捨てる」= データロストなので、時刻窓で限定する方を選ぶ。
//
// unique制約を避けるもう1つの理由は適用手順。prisma db pushはDockerfileのCMDで
// **コンテナ起動時**に走るため、既存の重複行が残っていると制約作成に失敗し、
// Webが起動しなくなる。非uniqueなindexなら重複があっても必ず作成できる。
const GIFT_DEDUP_WINDOW_MS = 5 * 60_000;

// 保存に成功したらtrueを返す(呼び出し側はこれを見てオーバーレイ通知の要否を判断する)。
//
// falseは「このイベントを保存しなかった」であって「ギフトが無かった」ではない。
// モバイルの効果音配信(notifyChatGift)はこの戻り値に紐づけていない — 呼び出し側の
// コメントの通り、鳴らすかどうかは別の判断で、Webプロセス側(emitChatGift)が
// 独自にdedupする。ここで抑えるのはDBの行とオーバーレイ更新だけ。
async function saveGift(
  roomId: string,
  data: Record<string, unknown>,
  count: number,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback"
): Promise<boolean> {
  // catch側のログでも参照するのでtryの外で確定させる(いずれも例外を投げない純粋な変換)。
  const orderId = data.orderId ? String(data.orderId) : null;
  const groupId = data.groupId ? String(data.groupId) : null;
  const msgId = resolveMsgId(data);

  try {
    const dayKey = jstDateKey(receivedAt);
    const diamondCount = Number(data.diamondCount) || 0;

    // msgIdが取れているときだけ効く。resolveMsgId()がprotobufの既定値を弾いてnullに
    // した場合は従来どおりそのまま保存する(dedupキーが無いだけで、ギフト自体は
    // 実際に届いているため、捨てるとダイヤ数がそのまま失われる)。
    if (msgId) {
      const duplicate = await prisma.gift.findFirst({
        where: {
          roomId,
          msgId,
          receivedAt: { gte: new Date(receivedAt.getTime() - GIFT_DEDUP_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (duplicate) {
        console.log(
          `[gift] dedup: msgId=${msgId} は直近${GIFT_DEDUP_WINDOW_MS / 60_000}分に保存済み (room=${roomId}, gift=${String(data.giftName || "")})`
        );
        return false;
      }
    }

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
        msgId,
        giftType: Number.isInteger(data.giftType) ? (data.giftType as number) : null,
      },
    });
    return true;
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "P2002") {
      // どのunique制約で弾かれたかを残す。現状効きうるのは (roomId, orderId) だけだが、
      // orderIdは本番で100%nullなので実際には発火しない。将来TikTokがorderIdを返し
      // 始めたとき、comboの正当な加算を黙って捨てていないか気づけるようにしておく。
      const target = (err as { meta?: { target?: unknown } })?.meta?.target;
      console.log(
        `[gift] dedup: unique制約違反でスキップ target=${JSON.stringify(target)} orderId=${orderId} msgId=${msgId} groupId=${groupId} room=${roomId}`
      );
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

// ---------------------------------------------------------------------------
// LinkMic バトルの記録(live-sidestage-event の対戦検知が使う)
// ---------------------------------------------------------------------------

// 1つのバトルにつきイベントが何度も届き、それぞれが read-modify-write になる。
// 同じ (roomId, battleId) の書き込みは直列に流して、後から届いた古い状態で
// 上書きされないようにする。
const battleWriteChains = new Map<string, Promise<void>>();

function queueBattleWrite(key: string, task: () => Promise<void>): void {
  const prev = battleWriteChains.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(task)
    .catch((err) => {
      // 保存失敗は握りつぶさない。バトルが記録できないとイベントの対戦検知が動かない。
      console.error("[battle] failed to persist battle", { key, err });
    })
    .finally(() => {
      if (battleWriteChains.get(key) === next) battleWriteChains.delete(key);
    });
  battleWriteChains.set(key, next);
}

// payload には未検証の構造が入りうるので、JSON 化できないものはそこで捨てる。
// 1件あたりの上限を設けるのは、anchorInfo のアバター画像URL群などで肥大するため。
const MAX_RAW_BYTES = 64 * 1024;

function toStorableRaw(data: unknown): Prisma.InputJsonValue {
  try {
    const json = JSON.stringify(data);
    if (!json) return { unserializable: true };
    if (json.length > MAX_RAW_BYTES) {
      return { truncated: true, bytes: json.length, head: json.slice(0, MAX_RAW_BYTES) };
    }
    return JSON.parse(json) as Prisma.InputJsonValue;
  } catch (err) {
    return { unserializable: true, error: String(err) };
  }
}

async function persistBattle(
  roomId: string,
  parsed: ParsedBattle,
  rawKey: "battle" | "armies",
  raw: unknown,
  receivedAt: Date
): Promise<void> {
  const existing = await prisma.tiktokBattle.findUnique({
    where: { roomId_battleId: { roomId, battleId: parsed.battleId } },
  });

  const previous: BattleRecordState | null = existing
    ? {
        action: existing.action,
        startedAt: existing.startedAt,
        startedAtEstimated: existing.startedAtEstimated,
        endedAt: existing.endedAt,
        durationSec: existing.durationSec,
        hostUserIds: existing.hostUserIds,
        hostDisplayIds: existing.hostDisplayIds,
        hostScores: (existing.hostScores as Record<string, string> | null) ?? {},
      }
    : null;

  const state = mergeBattleState(previous, parsed, receivedAt);

  // raw は linkMicBattle と linkMicArmies を別キーで持つ。実 payload の fixture を
  // 取るとき、両方のイベント形が1レコードから読めるようにするため。
  const existingRaw =
    existing && existing.raw && typeof existing.raw === "object" && !Array.isArray(existing.raw)
      ? (existing.raw as Prisma.JsonObject)
      : {};
  const raws: Prisma.InputJsonObject = {
    ...(existingRaw as Prisma.InputJsonObject),
    [rawKey]: toStorableRaw(raw),
  };

  const data = {
    action: state.action,
    startedAt: state.startedAt,
    startedAtEstimated: state.startedAtEstimated,
    endedAt: state.endedAt,
    durationSec: state.durationSec,
    hostUserIds: state.hostUserIds,
    hostDisplayIds: state.hostDisplayIds,
    hostScores: state.hostScores,
    raw: raws,
  };

  if (existing) {
    await prisma.tiktokBattle.update({ where: { id: existing.id }, data });
  } else {
    await prisma.tiktokBattle.create({
      data: { roomId, battleId: parsed.battleId, ...data },
    });
  }
}

function recordBattleEvent(
  roomId: string,
  parsed: ParsedBattle | null,
  rawKey: "battle" | "armies",
  raw: unknown
): void {
  // 成立していない招待(INVITE / REJECT / CANCEL)やパースできない payload は記録しない。
  if (!parsed) return;
  const receivedAt = new Date();
  queueBattleWrite(`${roomId}:${parsed.battleId}`, () =>
    persistBattle(roomId, parsed, rawKey, raw, receivedAt)
  );
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
    inst.watchdogTriggerCount = 0;
    inst.watchdogBackoffUntil = 0;
  };
  conn.on("chat", markAlive);
  conn.on("member", markAlive);
  conn.on("roomUser", markAlive);
  conn.on("social", markAlive);
  conn.on("like", markAlive);

  // バトル中はチャットが流れない配信もあるので、バトルのイベントもwatchdogの生存判定に含める。
  conn.on("linkMicBattle", (data: unknown) => {
    markAlive();
    recordBattleEvent(roomId, parseBattleEvent(data), "battle", data);
  });
  conn.on("linkMicArmies", (data: unknown) => {
    markAlive();
    recordBattleEvent(roomId, parseArmiesEvent(data), "armies", data);
  });

  conn.on("chat", (data: Record<string, unknown>) => {
    const msgId = resolveMsgId(data);
    if (
      msgId &&
      !rememberMsgId(inst.recentChatMsgIds, inst.recentChatMsgIdOrder, msgId, CHAT_DEDUP_CACHE_SIZE)
    ) {
      console.log("[chat] dedup: duplicate msgId skipped (listener instance)", { roomId, msgId });
      return;
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

  // フォローはモバイルの効果音トリガー専用(集計・保存はしない)。
  // connectorはWebcastSocialMessageのdisplayTextに"follow"が含まれるときだけ
  // このイベントをemitするので、こちら側でdisplayTypeを判定する必要はない。
  conn.on("follow", (data: Record<string, unknown>) => {
    markAlive();
    const { time: eventTime } = resolveEventTime(data);
    notifyChatFollow(Array.from(inst.subscriberIds), {
      uniqueId: String(data.uniqueId || ""),
      nickname: String(data.nickname || ""),
      profilePictureUrl: data.profilePictureUrl ? String(data.profilePictureUrl) : null,
      occurredAt: eventTime.toISOString(),
      receivedAt: new Date().toISOString(),
      msgId: resolveMsgId(data),
    });
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

    // 同一プロセスに同じイベントが2回届いた場合をここで落とす。
    // saveGift()側のDB照会だけでは足りない — このハンドラはsaveGift()をawaitせず
    // .then()で流すので、同じtickに再送が2件届くと双方のfindFirstが「まだ無い」を
    // 見てしまい2行入る。実データで確認した二重計上(間隔0.00秒)はこの経路。
    // comboは同じrepeatCountならdelta=0で元々保存されないが、non-comboは無条件に
    // insertするため、msgId単位で先に弾く必要がある。
    // (プロセスをまたぐ重複 — デプロイ中の新旧Worker並走 — はsaveGift()側が担当する)
    const eventMsgId = resolveMsgId(data);
    if (
      eventMsgId &&
      !rememberMsgId(
        inst.recentGiftMsgIds,
        inst.recentGiftMsgIdOrder,
        eventMsgId,
        GIFT_DEDUP_CACHE_SIZE
      )
    ) {
      console.log("[gift] dedup: duplicate msgId skipped (listener instance)", {
        roomId,
        msgId: eventMsgId,
      });
      notifyGiftLog({ ...baseLog, action: "dropped", reason: "duplicate_msgId" });
      return;
    }

    // ギフトデータはroomId単位で1行だけ保存される(登録者全員で共有)。
    // 保存に成功したときだけ、購読している全Streamerのオーバーレイへ更新通知を送る。
    const notifyAllSubscribers = () => {
      for (const streamerId of Array.from(inst.subscriberIds)) {
        notifyOverlayUpdate(streamerId);
      }
    };

    // モバイルの効果音トリガー向け配信。saveGift()の成否には紐づけない —
    // falseは「roomId単位で既に保存済み」を意味するだけで、音を鳴らすべきかとは無関係。
    // TikTok側の再送による二重発火はWebプロセス側(emitChatGift)が吸収する。
    // ここではdeltaを一切計算せず、累計値をそのまま送る(新旧Worker並走時に
    // 各プロセスが別のdeltaを出すのを防ぐため。詳細はchat-feed.tsのChatGiftInput参照)。
    notifyChatGift(Array.from(inst.subscriberIds), {
      uniqueId: String(data.uniqueId || ""),
      nickname: String(data.nickname || ""),
      profilePictureUrl: data.profilePictureUrl ? String(data.profilePictureUrl) : null,
      giftName: String(data.giftName || "").trim().toLowerCase(),
      giftId: data.giftId ? String(data.giftId) : null,
      diamondCount: Number(data.diamondCount) || 0,
      repeatCount: currentRepeat,
      isCombo,
      repeatEnd: Boolean(data.repeatEnd),
      groupId,
      orderId: data.orderId ? String(data.orderId) : null,
      msgId: eventMsgId,
      occurredAt: eventTime.toISOString(),
      receivedAt: new Date().toISOString(),
    });

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
    watchdogTriggerCount: 0,
    watchdogBackoffUntil: 0,
    recentChatMsgIds: new Set(),
    recentChatMsgIdOrder: [],
    recentGiftMsgIds: new Set(),
    recentGiftMsgIdOrder: [],
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

// このプロセスが実際にメモリ上に保持しているlistenerの一覧。
//
// DBのTiktokRoom.listenerStatusとは別物であることに注意する。あちらはpersistState()が
// best effortで書いた「最後に書き込めた状態」で、書き込み失敗は握り潰されるうえ、
// 定期更新があるのはconnectedのときだけ(30秒のheartbeat)。retrying/connecting/idleは
// 古い値が残り続ける。こちらは今この瞬間のプロセス内の実体を返すので、
// 「DB上は担当なのにlistenerが存在しない」といった食い違いの検出に使える。
//
// Workerプロセスの GET /status (worker.ts) から呼ばれる。
export type ListenerSnapshot = {
  roomId: string;
  tiktokId: string;
  status: ListenerStatus;
  message: string;
  updatedAt: string;
  subscriberCount: number;
  /** 最後に実イベント(chat/gift/member等)を受け取ってからの経過ms。watchdogの判断材料と同じ値。 */
  silentForMs: number;
  watchdogTriggerCount: number;
};

export function getListenerSnapshots(now: number = Date.now()): ListenerSnapshot[] {
  return [...listeners.values()].map((inst) => ({
    roomId: inst.state.roomId,
    tiktokId: inst.state.tiktokId,
    status: inst.state.status,
    message: inst.state.message,
    updatedAt: inst.state.updatedAt,
    subscriberCount: inst.subscriberIds.size,
    silentForMs: Math.max(0, now - inst.lastEventAt),
    watchdogTriggerCount: inst.watchdogTriggerCount,
  }));
}

type MyRoom = { id: string; tiktokId: string; subscriberIds: string[] };

// 接続を維持すべき部屋の条件。次のいずれかが成立していれば対象。
//  - 配信者本人の登録(Streamer)が1人以上いる — 従来どおり
//  - 事務所の監視対象(AgencyWatch)が1件以上ある
//  - monitorUntilが未来 — 外部サービス(live-sidestage-event)が期限付きで監視を要求している
// どれも満たさない部屋(全員が退会/re-registration/監視解除/事務所削除済みで、監視要求も期限切れ)は
// 除外され、ensureAllListenersAlive()の第2ループで切断される。
// 事務所を削除するとwatchはカスケードで消えるため、この条件だけで接続も止まる。
// nowは呼び出し側が1回だけ評価した時刻を渡す(複数クエリ間で基準時刻がずれないようにするため)。
export function watchedRoomFilter(now: Date = new Date()): Prisma.TiktokRoomWhereInput {
  return {
    OR: [{ streamers: { some: {} } }, { watches: { some: {} } }, { monitorUntil: { gt: now } }],
  };
}

// 自分(このWorkerプロセス)が担当する部屋(TiktokRoom)だけを返す。
// workerId未割当の部屋は resolveWorkerForRoom() で決定的にハッシュ割当し、
// 自分の担当だった場合のみ含める(複数Workerが同時に処理しても同じ結果になるため競合しない)。
//
// 監視対象の条件は watchedRoomFilter() が単一の正。
// subscriberIdsはStreamerのみから作る。事務所はsocket.ioのoverlay/chatを購読しないため、
// 監視対象だけの部屋はsubscriberIds空で接続される(ギフト保存はroomId単位なのでデータは貯まる)。
async function getMyRooms(): Promise<MyRoom[]> {
  const { index, count } = getWorkerConfig();

  // assignedとunassignedで基準時刻がずれないよう1回だけ評価する。
  const monitored = watchedRoomFilter(new Date());

  const assigned = await prisma.tiktokRoom.findMany({
    where: { workerId: index, ...monitored },
    include: { streamers: { select: { id: true } } },
  });

  const unassigned = await prisma.tiktokRoom.findMany({
    where: { workerId: null, ...monitored },
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

// reconcile の結果。startFailures は「listenerを起動しようとして例外になった部屋の数」で、
// worker.ts の readiness 判定に使う。
//
// TikTok側の接続失敗(オフライン・rate limit・WebSocket断)はここに計上されない —
// connectAndAttach() が捕まえて scheduleReconnect() へ回すため startListener() は正常終了する。
// 一方 loadPendingCombos() / getOrCreateDeviceId() / resolveProxyForRoom() のDBアクセスは
// connectInstance() に catch が無くそのまま throw されるので、startFailures > 0 は
// 実質「DBに到達できていない」を意味する。TikTokが落ちているだけで unready にはならない。
export interface ReconcileResult {
  roomCount: number;
  startFailures: number;
}

export async function resumeAllListeners(): Promise<ReconcileResult> {
  const rooms = await getMyRooms();

  console.log(`[listener] resumeAllListeners: found ${rooms.length} room(s)`);

  let startFailures = 0;
  await runWithConcurrency(rooms, RESUME_CONCURRENCY, async (r) => {
    console.log(`[listener] starting listener for @${r.tiktokId} (room ${r.id}, ${r.subscriberIds.length} subscriber(s))`);
    await startListener(r.id, r.tiktokId, r.subscriberIds).catch((err) => {
      startFailures++;
      console.error(`[listener] resume failed for ${r.tiktokId}:`, err);
    });
    console.log(`[listener] listener state for @${r.tiktokId}:`, listeners.get(r.id)?.state.status);
  });

  return { roomCount: rooms.length, startFailures };
}

// ギフトカタログ(gift/list/)を取りにいくための部屋を1つ選ぶ。worker.tsの60秒ループから使う。
//
// **ライブ中かどうかは問わない。** fetchAvailableGifts()はHTTPだけで済み、WS接続を必要としない。
// 「接続成功後」に置くと、担当している配信が全部オフラインのあいだカタログが永久に空のままになり、
// 「まだ貰ったことのないギフトを事前に仕込む」という目的そのものが果たせない。
export async function resolveGiftCatalogSource(): Promise<GiftCatalogSource | null> {
  const rooms = await getMyRooms();
  const room = rooms[0];
  if (!room) return null;

  // ライブ接続と同じdeviceId/proxyを使う。カタログ取得だけ別のegress IPから出さない。
  const deviceId = await getOrCreateDeviceId(room.id);
  const proxyUrl = await resolveProxyForRoom(room.id);
  return { tiktokId: room.tiktokId, deviceId, proxyUrl };
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
export async function ensureAllListenersAlive(): Promise<ReconcileResult> {
  const rooms = await getMyRooms();
  const myRoomIds = new Set(rooms.map((r) => r.id));

  let startFailures = 0;
  for (const r of rooms) {
    const existing = listeners.get(r.id);
    if (existing) {
      existing.subscriberIds = new Set(r.subscriberIds);
      continue;
    }
    console.log(`[listener] ensureAlive: restarting missing listener for @${r.tiktokId}`);
    await startListener(r.id, r.tiktokId, r.subscriberIds).catch((err) => {
      startFailures++;
      console.error(`[listener] ensureAlive failed for ${r.tiktokId}:`, err);
    });
  }

  for (const roomId of Array.from(listeners.keys())) {
    if (!myRoomIds.has(roomId)) {
      console.log(`[listener] ensureAlive: tearing down orphaned/reassigned room ${roomId}`);
      // teardownの失敗は readiness に計上しない。切断できなかった部屋が残るだけで、
      // 担当部屋の受信が止まるわけではないため。
      await stopListener(roomId).catch((err) =>
        console.error(`[listener] ensureAlive teardown failed for ${roomId}:`, err)
      );
    }
  }

  return { roomCount: rooms.length, startFailures };
}

const WATCHDOG_SILENCE_MS = 60_000;

// checkWatchdogs()→connectInstance()経路専用の指数バックオフ。scheduleReconnect()
// (disconnect/error/streamEnd/rate-limit用の固定遅延ロジック)とは独立しており、
// そちらのタイマー・定数には一切影響しない。
const WATCHDOG_BACKOFF_BASE_MS = RECONNECT_DELAY_MS; // 10_000、初回発動時の遅延
const WATCHDOG_BACKOFF_FACTOR = 2; // 倍々で延ばす
const WATCHDOG_BACKOFF_MAX_MS = 10 * 60_000; // 上限10分

function nextWatchdogBackoffMs(triggerCount: number): number {
  const raw = WATCHDOG_BACKOFF_BASE_MS * Math.pow(WATCHDOG_BACKOFF_FACTOR, triggerCount - 1);
  return Math.min(WATCHDOG_BACKOFF_MAX_MS, raw);
}

// Detects zombie WebSocket connections: status stays "connected" but no
// events (gift/chat/member/...) have arrived, meaning the socket died
// without firing disconnected/streamEnd.
export function checkWatchdogs() {
  const now = Date.now();
  listeners.forEach((inst, roomId) => {
    if (inst.stopped) return;
    if (inst.state.status !== "connected") return;
    if (inst.connectPromise) return;

    // 無応答検知: バックオフ中でもここまでは毎回判定する。
    const silentFor = now - inst.lastEventAt;
    if (silentFor <= WATCHDOG_SILENCE_MS) return;

    if (now < inst.watchdogBackoffUntil) {
      console.warn(
        `[listener] watchdog: @${inst.state.tiktokId} silent for ${silentFor}ms but skipping forced reconnect — backoff active (trigger #${inst.watchdogTriggerCount}, retry allowed in ${inst.watchdogBackoffUntil - now}ms)`
      );
      return;
    }

    // 発動: 無応答検知 + バックオフ解除済みのときのみカウントする。
    inst.watchdogTriggerCount += 1;
    const backoffMs = nextWatchdogBackoffMs(inst.watchdogTriggerCount);
    inst.watchdogBackoffUntil = now + backoffMs;

    console.warn(
      `[listener] watchdog: @${inst.state.tiktokId} silent for ${silentFor}ms, forcing reconnect (trigger #${inst.watchdogTriggerCount}, next forced reconnect allowed in ${backoffMs}ms if still silent)`
    );
    connectInstance(roomId).catch((err) =>
      console.error(`[listener] watchdog reconnect failed for ${inst.state.tiktokId}:`, err)
    );
  });
}
