import type { Server as SocketIOServer } from "socket.io";

export const CHAT_EVENT_SCHEMA_VERSION = 1;

export interface ChatCommentPayload {
  streamerId: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  comment: string;
  receivedAt: string; // ISO8601
  // TikTok側が払い出すWebcastChatMessage.common.msgId。欠落時はnull。
  // connectorのsimplifyObject()がcommonを平坦化するため、listener側では data.msgId として読む
  // (tiktok-listener.ts の resolveMsgId 参照)。
  msgId: string | null;
}

/**
 * Workerがギフトtickごとに送ってくる生の値。
 *
 * Workerは「何回鳴らすべきか」を一切判断しない。デプロイ時に新旧Workerが同じ部屋へ
 * 並走すると、各Workerが自前のpendingCombos(しかも新Worker側はDBから復元した
 * 少し古い累計)からdeltaを計算してしまい、同じtickに対して違うdeltaが生まれるため。
 * 累計値だけを送り、単一のWebプロセスでdeltaへ変換する。
 */
export interface ChatGiftInput {
  streamerId: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  giftName: string; // listener側でtrim+小文字化済み(desktopのトリガー判定と揃える)
  giftId: string | null;
  diamondCount: number;
  repeatCount: number; // このtick時点の累計連打数
  isCombo: boolean;
  repeatEnd: boolean;
  groupId: string | null;
  orderId: string | null;
  msgId: string | null;
  occurredAt: string; // TikTokのcreateTime由来
  receivedAt: string; // Workerがイベントを受けたサーバー時刻
}

export interface ChatGiftPayload {
  schemaVersion: number;
  streamerId: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  giftName: string;
  giftId: string | null;
  diamondCount: number;
  repeatCount: number;
  /** 今回のtickで新たに増えた回数。クライアントはこの回数だけ鳴らす。 */
  delta: number;
  /** diamondCount * repeatCount。desktopのtotalGiftsと同義で、minCoins判定に使う累計側の値。 */
  totalCoins: number;
  /** Web側の状態が失われた後の復帰tickならtrue(deltaを1に切り詰めている)。 */
  baselineReset: boolean;
  isCombo: boolean;
  repeatEnd: boolean;
  /** groupId由来のコンボ識別子。groupIdが無いギフトではnull。 */
  comboId: string | null;
  occurredAt: string;
  receivedAt: string;
}

export interface ChatFollowInput {
  streamerId: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  occurredAt: string;
  receivedAt: string;
  msgId: string | null;
}

export interface ChatFollowPayload extends ChatFollowInput {
  schemaVersion: number;
}

interface ChatDedupState {
  ids: Set<string>;
  order: string[];
}

interface ComboState {
  /** これまでに観測した最大のrepeatCount。 */
  maxRepeat: number;
  /** repeatEndを観測済みか(tombstone)。 */
  ended: boolean;
  lastSeenAt: number;
}

// tiktok-listener.ts側のCHAT_DEDUP_CACHE_SIZEと同じ理由(ack未達によるTikTok側の
// 再送バッチが、盛り上がっている配信では直近のコメント数百件を超えて遅れて届くことがある)で
// 十分な余裕を持たせる。
const CHAT_COMMENT_DEDUP_CACHE_SIZE = 3000;

// コンボは通常数十秒で終わる。スライディング(最終更新起点)で10分あれば実害はない。
// 生成時起点にすると長いコンボの途中でエントリが消え、次のtickでmaxRepeatが0に戻って
// deltaが累計値まで跳ね上がる。
const COMBO_STATE_TTL_MS = 10 * 60 * 1000;
const COMBO_STATE_MAX_ENTRIES = 5000;

type DedupNamespace = "comment" | "follow" | "gift";

// server.js が生成した socket.io サーバーへの参照。overlay.ts と同じ global 経由パターン。
const g = global as typeof globalThis & {
  __io?: SocketIOServer;
  __chatCommentDedup?: Map<string, ChatDedupState>;
  __chatComboState?: Map<string, ComboState>;
};
if (!g.__chatCommentDedup) g.__chatCommentDedup = new Map();
if (!g.__chatComboState) g.__chatComboState = new Map();
const dedupByStreamer = g.__chatCommentDedup;
const comboStates = g.__chatComboState;

