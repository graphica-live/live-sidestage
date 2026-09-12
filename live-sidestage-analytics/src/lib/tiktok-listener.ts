import { WebcastPushConnection, getBattleItemCard, getBattleItemCardSender, FetchIsLiveError } from "TLC-sidestage";
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
  FACTS_HANDLE_MISMATCH,
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
  parseBattleTaskEvent,
  BATTLE_TASK_MESSAGE_TYPE,
  BATTLE_TASK_RESULT,
  type BattleRecordState,
  type ParsedBattleTask,
  type HostProfiles,
  type HostTeams,
  type OpponentWatch,
  type ParsedBattle,
} from "./tiktok-battle";
import { ensureAvatarCached } from "./avatar-storage";
import { normalizeTikTokUserId, normalizeDisplayValue, recordTikTokUser, type TikTokUserObservation } from "./tiktok-user";
import { materializeBattleHistory } from "./battle-history-finalize";
import {
  applyRankingSyncTrigger,
  applyGiftHistorySyncTrigger,
  applyBattleHistorySyncTrigger,
} from "./realtime-sync/dispatch";
import { parseCollabGroupChange, shouldWatchCollabSnapshot, isCollabCloseMessage } from "./tiktok-collab";
import { recordCollabSourceLink, releaseCollabSourceLinksBySource, enqueueForSource } from "./tiktok-collab-source";
import {
  ensureRoomWatchedForCollab,
  markRoomHandleStale,
  normalizeTiktokId,
  type CollabWatchResult,
  type CollabWatchSource,
  type TiktokRoomSubject,
} from "./tiktok-room";
import { resolveWatchedRoomFilter } from "./watched-room-filter";
import { existenceChecker } from "./tiktok-existence";
import { isTiktokUidMismatchCheckDisabled } from "./tiktok-id-lock";

export type ListenerStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "retrying"
  | "error";

interface ListenerState {
  roomId: string;
  tiktokHandle: string;
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
  // この部屋の配信者の tiktokUid(`TiktokRoom.hostTiktokUid`)。**同一性の正本はこれで、
  // ハンドルから引き直さない**(改名で空いたハンドルは第三者が取得しうる)。
  // startListener() で1回だけ読み、tap point の帰属先に使う。
  hostTiktokUid: string | null;
  connection: WebcastPushConnection | null;
  connectPromise: Promise<void> | null;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatInterval: NodeJS.Timeout | null;
  // 開いている RoomConnectionInterval.id。「connected」区間の間だけ非null。
  // 生成はopen呼び出し側(updateState)がclient側で行う(DBのデフォルト生成完了を待つと、
  // その間に接続が切れた場合にidをどの行に書き戻すべきか決められなくなるため)。
  connectionIntervalId: string | null;
  // **groupIdが欠落したcombo専用のフォールバック。** キーは `tiktokHandle:giftId`。
  // 有効なgroupIdを持つcomboはここを通らず、saveComboGift()がDBの確定値から
  // deltaを計算する(プロセスごとに前回値がズレて二重計上するのを防ぐため)。
  pendingCombos: Map<string, { repeatCount: number; [key: string]: unknown }>;
  // この部屋(TiktokRoom)を購読しているStreamer.idの集合。ギフトデータの書き込み先ではなく、
  // オーバーレイ更新通知・チャット配信を「誰に」送るかを決めるためだけに使う
  // (ギフトデータ自体はroomId単位で1回だけ保存され、登録者全員が同じ行を参照する)。
  subscriberIds: Set<string>;
  // 開発用「特別監視」フラグ(TiktokRoom.specialWatch)のキャッシュ。reconcile(ensureAllListenersAlive)
  // のたびにDBの最新値へ更新する。コラボ・バトル相手発見のキック条件(subscriberIds.size>0 || specialWatch)
  // にのみ使う。監視対象自体(watchedRoomFilter)には影響しない。
  specialWatch: boolean;
  stopped: boolean;
  lastEventAt: number;
  // このインスタンスをlistenersに登録したepoch ms。ensureAllListenersAlive()が
  // 「担当外なので切断」と誤判定しないための猶予に使う(下記コメント参照)。
  createdAt: number;
  // watchdogが「実イベントが届かない」ことを理由に強制再接続を発動した連続回数。
  // markAlive()(アプリ層の配信イベント。輸送フレーム・msgDetectは対象外)が発火すると0にリセットされる。
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
  // tiktokHandleごとの1秒コアレッシングバッファ。likeは視聴者全員が連打するため、
  // イベントごとに転送するとforwardToWebの共有キュー(同時4/待ち行列256)を占有し、
  // 優先度の高いgiftイベントが落ちるリスクがある。likeCountは加算的な増分なので
  // 合算しても無損失。
  pendingLikes: Map<
    string,
    { tiktokUid: string; tiktokHandle: string; nickname: string; profilePictureUrl: string | null; likeCount: number }
  >;
  likeFlushTimer: NodeJS.Timeout | null;
  // 進行中バトルのタップ点集計。バトル外は null。詳細は TapTally の定義コメント。
  tapTally: TapTally | null;
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

// likeイベントをtiktokHandleごとに合算してから転送するまでの待機時間。
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
  tiktokHandle: unknown;
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
// 同じworkerIdになる。同じtiktokHandleを複数人が登録しても部屋は1つなので、必ず同じWorkerが担当する。
//
// 部屋が消えていた場合は null を返す。**投げてはいけない** — findUniqueとupdateのあいだに
// tiktokHandle変更やStreamer削除で部屋が消えることがあり、投げると getMyRooms() が丸ごと失敗して
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

/**
 * `retryOnce` を渡してよいのは**受け手が冪等な種別だけ**。
 * `chat:comment` は Web 側の [isDuplicateChatEvent] が msgId で畳むので二重到達しても
 * 端末には1回しか出ない。一方 `likeEvent` は applyLikeEventInProcess() が**加算**する
 * ため、再送すると二重計上になる。
 *
 * queue full のドロップは再送しない — 枠が枯渇している状態への追い撃ちは悪化させるだけ。
 */
async function forwardToWeb(payload: Record<string, unknown>, opts?: { retryOnce?: boolean }) {
  const acquired = await acquireForwardSlot();
  if (!acquired) return;

  // 再送はスロットを保持したまま行う(解放して取り直すと、その隙に他のイベントが
  // 割り込んで再送だけキュー末尾へ回る)。
  const attempts = opts?.retryOnce ? 2 : 1;
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
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
        if (res.ok) return;
        console.error("[listener] internal notify failed:", res.status, await res.text().catch(() => ""));
      } catch (err) {
        console.error("[listener] internal notify error:", err);
      }
    }
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

// ギフト/フォローと同じく、同じ部屋を購読している全Streamer分を1リクエストにまとめる。
// **購読者ごとにHTTPを撃たないこと** — 転送スロット(FORWARD_MAX_CONCURRENCY/QUEUE)は
// worker プロセス全体の共有枠で、chatだけ購読者数倍のリクエストを出すと like/gift に
// 押し出されてコメントが無言で落ちる。
async function notifyChatComment(
  streamerIds: string[],
  comment: Omit<ChatCommentPayload, "streamerId">
) {
  if (streamerIds.length === 0) return;

  if (!isWorkerProcess) {
    for (const streamerId of streamerIds) {
      emitChatComment({ streamerId, ...comment }).catch((err) =>
        console.error("[chat] emit error:", err)
      );
    }
    return;
  }
  // 再送はmsgIdがある場合だけ。Web側のdedupはmsgId基準なので、msgIdがnullのまま
  // 再送すると端末へ二重に届き、同じコメントを2回読み上げる。
  await forwardToWeb(
    { streamerIds, chatCommentEvent: comment },
    { retryOnce: typeof comment.msgId === "string" }
  );
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
// **streamerIdごとに複製して呼んではいけない**(いいね集計はroomId軸で共有されるため、
// 複製すると合計が購読者数倍になる)。
async function notifyLikeEvent(
  streamerIds: string[],
  roomId: string,
  like: { tiktokUid: string; tiktokHandle: string; nickname: string; profilePictureUrl: string | null; likeCount: number }
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

// ── realtime-sync(ギフト履歴/バトル履歴)の転送 ──────────────────────────────
//
// **ギフト用のforwardToWebには載せない。** あちらは同時4・待ち行列256で、溢れたら
// 捨ててreplayしない設計。ギフト履歴/バトル履歴のappend/upsertはdropを許容できない
// (design-review反映、Codex-terra finding: 静かに欠落したままversionだけ進む状態を
// 作らない)。listenerNotifyQueue/deliverListenerNotifyと同じ「有限回リトライ、
// それでも届かなければ次回REST取得で収束させる」設計を踏襲する。

const SYNC_NOTIFY_TIMEOUT_MS = 5000;
const SYNC_NOTIFY_MAX_ATTEMPTS = 3;
const SYNC_NOTIFY_RETRY_DELAY_MS = 1000;

interface PendingGiftHistoryNotify {
  streamerIds: string[];
  giftId: string;
}

// **Map(roomId単位で最新1件に上書き)にしない。** ギフト履歴はGift.id単位で複数件を
// 捨てずに持つ必要がある(1tick=1履歴イベント、ユーザー確定方針)ため、配列(FIFO)にする。
const giftHistoryNotifyQueue: PendingGiftHistoryNotify[] = [];
let giftHistoryNotifyRunning = false;

function enqueueGiftHistoryNotify(pending: PendingGiftHistoryNotify): void {
  if (pending.streamerIds.length === 0) return;
  giftHistoryNotifyQueue.push(pending);
  void drainGiftHistoryNotifyQueue();
}

async function drainGiftHistoryNotifyQueue(): Promise<void> {
  if (giftHistoryNotifyRunning) return;
  giftHistoryNotifyRunning = true;
  try {
    while (giftHistoryNotifyQueue.length > 0) {
      const pending = giftHistoryNotifyQueue.shift()!;
      await deliverGiftHistoryNotify(pending);
    }
  } finally {
    giftHistoryNotifyRunning = false;
  }
}

async function deliverGiftHistoryNotify(pending: PendingGiftHistoryNotify): Promise<void> {
  if (!isWorkerProcess) {
    await applyGiftHistorySyncTrigger(pending.streamerIds, pending.giftId).catch((err) =>
      console.error("[gift-history] sync trigger error:", err)
    );
    return;
  }

  for (let attempt = 1; attempt <= SYNC_NOTIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${process.env.WEB_INTERNAL_URL}/api/internal/gift-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          streamerIds: pending.streamerIds,
          syncTrigger: "gift-history",
          giftId: pending.giftId,
        }),
        signal: AbortSignal.timeout(SYNC_NOTIFY_TIMEOUT_MS),
      });
      if (res.ok) return;
      console.error(
        "[gift-history] sync trigger forward failed:",
        res.status,
        await res.text().catch(() => "")
      );
    } catch (err) {
      console.error("[gift-history] sync trigger forward error:", err);
    }
    if (attempt < SYNC_NOTIFY_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, SYNC_NOTIFY_RETRY_DELAY_MS * attempt));
    }
  }
  // 有限回リトライしても届かなかった。Gift行自体は既にDBへ保存済みなので、
  // 該当streamerIdの次回REST取得(gift-history route.ts)で必ず最新状態に収束する
  // (listenerNotifyQueueのstate通知と同じ倒し方)。
  console.error("[gift-history] sync trigger forward exhausted retries — will converge on next REST fetch", {
    streamerIds: pending.streamerIds,
    giftId: pending.giftId,
  });
}

interface PendingBattleHistoryNotify {
  streamerIds: string[];
  roomId: string;
  battleId: string;
}

// battleId(roomId込み)単位で最新1件に上書きするMap。upsertなので、短時間に複数回
// 積まれても最後の1件を配信すれば内容としては最新状態に収束する(listenerNotifyQueueと同型)。
const battleHistoryNotifyQueue = new Map<string, PendingBattleHistoryNotify>();
let battleHistoryNotifyRunning = false;

function enqueueBattleHistoryNotify(key: string, pending: PendingBattleHistoryNotify): void {
  if (pending.streamerIds.length === 0) return;
  battleHistoryNotifyQueue.set(key, pending);
  void drainBattleHistoryNotifyQueue();
}

