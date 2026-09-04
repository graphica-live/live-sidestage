import { WebcastPushConnection, getBattleItemCard, getBattleItemCardSender } from "TLC-sidestage";
import type { WebcastLinkMicBattleItemCard } from "TLC-sidestage";
import { ProxyAgent } from "proxy-agent";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getOrCreateDeviceId } from "./device-id";
import {
  openConnectionInterval,
  closeConnectionInterval,
  touchConnectionIntervalHeartbeat,
} from "./room-connection-log";
import { randomUUID } from "node:crypto";
import { emitGiftDrivenOverlayUpdates } from "./overlay";
import { applyLikeEventInProcess } from "./overlay/like.server";
import {
  emitChatBattle,
  emitChatComment,
  emitChatFollow,
  emitChatGift,
  emitChatListener,
  normalizeChatCommentEmotes,
  type ChatBattleInput,
  type ChatCommentPayload,
  type ChatFollowInput,
  type ChatGiftInput,
  type ChatListenerInput,
} from "./chat-feed";
import {
  factsForReconnect,
  FACTS_CONNECTED,
  FACTS_CONNECTING,
  FACTS_IDLE,
  type ListenerActivity,
  type ListenerFacts,
  type ListenerHealth,
} from "./listener-state";
import { getEulerSignApiKey } from "./settings";
import { recordEulerSignUsage, type EulerSignTrigger } from "./euler-usage";
import type { GiftCatalogSource } from "./tiktok-gift-catalog";
import {
  battleNotifyDecision,
  mergeBattleState,
  parseArmiesEvent,
  parseBattleEvent,
  type BattleRecordState,
  type HostProfiles,
  type HostTeams,
  type ParsedBattle,
} from "./tiktok-battle";
import { ensureAvatarCached } from "./avatar-storage";
import { materializeBattleHistory } from "./battle-history-finalize";
import { fillHostUserIdFromBattle } from "./tiktok-id-migration";

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
  // 表示用に正規化した2軸。src/lib/listener-state.ts 参照。
  activity: ListenerActivity;
  health: ListenerHealth;
  /** scheduleReconnect() の reason。問い合わせ時の切り分け用。 */
  reason: string | null;
  /** この状態を書いたときの fencing revision。push の順序判定にも使う。 */
  revision: bigint;
}

// revision は epoch(DB採番の世代) * STRIDE + プロセス内連番。
// STRIDE がプロセス内の書き込み数の上限になる。1プロセスで100万回の状態遷移は
// 現実的に起きない(オフライン配信者でも30秒に1回、1年で約100万回)が、
// 溢れても壊れないよう nextListenerRevision() で頭打ちにする。
const LISTENER_REVISION_STRIDE = 1_000_000n;

let listenerEpoch: bigint | null = null;
let listenerEpochPromise: Promise<bigint> | null = null;
let listenerRevisionSeq = 0n;

// プロセス起動時にDBから世代を採番する。**後から起動したプロセスほど必ず大きい値**に
// なることだけが要件で、壁時計には依存しない(複数コンテナ間のNTPずれで順序が壊れない)。
async function ensureListenerEpoch(): Promise<bigint> {
  if (listenerEpoch !== null) return listenerEpoch;
  if (!listenerEpochPromise) {
    listenerEpochPromise = prisma.listenerEpoch
      .create({
        data: {
          role: isWorkerProcess ? "worker" : "web",
          workerIndex: Number.isInteger(Number(process.env.WORKER_INDEX))
            ? Number(process.env.WORKER_INDEX)
            : null,
        },
        select: { id: true },
      })
      .then((row) => {
        listenerEpoch = BigInt(row.id);
        return listenerEpoch;
      })
      .catch((err) => {
        // 採番できない = DBに届いていない。状態の永続化もどうせ失敗するので、
        // ここで例外にせず 0 世代として続行する(fencing は効かなくなるが、
        // 「DBが死んでいるのでlistenerも起動できない」という別の失敗が先に出る)。
        console.error("[listener] ListenerEpoch の採番に失敗しました:", err);
        listenerEpoch = 0n;
        return listenerEpoch;
      });
  }
  return listenerEpochPromise;
}

async function nextListenerRevision(): Promise<bigint> {
  const epoch = await ensureListenerEpoch();
  if (listenerRevisionSeq < LISTENER_REVISION_STRIDE - 1n) listenerRevisionSeq++;
  return epoch * LISTENER_REVISION_STRIDE + listenerRevisionSeq;
}

/** テスト用。プロセスローカルな世代・連番を初期化する。 */
export function __resetListenerEpochForTest(epoch: bigint | null = null): void {
  listenerEpoch = epoch;
  listenerEpochPromise = epoch === null ? null : Promise.resolve(epoch);
  listenerRevisionSeq = 0n;
}

interface ListenerInstance {
  state: ListenerState;
  connection: WebcastPushConnection | null;
  connectPromise: Promise<void> | null;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatInterval: NodeJS.Timeout | null;
  // 開いている RoomConnectionInterval.id。「connected」区間の間だけ非null。
  // 生成はopen呼び出し側(updateState)がclient側で行う(DBのデフォルト生成完了を待つと、
  // その間に接続が切れた場合にidをどの行に書き戻すべきか決められなくなるため)。
  connectionIntervalId: string | null;
  // **groupIdが欠落したcombo専用のフォールバック。** キーは `uniqueId:giftId`。
  // 有効なgroupIdを持つcomboはここを通らず、saveComboGift()がDBの確定値から
  // deltaを計算する(プロセスごとに前回値がズレて二重計上するのを防ぐため)。
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
  // scheduleReconnect()が"user_offline"/"rate_limited"以外の理由(disconnected/stream_end/error/connect_failed)で
  // 呼ばれた連続回数。EulerStreamの署名取得後に発生する失敗はここでバックオフさせる対象になる
  // ("user_offline"は署名取得前にUserOfflineErrorで止まるため対象外、"rate_limited"は別の専用ロジックを持つ)。
  // 接続成功(conn.connect()が解決)すると0にリセットされる。
  reconnectFailureCount: number;
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
  // バトルアイテム使用ログ版。連打(グローブ連打等)が起きうるうえ、TikTok側の再送は
  // gift/chatと同じ仕組みなので同様に必要。
  recentBattleItemMsgIds: Set<string>;
  recentBattleItemMsgIdOrder: string[];
  // like版のdedup FIFO。desktop 5ウィジェット移植で追加。
  recentLikeMsgIds: Set<string>;
  recentLikeMsgIdOrder: string[];
  // uniqueIdごとの1秒コアレッシングバッファ。likeは視聴者全員が連打するため、
  // イベントごとに転送するとforwardToWebの共有キュー(同時4/待ち行列256)を占有し、
  // 優先度の高いgiftイベントが落ちるリスクがある。likeCountは加算的な増分なので
  // 合算しても無損失。
  pendingLikes: Map<string, { uniqueId: string; nickname: string; profilePictureUrl: string | null; likeCount: number }>;
  likeFlushTimer: NodeJS.Timeout | null;
}

// ack未達等によるTikTok側の再送バッチは、盛り上がっている配信だと直近のコメントとの間隔が
// 数百件を優に超えることがある。小さすぎるFIFOだと再送到達前に対象msgIdが枠から追い出され、
// dedupをすり抜けて二重配信してしまう(2026-08-18に発覚)。msgId文字列は軽量なので余裕を持たせる。
const CHAT_DEDUP_CACHE_SIZE = 3000;

// ギフトはコメントよりずっと流量が少ないので、同じ再送バッチを覆うのに必要な枠も小さい。
const GIFT_DEDUP_CACHE_SIZE = 1000;

// バトルアイテム使用はギフトよりさらに流量が少ない(グローブ連打でも配信規模を考えれば少数)。
const BATTLE_ITEM_DEDUP_CACHE_SIZE = 500;

// likeはchat並み以上に流量が多いので、CHAT_DEDUP_CACHE_SIZEと同水準にする。
const LIKE_DEDUP_CACHE_SIZE = 3000;

// likeイベントをuniqueIdごとに合算してから転送するまでの待機時間。
const LIKE_COALESCE_WINDOW_MS = 1000;

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

// FIFOから取り消す。保存に失敗したイベントを再送で拾い直せるようにするため。
// 記録は保存の前に行う(同一tickの二重処理を止めるにはそうするしかない)ので、
// 失敗したまま残すと同じmsgIdの再送が同一プロセス内で永久に捨てられる。
function forgetMsgId(seen: Set<string>, order: string[], msgId: string): void {
  if (!seen.delete(msgId)) return;
  const at = order.lastIndexOf(msgId);
  if (at >= 0) order.splice(at, 1);
}