function isIoReady(): boolean {
  return Boolean(g.__io);
}

// tiktok-listener.ts側のrecentChatMsgIdsはWorkerプロセス(ListenerInstance)単位のdedupのため、
// デプロイ時のゼロダウンタイム切替(旧Workerが生きたまま新Workerが同じ部屋へ接続する重複期間、
// worker.tsのreadiness signal参照)では新旧2プロセスがそれぞれ別インスタンスとして同一msgIdを
// 「初見」と判定し、両方がここまで転送してくる。socket.ioへの配信が実際に集約される
// このWebプロセス側(全Worker/in-processチャットの単一合流点)でmsgIdベースに再dedupすることで、
// プロセスをまたいだ二重配信を防ぐ。
//
// FIFOはnamespaceごとに分ける。1本の共有FIFOにすると、コメントの大量流入がfollow/giftの
// エントリを押し出してしまい、そちらのdedupがすり抜ける。
function isDuplicateChatEvent(streamerId: string, namespace: DedupNamespace, id: string): boolean {
  const key = `${namespace}:${streamerId}`;
  let state = dedupByStreamer.get(key);
  if (!state) {
    state = { ids: new Set(), order: [] };
    dedupByStreamer.set(key, state);
  }
  if (state.ids.has(id)) {
    console.log("[chat] dedup: duplicate skipped (web process)", { streamerId, namespace, id });
    return true;
  }
  state.ids.add(id);
  state.order.push(id);
  if (state.order.length > CHAT_COMMENT_DEDUP_CACHE_SIZE) {
    const oldest = state.order.shift();
    if (oldest !== undefined) state.ids.delete(oldest);
  }
  return false;
}

function sweepComboStates(now: number): void {
  const entries = Array.from(comboStates.entries());
  for (const [key, state] of entries) {
    if (now - state.lastSeenAt > COMBO_STATE_TTL_MS) comboStates.delete(key);
  }
  if (comboStates.size <= COMBO_STATE_MAX_ENTRIES) return;

  // 上限超過分は最終更新が古い順に捨てる。
  const byAge = Array.from(comboStates.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  const excess = comboStates.size - COMBO_STATE_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) comboStates.delete(byAge[i][0]);
}

interface ComboDecision {
  emit: boolean;
  delta: number;
  baselineReset: boolean;
}

/**
 * コンボtickをdeltaへ変換する。単調増加チェックがdedupを兼ねる。
 *
 * 状態を失った直後(TTL掃除・件数上限・Webの再起動/クラッシュ・Web先行デプロイ)は
 * maxRepeatが無いまま累計の途中tickが届く。そこでdelta=repeatCountにすると復帰した瞬間に
 * 何十回も鳴ってしまうため、delta=1へ切り詰めてbaselineResetを立てる。
 * 効果音はbest-effortなので、鳴らしすぎるより鳴らし損ねる側へ倒す。
 */
function decideComboDelta(streamerId: string, comboId: string, repeatCount: number, repeatEnd: boolean): ComboDecision {
  const now = Date.now();
  sweepComboStates(now);

  const key = `${streamerId}:${comboId}`;
  const state = comboStates.get(key);

  if (!state) {
    comboStates.set(key, { maxRepeat: repeatCount, ended: repeatEnd, lastSeenAt: now });
    const baselineReset = repeatCount > 1;
    return { emit: true, delta: 1, baselineReset };
  }

  state.lastSeenAt = now;

  // repeatEndを観測した後のtickは、値の大小に関わらず再発火させない。
  // maxRepeatを保持するだけだと、より大きいrepeatCountが遅れて届いたときに素通りしてしまう。
  if (state.ended) {
    console.log("[gift] combo already ended — skipping late tick", { streamerId, comboId, repeatCount });
    return { emit: false, delta: 0, baselineReset: false };
  }

  if (repeatCount <= state.maxRepeat) {
    // 再送・逆順到着。
    return { emit: false, delta: 0, baselineReset: false };
  }

  const delta = repeatCount - state.maxRepeat;
  state.maxRepeat = repeatCount;
  if (repeatEnd) state.ended = true;
  return { emit: true, delta, baselineReset: false };
}