async function drainBattleHistoryNotifyQueue(): Promise<void> {
  if (battleHistoryNotifyRunning) return;
  battleHistoryNotifyRunning = true;
  try {
    while (battleHistoryNotifyQueue.size > 0) {
      const [key, pending] = battleHistoryNotifyQueue.entries().next().value as [
        string,
        PendingBattleHistoryNotify,
      ];
      battleHistoryNotifyQueue.delete(key);
      await deliverBattleHistoryNotify(pending);
    }
  } finally {
    battleHistoryNotifyRunning = false;
  }
}

async function deliverBattleHistoryNotify(pending: PendingBattleHistoryNotify): Promise<void> {
  if (!isWorkerProcess) {
    await applyBattleHistorySyncTrigger(pending.streamerIds, pending.roomId, pending.battleId).catch((err) =>
      console.error("[battle-history] sync trigger error:", err)
    );
    return;
  }

  for (let attempt = 1; attempt <= SYNC_NOTIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${process.env.WEB_INTERNAL_URL}/api/internal/gift-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          streamerIds: pending.streamerIds,
          syncTrigger: "battle-history",
          roomId: pending.roomId,
          battleId: pending.battleId,
        }),
        signal: AbortSignal.timeout(SYNC_NOTIFY_TIMEOUT_MS),
      });
      if (res.ok) return;
      console.error(
        "[battle-history] sync trigger forward failed:",
        res.status,
        await res.text().catch(() => "")
      );
    } catch (err) {
      console.error("[battle-history] sync trigger forward error:", err);
    }
    if (attempt < SYNC_NOTIFY_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, SYNC_NOTIFY_RETRY_DELAY_MS * attempt));
    }
  }
  console.error("[battle-history] sync trigger forward exhausted retries — will converge on next REST fetch", {
    streamerIds: pending.streamerIds,
    roomId: pending.roomId,
    battleId: pending.battleId,
  });
}

/** ギフト履歴push(append)を仕掛ける。DB保存成功後(giftId確定後)にのみ呼ぶこと。 */
function notifyGiftHistorySync(streamerIds: string[], giftId: string): void {
  if (streamerIds.length === 0) return;
  enqueueGiftHistoryNotify({ streamerIds, giftId });
}

/** バトル履歴push(upsert)を仕掛ける。DB保存(persistBattle)完了後にのみ呼ぶこと。 */
function notifyBattleHistorySync(roomId: string, streamerIds: string[], battleId: string): void {
  if (streamerIds.length === 0) return;
  enqueueBattleHistoryNotify(`${roomId}:${battleId}`, { streamerIds, roomId, battleId });
}

/**
 * 貢献ランキングpushを仕掛ける。**drop許容**(scheduleRankingSnapshotEmit自体が
 * throttleで間引く設計のため、既存forwardToWebと同じ扱いでよい)。
 */