/**
 * 同じキーへの書き込みを直列に流すキュー。
 *
 * read-modify-write を並行させると、後から届いた古い状態で上書きしたり、
 * 全員が同じ「変更前の値」を読んでしまったりする。加えて、待ち合わせをDB側の
 * ロックだけに任せると待機中もコネクションを掴み続けるので、プロセス内で先に絞る。
 */
function createWriteQueue(label: string) {
  const chains = new Map<string, Promise<void>>();
  return {
    run(key: string, task: () => Promise<void>): Promise<void> {
      const prev = chains.get(key) ?? Promise.resolve();
      const next = prev
        .catch(() => undefined)
        .then(task)
        .catch((err) => {
          // 握りつぶさない。ここへ来るのは task 自身が捕まえ損ねた例外だけ。
          console.error(`[${label}] queued write failed`, { key, err });
        })
        .finally(() => {
          if (chains.get(key) === next) chains.delete(key);
        });
      chains.set(key, next);
      return next;
    },
  };
}

// RoomConnectionIntervalのopen/close/heartbeatをroomId単位で直列化する。
// updateStateはconnected/非connectedの遷移ごとに同期的にconnectionIntervalIdを
// 確定させるが、実際のDB書き込みは非同期(fire-and-forget)なので、同じroomで
// 短時間に複数回遷移すると書き込みの完了順が呼び出し順と入れ替わりうる
// (例: open(A)がまだ処理中にclose(A)→open(B)が先に届く)。直列化しておけば
// DB上の反映順は常に呼び出し順と一致する。
const connLogWrites = createWriteQueue("connlog");

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

// "disconnected"/"stream_end"/"error"/"connect_failed"用の指数バックオフ。
// これらはEulerStreamへの署名取得が完了した後に発生する失敗("user_offline"はfetchRoomInfoOnConnectの
// オフライン判定で署名取得前に止まるため対象外)なので、繰り返すたびに新規の署名を消費する。
// 上限はmobile側のstale判定(listener-liveness.ts、90秒)より短く抑え、バックオフ中のlistenerが
// 誤って「反応なし」と表示されないようにする。500部屋規模で一斉に同じタイミングへ再試行が
// 集中しないよう、送信直前に±15%のjitterを乗せる。
const RECONNECT_BACKOFF_FACTOR = 2;
// jitter(±15%)の上振れを含めても90秒(mobile側のstale判定、listener-liveness.ts)を
// 超えないよう、75_000 * 1.15 = 86_250msに収まる値にしている。
const RECONNECT_BACKOFF_MAX_MS = 75_000;
const RECONNECT_BACKOFF_JITTER_RATIO = 0.15;

export function nextReconnectBackoffMs(failureCount: number): number {
  const raw = RECONNECT_DELAY_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, failureCount - 1);
  const capped = Math.min(RECONNECT_BACKOFF_MAX_MS, raw);
  const jitter = capped * RECONNECT_BACKOFF_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.round(capped + jitter);
}

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
    emitGiftDrivenOverlayUpdates(streamerId).catch((err) => console.error("[overlay] emit error:", err));
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

// notifyChatGiftと同型 — 1イベント(コアレッシング済みの合算値)につき1リクエスト。
// **streamerIdごとに複製して呼んではいけない**(LikeTallyはroomId軸で共有されるため、
// 複製すると合計が購読者数倍になる)。
async function notifyLikeEvent(
  streamerIds: string[],
  roomId: string,
  like: { uniqueId: string; nickname: string; profilePictureUrl: string | null; likeCount: number }
) {
  if (streamerIds.length === 0) return;

  if (!isWorkerProcess) {
    applyLikeEventInProcess({ streamerIds, roomId, ...like }).catch((err) =>
      console.error("[like] apply error:", err)
    );
    return;
  }
  await forwardToWeb({ streamerIds, likeEvent: { roomId, ...like } });
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

// ── listener状態の転送 ────────────────────────────────────────────────────────
//
// **ギフト用の forwardToWeb には載せない。** あちらは同時4・待ち行列256で、溢れたら
// 捨てて replay しない設計(ギフトは「その瞬間に鳴らせなければ意味がない」ため)。
// 状態通知を同じ扱いにすると、落ちた瞬間から次の状態変化まで端末が古い表示のまま残る。
// しかも溢れるのはギフトが大量に流れているとき = ちょうど「配信中」へ遷移した瞬間。
//
// 代わりに **部屋ごとに最新の1件だけを保持する coalescing キュー**を持つ。
// 途中の状態は捨ててよい(最終的に正しい状態へ収束すればよい)ので、キューは伸びない。

const LISTENER_NOTIFY_TIMEOUT_MS = 5000;
const LISTENER_NOTIFY_MAX_ATTEMPTS = 3;
const LISTENER_NOTIFY_RETRY_DELAY_MS = 1000;

interface PendingListenerNotify {
  streamerIds: string[];
  event: Omit<ChatListenerInput, "streamerId">;
}

// roomId -> 送信待ちの最新1件。同じ部屋の新しい状態が来たら上書きする。
const listenerNotifyQueue = new Map<string, PendingListenerNotify>();
let listenerNotifyRunning = false;

function notifyListenerState(inst: ListenerInstance, revision: bigint) {
  const streamerIds = Array.from(inst.subscriberIds);
  if (streamerIds.length === 0) return;

  enqueueListenerNotify(inst.state.roomId, {
    streamerIds,
    event: {
      roomId: inst.state.roomId,
      revision: revision.toString(),
      status: inst.state.status,
      activity: inst.state.activity,
      health: inst.state.health,
      reason: inst.state.reason,
      message: inst.state.message,
      updatedAt: inst.state.updatedAt,
    },
  });
}

function enqueueListenerNotify(roomId: string, pending: PendingListenerNotify) {
  listenerNotifyQueue.set(roomId, pending);
  void drainListenerNotifyQueue();
}

async function drainListenerNotifyQueue(): Promise<void> {
  if (listenerNotifyRunning) return;
  listenerNotifyRunning = true;
  try {
    while (listenerNotifyQueue.size > 0) {
      const [roomId, pending] = listenerNotifyQueue.entries().next().value as [
        string,
        PendingListenerNotify,
      ];
      listenerNotifyQueue.delete(roomId);
      await deliverListenerNotify(pending);
    }
  } finally {
    listenerNotifyRunning = false;
  }
}

async function deliverListenerNotify(pending: PendingListenerNotify): Promise<void> {
  if (!isWorkerProcess) {
    for (const streamerId of pending.streamerIds) {
      await emitChatListener({ streamerId, ...pending.event }).catch((err) =>
        console.error("[listener] chat emit error:", err)
      );
    }
    return;
  }

  // ギフトと違い、状態は「落としたら次の変化まで戻らない」ので有限回だけ再送する。
  for (let attempt = 1; attempt <= LISTENER_NOTIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${process.env.WEB_INTERNAL_URL}/api/internal/gift-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({ streamerIds: pending.streamerIds, listenerEvent: pending.event }),
        signal: AbortSignal.timeout(LISTENER_NOTIFY_TIMEOUT_MS),
      });
      if (res.ok) return;
      // 旧Webは未知のbodyでも 200 を返す(どの分岐にも入らないだけ)。つまりここへ
      // 来るのは実際の失敗だけ。ただし旧Webへ送っても静かに落ちることは避けられないので、
      // 端末側は定期リコンサイル(HTTP)で必ず収束させる。
      console.error("[listener] state notify failed:", res.status, await res.text().catch(() => ""));
    } catch (err) {
      console.error("[listener] state notify error:", err);
    }
    if (attempt < LISTENER_NOTIFY_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, LISTENER_NOTIFY_RETRY_DELAY_MS * attempt));
    }
  }
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