// Android/iOSアプリ向けのコメント配信。overlayと違いDB保存・間引きは行わず、
// 受信したチャットイベントをそのまま `chat:${streamerId}` ルームへ流す。
//
// 戻り値false = socket.ioサーバー未初期化。呼び出し側(内部API)は503を返す。
// dedup/combo状態を進める前に判定するので、失敗したイベントは再送で拾い直せる。
export async function emitChatComment(payload: ChatCommentPayload): Promise<boolean> {
  if (!isIoReady()) return false;
  if (payload.msgId && isDuplicateChatEvent(payload.streamerId, "comment", payload.msgId)) {
    return true;
  }
  g.__io?.to(`chat:${payload.streamerId}`).emit("chat:comment", payload);
  return true;
}

export async function emitChatFollow(input: ChatFollowInput): Promise<boolean> {
  if (!isIoReady()) return false;
  if (input.msgId && isDuplicateChatEvent(input.streamerId, "follow", input.msgId)) {
    return true;
  }
  const payload: ChatFollowPayload = { schemaVersion: CHAT_EVENT_SCHEMA_VERSION, ...input };
  g.__io?.to(`chat:${input.streamerId}`).emit("chat:follow", payload);
  return true;
}

/**
 * ギフトtickをモバイル向けに配信する。deltaの導出とdedupをここへ集約している。
 *
 * ギフトの種類ごとに扱いが違う:
 * - groupIdのあるコンボ: 累計の単調増加チェックでdeltaを出す(decideComboDelta)
 * - groupIdの無いコンボ: 永続的なcombo IDを作れない(uniqueId:giftIdは次のコンボで再利用され
 *   衝突する)。repeatEndのtickだけをmsgId/orderIdでdedupして1回だけ流す
 * - 非コンボ: orderId/groupIdでdedupして1回だけ流す。desktopも非コンボは
 *   repeatCountに関係なく1回しか再生しない
 */
export async function emitChatGift(input: ChatGiftInput): Promise<boolean> {
  if (!isIoReady()) return false;

  const repeatCount = Math.max(1, Math.floor(input.repeatCount) || 1);
  const diamondCount = Math.max(0, Math.floor(input.diamondCount) || 0);
  const comboId = input.isCombo ? input.groupId : null;

  let delta: number;
  let baselineReset = false;

  if (input.isCombo && comboId) {
    const decision = decideComboDelta(input.streamerId, comboId, repeatCount, input.repeatEnd);
    if (!decision.emit) return true;
    delta = decision.delta;
    baselineReset = decision.baselineReset;
  } else if (input.isCombo) {
    // groupId欠落コンボ: 最終tickのみ。途中tickは捨てる(識別子が無く累計を追えないため)。
    if (!input.repeatEnd) return true;
    const dedupKey = input.msgId ?? input.orderId;
    if (dedupKey && isDuplicateChatEvent(input.streamerId, "gift", dedupKey)) return true;
    delta = 1;
  } else {
    const dedupKey = input.orderId ?? input.groupId;
    // orderId/groupIdが両方欠落するケースがある(一部のgiftType=2ギフト)。
    // dedupキーが無いだけでギフト自体は届いているので、捨てずにそのまま流す。
    if (dedupKey && isDuplicateChatEvent(input.streamerId, "gift", dedupKey)) return true;
    delta = 1;
  }

  const payload: ChatGiftPayload = {
    schemaVersion: CHAT_EVENT_SCHEMA_VERSION,
    streamerId: input.streamerId,
    uniqueId: input.uniqueId,
    nickname: input.nickname,
    profilePictureUrl: input.profilePictureUrl,
    giftName: input.giftName,
    giftId: input.giftId,
    diamondCount,
    repeatCount,
    delta,
    totalCoins: diamondCount * repeatCount,
    baselineReset,
    isCombo: input.isCombo,
    repeatEnd: input.repeatEnd,
    comboId,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
  };

  g.__io?.to(`chat:${input.streamerId}`).emit("chat:gift", payload);
  return true;
}

/** テスト用: プロセスローカルなdedup/combo状態を初期化する。 */
export function __resetChatFeedStateForTest(): void {
  dedupByStreamer.clear();
  comboStates.clear();
}