function notifyRankingSync(roomId: string, streamerIds: string[]): void {
  if (streamerIds.length === 0) return;
  if (!isWorkerProcess) {
    applyRankingSyncTrigger(roomId, streamerIds);
    return;
  }
  void forwardToWeb({ streamerIds, syncTrigger: "ranking", roomId });
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

// fetchRoomInfoOnConnectのオフライン判定(client.jsの`_roomInfo.data.status === 4`)は、
// `room/info/` が `status_code!==0`(データ無し応答。実測: sion291のケースで4003110)を
// 返すroomでは`data.status`自体が無く、常にfalseへ倒れて素通りする——本来オフラインの
// roomがオンライン扱いのままEuler署名を消費してWS接続し、無応答→watchdog強制再接続を
// 繰り返す「ゾンビ」になる(実データで確認、2026-09-05)。
//
// 一般利用者が見る「配信中か」は`api-live/user/room/`の`liveRoom.status`(TLC-sidestageの
// `fetchIsLive()`が使う方のエンドポイント)で、このroomでは一貫して4(オフライン)を返す。
// `_connect()`本体を差し替える(vendored fork)のではなく、Euler署名を消費する前にこちらで
// 事前チェックし、確実にオフラインと分かる場合だけ`user_offline`と同じ経路へ倒す。
// 判定不能(API失敗・フィールド欠落)ならfalseを返し、既存の`fetchRoomInfoOnConnect`任せの
// 挙動へフォールバックする(誤検知でオンラインroomを弾かないため)。
//
// **同じ応答で room の同一性(tiktokUid)も照合する。** 接続先を決めているのは可変ハンドルなので、
// 改名で空いたハンドルを第三者が取得すると、照合が無ければ別人の配信データがこの room へ入る。
// `data.user.id` は `TiktokRoom.hostTiktokUid` の出所と同じ値(schema.prisma 参照)。
// **判定不能(API失敗・uid欠落)を「一致」に倒さない** — fail-open にすると api-live の障害中だけ
// 照合が素通りする。オフライン判定と違い、同一性は分からないなら接続しない。
type ApiLivePreCheck =
  | { kind: "offline" }
  | { kind: "verified"; tiktokUid: string }
  | { kind: "mismatch"; actual: string }
  | { kind: "unverifiable"; reason: string };

async function precheckApiLive(
  conn: WebcastPushConnection,
  tiktokHandle: string,
  expectedTiktokUid: string | null
): Promise<ApiLivePreCheck> {
  let roomData: Awaited<ReturnType<typeof conn.webClient.fetchRoomInfoFromApiLive>>;
  try {
    roomData = await conn.webClient.fetchRoomInfoFromApiLive({ uniqueId: tiktokHandle });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[listener] @${tiktokHandle}: api-live/user/room/ pre-check failed — ${reason}`);
    return { kind: "unverifiable", reason };
  }

  if (roomData?.data?.liveRoom?.status === 4) return { kind: "offline" };

  const actual = normalizeTikTokUserId(
    (roomData as { data?: { user?: { id?: unknown } } })?.data?.user?.id
  );
  if (!actual) return { kind: "unverifiable", reason: "api-live response has no usable data.user.id" };
  if (!expectedTiktokUid) return { kind: "unverifiable", reason: "room has no hostTiktokUid" };
  if (actual !== expectedTiktokUid) return { kind: "mismatch", actual };
  return { kind: "verified", tiktokUid: actual };
}

function isAlreadyConnectedError(error: unknown): boolean {
  const msg =
    typeof (error as { message?: string })?.message === "string"
      ? (error as { message: string }).message
      : String(error || "");
  return /already connected!?/i.test(msg);
}

// TikTok側からの403(IP/アカウントブロック)を検知する。worker-guardian.tsの403フェイル
// オーバー(別workerへの再割当)トリガーとしてのみ使う——in-processの再接続ロジック
// (scheduleReconnect)は変えない。
//
// 判定はAxiosErrorのstatus===403のみに絞る(SIGI_STATE抽出失敗等の文言ベース判定は
// 対象外——TikTok側のHTML構造変更(非ブロック)でも同じ文言が出て誤検知になるため、
// 実装前レビューで意図的に除外した)。FetchIsLiveErrorはfetchRoomId()内でHTML経由・
// API経由の複数エラーをまとめて投げるラッパーなので、その配列内も走査する。
//
// error.exception / error.cause も候補に含める——isUserOfflineError()と同じ理由で、
// conn.on("error")が受け取るのはTLC側がラップした{info, exception}形であることがあり、
// exceptionの中に本来のAxiosErrorが入っている。ここを見ないとisAxiosErrorが常にundefinedで
// post-connect側の403検知が機能しない(実装後レビューMEDIUM指摘)。
export function isBlockedError(error: unknown): boolean {
  const candidates: unknown[] =
    error instanceof FetchIsLiveError
      ? [error, ...error.errors]
      : [
          error,
          (error as { exception?: unknown })?.exception,
          (error as { cause?: unknown })?.cause,
        ].filter(Boolean);
  return candidates.some((c) => {
    const e = c as { isAxiosError?: boolean; response?: { status?: number } };
    return e?.isAxiosError === true && e.response?.status === 403;
  });
}

// consecutiveBlockedCountのincrement。WHERE workerId=自worker を必ず付ける——
// 再割当直後、旧worker側の60秒reconcile待ちの間に届くin-flightのエラーが新worker分
// としてカウントされたり、旧workerの残余カウントを誤って引き継いだりするレースを防ぐ
// (実装前レビューHIGH指摘)。fencing(listenerRevision)は使わない単純incrementなので、
// persistState()のCASE式リセットとはごく小さいレースが理論上残るが、実害は「1回分
// カウントがずれる」程度で許容する。
export async function recordBlockedAttempt(roomId: string): Promise<void> {
  const workerIndex = Number.isInteger(Number(process.env.WORKER_INDEX))
    ? Number(process.env.WORKER_INDEX)
    : null;
  if (workerIndex == null) return;
  try {
    await prisma.tiktokRoom.updateMany({
      where: { id: roomId, workerId: workerIndex },
      data: { consecutiveBlockedCount: { increment: 1 } },
    });
  } catch (err) {
    console.error("[listener] consecutiveBlockedCount更新に失敗:", err);
  }
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
//  - consecutiveBlockedCount は"connected"に加え reason==='user_offline' でも0リセットする。
//    配信者が長期オフラインだとconnected到達自体が起きず、その間に散発する403が数日かけて
//    閾値に達し誤ってブロック扱いされうる。room/info成功後の判定であるuser_offlineは
//    「TikTokから正常応答があった」証拠なので、ブロックが解消している根拠として扱える
//    (実装後レビューMEDIUM指摘)。
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
          "notFoundFirstAt" = CASE WHEN ${status} = 'connected' THEN NULL ELSE "notFoundFirstAt" END,
          "consecutiveBlockedCount" = CASE
            WHEN ${status} = 'connected' OR ${reason ?? null} = 'user_offline' THEN 0
            ELSE "consecutiveBlockedCount"
          END
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

    // 配信開始(初回connected)のたびにTikTok表示名(nickname)を更新する。表示専用データなので
    // 失敗しても接続処理自体には影響させない。existenceCheckerは6時間TTLキャッシュ・同時実行
    // 上限2を持つ既存の共有レート制限層(tiktok-existence.ts)にそのまま乗る。例外を投げない契約
    // (ExistenceChecker.check参照)だが、DB更新側の失敗は念のためcatchしておく。
    void existenceChecker
      .check(inst.state.tiktokHandle)
      .then(async (result) => {
        if (result.verdict !== "EXISTS" || !result.nickname) return;
        const tiktokUid = normalizeTikTokUserId(result.tiktokUid);
        if (!tiktokUid) return;
        const commit = await recordTikTokUser(prisma, {
          tiktokUid,
          tiktokHandle: normalizeDisplayValue(inst.state.tiktokHandle),
          nickname: normalizeDisplayValue(result.nickname),
        });
        commit();
      })
      .catch(() => {});
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

// matchInfoを観測できた最初の1回だけログを出す(プロセス単位)。本番でこの刻印が
// 実際に届いているかを確認する手段が、これとDBの `multiplierType IS NOT NULL` 件数しかない。
let matchInfoObservedLogged = false;

// WebcastGiftMessage.matchInfo から倍率刻印を取り出す。
//
// **ネストのまま読むのが正**。data-converter.ts の WebcastGiftMessage 変換が
// Object.assign で平坦化するのは giftDetails と giftExtra だけで、matchInfo は
// ネストされたまま残る。フラット側も読むのは、将来 converter が平坦化しても
// 拾えるようにするための保険。
//
// multiplierType=0 は「倍率なし」を明示する値なので保存する。取り出せなかった場合のみ
// null にして「未観測」と区別する(schema.prisma の Gift.multiplierType コメント参照)。
function resolveGiftMultiplier(data: Record<string, unknown>): {
  multiplierType: number | null;
  multiplierValue: number | null;
} {
  const matchInfo = data.matchInfo as Record<string, unknown> | undefined;
  const rawType = matchInfo?.multiplierType ?? data.multiplierType;
  // protobufのint64はstringで届く。
  const rawValue = matchInfo?.multiplierValue ?? data.multiplierValue;

  const multiplierType = toFiniteInt(rawType);
  const multiplierValue = toFiniteInt(rawValue);

  if (!matchInfoObservedLogged && (multiplierType !== null || multiplierValue !== null)) {
    matchInfoObservedLogged = true;
    // どちらの形で届いたかを残す。フラット側だけで取れた場合に「matchInfoが来ている」と
    // 誤読すると、data-converter.tsの平坦化仕様の判断を間違える。
    console.log("[gift] gift multiplier observed", {
      source: matchInfo ? "matchInfo" : "flat",
      multiplierType,
      multiplierValue,
    });
  }

  return { multiplierType, multiplierValue };
}

function toFiniteInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

// GiftのINSERT行を組み立てる。saveGift()とsaveComboGift()で共有する。
// dedupキー(orderId/groupId/msgId)だけは経路ごとに扱いが違うので呼び出し側から渡す。
// tiktokUid は呼び出し側の入口で normalizeTikTokUserId() 済みの非 null 値を渡す
// (builder 内で normalize すると string | null になり戻り型と合わない)。
function buildGiftRow(
  roomId: string,
  tiktokUid: string,
  data: Record<string, unknown>,
  count: number,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback",
  keys: { orderId: string | null; groupId: string | null; msgId: string | null }
): Prisma.GiftUncheckedCreateInput {
  const diamondCount = Number(data.diamondCount) || 0;
  const { multiplierType, multiplierValue } = resolveGiftMultiplier(data);
  return {
    roomId,
    tiktokUid,
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
    multiplierType,
    multiplierValue,
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
export type GiftSaveResult = "saved" | "duplicate" | "error";

// exportはテスト専用(真の同時実行を作るため関数を直接importして呼ぶ。Concurrent duplicateテスト参照)。
// 呼び出し元(本番コード)は依然としてリスナーのイベントハンドラ経由でのみ呼ぶ。
export async function saveGift(
  roomId: string,
  data: Record<string, unknown>,
  count: number,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback",
  // realtime-sync(ギフト履歴push)用。**戻り値の型(GiftSaveResult)は変更しない**
  // (既存呼び出し元・tiktok-listener.combo.integration.test.tsの契約を壊さないため)。
  // 保存に成功しGift.idが確定した直後、コミット後にのみ呼ぶ。
  onSaved?: (giftId: string) => void
): Promise<GiftSaveResult> {
  // catch側のログでも参照するのでtryの外で確定させる(いずれも例外を投げない純粋な変換)。
  const orderId = data.orderId ? String(data.orderId) : null;
  // protobufの既定値"0"はキーとして使えないのでnullで保存する。
  // 列の意味を「使えるcombo/dedup識別子、無ければnull」に揃える。
  const groupId = resolveGroupId(data);
  const msgId = resolveMsgId(data);

  // getUserAttributes() は全イベントに userId を載せるので、欠落は protobuf レベルの異常。
  // "" / "0" を保存すると tiktokUid 不明の全員が1人へ畳まれるため書き込まない。
  const tiktokUid = normalizeTikTokUserId(data.userId);
  if (!tiktokUid) {
    console.error("[gift] data.userId が解決できないため保存をスキップした", {
      roomId,
      msgId,
      giftName: String(data.giftName || ""),
    });
    return "error";
  }

  try {
    const dayKey = jstDateKey(receivedAt);
    const diamondCount = Number(data.diamondCount) || 0;

    // クロージャ内での代入をTSが追跡できないので、saveComboGift()と同じくホルダー越しに
    // 受け渡す(1832-1834行付近と同じパターン)。
    const giftCommit: { fn: (() => void) | null } = { fn: null };
    const giftIdHolder: { value: string | null } = { value: null };

    const result = await prisma.$transaction<GiftSaveResult>(
      async (tx) => {
        // msgIdが取れているときだけ効く。resolveMsgId()がprotobufの既定値を弾いてnullに
        // した場合は従来どおりそのまま保存する(dedupキーが無いだけで、ギフト自体は
        // 実際に届いているため、捨てるとダイヤ数がそのまま失われる)。
        if (msgId) {
          // 同一(roomId, msgId)への同時書き込みを直列化する。comboのlock key(groupId単体)
          // とは別の値空間になるよう "gift:" プレフィックスを付ける(kindによる種別分離)。
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}), hashtext(${"gift:" + msgId}))`;

          const duplicate = await tx.gift.findFirst({
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

        const created = await tx.gift.create({
          data: buildGiftRow(roomId, tiktokUid, data, count, receivedAt, timeSource, {
            orderId,
            groupId,
            msgId,
          }),
          select: { id: true },
        });
        giftCommit.fn = await recordTikTokUser(tx, {
          tiktokUid,
          tiktokHandle: normalizeDisplayValue(data.uniqueId),
          nickname: normalizeDisplayValue(data.nickname),
        });
        giftIdHolder.value = created.id;
        return "saved";
      },
      // Prismaの既定(maxWait=2s / timeout=5s)はadvisory lockの待ち行列には短すぎる
      // (saveComboGift()と同じ値を流用)。
      { maxWait: COMBO_TX_MAX_WAIT_MS, timeout: COMBO_TX_TIMEOUT_MS }
    );
    // トランザクションが正常にresolveした時点でDBへ確定コミット済み(Prisma interactive
    // transactionの契約)。onSavedはこの後で呼ぶ = 「DB保存完了後にpushする」invariantを満たす。
    if (result === "saved" && giftIdHolder.value) {
      giftCommit.fn?.();
      onSaved?.(giftIdHolder.value);
    }
    return result;
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

// 同時実行中のlistener comment createの上限。chatはgiftよりはるかに高頻度なので、
// 無制限にfire-and-forgetすると、DBが一時的に遅延した瞬間にPrismaコネクションプールを
// コメント書き込みが埋め尽くし、同じプールを使うsaveGift/saveComboGift(金銭データ)が
// pool timeoutで落ちる経路になりうる(外部レビュー指摘)。超過分は保存を諦めてログのみ
// (この用途では取りこぼし許容、schema.prismaのListenerCommentコメント参照)。
const LISTENER_COMMENT_SAVE_CONCURRENCY_LIMIT = 12;
let listenerCommentSaveInFlight = 0;

// リスナーコメント保存(AI傾向分析用の生ログ、30日retention)。GiftのfindFirst事前
// 重複チェックは行わない — chat流量はgiftよりはるかに多く、インメモリdedup
// (rememberMsgId, CHAT_DEDUP_CACHE_SIZE)が正常系の重複をほぼ弾いているため。
// 例外は伝播させずログのみに倒す(fire-and-forgetで呼ばれるため、unhandled
// promise rejectionでworkerプロセスが落ちるのを防ぐ)。
// 保存に失敗してもmsgIdのFIFO(rememberMsgId)からは戻さない — chatのFIFOは
// socket配信の二重送信防止が目的で、配信は保存より先に完了しているため、
// giftのforgetMsgIdと同じ「失敗時に外して再送で拾い直す」動きを真似ると
// 逆に二重配信を招く。
async function saveListenerComment(
  roomId: string,
  data: Record<string, unknown>,
  receivedAt: Date,
  timeSource: "tiktok" | "fallback"
): Promise<void> {
  if (listenerCommentSaveInFlight >= LISTENER_COMMENT_SAVE_CONCURRENCY_LIMIT) {
    console.warn(
      `[listener] listener comment save skipped: concurrency limit(${LISTENER_COMMENT_SAVE_CONCURRENCY_LIMIT}) reached (room=${roomId})`
    );
    return;
  }
  const tiktokUid = normalizeTikTokUserId(data.userId);
  if (!tiktokUid) {
    console.error("[listener] data.userId が解決できないためコメント保存をスキップした", { roomId });
    return;
  }
  listenerCommentSaveInFlight += 1;
  try {
    const commit = await prisma.$transaction(async (tx) => {
      await tx.listenerComment.create({
        data: {
          roomId,
          tiktokUid,
          comment: String(data.comment || ""),
          receivedAt,
          timeSource,
          dayKey: jstDateKey(receivedAt),
          msgId: resolveMsgId(data),
        },
      });
      return recordTikTokUser(tx, {
        tiktokUid,
        tiktokHandle: normalizeDisplayValue(data.uniqueId),
        nickname: normalizeDisplayValue(data.nickname),
      });
    });
    commit();
  } catch (err: unknown) {
    console.error("[listener] listener comment save error:", err);
  } finally {
    listenerCommentSaveInFlight -= 1;
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

export type BattleItemSaveResult = "saved" | "duplicate" | "error";

// バトルアイテム使用ログの保存。comboのような累計tickではなく「使用ごとに1回」の
// 離散イベントなので、saveComboGiftのようなdelta計算は不要 — saveGift(non-combo)と同型。
/**
 * ボーナスミッション区間(linkMicBattleTask)を TiktokBattleBonusMission へ残す。
 *
 * taskStart で1行 create し、taskSettle / rewardSettle は `(roomId, battleId)` の
 * **未確定の行のうち最も古いもの**を findFirst で1行選んで update する。**taskStart を
 * 取りこぼした状態の settle は捨てる**(startedAt も条件も無い部分行を作らないため)。
 *
 * **taskSettle は1区間につき複数回飛ぶ。** `taskResult=0`(中間settle)は無視し、
 * 1(未達成)か 2(達成)だけを確定として書く(詳細は該当分岐のコメント)。
 *
 * 最古を採る(`startedAt: "asc"`)のは、区間が重なって未確定行が2つ以上あるときに
 * FIFO で対応づけるため。BATTLE-EVENTS.md 3節のライフサイクル
 * (taskStart→taskSettle→rewardSettle→次のtaskStart)が保たれる限り未確定行は常に1つだが、
 * payload に区間の識別子が無いので、崩れた場合でも先に始まった区間から順に閉じる方へ倒す。
 *
 * **書き込み失敗は握りつぶす**(persistBattle の armies snapshot と同じ理由)。この保存は
 * バトル再生の補助情報であって、失敗でギフト受信や他のバトル保存を止めてはならない。
 */
async function saveBattleBonusMission(
  roomId: string,
  task: ParsedBattleTask,
  receivedAt: Date
): Promise<void> {
  try {
    if (task.messageType === BATTLE_TASK_MESSAGE_TYPE.TASK_START) {
      // 条件が1つでも欠けた taskStart は「何のミッションか」を表示できないので保存しない。
      if (task.targetType === null || task.progressTarget === null || task.rewardMultiple === null) {
        console.warn("[battle-task] taskStart に条件が欠けているため保存しない", {
          roomId,
          battleId: task.battleId,
        });
        return;
      }
      await prisma.tiktokBattleBonusMission.create({
        data: {
          roomId,
          battleId: task.battleId,
          targetType: task.targetType,
          progressTarget: task.progressTarget,
          rewardMultiple: task.rewardMultiple,
          startedAt: receivedAt,
        },
      });
      return;
    }

    if (task.messageType === BATTLE_TASK_MESSAGE_TYPE.TASK_SETTLE) {
      // taskResult=0 は進捗到達直後に飛ぶ中間settleで、このあと 1(未達成) か 2(達成) が
      // 別メッセージで届く。これを確定として書くと settledAt が埋まってしまい、本settleが
      // 「未確定の行が無い」として捨てられ、rewardStartTimestamp(報酬区間の開始)を永久に失う。
      // 2026-09-06 本番で実際に発生(達成した区間が taskResult=0 のまま固定され開始時刻が欠損)。
      // null(taskSettle 自体が欠落など、確定と判別できない形)も同じ理由で捨てる。
      if (task.taskResult === null || task.taskResult === BATTLE_TASK_RESULT.INTERIM) return;
      const open = await prisma.tiktokBattleBonusMission.findFirst({
        where: { roomId, battleId: task.battleId, settledAt: null },
        orderBy: { startedAt: "asc" },
        select: { id: true },
      });
      if (!open) return; // taskStart を取りこぼした区間
      await prisma.tiktokBattleBonusMission.update({
        where: { id: open.id },
        data: {
          settledAt: receivedAt,
          taskResult: task.taskResult,
          // 報酬区間の開始は予告値しか取れない(実開始より早い)。区間終了は rewardSettle が正。
          rewardStartedAt: task.rewardStartTime,
        },
      });
      return;
    }

    if (task.messageType === BATTLE_TASK_MESSAGE_TYPE.REWARD_SETTLE) {
      const settled = await prisma.tiktokBattleBonusMission.findFirst({
        where: { roomId, battleId: task.battleId, settledAt: { not: null }, rewardEndedAt: null },
        orderBy: { startedAt: "asc" },
        select: { id: true },
      });
      if (!settled) return;
      await prisma.tiktokBattleBonusMission.update({
        where: { id: settled.id },
        data: { rewardEndedAt: receivedAt, rewardSum: task.rewardSum },
      });
      return;
    }
    // taskUpdate(1)は高頻度なので保存しない(schema.prisma の TiktokBattleBonusMission コメント参照)。
  } catch (err: unknown) {
    console.error("[listener] battle bonus mission save error:", {
      roomId,
      battleId: task.battleId,
      messageType: task.messageType,
      err,
    });
  }
}

// exportはテスト専用(真の同時実行を作るため関数を直接importして呼ぶ。Concurrent duplicateテスト参照)。
// 呼び出し元(本番コード)は依然としてリスナーのイベントハンドラ経由でのみ呼ぶ。
export async function saveBattleItemUse(
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

  // TikTok の不変IDが取れない送信者は保存しない。protobuf 既定値("0")・空文字を許すと
  // 送信者不明の複数人が同一人物として畳まれる(normalizeTikTokUserId のコメント参照)。
  const senderTiktokUid = normalizeTikTokUserId(sender.userId);
  if (!senderTiktokUid) {
    console.error("[battle-item] sender.userId が解決できないため保存をスキップした", {
      roomId,
      battleId: message.battleId,
      cardType: message.cardType,
    });
    return "duplicate";
  }
  const senderTiktokHandle = normalizeDisplayValue(sender.uniqueId);
  const senderNickname = normalizeDisplayValue(sender.nickname);

  const msgId = resolveMsgId(message as unknown as Record<string, unknown>);

  try {
    // クロージャ内での代入をTSが追跡できないので、saveGift()/saveComboGift()と同じく
    // ホルダー越しに受け渡す。commit()はtxがresolveした後(DB確定コミット後)にのみ呼ぶ
    // (recordTikTokUser()のスロットル記録はtx rollback時に呼ぶと実際のupsertより先に
    // マークされてしまうため)。
    const battleItemCommit: { fn: (() => void) | null } = { fn: null };

    // 表示名の正本は TikTokUser。アイテムカードしか使っていない送信者はここでしか
    // 記録されないので、item-use の INSERT と同一トランザクションで upsert する。
    const result = await prisma.$transaction<BattleItemSaveResult>(
      async (tx) => {
        if (msgId) {
          // 同一(roomId, msgId)への同時書き込みを直列化する。lock keyは "battle_item:" を
          // 付けてGift("gift:")・combo(groupId単体)と別の値空間にする(kindによる種別分離)。
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}), hashtext(${"battle_item:" + msgId}))`;

          const duplicate = await tx.tiktokBattleItemUse.findFirst({
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

        await tx.tiktokBattleItemUse.create({
          data: {
            roomId,
            battleId: message.battleId,
            cardType: message.cardType,
            senderTiktokUid,
            senderProfilePictureUrl: pickProfilePictureUrl(sender.profilePicture?.url),
            targetHostTiktokUid: card.targetHostUserId,
            msgId,
            receivedAt,
          },
        });
        battleItemCommit.fn = await recordTikTokUser(tx, {
          tiktokUid: senderTiktokUid,
          tiktokHandle: senderTiktokHandle,
          nickname: senderNickname,
        });
        return "saved";
      },
      // Prismaの既定(maxWait=2s / timeout=5s)はadvisory lockの待ち行列には短すぎる
      // (saveComboGift()と同じ値を流用)。
      { maxWait: COMBO_TX_MAX_WAIT_MS, timeout: COMBO_TX_TIMEOUT_MS }
    );
    if (result === "saved") battleItemCommit.fn?.();
    return result;
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
  timeSource: "tiktok" | "fallback",
  // saveGift()と同じ契約: 戻り値の型は変更せず、保存成功(コミット後)にだけ呼ぶ
  // out-paramとして渡す(既存tiktok-listener.combo.integration.test.tsの呼び出し・
  // 戻り値契約を壊さないための技術的判断)。
  onSaved?: (giftId: string) => void
): Promise<GiftSaveResult> {
  const msgId = resolveMsgId(data);
  // 送信者のtiktokUidが解決できない = protobufレベルの異常。空文字/"0"を主キー相当へ入れると
  // uid不明の全ユーザーが1人へ畳まれるので、保存自体をスキップする(saveGift()と同じ契約)。
  const tiktokUid = normalizeTikTokUserId(data.userId);
  if (!tiktokUid) {
    console.error("[gift/combo] data.userIdが解決できないため保存をスキップした", {
      roomId,
      groupId,
      msgId,
    });
    return "error";
  }
  // クロージャ内での代入をTSが追跡できないので、ホルダー越しに受け渡す。
  const comboCommit: { fn: (() => void) | null } = { fn: null };
  const comboGiftId: { value: string | null } = { value: null };
  try {
    const result = await prisma.$transaction<GiftSaveResult>(
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

        const created = await tx.gift.create({
          data: buildGiftRow(roomId, tiktokUid, data, delta, receivedAt, timeSource, {
            // comboの各段に同じorderIdが付くとunique(roomId, orderId)で2段目以降がP2002になる。
            // comboのdedupはgroupId単位の単調増加判定でできているのでorderIdは要らない。
            orderId: null,
            groupId,
            msgId,
          }),
          select: { id: true },
        });
        comboGiftId.value = created.id;
        // Gift行と同一トランザクションで記録する(生観測系から表示名列を落としたので、
        // 取りこぼすとランキングに名無しが並ぶ)。markerはcommit後に立てる。
        comboCommit.fn = await recordTikTokUser(tx, {
          tiktokUid,
          tiktokHandle: normalizeDisplayValue(data.uniqueId),
          nickname: normalizeDisplayValue(data.nickname),
        });
        console.log("[gift/combo] save", { roomId, groupId, currentRepeat, saved, delta });
        return "saved";
      },
      // Prismaの既定(maxWait=2s / timeout=5s)はadvisory lockの待ち行列には短すぎる。
      { maxWait: COMBO_TX_MAX_WAIT_MS, timeout: COMBO_TX_TIMEOUT_MS }
    );
    comboCommit.fn?.();
    // トランザクションのresolveでDB確定コミット済み。saveGift()と同じくコミット後にのみ呼ぶ。
    if (result === "saved" && comboGiftId.value) onSaved?.(comboGiftId.value);
    return result;
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
  tiktokHandle: string,
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
        tiktokHandle,
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
  tiktokHandle: string,
  deviceId: string,
  proxyUrl: string | null,
  eulerSignApiKey: string | null,
  signCtx: SignUsageContext
): WebcastPushConnection {
  let connRef: WebcastPushConnection;
  const conn = new WebcastPushConnection(`@${tiktokHandle}`, {
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
      tiktokHandle,
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

/**
 * バトル履歴の確定を仕掛けるまでの猶予。
 *
 * Gift の保存は persistBattle と非同期・非awaitの別経路(saveGift(...).then(...))なので、
 * END検知の瞬間には集計対象の Gift がまだ INSERT されていない。さらに armies の最終スコアが
 * FINISH 後に届くこともある。10秒待ってから確定処理へ入り、そこでさらに10秒の安定性チェックを行う
 * (2026-09-02に10分→30秒、2026-09-06に30秒→10秒へさらに短縮。遅延Giftを取りこぼしたまま
 * 確定するリスクは詳細を battle-history-finalize.ts 冒頭コメント参照)。
 */
const BATTLE_FINALIZE_DELAY_MS = 10 * 1000;

/**
 * 10秒後に確定処理を1回だけ fire-and-forget で呼ぶ。**await しない**(イベントループを塞がない)。
 *
 * 失敗・プロセス再起動で取りこぼしても、そのバトルは「未確定」のまま残るだけで、読み出しは
 * 従来どおりライブ集計へ正しくフォールバックする。再試行は行わない
 * (まとめて確定させたいときは scripts/backfill-battle-history.ts を実行する)。
 *
 * 確定(materializeBattleHistory)が成功したときは、バトル履歴pushを1回追加で仕掛ける
 * (design-review反映2 finding4)。購読者は**確定時点で改めて解決する**
 * (スケジュール時点でクロージャに固定すると、10秒の間に増減した購読者を反映できないため)。
 */
function scheduleBattleHistoryFinalize(roomId: string, battleId: string): void {
  const timer = setTimeout(() => {
    void materializeBattleHistory(roomId, battleId, new Date())
      .then((result) => {
        if (!result.finalized) return;
        const streamerIds = Array.from(listeners.get(roomId)?.subscriberIds ?? []);
        notifyBattleHistorySync(roomId, streamerIds, battleId);
      })
      .catch((err) => {
        console.error(`[battle-history] 確定処理に失敗 roomId=${roomId} battleId=${battleId}`, err);
      });
  }, BATTLE_FINALIZE_DELAY_MS);
  // 確定は最適化なので、プロセス終了をこのタイマーで引き延ばさない。
  timer.unref?.();
}

// ===== タップ点(いいね由来のスコア)の集計 =====
//
// 公式スコアはギフトだけでは増えず「ギフト点 x 倍率 + タップ点」で増える。差し引かないと
// 初ギフトx倍の逆算(battle-opening-multiplier.ts)の比が一方向に上振れし、正しい倍率が
// 「判定不能」として棄却される(本番実例: 406/200 = 2.03)。
//
// 仕様(ユーザー提示。TikTok公式では裏取りできていない): **1リスナーが10タップで3点。それが上限**で、
// 上限はバトル単位。次のバトルでは全員が再び権利を得る。したがって行が増えるのは
// 「あるリスナーがそのバトルで10タップに到達した瞬間」だけで、毎秒書く方式ではない。

/** これだけタップしたリスナーに TAP_POINTS_PER_LISTENER が入る。 */
const TAP_THRESHOLD_COUNT = 10;

/** 10タップ到達1人あたりのスコア。**定数で埋めずDBへ保存する**(仕様が違っていたと後で判るように)。 */
const TAP_POINTS_PER_LISTENER = 3;

/** 1バトルで追跡するリスナー数の上限(counts と reached の合計)。超えたら計上を止めて
 * complete=false にする。バトルは5分なので tally はその間だけ生きる。 */
export const MAX_TAP_TALLY_ENTRIES = 20_000;

/**
 * 進行中バトル1本ぶんのタップ集計。**write queue 上ではなくイベントハンドラ内で同期的に作る。**
 * persistBattle() は queueBattleWrite() で非同期に積まれるため、そこで作るとバトル開始イベント
 * 受信から実行までの like を構造的に取りこぼす。
 */
type TapTally = {
  battleId: string;
  /** このroomの配信者のtiktokUid。行に持たせて読み出し時のroom->host解決を不要にする。 */
  hostTiktokUid: string;
  /** リスナーの tiktokUid -> 累積タップ数(10未満のリスナーのみ)。 */
  counts: Map<string, number>;
  /** 10到達済み。メモリ上の二重書き込み抑制で、正は DB の unique 制約。 */
  reached: Set<string>;
  /** insert の結果(成功=true)。**fire-and-forget にせず参照を残す**。最終化タスクがこれを
   * 待たないと、FINISH 後に reject した insert を取りこぼしたまま tracked=true を書いてしまう。 */
  pendingWrites: Promise<boolean>[];
  /** バトル開始から取りこぼしなく観測できているか。**単調に false へ落ちるだけ。** */
  complete: boolean;
};

/**
 * バトルイベントを受けてタリーを生成・切替・最終化する。**ハンドラ内で同期的に呼ぶこと。**
 */
function syncTapTally(inst: ListenerInstance, roomId: string, parsed: ParsedBattle | null): void {
  if (!parsed) return;
  const current = inst.tapTally;

  if (parsed.phase === "END") {
    if (current && current.battleId === parsed.battleId) {
      inst.tapTally = null;
      finalizeTapTally(roomId, current);
    }
    return;
  }

  if (current?.battleId === parsed.battleId) return;

  // 別のバトルが始まった。上限3点はバトル単位なので必ず作り直す。
  if (current) {
    inst.tapTally = null;
    finalizeTapTally(roomId, current);
  }

  // 自room の配信者は `TiktokRoom.hostTiktokUid` が正本。payload の displayId(可変ハンドル)と
  // 突き合わせて引き直すと、改名直後・ハンドル再利用で別人へ帰属する。
  const tiktokUid = inst.hostTiktokUid;
  if (tiktokUid === null) return;

  inst.tapTally = {
    battleId: parsed.battleId,
    hostTiktokUid: tiktokUid,
    counts: new Map(),
    reached: new Set(),
    pendingWrites: [],
    // **START 以外で初めて見たバトルは開始からの観測連続性が無い。** armies 先着(配信途中から
    // 接続した・worker再起動)の場合、それ以前のタップを失っているので計測済みを名乗れない。
    complete: parsed.phase === "START",
  };
}

/**
 * `TiktokBattle.tapPointsTracked` へ書く**唯一の経路**。
 *
 * false 化を別経路で即時に書くと、FINISH 後に reject した insert の false を、後から走る true が
 * 上書きしうる。既定値が false なので「complete を確認できたときだけ true を書く」だけでよく、
 * 途中の失敗は DB を触らずメモリ上のフラグを落とすだけで済む(プロセスが落ちても安全側)。
 *
 * 同じ `${roomId}:${battleId}` キーへ積むので、persistBattle() による TiktokBattle 行の作成より
 * 後に走る(createWriteQueue は key 単位で直列)。
 *
 * **absorbRooms(TikTok ID 改名の合流)と競合しても安全側に倒れる。** 合流は1トランザクションで
 * タップ点の移送と候補room削除まで行うので、外から見える状態は合流前か合流後のどちらかしかない。
 * 合流後に届いた insert は room が無く FK 違反で reject し、ここで false のまま残る。
 * 合流の直前に commit した insert は cascade で失われうるが、その場合この updateMany の
 * `roomId` が候補room を指すのに対し `TiktokBattle` 行は survivor へ移っているため 0 件更新となり、
 * **「行は消えたのに tracked=true」にはならない**(= 逆算は差し引かず、導入前と同じ判定に戻る)。
 */
function finalizeTapTally(roomId: string, tally: TapTally): void {
  queueBattleWrite(`${roomId}:${tally.battleId}`, async () => {
    const results = await Promise.all(tally.pendingWrites);
    if (!tally.complete || !results.every(Boolean)) return; // 既定値 false のまま残す
    await prisma.tiktokBattle.updateMany({
      // **roomId を必ず含める。** 同じ battleId の行を相手roomも持つので、battleId だけで
      // 絞ると相手roomのフラグまで書き換える。対象0件でも updateMany は例外を投げない。
      where: { roomId, battleId: tally.battleId },
      data: { tapPointsTracked: true },
    });
  });
}

/**
 * like 1件ぶんをタリーへ反映する。10到達で1行 insert し、以後そのリスナーは計上しない。
 */
function recordTapProgress(
  roomId: string,
  tally: TapTally,
  listener: TikTokUserObservation,
  likeCount: number,
  occurredAt: Date
): void {
  const tiktokUid = listener.tiktokUid;
  if (tally.reached.has(tiktokUid)) return;

  if (!tally.counts.has(tiktokUid) && tally.counts.size + tally.reached.size >= MAX_TAP_TALLY_ENTRIES) {
    tally.complete = false;
    return;
  }

  const next = (tally.counts.get(tiktokUid) ?? 0) + likeCount;
  if (next < TAP_THRESHOLD_COUNT) {
    tally.counts.set(tiktokUid, next);
    return;
  }

  tally.counts.delete(tiktokUid);
  tally.reached.add(tiktokUid);

  // reject させない(最終化タスクが待つまでの間に unhandled rejection になるため)。
  // 成否を boolean で持ち帰り、1件でも失敗していたら tracked=true を書かない。
  // ギフトもコメントも出していないリスナーの TikTokUser 行はここでしか作られないので、
  // tap point の insert と同一トランザクションで upsert する。
  const write = prisma
    .$transaction(async (tx) => {
      await tx.tiktokBattleTapPoint.createMany({
        data: [
          {
            roomId,
            battleId: tally.battleId,
            hostTiktokUid: tally.hostTiktokUid,
            occurredAt,
            tiktokUid,
            points: TAP_POINTS_PER_LISTENER,
          },
        ],
        // 再接続でメモリ上の reached が消えても二重計上しない(正は unique 制約)。
        skipDuplicates: true,
      });
      return recordTikTokUser(tx, listener);
    })
    .then(
      (commit) => {
        commit();
        return true;
      },
      (err) => {
        console.error("[tiktok-listener] tap point write failed", { roomId, battleId: tally.battleId, err });
        return false;
      }
    );
  tally.pendingWrites.push(write);
}

async function persistBattle(
  roomId: string,
  tiktokHandle: string,
  streamerIds: string[],
  parsed: ParsedBattle,
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
        hostTiktokUids: existing.hostTiktokUids,
        hostScores: (existing.hostScores as Record<string, string> | null) ?? {},
        hostProfiles: (existing.hostProfiles as HostProfiles | null) ?? {},
        hostTeams: (existing.hostTeams as HostTeams | null) ?? {},
      }
    : null;

  const state = mergeBattleState(previous, parsed, receivedAt);

  const data = {
    action: state.action,
    startedAt: state.startedAt,
    startedAtEstimated: state.startedAtEstimated,
    endedAt: state.endedAt,
    durationSec: state.durationSec,
    hostTiktokUids: state.hostTiktokUids,
    hostScores: state.hostScores,
    hostProfiles: state.hostProfiles,
    hostTeams: state.hostTeams,
  };

  if (existing) {
    await prisma.tiktokBattle.update({ where: { id: existing.id }, data });
  } else {
    await prisma.tiktokBattle.create({
      data: { roomId, battleId: parsed.battleId, ...data },
    });
  }

  // スコア推移の時系列収集。linkMicBattle/linkMicArmiesどちらもcollectHosts()経由で
  // parsed.hostScoresを持つが、変化があったtiktokUid分だけ書く(無変化イベントまで
  // 書くと行数が際限なく膨らむ上、時系列再現には変化点だけで足りるため)。
  const changedScoreEntries = Object.entries(parsed.hostScores).filter(
    ([tiktokUid, score]) => previous?.hostScores[tiktokUid] !== score
  );
  if (changedScoreEntries.length > 0) {
    try {
      await prisma.tiktokBattleArmiesSnapshot.createMany({
        data: changedScoreEntries.map(([tiktokUid, score]) => ({
          roomId,
          battleId: parsed.battleId,
          occurredAt: receivedAt,
          tiktokUid,
          score,
        })),
      });
    } catch (err) {
      // 握りつぶす。ここで投げるとpersistBattle自体がrejectし、後続の
      // scheduleBattleHistoryFinalize/enqueueBattleNotifyが実行されなくなる
      // (battleNotifyDecisionは既にupdate済みのstateを見るため、次イベントでも
      // "ended"を二度と返さない)。アバターキャッシュと同じfire-and-forget原則。
      console.error("[tiktok-listener] armies snapshot write failed", {
        roomId,
        battleId: parsed.battleId,
        err,
      });
    }
  }

  // アイコンの恒久化はfire-and-forget。DB書き込みが終わった後に呼ぶことで
  // write queueの直列化(同じbattleIdの後続イベント処理)をブロックしない。
  for (const [tiktokUid, profile] of Object.entries(state.hostProfiles)) {
    ensureAvatarCached(tiktokUid, profile.avatarUrl).catch(() => {});
  }


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

      // realtime-sync(バトル履歴upsert)。**"ended"限定にしない** — kindは
      // "ended"|"score_updated"のどちらも取りうり、END後のスコア訂正もpush対象
      // (design-review反映2 finding4)。DB書き込み完了後(この関数の先頭で
      // update/createを済ませた後)にのみ呼んでいる。
      notifyBattleHistorySync(roomId, streamerIds, parsed.battleId);
    }
  }
}

function recordBattleEvent(
  roomId: string,
  tiktokHandle: string,
  streamerIds: string[],
  parsed: ParsedBattle | null
): void {
  // 成立していない招待(INVITE / REJECT / CANCEL)やパースできない payload は記録しない。
  if (!parsed) return;
  const receivedAt = new Date();
  queueBattleWrite(`${roomId}:${parsed.battleId}`, () =>
    persistBattle(roomId, tiktokHandle, streamerIds, parsed, receivedAt)
  );
}

/**
 * このWorkerプロセス自身のWORKER_INDEXを取る。失敗時は自己割当を諦めて既存動作
 * (workerId未設定で作成、次のreconcileのハッシュ割当を待つ)にフォールバックする。
 * 呼び出し元でthrowさせない(linkLayer/linkMicBattleのイベント処理全体、
 * watchdogのmarkAlive等を巻き込むため)。
 */
function tryGetOwnWorkerIndex(logPrefix: string): number | undefined {
  try {
    return getWorkerConfig().index;
  } catch (err) {
    console.error(`[${logPrefix}] getWorkerConfig失敗。自己割当なしで従来どおり処理を続ける`, err);
    return undefined;
  }
}

/**
 * 相手roomを発見経路ごと(コラボ承諾検知/バトル開始補助検知)に監視対象へ入れる共通処理。
 * ensureRoomWatchedForCollab()でDB行を用意し、このプロセスが新規作成できた場合のみ
 * 即接続キックする。
 *
 * `sourceRoomId` は呼び出し元(発見の引き金になったroom)のID。ensureRoomWatchedForCollab()へ
 * そのまま渡し、`TiktokRoom.lastCollabSourceRoomId`へ記録させる(/admin/workers「コラボ署名
 * 消費」列の集計専用。購読判定・接続キック判定には一切使わない)。
 *
 * `created===true`のときだけ即キックする。この分岐は「その部屋のTiktokRoom行を
 * このプロセスが初めて作った」場合にのみ通り、以後同じtiktokHandleへ何度呼ばれても
 * ensureRoomWatchedForCollab()は既存行(existing)分岐に落ちてcreated:falseを返す
 * (DBのunique制約が二重作成自体を防ぐため)。したがって二重キック・再接続ループは
 * 起こらない — startListener()を「新規作成の瞬間に1回だけ」しか呼ばない設計そのものが
 * ガードになっている。
 *
 * ownWorkerIndexが取れていない(getWorkerConfig失敗)ときはDB上のworkerIdもnullのまま
 * 作成されるため、ここでキックすると次のreconcileが別workerへhash割当した際に
 * 二重接続(最大1周回ぶんのgift二重受信)を招く。そのケースは即キックせず従来どおり
 * reconcileに委ねる。
 *
 * 戻り値はtiktokUid -> CollabWatchResult(失敗/スキップ時はnull)。呼び出し元
 * (linkLayerハンドラ)がfire-and-forgetで済ませる場合はPromiseを待たなくてよい。
 */
async function watchDiscoveredRooms(
  subjects: TiktokRoomSubject[],
  ownTiktokHandle: string,
  source: CollabWatchSource,
  ownWorkerIndex: number | undefined,
  sourceRoomId: string
): Promise<Map<string, CollabWatchResult | null>> {
  const targets = new Map<string, TiktokRoomSubject>();
  for (const subject of subjects) {
    const tiktokUid = normalizeTikTokUserId(subject.tiktokUid);
    if (!tiktokUid) continue;
    const tiktokHandle = normalizeTiktokId(subject.tiktokHandle);
    if (tiktokHandle === ownTiktokHandle) continue;
    if (targets.has(tiktokUid)) continue;
    targets.set(tiktokUid, { tiktokUid, tiktokHandle, nickname: subject.nickname });
  }

  const entries = await Promise.all(
    [...targets.values()].map(async (subject): Promise<[string, CollabWatchResult | null]> => {
      const tiktokUid = subject.tiktokUid;
      const tiktokHandle = subject.tiktokHandle;
      try {
        const result = await ensureRoomWatchedForCollab(subject, ownWorkerIndex, source, sourceRoomId);
        if (result) {
          // 発見元roomがこの相手roomを検知した/再検知したことを記録する(TiktokRoomCollabSource)。
          // 失敗してもコラボ検知自体は成立しているのでベストエフォートで済ませる — 取りこぼしても
          // 次のコラボ/バトルイベントで再試行される(recordCollabSourceLink()は冪等)。
          await recordCollabSourceLink(result.roomId, sourceRoomId).catch((err) => {
            console.error(`[${source}] コラボ発見元リンクの記録に失敗`, {
              roomId: result.roomId,
              sourceRoomId,
              err,
            });
          });
        }
        if (result?.created && ownWorkerIndex !== undefined) {
          await startListener(result.roomId, result.tiktokHandle, []).catch((err) => {
            console.error(`[${source}] 新規roomの即時接続に失敗。次のreconcileで拾われる`, {
              roomId: result.roomId,
              tiktokHandle: result.tiktokHandle,
              err,
            });
          });
        }
        return [tiktokUid, result];
      } catch (err) {
        console.error(`[${source}] 相手roomの監視対象追加に失敗`, { tiktokUid, tiktokHandle, err });
        return [tiktokUid, null];
      }
    })
  );

  return new Map(entries);
}

/**
 * コラボ(linkMic)への参加を検知し、相手roomを監視対象へ入れる。
 *
 * `linkLayer`(`WebcastLinkLayerMessage`)の`messageType:18`(groupChangeContent)のうち、
 * `source`が参加確定(招待への承諾)を示すものだけを処理する。userInfosは受信時点の
 * コラボメンバー全員(own含む)のスナップショットで、差分ではない — 詳細は
 * tiktok-collab.ts / tiktok-probe/KNOWLEDGE.md 参照。自分自身のtiktokHandleは除外する。
 *
 * 監視対象への追加はfire-and-forget。失敗してもlinkLayerイベント自体の処理(watchdog等)は
 * 継続させる — 監視対象追加はベストエフォートの付随処理であって、取りこぼしても
 * 次のコラボ参加イベントで再試行される(ensureRoomWatchedForCollab()は冪等)。
 *
 * 既知の制約(匿名観測room自動停止トグルON時): この関数はコラボ参加確定(AGREE)の
 * 瞬間にしかコラボ相手roomのlastWatchInstructedAtをスタンプしない。コラボが継続中でも
 * メンバー変動(groupChangeイベント)が無ければ再スタンプされないため、トグルON時は
 * 参加検知から30分でコラボ観測が打ち切られうる(実装後レビューで指摘。継続監視まで
 * 保証するにはlinkMicBattle/linkMicArmies受信時の再スタンプが必要だが、今回のスコープ
 * (Sidestageユーザーでない匿名roomの放置停止)を超えるため見送った)。
 */
function recordCollabGroupChange(roomId: string, ownTiktokHandle: string, data: unknown): void {
  const parsed = parseCollabGroupChange(data);
  if (!parsed) return;

  // 採用可否の前に出す。sourceの値分布と「待機者ゼロのイベントがどれだけ来るか」は本番でしか
  // 測れず、この変更の効果測定(opponentWatchのbattle_start件数が減るか)の根拠にもなる。
  // messageType:18はコラボメンバーの変化時にしか飛ばないので1件/イベントでも量は問題にならない。
  console.info("[collab] groupChange", {
    roomId,
    source: parsed.source,
    linked: parsed.linkedCount,
    waiting: parsed.waitingCount,
    other: parsed.otherCount,
    ids: parsed.subjects.length,
  });

  if (parsed.subjects.length === 0) {
    // userListには人が居るのにuserInfosが空 = payload構造が想定と変わった疑い。
    // 判定自体は通っているため例外にはならず、気づかないまま機能停止しうる(実装後レビューで指摘)。
    if (parsed.linkedCount + parsed.waitingCount + parsed.otherCount > 0) {
      console.warn("[collab] userListに人が居るのにsubjectsが空。payload構造の変化を疑う", {
        roomId,
        source: parsed.source,
      });
    }
    return;
  }

  if (!shouldWatchCollabSnapshot(parsed)) return;

  const ownWorkerIndex = tryGetOwnWorkerIndex("collab");
  // sourceRoomId(roomId)単位で直列化する — CLOSE処理(releaseCollabSourceLinksBySource)との
  // 到着順保証のため、enqueue自体をこの同期ハンドラ内(イベント受信直後)で行う
  // (tiktok-collab-source.tsのenqueueForSourceコメント参照)。
  void enqueueForSource(roomId, () => watchDiscoveredRooms(parsed.subjects, ownTiktokHandle, "collab", ownWorkerIndex, roomId));
}

/**
 * 相手roomの監視開始経路をTiktokBattle.opponentWatchへ記録する。書き込み対象の行は
 * recordBattleEvent()が同じ`${roomId}:${battleId}`キーのwrite queueへ先にpersistBattle()を
 * enqueue済みなので、この関数呼び出し時点で行は必ず存在する(persistBattle自体が失敗した
 * 場合のみP2025になり、その場合は警告して捨てる — バトル記録自体の失敗はここでは扱わない)。
 */
async function recordOpponentWatch(
  roomId: string,
  battleId: string,
  entries: OpponentWatch
): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  try {
    await prisma.tiktokBattle.update({
      where: { roomId_battleId: { roomId, battleId } },
      data: { opponentWatch: entries },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2025") {
      console.warn("[battle-watch] opponentWatch書き込み対象のTiktokBattle行が無い", { roomId, battleId });
      return;
    }
    console.error("[battle-watch] opponentWatch書き込みに失敗", { roomId, battleId, err });
  }
}

/**
 * バトル開始(`linkMicBattle` action:4)を検知し、相手roomを監視対象へ入れる補助トリガー。
 *
 * 主トリガーは`recordCollabGroupChange`(コラボ承諾検知)で、これはworker再起動・デプロイの
 * タイミングで既にコラボ済みだった相手を取りこぼす(承諾通知は接続開始前に流れてしまっている
 * ため)。このトリガーはその取りこぼしを埋める補助であり、`recordCollabGroupChange`を置き換える
 * ものではない — 開始通知が最初の観測になる場合、相手roomへの接続完了までの数秒間は
 * ギフトを取りこぼす(captureStatus: "partial")。
 *
 * どちらの経路で監視が始まった(始まらなかった)かはopponentWatchへ記録し、事後に
 * recordCollabGroupChangeの取りこぼし率を検証できるようにする。
 */
function watchBattleOpponents(roomId: string, ownTiktokHandle: string, parsed: ParsedBattle): void {
  if (parsed.phase !== "START") return;

  // opponentWatchはtiktokUid(TiktokBattle.hostProfilesと同じキー)で引けるようにする。
  // 同じdisplayIdへ複数のtiktokUidが束ねられることは無い前提(hostProfilesの生成元と同一)。
  const opponentsByTiktokUid = new Map<string, TiktokRoomSubject>();
  for (const [rawUid, profile] of Object.entries(parsed.hostProfiles)) {
    const tiktokUid = normalizeTikTokUserId(rawUid);
    if (!tiktokUid) continue;
    if (profile.displayId === null) continue;
    const tiktokHandle = normalizeTiktokId(profile.displayId);
    if (tiktokHandle === ownTiktokHandle) continue;
    opponentsByTiktokUid.set(tiktokUid, {
      tiktokUid,
      tiktokHandle,
      nickname: normalizeDisplayValue(profile.nickName),
    });
  }

  if (opponentsByTiktokUid.size === 0) {
    console.warn("[battle-watch] バトル開始だがhostProfilesに相手のdisplayIdが無い", {
      roomId,
      battleId: parsed.battleId,
    });
    return;
  }

  const ownWorkerIndex = tryGetOwnWorkerIndex("battle-watch");

  // sourceRoomId(roomId)単位で直列化する(recordCollabGroupChangeと同じ理由。
  // tiktok-collab-source.tsのenqueueForSourceコメント参照)。
  enqueueForSource(roomId, () =>
    watchDiscoveredRooms([...opponentsByTiktokUid.values()], ownTiktokHandle, "battle_start", ownWorkerIndex, roomId)
  )
    .then((results) => {
      const entries: OpponentWatch = {};
      for (const [tiktokUid, subject] of opponentsByTiktokUid) {
        const tiktokHandle = subject.tiktokHandle;
        const result = results.get(tiktokUid);
        const watchedAt = new Date().toISOString();
        if (!result) {
          entries[tiktokUid] = { tiktokHandle, roomId: null, source: "skipped", watchedAt: null };
        } else if (!result.created) {
          // 既存room。watchSourceが"collab"なら主トリガーで既に拾えていた(理想)。
          // nullならStreamer登録/AgencyWatch/イベント監視由来で元々監視中だった。
          entries[tiktokUid] = {
            tiktokHandle,
            roomId: result.roomId,
            source: result.watchSource ?? "registered",
            watchedAt,
          };
        } else if (ownWorkerIndex === undefined) {
          entries[tiktokUid] = { tiktokHandle, roomId: result.roomId, source: "unassigned", watchedAt };
        } else {
          entries[tiktokUid] = { tiktokHandle, roomId: result.roomId, source: "battle_start", watchedAt };
        }
      }
      // persistBattle(recordBattleEventがrecordBattleEvent内で同じkeyへenqueue済み)の
      // 後に必ず走るよう、同じ write queue keyへ乗せる。これが無いとバトル検知直後の
      // opponentWatch更新がTiktokBattle行のcreateより先に走りP2025になりうる(実測)。
      queueBattleWrite(`${roomId}:${parsed.battleId}`, () =>
        recordOpponentWatch(roomId, parsed.battleId, entries)
      );
    })
    .catch((err) => {
      console.error("[battle-watch] 相手roomの監視対象追加に失敗", { roomId, battleId: parsed.battleId, err });
    });
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
  const conn = createConnection(inst.state.tiktokHandle, deviceId, proxyUrl, eulerSignApiKey, {
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
    if (isBlockedError(err)) {
      void recordBlockedAttempt(roomId);
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
  // アプリ層の配信活動だけを生存とみなす。websocketData/rawData/decodedData/msgDetect/
  // enterRoom/controlMessage は輸送・接続制御なので足さない(hb/ack/プローブでゾンビを隠す)。
  conn.on("member", markAlive);
  conn.on("roomUser", markAlive);
  conn.on("social", markAlive);
  conn.on("like", markAlive);
  conn.on("share", markAlive);
  conn.on("emote", markAlive);
  conn.on("envelope", markAlive);
  conn.on("questionNew", markAlive);
  conn.on("liveIntro", markAlive);
  conn.on("hourlyRank", markAlive);
  conn.on("rankUpdate", markAlive);
  conn.on("rankText", markAlive);
  conn.on("goalUpdate", markAlive);
  conn.on("roomMessage", markAlive);
  conn.on("captionMessage", markAlive);
  conn.on("inRoomBanner", markAlive);
  conn.on("roomPin", markAlive);
  conn.on("pollMessage", markAlive);
  conn.on("barrage", markAlive);
  conn.on("superFan", markAlive);
  conn.on("imDelete", markAlive);
  conn.on("unauthorizedMember", markAlive);
  conn.on("oecLiveShopping", markAlive);
  conn.on("linkMessage", markAlive);
  conn.on("linkMicMethod", markAlive);
  conn.on("linkMicFanTicketMethod", markAlive);
  conn.on("linkMicBattlePunishFinish", markAlive);

  // Like数一覧/Like貢献通知(desktop 5ウィジェット移植)向け。likeCountは「このtickでの増分」
  // であって累計(totalLikeCount)ではない点に注意。tiktokHandleごとに1秒コアレッシングしてから
  // まとめて転送する(理由はLIKE_COALESCE_WINDOW_MSの定義コメント参照)。
  conn.on("like", (data: Record<string, unknown>) => {
    const msgId = resolveMsgId(data);
    if (msgId && !rememberMsgId(inst.recentLikeMsgIds, inst.recentLikeMsgIdOrder, msgId, LIKE_DEDUP_CACHE_SIZE)) {
      return; // プロセス内再送のみ弾く(非金銭的データのためgiftほど厳密にはしない)
    }
    const tiktokUid = normalizeTikTokUserId(data.userId);
    const tiktokHandle = String(data.uniqueId || "");
    const likeCount = Math.max(0, Number(data.likeCount) || 0);
    if (!tiktokUid || likeCount <= 0) return;

    const nickname = String(data.nickname || "");

    // バトル中だけタップ点を集計する。like と armies はどちらもサーバー受信時刻なので、
    // ここで取る時刻がそのまま逆算側の区間割当の基準になる。
    if (inst.tapTally) {
      recordTapProgress(
        roomId,
        inst.tapTally,
        { tiktokUid, tiktokHandle: normalizeDisplayValue(tiktokHandle), nickname: normalizeDisplayValue(nickname) },
        likeCount,
        new Date()
      );
    }

    const existing = inst.pendingLikes.get(tiktokUid);
    const profilePictureUrl = data.profilePictureUrl ? String(data.profilePictureUrl) : null;
    inst.pendingLikes.set(tiktokUid, {
      tiktokUid,
      tiktokHandle: tiktokHandle || existing?.tiktokHandle || "",
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
    const parsed = parseBattleEvent(data);
    // **recordBattleEvent より先に、ここで同期的に**タリーを作る。recordBattleEvent は
    // persistBattle を write queue へ積むだけなので、そこで作ると開始直後の like を取りこぼす。
    syncTapTally(inst, roomId, parsed);
    recordBattleEvent(roomId, inst.state.tiktokHandle, Array.from(inst.subscriberIds), parsed);
    // 補助トリガー: コラボ承諾(linkLayer)の取りこぼし(worker再起動等で承諾より後に接続した場合)を
    // 埋める。主トリガーはlinkLayer側のrecordCollabGroupChange。詳細はwatchBattleOpponents参照。
    // コラボ相手発見のキックはStreamer購読中のroomか特別監視roomからのみ許可する
    // (2026-09-06、連鎖爆発によるEulerStream署名枯渇の再発防止)。
    if (parsed && (inst.subscriberIds.size > 0 || inst.specialWatch)) {
      watchBattleOpponents(roomId, inst.state.tiktokHandle, parsed);
    }
  });
  conn.on("linkMicArmies", (data: unknown) => {
    markAlive();
    const parsed = parseArmiesEvent(data);
    syncTapTally(inst, roomId, parsed);
    recordBattleEvent(roomId, inst.state.tiktokHandle, Array.from(inst.subscriberIds), parsed);
  });

  // コラボ(linkMic本体。バトルでない)の参加・離脱通知。fork独自追加のイベント
  // (shared/tiktok-live-connector/CHANGELOG.md 1.1.0参照)。
  //
  // 2026-09にStreamer登録済みroom限定のガードを一度撤廃したところ、コラボ由来で新規発見した
  // roomが次のreconcileで同じlinkLayerを購読し連鎖的に監視対象が爆発、
  // `MAX_COLLAB_DISCOVERED_ROOMS`(監視中room総数ベース)が403フェイルオーバー休止room
  // (monitoringSuspended:true)を数に入れず実質無効化されていたため、EulerStream署名を
  // 日次上限まで消費する障害になった(2026-09-06)。再発防止として、コラボ相手発見の
  // キックはStreamer購読中のroomか特別監視(specialWatch)roomからのみ許可する。
  // コラボ先のコラボ先(他人)が連鎖的に監視対象へ広がることはない。
  conn.on("linkLayer", (data: unknown) => {
    markAlive();
    if (inst.subscriberIds.size > 0 || inst.specialWatch) {
      recordCollabGroupChange(roomId, inst.state.tiktokHandle, data);
    }
  });

  // コラボセッション自体の解散通知(`WebcastLinkMessage`、fork独自追加。linkLayerとは別イベント
  // ・別enum)。`TYPE_LINKER_CLOSE`を受けたら、このroom(発見元)経由で監視対象へ入れた相手roomの
  // うち、他に有効な発見元が無いものだけ監視を期限切れ方向へ倒す
  // (tiktok-collab-source.ts参照)。誰でも発行しうるイベントではなく、subscriberIds/specialWatch
  // の歯止めをかけない — この room 自身のコラボが終わったことを示すだけで、新規roomの
  // 発見(資源消費)を一切伴わないため連鎖爆発のリスクが無い。
  conn.on("linkMessage", (data: unknown) => {
    markAlive();
    if (isCollabCloseMessage(data)) {
      // sourceRoomId(roomId)単位で直列化する — 発見処理(watchDiscoveredRooms)と同じキューを
      // 使うことで、「検知→CLOSE」の到着順どおりに処理が完了する(code-review Codex round2指摘、
      // tiktok-collab-source.tsのenqueueForSourceコメント参照)。
      enqueueForSource(roomId, () => releaseCollabSourceLinksBySource(roomId)).catch((err) => {
        console.error("[collab] コラボ解散によるリンク解放に失敗", { roomId, err });
      });
    }
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

  // ボーナスミッション区間(2倍/3倍)。taskStart→taskSettle→rewardSettle が同じ行を順に
  // 埋めるので、persistBattle と同じ `${roomId}:${battleId}` キューで直列化する
  // (fire-and-forget のままだと settle の update が create を追い越しうる)。
  conn.on("linkMicBattleTask", (data: unknown) => {
    markAlive();
    const task = parseBattleTaskEvent(data);
    if (!task) return;
    if (task.messageType === BATTLE_TASK_MESSAGE_TYPE.TASK_UPDATE) return;
    const { time: eventTime } = resolveEventTime(data as Record<string, unknown>);
    queueBattleWrite(`${roomId}:${task.battleId}`, () =>
      saveBattleBonusMission(roomId, task, eventTime)
    );
  });

  conn.on("chat", (data: Record<string, unknown>) => {
    markAlive();
    const msgId = resolveMsgId(data);
    if (
      msgId &&
      !rememberMsgId(inst.recentChatMsgIds, inst.recentChatMsgIdOrder, msgId, CHAT_DEDUP_CACHE_SIZE)
    ) {
      console.log("[chat] dedup: duplicate msgId skipped (listener instance)", { roomId, msgId });
      return;
    }

    const { time: eventTime, source: timeSource } = resolveEventTime(data);
    // エモートだけのコメントは comment が空で届く。**空のまま配信すると、モバイルは
    // 画面に何も出せず、読み上げも空文字をVOICEVOXへ渡して例外になる。**
    // comment 自体は生テキストのまま変えず、別フィールドで足す(理由は
    // chat-feed.ts の ChatCommentPayload.emotes のコメント)。
    const emotes = normalizeChatCommentEmotes(data);
    // 端末側の同一性(ボイス割当・重複判定)は tiktokUid だけで決まる。空文字を配ると
    // **全投稿者が1人に畳まれる**ので、uid が取れないイベントは socket 配信ごと捨てる。
    // getUserAttributes() は全イベントに userId を載せるため、ここへ来るのは protobuf レベルの異常。
    const commentTiktokUid = normalizeTikTokUserId(data.userId);
    if (!commentTiktokUid) {
      console.error("[chat] tiktokUid missing — skipping comment", { roomId, msgId });
      return;
    }
    const payload = {
      tiktokUid: commentTiktokUid,
      tiktokHandle: String(data.uniqueId || ""),
      nickname: String(data.nickname || ""),
      profilePictureUrl: data.profilePictureUrl ? String(data.profilePictureUrl) : null,
      comment: String(data.comment || ""),
      receivedAt: eventTime.toISOString(),
      msgId,
      ...(emotes.length > 0 ? { emotes } : {}),
    };
    // 同じ部屋を複数のStreamerが購読している場合、全員分のchatルームへ配信する。
    notifyChatComment(Array.from(inst.subscriberIds), payload);
    // DB保存はsocket配信をブロックしないfire-and-forget(AI傾向分析用の生ログ、30日retention)。
    saveListenerComment(roomId, data, eventTime, timeSource);
  });

  // フォローはモバイルの効果音トリガー専用(集計・保存はしない)。
  // connectorはWebcastSocialMessageのdisplayTextに"follow"が含まれるときだけ
  // このイベントをemitするので、こちら側でdisplayTypeを判定する必要はない。
  conn.on("follow", (data: Record<string, unknown>) => {
    markAlive();
    const { time: eventTime } = resolveEventTime(data);
    const followerTiktokUid = normalizeTikTokUserId(data.userId);
    if (!followerTiktokUid) {
      console.error("[follow] tiktokUid missing — skipping", { roomId });
      return;
    }
    notifyChatFollow(Array.from(inst.subscriberIds), {
      tiktokUid: followerTiktokUid,
      tiktokHandle: String(data.uniqueId || ""),
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
    const giftSenderTiktokUid = normalizeTikTokUserId(data.userId);
    if (giftSenderTiktokUid) {
      const profilePictureUrl = data.profilePictureUrl ? String(data.profilePictureUrl) : null;
      ensureAvatarCached(giftSenderTiktokUid, profilePictureUrl).catch(() => {});
    }

    const isCombo = data.giftType === 1;
    // protobufの既定値"0"はcomboキーにもdedupキーにも使えない(全ユーザー・全ギフトが
    // 同じキーを共有してしまう)。resolveGroupId()がそれをnullへ倒す。
    const groupId = resolveGroupId(data);
    // groupIdが取れないcomboだけ、プロセス内の前回値で追う従来経路に落とす。
    // DBから合計を引く手が無いため(この形のキーはGift行に残らない)。
    const fallbackComboKey = isCombo && !groupId ? `${giftSenderTiktokUid ?? ""}:${data.giftId}` : null;
    const currentRepeat = Math.max(1, Number(data.repeatCount) || 1);
    const { time: eventTime, source: timeSource } = resolveEventTime(data);

    if (timeSource === "fallback") {
      console.warn("[gift] createTime missing/invalid — falling back to server time", {
        roomId,
        tiktokHandle: data.uniqueId,
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
      tiktokHandle: data.uniqueId,
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

    // realtime-sync(ギフト履歴append/貢献ランキングsnapshot)のpushトリガー。
    // saveGift/saveComboGiftのonSavedとして渡し、**DB保存(コミット)成功後にのみ**呼ぶ
    // (Invariants: Server Authoritative — DB保存前のpushは行わない)。
    const onGiftSaved = (giftId: string) => {
      const streamerIds = Array.from(inst.subscriberIds);
      notifyGiftHistorySync(streamerIds, giftId);
      notifyRankingSync(roomId, streamerIds);
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
    //
    // uid が取れないイベントは配信しない。空文字を配ると端末側の同一性キーが潰れて
    // **全送信者が1人に畳まれる**(chat / follow と同じ判断)。
    if (giftSenderTiktokUid) {
      notifyChatGift(Array.from(inst.subscriberIds), {
        tiktokUid: giftSenderTiktokUid,
        tiktokHandle: String(data.uniqueId || ""),
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
    } else {
      console.error("[gift] tiktokUid missing — skipping chat:gift emit", {
        roomId,
        giftId: data.giftId,
      });
    }

    // combo(有効なgroupIdあり): deltaはDBの確定値から引く。プロセスの記憶を持たない。
    // 同じグループの書き込みは1本ずつ流し、DB側のadvisory lockで待つ本数を抑える。
    if (isCombo && groupId) {
      notifyGiftLog({ ...baseLog, action: "combo" });
      void comboWrites.run(`${roomId}:${groupId}`, async () => {
        applySaveResult(
          await saveComboGift(roomId, groupId, data, currentRepeat, eventTime, timeSource, onGiftSaved)
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
        saveGift(roomId, data, delta, eventTime, timeSource, onGiftSaved).then(applySaveResult);
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
        tiktokHandle: data.uniqueId,
        giftId: data.giftId,
        giftName: data.giftName,
      });
      notifyGiftLog({ ...baseLog, action: "non-combo", reason: "missing_orderId_and_groupId" });
      saveGift(roomId, data, currentRepeat, eventTime, timeSource, onGiftSaved).then(applySaveResult);
      return;
    }
    console.log("[gift/non-combo]", { dedupKey, tiktokHandle: data.uniqueId });
    notifyGiftLog({ ...baseLog, action: "non-combo" });
    saveGift(roomId, data, currentRepeat, eventTime, timeSource, onGiftSaved).then(applySaveResult);
  });

  if (conn.clientParams) {
    (conn.clientParams as Record<string, string>).room_id = "";
    (conn.clientParams as Record<string, string>).cursor = "";
  }

  const preCheck = await precheckApiLive(conn, inst.state.tiktokHandle, inst.hostTiktokUid);
  if (!isCurrent() || inst.stopped) {
    // precheckApiLiveのHTTP待機中にstopListener()や次のconnectInstance()で
    // inst.connectionが差し替わった、または意図的に止められた
    // (stopListenerはinst.connectionをnullにしないためisCurrent()だけでは検知できない)。
    return;
  }
  if (preCheck.kind === "offline") {
    console.warn(
      `[listener] @${inst.state.tiktokHandle}: api-live/user/room/ reports offline (status=4) — skipping connect to avoid consuming an Euler signature`
    );
    scheduleReconnect(roomId, "user_offline");
    return;
  }
  if (preCheck.kind === "mismatch") {
    if (isTiktokUidMismatchCheckDisabled()) {
      // TIKTOK_UID_MISMATCH_CHECK_DISABLED(既定=無効化)が効いている間は、hostTiktokUid
      // mismatchによる凍結(markRoomHandleStale)を行わず通常接続へ進む。運用都合による
      // 一時的な全ユーザー向け安全機構OFF。"0"を設定すれば下のelse分岐(従来の凍結)へ戻る。
      console.warn(
        `[listener] @${inst.state.tiktokHandle}: hostTiktokUid mismatch (room=${inst.hostTiktokUid}, api-live=${preCheck.actual}) — TIKTOK_UID_MISMATCH_CHECK_DISABLED, skipping freeze and connecting anyway`
      );
      // mismatchのままfall throughし、下のconnect()処理へ進む(offline/unverifiableは
      // returnしたまま維持する — この分岐だけ意図的にreturnしない)。
    } else {
      // このハンドルの現在の持ち主が登録時と別人。接続すると別人のギフト・コメントが
      // この room へ入るので、再接続もスケジュールせず handleStaleAt で止める。
      console.error(
        `[listener] @${inst.state.tiktokHandle}: hostTiktokUid mismatch (room=${inst.hostTiktokUid}, api-live=${preCheck.actual}) — refusing to connect`
      );
      try {
        await markRoomHandleStale(roomId);
      } catch (err) {
        console.error("[listener] markRoomHandleStale error:", err);
      }
      updateState(
        inst,
        "error",
        FACTS_HANDLE_MISMATCH.message,
        FACTS_HANDLE_MISMATCH,
        "handle_mismatch"
      );
      return;
    }
  }
  if (preCheck.kind === "unverifiable") {
    // 同一性を確認できない間は接続しない(fail-closed)。バックオフ付きで再試行する。
    console.warn(
      `[listener] @${inst.state.tiktokHandle}: could not verify hostTiktokUid — ${preCheck.reason}`
    );
    scheduleReconnect(roomId, "uid_unverifiable");
    return;
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
    if (isBlockedError(err)) {
      void recordBlockedAttempt(roomId);
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
    `[listener] scheduleReconnect: @${inst.state.tiktokHandle} reason=${reason} delay=${delay}ms reconnectFailureCount=${inst.reconnectFailureCount}`
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
  tiktokHandle: string,
  subscriberIds: string[] = [],
  specialWatch = false
) {
  const existing = listeners.get(roomId);
  if (existing && !existing.stopped) {
    applySubscribers(existing, subscriberIds, specialWatch);
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

  // 同一性の正本(hostTiktokUid)は接続開始時に1回だけ読む。以後ハンドルから引き直さない。
  const room = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { hostTiktokUid: true },
  });

  const inst: ListenerInstance = {
    hostTiktokUid: room?.hostTiktokUid ?? null,
    state: {
      roomId,
      tiktokHandle,
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
    // キー(`tiktokHandle:giftId`)はGift行に残らないので元々復元できない。
    pendingCombos: new Map(),
    subscriberIds: new Set(subscriberIds),
    specialWatch,
    stopped: false,
    lastEventAt: Date.now(),
    createdAt: Date.now(),
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
    tapTally: null,
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
function applySubscribers(inst: ListenerInstance, subscriberIds: string[], specialWatch = false) {
  const added = subscriberIds.filter((id) => !inst.subscriberIds.has(id));
  inst.subscriberIds = new Set(subscriberIds);
  inst.specialWatch = specialWatch;
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
  tiktokHandle: string;
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
    tiktokHandle: inst.state.tiktokHandle,
    status: inst.state.status,
    message: inst.state.message,
    updatedAt: inst.state.updatedAt,
    subscriberCount: inst.subscriberIds.size,
    silentForMs: Math.max(0, now - inst.lastEventAt),
    watchdogTriggerCount: inst.watchdogTriggerCount,
    reconnectFailureCount: inst.reconnectFailureCount,
  }));
}

type MyRoom = { id: string; tiktokHandle: string; subscriberIds: string[]; specialWatch: boolean };

// 接続を維持すべき部屋の条件は watched-room-filter.ts の watchedRoomFilter()/
// resolveWatchedRoomFilter() へ集約してある(tiktok-room.ts の上限カウント・
// worker-status.ts の一覧取得も同じ関数を経由する)。ここでは re-export のみ行う。
export { watchedRoomFilter } from "./watched-room-filter";

// 自分(このWorkerプロセス)が担当する部屋(TiktokRoom)だけを返す。
// workerId未割当の部屋は resolveWorkerForRoom() で決定的にハッシュ割当し、
// 自分の担当だった場合のみ含める(複数Workerが同時に処理しても同じ結果になるため競合しない)。
//
// 監視対象の条件は resolveWatchedRoomFilter() が単一の正。
// subscriberIdsはStreamerのみから作る。事務所はsocket.ioのoverlay/chatを購読しないため、
// 監視対象だけの部屋はsubscriberIds空で接続される(ギフト保存はroomId単位なのでデータは貯まる)。
async function getMyRooms(): Promise<MyRoom[]> {
  const { index, count } = getWorkerConfig();

  // assignedとunassignedで基準時刻がずれないよう1回だけ評価する。
  const monitored = await resolveWatchedRoomFilter(new Date());

  // handleStaleAt が立っている room は接続直前の uid 照合で別人と判定済み。監視対象では
  // あり続ける(データは残す)が、接続はしない。解除は tiktokHandle を書き直す経路が行う。
  const assigned = await prisma.tiktokRoom.findMany({
    where: { workerId: index, handleStaleAt: null, ...monitored },
    include: { streamers: { select: { id: true } } },
  });

  const unassigned = await prisma.tiktokRoom.findMany({
    where: { workerId: null, handleStaleAt: null, ...monitored },
    include: { streamers: { select: { id: true } } },
  });
  const claimed: typeof unassigned = [];
  for (const r of unassigned) {
    const workerId = await resolveWorkerForRoom(r.id, count);
    if (workerId === index) claimed.push(r);
  }

  return [...assigned, ...claimed].map((r) => ({
    id: r.id,
    tiktokHandle: r.tiktokHandle,
    subscriberIds: r.streamers.map((s) => s.id),
    specialWatch: r.specialWatch,
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
    console.log(`[listener] starting listener for @${r.tiktokHandle} (room ${r.id}, ${r.subscriberIds.length} subscriber(s))`);
    await startListener(r.id, r.tiktokHandle, r.subscriberIds, r.specialWatch).catch((err) => {
      startFailures++;
      console.error(`[listener] resume failed for ${r.tiktokHandle}:`, err);
    });
    console.log(`[listener] listener state for @${r.tiktokHandle}:`, listeners.get(r.id)?.state.status);
  });

  return { roomCount: rooms.length, startFailures };
}

// ギフトカタログ(gift/list/)を取りにいくための部屋を1つ選ぶ。worker.tsの30秒ループから使う。
//
// **ライブ中かどうかは問わない。** fetchAvailableGifts()はHTTPだけで済み、WS接続を必要としない。
// 「接続成功後」に置くと、担当している配信が全部オフラインのあいだカタログが永久に空のままになり、
// 「まだ貰ったことのないギフトを事前に仕込む」という目的そのものが果たせない。
//
// **地域限定ギフトの可否はegress IPのリージョンだけで決まり、部屋(アカウント)には依存しない**
// (2026-09実測: room_id・device_id・regionパラメータ・Cookie等は全て無関係。日本限定ギフトの
// 取りこぼしは `GIFT_CATALOG_PROXY_URL`(日本プロキシ)で対応済み)ので、部屋は1つで足りる。
//
// 以前は`room_id`付きで複数部屋から配信者固有のコミュニティギフトも収集していたが、
// (1) community_giftはLIVE受信時点で既に日本語名確定(webcast_language非依存、
// `gift-name-verification/REPORT.md`発見2)、(2) `GET /api/mobile/gifts`は`Gift`受信履歴からも
// 名前・画像を拾う和集合設計、という実測により「事前収集の価値は初回受信前のピッカー表示だけ」と
// 判断し2026-09-07に撤去した(未受信の間は自由入力導線で足りる)。
export const GIFT_CATALOG_SOURCE_COUNT = 1;

export async function resolveGiftCatalogSources(): Promise<GiftCatalogSource[]> {
  const rooms = await getMyRooms();

  const sources: GiftCatalogSource[] = [];
  for (const room of rooms.slice(0, GIFT_CATALOG_SOURCE_COUNT)) {
    // ライブ接続と同じdeviceId/proxyを使う。カタログ取得だけ別のegress IPから出さない
    // (日本プロキシ未設定時のフォールバックとしてのみ使われる。tiktok-gift-catalog.ts参照)。
    const deviceId = await getOrCreateDeviceId(room.id);
    const proxyUrl = await resolveProxyForRoom(room.id);
    sources.push({ tiktokHandle: room.tiktokHandle, deviceId, proxyUrl });
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

// 30秒間隔で呼ばれるreconcileループ。以下をすべてここで一貫処理する:
//  - まだ接続していない担当部屋の起動
//  - 購読者(subscriberIds)が変わった部屋の更新(再接続はしない)
//  - 購読者がゼロになった/担当替えで自分の担当でなくなった部屋の切断
//    (tiktokHandle変更による旧部屋の切断・Streamer削除・Worker再編のすべてがこの1箇所を通る)
export async function ensureAllListenersAlive(): Promise<ReconcileResult> {
  const reconcileStartedAt = Date.now();
  const rooms = await getMyRooms();
  const myRoomIds = new Set(rooms.map((r) => r.id));

  let startFailures = 0;
  for (const r of rooms) {
    const existing = listeners.get(r.id);
    if (existing) {
      applySubscribers(existing, r.subscriberIds, r.specialWatch);
      continue;
    }
    console.log(`[listener] ensureAlive: restarting missing listener for @${r.tiktokHandle}`);
    await startListener(r.id, r.tiktokHandle, r.subscriberIds, r.specialWatch).catch((err) => {
      startFailures++;
      console.error(`[listener] ensureAlive failed for ${r.tiktokHandle}:`, err);
    });
  }

  for (const roomId of Array.from(listeners.keys())) {
    if (myRoomIds.has(roomId)) continue;

    const inst = listeners.get(roomId);
    // getMyRooms()のDBスナップショット取得後に作られたlistenerは、このスナップショットに
    // 含まれていないだけで「担当外」と確定したわけではない(コラボ検知の自己割当即キック等、
    // reconcile実行中の並行書き込みが原因でありうる)。次周回でDB上のworkerIdどおり
    // 正規にassignedへ入るため、ここでは切断せず見送るのが安全側。
    // Date.now()の分解能はミリ秒。reconcileStartedAt取得と即キックのstartListenerが
    // 同一msに収まることがある(ローカルDBが高速なテスト環境で実測)ため、境界は安全側
    // (見送る方)に倒して`>=`にする。
    if (inst && inst.createdAt >= reconcileStartedAt) continue;

    console.log(`[listener] ensureAlive: tearing down orphaned/reassigned room ${roomId}`);
    // teardownの失敗は readiness に計上しない。切断できなかった部屋が残るだけで、
    // 担当部屋の受信が止まるわけではないため。
    await stopListener(roomId).catch((err) =>
      console.error(`[listener] ensureAlive teardown failed for ${roomId}:`, err)
    );
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
// app-layer webcast events have arrived, meaning the socket died
// without firing disconnected/streamEnd. Transport frames (hb/ack) and
// msgDetect (uplink probe) do not count.
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
        `[listener] watchdog: @${inst.state.tiktokHandle} silent for ${silentFor}ms but skipping forced reconnect — backoff active (trigger #${inst.watchdogTriggerCount}, retry allowed in ${inst.watchdogBackoffUntil - now}ms)`
      );
      return;
    }

    // 発動: 無応答検知 + バックオフ解除済みのときのみカウントする。
    inst.watchdogTriggerCount += 1;
    const backoffMs = nextWatchdogBackoffMs(inst.watchdogTriggerCount);
    inst.watchdogBackoffUntil = now + backoffMs;

    console.warn(
      `[listener] watchdog: @${inst.state.tiktokHandle} silent for ${silentFor}ms, forcing reconnect (trigger #${inst.watchdogTriggerCount}, next forced reconnect allowed in ${backoffMs}ms if still silent)`
    );
    connectInstance(roomId, "watchdog").catch((err) =>
      console.error(`[listener] watchdog reconnect failed for ${inst.state.tiktokHandle}:`, err)
    );
  });
}