// 1回のUPDATE文(CASE式)で条件付き更新する。read-modify-writeにしないのは、
// "retrying"が高頻度(オフライン配信者は10〜30秒間隔で再接続ループ)に呼ばれるため
// 余分なSELECTを避けたいのと、書き込みの原子性を保つため。
//
// unhealthySince/notFoundStreak/notFoundFirstAt(tiktok-room-cleanup.ts用)の扱い:
//  - "retrying"/"error"にCOALESCEで初回到達時刻を書く。**"connecting"は一切触らない**
//    (再接続タイマーが発火するたびに必ず先に"connecting"を経由するため、ここでリセットすると
//    数十秒に1回クロックが巻き戻り、不健全継続の閾値へ永久に到達しなくなる)。
//  - "connected"復帰で全てクリアする(要件: 実在確認できたら判定をやり直す)。
//  - "idle"(部屋が監視対象から外れた/デプロイのグレースフルシャットダウン。コード上区別不可)では
//    意図的に何もリセットしない。デプロイのたびに全部屋のクロックが巻き戻るのを避けるため。
// exportはtiktok-listener.unhealthy.integration.test.ts用(実際の再接続ループ/モック接続を
// 経由せず、CASE式の挙動そのものを直接検証するため)。呼び出し元は本ファイル内のみ。
export async function persistState(
  roomId: string,
  status: ListenerStatus,
  message: string,
  facts?: ListenerFacts,
  reason?: string | null,
  revision?: bigint
) {
  const now = new Date();
  const rev = revision ?? (await nextListenerRevision());
  const activity = facts?.activity ?? null;
  const health = facts?.health ?? null;
  try {
    await prisma.$executeRaw`
      UPDATE public."TiktokRoom"
      SET "listenerStatus" = ${status},
          "listenerMessage" = ${message},
          "listenerUpdatedAt" = ${now},
          "listenerActivity" = ${activity},
          "listenerHealth" = ${health},
          "listenerReason" = ${reason ?? null},
          "listenerRevision" = ${rev},
          "unhealthySince" = CASE
            WHEN ${status} IN ('retrying', 'error') THEN COALESCE("unhealthySince", ${now})
            WHEN ${status} = 'connected' THEN NULL
            ELSE "unhealthySince"
          END,
          "notFoundStreak" = CASE WHEN ${status} = 'connected' THEN 0 ELSE "notFoundStreak" END,
          "notFoundFirstAt" = CASE WHEN ${status} = 'connected' THEN NULL ELSE "notFoundFirstAt" END
      WHERE "id" = ${roomId}
        -- fencing: 自分より新しい書き込みがすでに入っていたら何もしない。
        -- persistState は await されないので同一プロセス内でも着弾順が入れ替わるし、
        -- デプロイ中は新旧Workerが同じ部屋へ並走する(旧の "idle" が新の "connected" の
        -- 後に届きうる)。壁時計はコンテナ間で単調でないので世代付き revision で比較する。
        AND ("listenerRevision" IS NULL OR "listenerRevision" < ${rev})
    `;
  } catch (err) {
    console.error("[listener] persistState error:", err);
  }
}

function updateState(
  inst: ListenerInstance,
  status: ListenerStatus,
  message: string,
  facts: ListenerFacts,
  reason?: string | null
) {
  const previousStatus = inst.state.status;
  const roomId = inst.state.roomId;

  inst.state.status = status;
  inst.state.message = message;
  inst.state.updatedAt = new Date().toISOString();
  inst.state.activity = facts.activity;
  inst.state.health = facts.health;
  inst.state.reason = reason ?? null;

  // RoomConnectionInterval(捕捉率算出用の接続区間ログ)のopen/close。
  // idはここで同期的に確定させる(DB書き込み自体はconnLogWritesで直列化した非同期処理)。
  // stopListener()で意図的に止めた場合はここを通らず、stopListener自身がcloseする
  // (disconnectイベントのハンドラをremoveAllListeners()で先に外すため)。
  if (status === "connected" && previousStatus !== "connected" && !inst.stopped) {
    const id = randomUUID();
    const startedAt = new Date();
    inst.connectionIntervalId = id;
    void connLogWrites.run(roomId, () => openConnectionInterval(id, roomId, startedAt));
  } else if (status !== "connected" && previousStatus === "connected") {
    const id = inst.connectionIntervalId;
    const endedAt = new Date();
    inst.connectionIntervalId = null;
    if (id) void connLogWrites.run(roomId, () => closeConnectionInterval(id, reason ?? status, endedAt));
  }

  // Manage heartbeat interval
  if (status === "connected") {
    inst.lastEventAt = Date.now();
    if (!inst.heartbeatInterval) {
      inst.heartbeatInterval = setInterval(() => {
        // heartbeat は「まだ繋がっている」ことの更新なので facts も同じものを書く。
        // 書かないと listenerUpdatedAt だけ新しくなって activity が空の行が残る。
        void persistState(inst.state.roomId, "connected", inst.state.message, FACTS_CONNECTED, null);
        const id = inst.connectionIntervalId;
        const heartbeatAt = new Date();
        if (id) void connLogWrites.run(roomId, () => touchConnectionIntervalHeartbeat(id, heartbeatAt));
      }, 30_000);
    }
  } else {
    if (inst.heartbeatInterval) {
      clearInterval(inst.heartbeatInterval);
      inst.heartbeatInterval = null;
    }
  }

  void persistStateAndNotify(inst, status, message, facts, reason ?? null);
}

// 永続化と購読者への push を1つの revision で揃える。
// push が先に着いて DB が後から古い値で上書きされる、という食い違いを作らない。
async function persistStateAndNotify(
  inst: ListenerInstance,
  status: ListenerStatus,
  message: string,
  facts: ListenerFacts,
  reason: string | null
) {
  const revision = await nextListenerRevision();
  inst.state.revision = revision;
  await persistState(inst.state.roomId, status, message, facts, reason, revision);
  notifyListenerState(inst, revision);
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
 * (node_modules/TLC-sidestage/dist/lib/_legacy/data-converter.js)。
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
 * combo の識別子として使える groupId だけを返す。
 *
 * msgId と同じく protobuf の既定値 "0" が流れてくる(本番の gifts に groupId="0" が3655行)。
 * `data.groupId ? ... : null` では文字列 "0" が truthy なのですり抜け、combo キーにすると
 * **別ユーザー・別ギフトが1つの pending state / 1つの集計グループを共有する**。
 * docs/tiktok-live-connector-guide.md 14-2 参照。
 *
 * 実測では giftType=1 の265行すべてが実 groupId を持ち "0" は0件なので現状の実害はないが、
 * saveComboGift() は groupId 単位で SUM して delta を出すため、ここを緩めると
 * 無関係なギフトの合計を引いて delta が過少になる(= ダイヤが消える)。
 */
export function resolveGroupId(data: Record<string, unknown>): string | null {
  const raw = data.groupId;
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  return MSG_ID_PATTERN.test(text) ? text : null;
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

// 同じギフトイベントを二重に保存しないための時刻窓。
//
// **これが効くのはnon-comboと、groupIdが欠落したcomboだけ。** 有効なgroupIdを持つcomboは
// saveComboGift()の「delta = 累計 - 保存済み合計」が冪等なdedupを兼ねるのでここを通らない。
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

// バトルアイテム使用ログも同じ理由(roomIdが永続ID、db pushがコンテナ起動時実行)でunique制約を避け、
// 時刻窓で弾く。
const BATTLE_ITEM_DEDUP_WINDOW_MS = 5 * 60_000;

// GiftのINSERT行を組み立てる。saveGift()とsaveComboGift()で共有する。
// dedupキー(orderId/groupId/msgId)だけは経路ごとに扱いが違うので呼び出し側から渡す。
function buildGiftRow(
  roomId: string,
  data: Record<string, unknown>,
  count: number,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback",
  keys: { orderId: string | null; groupId: string | null; msgId: string | null }
): Prisma.GiftUncheckedCreateInput {
  const diamondCount = Number(data.diamondCount) || 0;
  return {
    roomId,
    uniqueId: String(data.uniqueId || ""),
    nickname: String(data.nickname || ""),
    profileImageUrl: data.profilePictureUrl ? String(data.profilePictureUrl) : null,
    giftId: Number(data.giftId) || 0,
    giftName: String(data.giftName || ""),
    giftPictureUrl: data.giftPictureUrl ? String(data.giftPictureUrl) : null,
    repeatCount: count,
    diamondCount,
    totalDiamonds: diamondCount * count,
    receivedAt,
    timeSource,
    dayKey: jstDateKey(receivedAt),
    orderId: keys.orderId,
    groupId: keys.groupId,
    msgId: keys.msgId,
    giftType: Number.isInteger(data.giftType) ? (data.giftType as number) : null,
  };
}

/**
 * ギフト保存の結果。
 *
 * `"duplicate"` と `"error"` を分けているのは、呼び出し側が msgId の FIFO を
 * 取り消すかどうかを判断するため。重複でスキップしたなら記録を残すのが正しく、
 * DBエラーで落ちたなら取り消して再送で拾い直せるようにしたい。
 *
 * `"saved"` 以外は「このイベントを保存しなかった」であって「ギフトが無かった」ではない。
 * モバイルの効果音配信(notifyChatGift)はこの戻り値に紐づけていない — 鳴らすかどうかは
 * 別の判断で、Webプロセス側(emitChatGift)が独自にdedupする。
 * ここで抑えるのはDBの行とオーバーレイ更新だけ。
 */
type GiftSaveResult = "saved" | "duplicate" | "error";

async function saveGift(
  roomId: string,
  data: Record<string, unknown>,
  count: number,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback"
): Promise<GiftSaveResult> {
  // catch側のログでも参照するのでtryの外で確定させる(いずれも例外を投げない純粋な変換)。
  const orderId = data.orderId ? String(data.orderId) : null;
  // protobufの既定値"0"はキーとして使えないのでnullで保存する。
  // 列の意味を「使えるcombo/dedup識別子、無ければnull」に揃える。
  const groupId = resolveGroupId(data);
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
        return "duplicate";
      }
    }

    await prisma.gift.create({
      data: buildGiftRow(roomId, data, count, receivedAt, timeSource, { orderId, groupId, msgId }),
    });
    return "saved";
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "P2002") {
      // どのunique制約で弾かれたかを残す。現状効きうるのは (roomId, orderId) だけだが、
      // orderIdは本番で100%nullなので実際には発火しない。将来TikTokがorderIdを返し
      // 始めたとき、comboの正当な加算を黙って捨てていないか気づけるようにしておく。
      const target = (err as { meta?: { target?: unknown } })?.meta?.target;
      console.log(
        `[gift] dedup: unique制約違反でスキップ target=${JSON.stringify(target)} orderId=${orderId} msgId=${msgId} groupId=${groupId} room=${roomId}`
      );
      return "duplicate";
    }
    console.error("[listener] gift save error:", err);
    return "error";
  }
}

// getBattleItemCardSender()が返すのは生のprotobuf User(simplifyObjectはネスト内のsenderを
// 平坦化しない)なので、Gift保存で使うgetPreferredPictureFormat相当の選択を自前で行う。
// data-converter.ts の getPreferredPictureFormat と同じ優先順位(100x100 webp > jpeg > shrink無し > 先頭)。
function pickProfilePictureUrl(urls: readonly string[] | undefined): string | null {
  if (!urls || urls.length === 0) return null;
  return (
    urls.find((u) => u.includes("100x100") && u.includes(".webp")) ||
    urls.find((u) => u.includes("100x100") && u.includes(".jpeg")) ||
    urls.find((u) => !u.includes("shrink")) ||
    urls[0]
  );
}

type BattleItemSaveResult = "saved" | "duplicate" | "error";

// バトルアイテム使用ログの保存。comboのような累計tickではなく「使用ごとに1回」の
// 離散イベントなので、saveComboGiftのようなdelta計算は不要 — saveGift(non-combo)と同型。
async function saveBattleItemUse(
  roomId: string,
  message: WebcastLinkMicBattleItemCard,
  receivedAt: Date
): Promise<BattleItemSaveResult> {
  const card = getBattleItemCard(message);
  if (!card) {
    // cardTypeに対応するスロットが取れない = 未知cardType(将来TikTokが追加した種別)。
    // POWER_UP_SUMMARY(4)はcard自体は取れるがsenderが無く、次のガードで落ちる。
    console.warn(`[battle-item] unknown/unpopulated cardType=${message.cardType} room=${roomId}`);
    return "duplicate";
  }
  const sender = getBattleItemCardSender(card);
  if (!sender) return "duplicate"; // POWER_UP_SUMMARY等、sender自体を持たない周期通知

  const msgId = resolveMsgId(message as unknown as Record<string, unknown>);

  try {
    if (msgId) {
      const duplicate = await prisma.tiktokBattleItemUse.findFirst({
        where: {
          roomId,
          msgId,
          receivedAt: { gte: new Date(receivedAt.getTime() - BATTLE_ITEM_DEDUP_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (duplicate) {
        console.log(
          `[battle-item] dedup: msgId=${msgId} は直近${BATTLE_ITEM_DEDUP_WINDOW_MS / 60_000}分に保存済み (room=${roomId}, cardType=${message.cardType})`
        );
        return "duplicate";
      }
    }

    await prisma.tiktokBattleItemUse.create({
      data: {
        roomId,
        battleId: message.battleId,
        cardType: message.cardType,
        senderUserId: sender.userId ?? "",
        senderUniqueId: sender.uniqueId ?? "",
        senderNickname: sender.nickname ?? "",
        senderProfilePictureUrl: pickProfilePictureUrl(sender.profilePicture?.url),
        targetHostUserId: card.targetHostUserId,
        msgId,
        receivedAt,
      },
    });
    return "saved";
  } catch (err: unknown) {
    console.error("[listener] battle item use save error:", { roomId, msgId, cardType: message.cardType, err });
    return "error";
  }
}

// comboのtickは「その時点の累計」で届くが、Giftに保存するのは前回からの増分(delta)。
// 合計が最終連打数になるようにしてある(消費側はどこも SUM(repeatCount) で数える)。
//
// **deltaの計算元をプロセスのメモリに置かない。** 以前は listener インスタンスの
// pendingCombos が持つ「前回値」から引いていたが、デプロイ中は
// RAILWAY_DEPLOYMENT_OVERLAP_SECONDS の並走で新旧2プロセスが同じ部屋に繋がり、
// 新プロセスの起動時読み出しが旧プロセスの未commit行を読み逃すと前回値がズレる。
// 同じイベントに対して片方が delta=2、もう片方が delta=4 を出し、msgId dedup は
// 「先に書いた方を採用」するだけなので合計が過大になる(行は1つなのに数字が違う)。
//
// DBの確定値から引けば、何プロセスが並走しても保存後の合計は max(保存済み, 累計) に
// 収束する。重複・逆順到着・再試行はすべて delta<=0 として自然に落ちる。
//
// 集計範囲に時間窓もdayKeyも付けない。窓を付けると移動SUMになり、窓より長く続いた
// comboで古いdeltaが窓から落ちて過大計上が累積する。groupIdは1回の連打バーストに
// 対応し再利用されない(実測: 複数行を持つ948グループすべてが1分未満、5分超のギャップ0件、
// JST日付をまたいだグループ0件)ので、グループ全行を合計してよい。
// dayKeyを外したことで、日付境界をまたぐバーストがリセットされる潜在バグも消える。
const COMBO_TX_MAX_WAIT_MS = 10_000;
const COMBO_TX_TIMEOUT_MS = 15_000;

export async function saveComboGift(
  roomId: string,
  groupId: string,
  data: Record<string, unknown>,
  currentRepeat: number,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback"
): Promise<GiftSaveResult> {
  const msgId = resolveMsgId(data);
  try {
    return await prisma.$transaction<GiftSaveResult>(
      async (tx) => {
        // 同じグループへの同時書き込みを直列化する。プロセス内は comboWriteChains が
        // 先に絞っているので、ここで待つのは別プロセス(並走中の新旧Worker)だけ。
        // event集計は単一bigintキーのpg_try_advisory_xact_lockなのでキー空間が重ならない。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}), hashtext(${groupId}))`;

        const agg = await tx.gift.aggregate({
          where: { roomId, groupId },
          _sum: { repeatCount: true },
        });
        const saved = agg._sum.repeatCount ?? 0;
        const delta = currentRepeat - saved;
        if (delta <= 0) {
          console.log("[gift/combo] skip", { roomId, groupId, currentRepeat, saved, delta });
          return "duplicate";
        }

        await tx.gift.create({
          data: buildGiftRow(roomId, data, delta, receivedAt, timeSource, {
            // comboの各段に同じorderIdが付くとunique(roomId, orderId)で2段目以降がP2002になる。
            // comboのdedupはgroupId単位の単調増加判定でできているのでorderIdは要らない。
            orderId: null,
            groupId,
            msgId,
          }),
        });
        console.log("[gift/combo] save", { roomId, groupId, currentRepeat, saved, delta });
        return "saved";
      },
      // Prismaの既定(maxWait=2s / timeout=5s)はadvisory lockの待ち行列には短すぎる。
      { maxWait: COMBO_TX_MAX_WAIT_MS, timeout: COMBO_TX_TIMEOUT_MS }
    );
  } catch (err: unknown) {
    // saveGift()と同じ契約: 例外を外へ出さずGiftSaveResultを返す。呼び出し側は
    // 保存をawaitせず.then()で流すので、ここで捕まえないと未処理rejectionになる。
    // ロック待ちのtimeout・コネクション枯渇もここへ来る。
    console.error("[gift/combo] save error:", { roomId, groupId, currentRepeat, msgId, err });
    return "error";
  }
}

// comboの書き込みは (roomId, groupId) 単位で直列化する。
// saveComboGift() は advisory lock で待てるが、待っている間もPrismaのコネクションを
// 掴んだままになる。ハンドラは保存をawaitしないので、連打の全tickが同時に
// transactionを開くとプールを食い潰す。プロセス内で先に1本へ絞る。
const comboWrites = createWriteQueue("gift/combo");

interface SignUsageContext {
  roomId: string;
  trigger: EulerSignTrigger;
  reason: string | null;
}

// EulerStream署名API(WebSocket接続用の署名)への実際のリクエストを記録するラッパー。
// tiktok-live-connectorはoptions.signedWebSocketProviderが未指定なら
// `this.webClient.fetchSignedWebSocketFromEuler`を直接呼ぶ(node_modules/TLC-sidestage/dist/lib/client.js
// の_connect()参照)。ここではその既定実装を素通しで呼びつつ、呼ばれた事実だけを記録する
// — fetchRoomInfoOnConnectのオフライン判定(UserOfflineError)はこの手前で終わるため、
// このラッパーが呼ばれる=実際に署名を消費する試行が発生した、という対応が保たれる。
function createSignedWebSocketProvider(
  getConn: () => WebcastPushConnection,
  tiktokId: string,
  eulerSignApiKey: string | null,
  signCtx: SignUsageContext
) {
  return async (params: unknown) => {
    const requestedAt = new Date();
    const [epoch, workerIndex] = await Promise.all([
      ensureListenerEpoch().catch(() => null),
      Promise.resolve(
        Number.isInteger(Number(process.env.WORKER_INDEX)) ? Number(process.env.WORKER_INDEX) : null
      ),
    ]);
    const record = (outcome: "success" | "error", errorMessage?: string) =>
      void recordEulerSignUsage({
        roomId: signCtx.roomId,
        tiktokId,
        requestedAt,
        outcome,
        errorMessage,
        trigger: signCtx.trigger,
        reason: signCtx.reason,
        role: isWorkerProcess ? "worker" : "web",
        workerIndex,
        listenerEpoch: epoch,
        credentialMode: eulerSignApiKey ? "configured" : "anonymous",
      });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tiktok-live-connectorの内部プロパティ
      const webClient = (getConn() as any).webClient;
      const result = await webClient.fetchSignedWebSocketFromEuler(params);
      record("success");
      return result;
    } catch (err) {
      record("error", err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}

function createConnection(
  tiktokId: string,
  deviceId: string,
  proxyUrl: string | null,
  eulerSignApiKey: string | null,
  signCtx: SignUsageContext
): WebcastPushConnection {
  let connRef: WebcastPushConnection;
  const conn = new WebcastPushConnection(`@${tiktokId}`, {
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
    signedWebSocketProvider: createSignedWebSocketProvider(
      () => connRef,
      tiktokId,
      eulerSignApiKey,
      signCtx
    ),
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
  connRef = conn;
  return conn;
}

async function connectInstance(roomId: string, trigger: EulerSignTrigger = "start") {
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

      await connectAndAttach(roomId, inst, deviceId, proxyUrl, eulerSignApiKey, trigger);
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
// 上書きされないようにする。保存失敗を握りつぶすと対戦検知が動かなくなるので、
// createWriteQueue() 側が必ずログに残す。
const battleWrites = createWriteQueue("battle");

function queueBattleWrite(key: string, task: () => Promise<void>): void {
  void battleWrites.run(key, task);
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

/**
 * バトル履歴の確定を仕掛けるまでの猶予。
 *
 * Gift の保存は persistBattle と非同期・非awaitの別経路(saveGift(...).then(...))なので、
 * END検知の瞬間には集計対象の Gift がまだ INSERT されていない。さらに armies の最終スコアが
 * FINISH 後に届くこともある。30秒待ってから確定処理へ入り、そこでさらに60秒の安定性チェックを行う
 * (2026-09-02に10分から短縮。遅延Giftを取りこぼしたまま確定するリスクは詳細を
 * battle-history-finalize.ts 冒頭コメント参照)。
 */
const BATTLE_FINALIZE_DELAY_MS = 30 * 1000;

/**
 * 30秒後に確定処理を1回だけ fire-and-forget で呼ぶ。**await しない**(イベントループを塞がない)。
 *
 * 失敗・プロセス再起動で取りこぼしても、そのバトルは「未確定」のまま残るだけで、読み出しは
 * 従来どおりライブ集計へ正しくフォールバックする。再試行は行わない
 * (まとめて確定させたいときは scripts/backfill-battle-history.ts を実行する)。
 */
function scheduleBattleHistoryFinalize(roomId: string, battleId: string): void {
  const timer = setTimeout(() => {
    void materializeBattleHistory(roomId, battleId, new Date()).catch((err) => {
      console.error(`[battle-history] 確定処理に失敗 roomId=${roomId} battleId=${battleId}`, err);
    });
  }, BATTLE_FINALIZE_DELAY_MS);
  // 確定は最適化なので、プロセス終了をこのタイマーで引き延ばさない。
  timer.unref?.();
}

async function persistBattle(
  roomId: string,
  tiktokId: string,
  streamerIds: string[],
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
        hostProfiles: (existing.hostProfiles as HostProfiles | null) ?? {},
        hostTeams: (existing.hostTeams as HostTeams | null) ?? {},
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
    hostProfiles: state.hostProfiles,
    hostTeams: state.hostTeams,
    raw: raws,
  };

  if (existing) {
    await prisma.tiktokBattle.update({ where: { id: existing.id }, data });
  } else {
    await prisma.tiktokBattle.create({
      data: { roomId, battleId: parsed.battleId, ...data },
    });
  }

  // アイコンの恒久化はfire-and-forget。DB書き込みが終わった後に呼ぶことで
  // write queueの直列化(同じbattleIdの後続イベント処理)をブロックしない。
  for (const [anchorId, profile] of Object.entries(state.hostProfiles)) {
    ensureAvatarCached("battle_host", anchorId, profile.avatarUrl).catch(() => {});
  }

  // hostProfilesには**両サイド分**のdisplayIdが入っているので、自分のハンドルに一致する
  // anchorIdを引けばTikTokへ問い合わせずにhostUserIdが埋まる。改名の検知(合流)は
  // ハンドルが生きているうちにしかhostUserIdを集められないため、拾える機会は全部拾う。
  // アイコン同様fire-and-forgetで、失敗してもバトル保存には影響させない。
  fillHostUserIdFromBattle(roomId, tiktokId, state.hostProfiles).catch(() => {});

  const notifyKind = battleNotifyDecision(previous, state);

  // バトル履歴の確定(非正規化スナップショット)。**購読者の有無とは無関係**に、
  // このプロセスでEND遷移を検知したときだけ仕掛ける。確定は表示の最適化であって
  // 通知先の有無に依存しないため、streamerIdsの分岐の外に置く。
  if (notifyKind === "ended") {
    scheduleBattleHistoryFinalize(roomId, parsed.battleId);
  }

  // バトル終了の即時表示。**DB書き込み完了後**に判定・通知する — 受信時点で送ると、
  // 端末の再取得(REST)がこのDB書き込みと競争して「終了したのに進行中」と表示される
  // 瞬間ができてしまう。streamerIdsが空(購読者がいない部屋)なら通知先が無い。
  if (streamerIds.length > 0) {
    const kind = notifyKind;
    if (kind) {
      enqueueBattleNotify(`${roomId}:${parsed.battleId}`, {
        streamerIds,
        event: {
          battleId: parsed.battleId,
          startedAt: state.startedAt.toISOString(),
          // battleNotifyDecisionがkindを返すのはstate.endedAtがnon-nullのときだけ。
          endedAt: (state.endedAt as Date).toISOString(),
          receivedAt: receivedAt.toISOString(),
        },
      });
    }
  }
}

function recordBattleEvent(
  roomId: string,
  tiktokId: string,
  streamerIds: string[],
  parsed: ParsedBattle | null,
  rawKey: "battle" | "armies",
  raw: unknown
): void {
  // 成立していない招待(INVITE / REJECT / CANCEL)やパースできない payload は記録しない。
  if (!parsed) return;
  const receivedAt = new Date();
  queueBattleWrite(`${roomId}:${parsed.battleId}`, () =>
    persistBattle(roomId, tiktokId, streamerIds, parsed, rawKey, raw, receivedAt)
  );
}

// ── バトル終了通知の転送 ──────────────────────────────────────────────────────
//
// listener状態の転送(上のlistenerNotifyQueue)と同じ理由で、共有forwardToWebには
// 載せない。バトル終了はギフトが殺到する瞬間そのものなので、共有キュー(同時4・
// 待ち行列256、溢れたら捨てて再送しない)に乗せると一番届けたい通知が真っ先に落ちる。
// 部屋(roomId:battleId)ごとに最新の1件だけを保持するcoalescingキューにする。

const BATTLE_NOTIFY_TIMEOUT_MS = 5000;
const BATTLE_NOTIFY_MAX_ATTEMPTS = 3;
const BATTLE_NOTIFY_RETRY_DELAY_MS = 1000;

interface PendingBattleNotify {
  streamerIds: string[];
  event: Omit<ChatBattleInput, "streamerId">;
}

const battleNotifyQueue = new Map<string, PendingBattleNotify>();
let battleNotifyRunning = false;

function enqueueBattleNotify(key: string, pending: PendingBattleNotify) {
  battleNotifyQueue.set(key, pending);
  void drainBattleNotifyQueue();
}

async function drainBattleNotifyQueue(): Promise<void> {
  if (battleNotifyRunning) return;
  battleNotifyRunning = true;
  try {
    while (battleNotifyQueue.size > 0) {
      const [key, pending] = battleNotifyQueue.entries().next().value as [string, PendingBattleNotify];
      battleNotifyQueue.delete(key);
      await deliverBattleNotify(pending);
    }
  } finally {
    battleNotifyRunning = false;
  }
}

async function deliverBattleNotify(pending: PendingBattleNotify): Promise<void> {
  if (!isWorkerProcess) {
    for (const streamerId of pending.streamerIds) {
      await emitChatBattle({ streamerId, ...pending.event }).catch((err) =>
        console.error("[battle] chat emit error:", err)
      );
    }
    return;
  }

  // 状態通知と同じく、落としたら次の変化(次のバトル)まで戻らない。有限回だけ再送する。
  for (let attempt = 1; attempt <= BATTLE_NOTIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${process.env.WEB_INTERNAL_URL}/api/internal/gift-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({ streamerIds: pending.streamerIds, battleEvent: pending.event }),
        signal: AbortSignal.timeout(BATTLE_NOTIFY_TIMEOUT_MS),
      });
      if (res.ok) return;
      console.error("[battle] notify failed:", res.status, await res.text().catch(() => ""));
    } catch (err) {
      console.error("[battle] notify error:", err);
    }
    if (attempt < BATTLE_NOTIFY_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, BATTLE_NOTIFY_RETRY_DELAY_MS * attempt));
    }
  }
}

async function connectAndAttach(
  roomId: string,
  inst: ListenerInstance,
  deviceId: string,
  proxyUrl: string | null,
  eulerSignApiKey: string | null,
  trigger: EulerSignTrigger
) {
  // "connecting"遷移でinst.state.reasonがnullに上書きされる前に退避する(updateState参照)。
  // 署名利用ログにはこの直前理由(初回接続ならnull)を残す。
  const signReason = inst.state.reason;
  const conn = createConnection(inst.state.tiktokId, deviceId, proxyUrl, eulerSignApiKey, {
    roomId,
    trigger,
    reason: signReason,
  });
  inst.connection = conn;

  // stopListener()やconnectInstance()の再呼び出しでinst.connectionが別物(または null)に
  // 置き換わった後も、このconnのイベントハンドラは残り得る(disconnect()はCONNECTING中の
  // 接続を確実には中断しない)。stale化したconnからのイベントで別接続の状態(reconnectFailureCount等)を
  // 書き換えないよう、各ハンドラの先頭で「自分がまだ現役か」を確認する。
  const isCurrent = () => inst.connection === conn;

  conn.on("disconnected", () => {
    if (!isCurrent() || inst.connectPromise) return;
    scheduleReconnect(roomId, "disconnected");
  });

  conn.on("streamEnd", () => {
    if (!isCurrent() || inst.connectPromise) return;
    scheduleReconnect(roomId, "stream_end");
  });

  conn.on("error", (err: unknown) => {
    if (!isCurrent() || inst.connectPromise) return;
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

  // Like数一覧/Like貢献通知(desktop 5ウィジェット移植)向け。likeCountは「このtickでの増分」
  // であって累計(totalLikeCount)ではない点に注意。uniqueIdごとに1秒コアレッシングしてから
  // まとめて転送する(理由はLIKE_COALESCE_WINDOW_MSの定義コメント参照)。
  conn.on("like", (data: Record<string, unknown>) => {
    const msgId = resolveMsgId(data);
    if (msgId && !rememberMsgId(inst.recentLikeMsgIds, inst.recentLikeMsgIdOrder, msgId, LIKE_DEDUP_CACHE_SIZE)) {
      return; // プロセス内再送のみ弾く(非金銭的データのためgiftほど厳密にはしない)
    }
    const uniqueId = String(data.uniqueId || "");
    const likeCount = Math.max(0, Number(data.likeCount) || 0);
    if (!uniqueId || likeCount <= 0) return;

    const existing = inst.pendingLikes.get(uniqueId);
    const nickname = String(data.nickname || "");
    const profilePictureUrl = data.profilePictureUrl ? String(data.profilePictureUrl) : null;
    inst.pendingLikes.set(uniqueId, {
      uniqueId,
      nickname: nickname || existing?.nickname || "",
      profilePictureUrl: profilePictureUrl || existing?.profilePictureUrl || null,
      likeCount: (existing?.likeCount ?? 0) + likeCount,
    });

    if (!inst.likeFlushTimer) {
      inst.likeFlushTimer = setTimeout(() => {
        inst.likeFlushTimer = null;
        const batch = Array.from(inst.pendingLikes.values());
        inst.pendingLikes.clear();
        for (const like of batch) {
          notifyLikeEvent(Array.from(inst.subscriberIds), roomId, like);
        }
      }, LIKE_COALESCE_WINDOW_MS);
    }
  });

  // バトル中はチャットが流れない配信もあるので、バトルのイベントもwatchdogの生存判定に含める。
  conn.on("linkMicBattle", (data: unknown) => {
    markAlive();
    recordBattleEvent(
      roomId,
      inst.state.tiktokId,
      Array.from(inst.subscriberIds),
      parseBattleEvent(data),
      "battle",
      data
    );
  });
  conn.on("linkMicArmies", (data: unknown) => {
    markAlive();
    recordBattleEvent(
      roomId,
      inst.state.tiktokId,
      Array.from(inst.subscriberIds),
      parseArmiesEvent(data),
      "armies",
      data
    );
  });

  conn.on("linkMicBattleItemCard", (data: unknown) => {
    markAlive();
    const message = data as WebcastLinkMicBattleItemCard;
    const { time: eventTime } = resolveEventTime(data as Record<string, unknown>);
    const msgId = resolveMsgId(data as Record<string, unknown>);

    // 同一プロセスへの再送はgift/chatと同じ理由(DB照会だけでは同一tickの再送を防げない)で
    // 保存前にFIFOへ記録する。
    const fifoRecorded = msgId
      ? rememberMsgId(
          inst.recentBattleItemMsgIds,
          inst.recentBattleItemMsgIdOrder,
          msgId,
          BATTLE_ITEM_DEDUP_CACHE_SIZE
        )
      : true;
    if (!fifoRecorded) {
      console.log("[battle-item] dedup: duplicate msgId skipped (listener instance)", { roomId, msgId });
      return;
    }

    saveBattleItemUse(roomId, message, eventTime).then((result) => {
      if (result === "error" && msgId) {
        forgetMsgId(inst.recentBattleItemMsgIds, inst.recentBattleItemMsgIdOrder, msgId);
      }
    });
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
    // エモートだけのコメントは comment が空で届く。**空のまま配信すると、モバイルは
    // 画面に何も出せず、読み上げも空文字をVOICEVOXへ渡して例外になる。**
    // comment 自体は生テキストのまま変えず、別フィールドで足す(理由は
    // chat-feed.ts の ChatCommentPayload.emotes のコメント)。
    const emotes = normalizeChatCommentEmotes(data);
    const payload = {
      uniqueId: String(data.uniqueId || ""),
      nickname: String(data.nickname || ""),
      profilePictureUrl: data.profilePictureUrl ? String(data.profilePictureUrl) : null,
      comment: String(data.comment || ""),
      receivedAt: eventTime.toISOString(),
      msgId,
      ...(emotes.length > 0 ? { emotes } : {}),
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

    // アイコンの恒久化はfire-and-forget。saveGift/saveComboGiftのadvisory lock保持時間に
    // 影響させないため、DB書き込みより前・完全に独立した経路で呼ぶ。
    if (data.uniqueId) {
      const uniqueId = String(data.uniqueId);
      const profilePictureUrl = data.profilePictureUrl ? String(data.profilePictureUrl) : null;
      ensureAvatarCached("gift_sender", uniqueId, profilePictureUrl).catch(() => {});
    }

    const isCombo = data.giftType === 1;
    // protobufの既定値"0"はcomboキーにもdedupキーにも使えない(全ユーザー・全ギフトが
    // 同じキーを共有してしまう)。resolveGroupId()がそれをnullへ倒す。
    const groupId = resolveGroupId(data);
    // groupIdが取れないcomboだけ、プロセス内の前回値で追う従来経路に落とす。
    // DBから合計を引く手が無いため(この形のキーはGift行に残らない)。
    const fallbackComboKey = isCombo && !groupId ? `${data.uniqueId}:${data.giftId}` : null;
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

    // 同一プロセスに同じイベントが2回届いた場合をここで落とす。
    // saveGift()側のDB照会だけでは足りない — このハンドラはsaveGift()をawaitせず
    // .then()で流すので、同じtickに再送が2件届くと双方のfindFirstが「まだ無い」を
    // 見てしまい2行入る。実データで確認した二重計上(間隔0.00秒)はこの経路。
    // (プロセスをまたぐ重複 — デプロイ中の新旧Worker並走 — はsaveGift()側が担当する)
    //
    // **有効なgroupIdを持つcomboはこのFIFOを通さない。** saveComboGift()の
    // 「delta = 累計 - 保存済み合計」がそのままdedupを兼ねており、プロセスを跨いでも
    // 効くうえに冪等。逆にFIFOは保存の前に記録するので、DB保存が失敗したあとに
    // TikTokが同じmsgIdを再送しても同一プロセス内で捨ててしまう。
    const useMsgIdFifo = !(isCombo && groupId);
    const eventMsgId = resolveMsgId(data);
    const fifoRecorded =
      useMsgIdFifo && eventMsgId
        ? rememberMsgId(
            inst.recentGiftMsgIds,
            inst.recentGiftMsgIdOrder,
            eventMsgId,
            GIFT_DEDUP_CACHE_SIZE
          )
        : true;
    if (!fifoRecorded) {
      console.log("[gift] dedup: duplicate msgId skipped (listener instance)", {
        roomId,
        msgId: eventMsgId,
      });
      notifyGiftLog({ ...baseLog, action: "dropped", reason: "duplicate_msgId" });
      return;
    }

    // 保存がDBエラーで落ちたらFIFOの記録を取り消す(再送で拾い直せるようにする)。
    // 重複スキップのときは取り消さない — そちらは記録が残っているのが正しい。
    const applySaveResult = (result: GiftSaveResult) => {
      if (result === "saved") {
        notifyAllSubscribers();
        return;
      }
      if (result === "error" && useMsgIdFifo && eventMsgId) {
        forgetMsgId(inst.recentGiftMsgIds, inst.recentGiftMsgIdOrder, eventMsgId);
      }
    };

    // モバイルの効果音トリガー向け配信。saveGift()の成否には紐づけない —
    // 保存しなかったことは「roomId単位で既に保存済み」を意味するだけで、音を鳴らすべきかとは無関係。
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

    // combo(有効なgroupIdあり): deltaはDBの確定値から引く。プロセスの記憶を持たない。
    // 同じグループの書き込みは1本ずつ流し、DB側のadvisory lockで待つ本数を抑える。
    if (isCombo && groupId) {
      notifyGiftLog({ ...baseLog, action: "combo" });
      void comboWrites.run(`${roomId}:${groupId}`, async () => {
        applySaveResult(
          await saveComboGift(roomId, groupId, data, currentRepeat, eventTime, timeSource)
        );
      });
      return;
    }

    // combo(groupId欠落): 保存済み合計を引く手がかりがGift行に残らないため、
    // 従来どおりプロセス内の前回値でdeltaを追う。実データでは発生していない経路
    // (giftType=1の265行はすべて実groupIdを持つ)だが、各tickのcurrentRepeatを
    // そのまま保存すると 1+3+5=9 のように累計を多重計上するので消せない。
    if (isCombo) {
      const comboKey = fallbackComboKey!;
      const prev = inst.pendingCombos.get(comboKey);
      const prevRepeat = prev ? Number(prev.repeatCount) || 0 : 0;
      const delta = Math.max(0, currentRepeat - prevRepeat);
      if (data.repeatEnd) {
        inst.pendingCombos.delete(comboKey);
      } else {
        inst.pendingCombos.set(comboKey, { ...data, repeatCount: currentRepeat });
      }
      console.warn("[gift/combo] groupId欠落 — プロセス内の前回値でdeltaを計算する", {
        roomId, comboKey, prevRepeat, currentRepeat, delta, repeatEnd: data.repeatEnd,
      });
      notifyGiftLog({ ...baseLog, action: "combo", reason: "missing_groupId", delta, prevRepeat });
      if (delta > 0) {
        saveGift(roomId, data, delta, eventTime, timeSource).then(applySaveResult);
      }
      return;
    }

    // Non-combo: dedupキーはorderId、無ければgroupIdで代用する
    // (giftType=2のCompact等はorderIdが空で届く)。両方欠落するケースもあるが、
    // dedupキーが無いだけでギフト自体は実際に届いているため、捨てるとダイヤ数がそのまま失われる。
    // 実際に保存するorderIdはsaveGift()が data.orderId から決める(ここでの代用は判定用)。
    const dedupKey = (data.orderId ? String(data.orderId) : null) ?? groupId;
    if (!dedupKey) {
      console.warn("[gift/non-combo] missing orderId and groupId — saving without dedup key", {
        uniqueId: data.uniqueId,
        giftId: data.giftId,
        giftName: data.giftName,
      });
      notifyGiftLog({ ...baseLog, action: "non-combo", reason: "missing_orderId_and_groupId" });
      saveGift(roomId, data, currentRepeat, eventTime, timeSource).then(applySaveResult);
      return;
    }
    console.log("[gift/non-combo]", { dedupKey, uniqueId: data.uniqueId });
    notifyGiftLog({ ...baseLog, action: "non-combo" });
    saveGift(roomId, data, currentRepeat, eventTime, timeSource).then(applySaveResult);
  });

  if (conn.clientParams) {
    (conn.clientParams as Record<string, string>).room_id = "";
    (conn.clientParams as Record<string, string>).cursor = "";
  }

  updateState(inst, "connecting", FACTS_CONNECTING.message, FACTS_CONNECTING, null);

  try {
    await conn.connect();
    if (!isCurrent() || inst.stopped) {
      // 待っている間にstopListener()や次のconnectInstance()でinst.connectionが
      // 差し替わった、またはstopListener()で意図的に止められた
      // (stopListenerはinst.connectionをnullにしないためisCurrent()だけでは検知できない)。
      // もう誰も参照しないconnをここで確実に切断する。
      try { conn.disconnect?.(); } catch {}
      return;
    }
    inst.reconnectFailureCount = 0;
    updateState(inst, "connected", FACTS_CONNECTED.message, FACTS_CONNECTED, null);
  } catch (err) {
    if (!isCurrent() || inst.stopped) return;
    if (isAlreadyConnectedError(err)) {
      updateState(inst, "connected", FACTS_CONNECTED.message, FACTS_CONNECTED, null);
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
  if (reason === "rate_limited") {
    delay = Math.min(
      RATE_LIMIT_MAX_DELAY_MS,
      Math.max(RATE_LIMIT_MIN_DELAY_MS, retryAfterMs ?? RATE_LIMIT_FALLBACK_DELAY_MS)
    );
  } else if (reason === "user_offline") {
    delay = OFFLINE_RECONNECT_DELAY_MS;
  } else {
    // disconnected/stream_end/error/connect_failed: 署名取得後の失敗として連続回数に応じてバックオフする。
    inst.reconnectFailureCount += 1;
    delay = nextReconnectBackoffMs(inst.reconnectFailureCount);
  }

  // EulerStream署名消費の実測用。"user_offline"はfetchRoomInfoOnConnectのオフライン判定で
  // 署名取得前に終わるため実質消費なし、それ以外の理由は署名取得後の失敗として計上する。
  console.log(
    `[listener] scheduleReconnect: @${inst.state.tiktokId} reason=${reason} delay=${delay}ms reconnectFailureCount=${inst.reconnectFailureCount}`
  );

  // メッセージは**そのままユーザーへ出す**。以前の `再接続待機中... (connect_failed)` は
  // 開発者向けで、モバイルのステータス欄に出しても何も伝わらなかった。
  // reason コード自体は listenerReason に別途保存するので文面から消してよい。
  const facts = factsForReconnect(reason, delay);

  updateState(inst, "retrying", facts.message, facts, reason);

  inst.reconnectTimer = setTimeout(async () => {
    inst.reconnectTimer = null;
    await connectInstance(roomId, "scheduled_reconnect");
  }, delay);
}

export async function startListener(
  roomId: string,
  tiktokId: string,
  subscriberIds: string[] = []
) {
  const existing = listeners.get(roomId);
  if (existing && !existing.stopped) {
    applySubscribers(existing, subscriberIds);
    if (
      existing.state.status === "connected" ||
      existing.state.status === "connecting"
    ) {
      return existing.state;
    }
  }

  if (existing) {
    await stopListener(roomId, "restart");
  }

  const inst: ListenerInstance = {
    state: {
      roomId,
      tiktokId,
      status: "idle",
      message: "起動中",
      updatedAt: new Date().toISOString(),
      activity: "unknown",
      health: "connecting",
      reason: null,
      revision: 0n,
    },
    connection: null,
    connectPromise: null,
    reconnectTimer: null,
    heartbeatInterval: null,
    connectionIntervalId: null,
    // 起動時にDBから復元しない。有効なgroupIdを持つcomboはsaveComboGift()が
    // 毎回DBの確定値を引くので前回値を持ち越す必要がなく、groupId欠落comboの
    // キー(`uniqueId:giftId`)はGift行に残らないので元々復元できない。
    pendingCombos: new Map(),
    subscriberIds: new Set(subscriberIds),
    stopped: false,
    lastEventAt: Date.now(),
    watchdogTriggerCount: 0,
    watchdogBackoffUntil: 0,
    reconnectFailureCount: 0,
    recentChatMsgIds: new Set(),
    recentChatMsgIdOrder: [],
    recentGiftMsgIds: new Set(),
    recentGiftMsgIdOrder: [],
    recentBattleItemMsgIds: new Set(),
    recentBattleItemMsgIdOrder: [],
    recentLikeMsgIds: new Set(),
    recentLikeMsgIdOrder: [],
    pendingLikes: new Map(),
    likeFlushTimer: null,
  };

  listeners.set(roomId, inst);
  await connectInstance(roomId, "start");
  return inst.state;
}

/**
 * listener を止める理由。**"shutdown" では状態を永続化しない。**
 *
 * デプロイのグレースフルシャットダウンは全部屋に対して走るので、"idle" を書くと
 * 新Workerがすでに書いた "connected" を旧Workerが後から潰しうる(fencing で弾けるが、
 * そもそも書く意味がない)。プロセスが降りるだけで、その部屋の監視自体は
 * 新Workerが引き継ぐ。listenerUpdatedAt が更新されなくなるので、鮮度判定
 * (LISTENER_STALE_MS)が自然に「今の状態は分からない」へ倒してくれる。
 *
 * "unwatched"(購読者がいなくなった/担当替え)は本当に監視をやめるので "idle" を書く。
 */
export type StopListenerCause = "unwatched" | "shutdown" | "restart";

export async function stopListener(roomId: string, cause: StopListenerCause = "unwatched") {
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

  if (cause === "unwatched") {
    void persistStateAndNotify(inst, "idle", FACTS_IDLE.message, FACTS_IDLE, null);
  }

  // updateState()はdisconnectイベントのハンドラをこの後removeAllListeners()で外すため通らない。
  // 接続中(connectionIntervalIdが立っている)ならここで確実にcloseする。プロセス終了
  // (stopAllListeners → process.exit)前に書き込みを終わらせたいのでawaitする。
  if (inst.connectionIntervalId) {
    const id = inst.connectionIntervalId;
    const endedAt = new Date();
    inst.connectionIntervalId = null;
    await connLogWrites.run(roomId, () => closeConnectionInterval(id, cause, endedAt));
  }

  if (inst.connection) {
    inst.connection.removeAllListeners?.();
    try {
      await Promise.resolve(inst.connection.disconnect?.());
    } catch {}
  }

  // 上のawait(接続区間close・disconnect)の間に同じroomIdでstartListener()が
  // 呼ばれ、新しいinstが登録されている可能性がある(このstopListener呼び出し自体が
  // 元々そのstartListener内のstopListener(roomId, "restart")かもしれない)。
  // 無条件でdeleteすると、自分より後に作られた新instを消してしまい、新instは
  // 接続を維持したままlistenersマップから外れた「ゾンビ」になる(gift二重受信の温床)。
  if (listeners.get(roomId) === inst) listeners.delete(roomId);
}

/**
 * 購読者集合を差し替え、**新しく増えた購読者にだけ現在の状態を送る。**
 *
 * 集合を差し替えるだけだと、接続後に登録したユーザーは次の状態遷移まで何も受け取れない
 * (heartbeat は persistState を呼ぶだけで updateState を通らない)。配信が安定していると
 * 遷移は何時間も起きないので、端末は延々「配信開始待ち」のままになる。
 */
function applySubscribers(inst: ListenerInstance, subscriberIds: string[]) {
  const added = subscriberIds.filter((id) => !inst.subscriberIds.has(id));
  inst.subscriberIds = new Set(subscriberIds);
  if (added.length === 0 || inst.state.revision === 0n) return;

  enqueueListenerNotify(`${inst.state.roomId}:snapshot`, {
    streamerIds: added,
    event: {
      roomId: inst.state.roomId,
      revision: inst.state.revision.toString(),
      status: inst.state.status,
      activity: inst.state.activity,
      health: inst.state.health,
      reason: inst.state.reason,
      message: inst.state.message,
      updatedAt: inst.state.updatedAt,
    },
  });
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
  /** 署名取得後の失敗(disconnected/stream_end/error/connect_failed)によるscheduleReconnect()の連続回数。 */
  reconnectFailureCount: number;
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
    reconnectFailureCount: inst.reconnectFailureCount,
  }));
}

type MyRoom = { id: string; tiktokId: string; subscriberIds: string[] };

// 接続を維持すべき部屋の条件。次のいずれかが成立していれば対象。
//  - monitoringSuspendedがfalse — 配信者(Streamer)の登録有無を問わない。Streamerが0人の
//    部屋も、tiktok-low-value-cleanup.tsが停止判定するまでは情報をプールし続ける方針
//    (tiktokIdのハンドル変更でStreamerの紐付けが別Room行へ移った場合に、旧Room行が
//    Streamer 0人になった瞬間切断されるのを避ける意図もある)
//  - 事務所の監視対象(AgencyWatch)が1件以上ある
//  - monitorUntilが未来 — 外部サービス(live-sidestage-event)が期限付きで監視を要求している
// どれも満たさない部屋(明示的にmonitoringSuspended=trueにされ、監視要求も期限切れ)は
// 除外され、ensureAllListenersAlive()の第2ループで切断される。
// 事務所を削除するとwatchはカスケードで消えるため、この条件だけで接続も止まる。
// nowは呼び出し側が1回だけ評価した時刻を渡す(複数クエリ間で基準時刻がずれないようにするため)。
export function watchedRoomFilter(now: Date = new Date()): Prisma.TiktokRoomWhereInput {
  return {
    OR: [
      { monitoringSuspended: false },
      { watches: { some: {} } },
      { monitorUntil: { gt: now } },
    ],
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
// 一方 getOrCreateDeviceId() / resolveProxyForRoom() のDBアクセスは
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
// 1周回のカタログ取得で試す部屋数の上限。
//
// **地域/イベント限定ギフトは`gift/list/`の応答が部屋(アカウント)ごとに変わりうる**
// (実測: giftId 1182805 "Ultra Fan"/「ウルトラうちわ」は`is_global_gift: false`で、
// ある部屋からの取得では出るが別の部屋からは出ない可能性がある)。1部屋だけに固定すると
// その部屋がたまたま対象外のイベント/地域だった場合、実際にTikTok側には存在するギフトが
// 恒久的にカタログへ入らない。複数の自部屋を試して和集合を取ることでカバレッジを広げる。
//
// 増やしすぎるとリフレッシュ1周回あたりのTikTokへのリクエスト数(英語+日本語の2倍)が
// 線形に増えるため、小さめの上限にする。
export const MAX_GIFT_CATALOG_SOURCES = 3;

export async function resolveGiftCatalogSources(): Promise<GiftCatalogSource[]> {
  const rooms = await getMyRooms();
  const sources: GiftCatalogSource[] = [];
  for (const room of rooms.slice(0, MAX_GIFT_CATALOG_SOURCES)) {
    // ライブ接続と同じdeviceId/proxyを使う。カタログ取得だけ別のegress IPから出さない。
    const deviceId = await getOrCreateDeviceId(room.id);
    const proxyUrl = await resolveProxyForRoom(room.id);
    sources.push({ tiktokId: room.tiktokId, deviceId, proxyUrl });
  }
  return sources;
}

// デプロイ時のグレースフルシャットダウン用。担当中の全部屋のTikTok接続を明示的に切断する。
export async function stopAllListeners() {
  const roomIds = Array.from(listeners.keys());
  console.log(`[listener] stopAllListeners: disconnecting ${roomIds.length} room(s)`);
  // "shutdown" なので listener 状態は書かない。プロセスが降りるだけで、その部屋は
  // 新Workerが引き継ぐ。ここで "idle" を全部屋へ書くと、すでに接続を終えた新Workerの
  // "connected" を後追いで潰しにいくことになる。
  await Promise.all(roomIds.map((id) => stopListener(id, "shutdown")));
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
      applySubscribers(existing, r.subscriberIds);
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
    connectInstance(roomId, "watchdog").catch((err) =>
      console.error(`[listener] watchdog reconnect failed for ${inst.state.tiktokId}:`, err)
    );
  });
}
