import type { Server as SocketIOServer } from "socket.io";

export const CHAT_EVENT_SCHEMA_VERSION = 1;

/** コメントに含まれるエモート(絵文字スタンプ)1件。 */
export interface ChatCommentEmote {
  emoteId: string;
  /** 取得できなければnull。**idさえあれば「エモート」と表示できる**ので、URL欠落で捨てない。 */
  imageUrl: string | null;
  /** 本文中の挿入位置。無ければnull(末尾扱い)。画像表示を作るときに使う。 */
  placeInComment: number | null;
}

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
  /**
   * エモート。**無いときはフィールドごと省く**(空配列を送らない)。
   *
   * **`comment` には絶対に混ぜない。** 既に世に出ているアプリは `comment` を
   * そのまま表示し、そのままVOICEVOXへ渡す。desktop([comment-feed.js]の
   * `buildCommentFeedTextWithInlineEmotes`)は本文にトークンを差し込む方式だが、
   * あれはサーバーとUIが必ず同時に更新されるローカル完結アプリだから成立する。
   * こちらで同じことをすると**旧アプリの画面に生のトークンが出て、音読される**。
   *
   * 表示文字列の組み立ては端末側の責務(`Comment.displayText`)。「エモート」という
   * 語はUIの関心事で、ここに置くと文言を変えるだけでサーバーのデプロイが要る。
   *
   * optionalな追加なので [CHAT_EVENT_SCHEMA_VERSION] は上げない。そもそも
   * `chat:comment` はモバイル側が `requireSchemaVersion: false` で受けており、
   * 旧アプリはこのフィールドも schemaVersion も読まずに無視する。
   */
  emotes?: ChatCommentEmote[];
}

/** 1コメントあたりのエモート上限。TikTokのUI上これを超える現実的な入力は無い。 */
const MAX_CHAT_COMMENT_EMOTES = 10;
/** id / URL の長さ上限。内部APIの他フィールドと揃えてある。 */
const MAX_CHAT_COMMENT_EMOTE_FIELD_LENGTH = 500;

function firstNonEmptyString(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed.slice(0, MAX_CHAT_COMMENT_EMOTE_FIELD_LENGTH);
  }
  return null;
}

/**
 * connectorが渡す chat イベントの生データからエモートを取り出す。
 *
 * **入れ子の形が一定しない。** connectorのsimplifyObjectがどこまで平坦化するかは
 * バージョンとイベント種別で変わるため、候補を順に試す(desktopの
 * `getCommentFeedEmoteImageUrl` が6通り試しているのと同じ理由)。1つの形だけを
 * 見に行くと、**例外もログも出ないまま静かに全件落ちる**。
 *
 * `chat:comment` の検証点はこの関数だけ。内部API `/api/internal/gift-event` は
 * chatEvent を素通しする設計(旧Workerの複数形を受け続けるため)なので、
 * 上限とサニタイズをここへ寄せている。
 */
export function normalizeChatCommentEmotes(data: Record<string, unknown>): ChatCommentEmote[] {
  const raw = Array.isArray(data.emotes) ? data.emotes : [];
  const result: ChatCommentEmote[] = [];

  for (const item of raw) {
    if (result.length >= MAX_CHAT_COMMENT_EMOTES) break;
    if (typeof item !== "object" || item === null) continue;

    const entry = item as Record<string, unknown>;
    const nested = (entry.emote ?? {}) as Record<string, unknown>;
    const image = (entry.image ?? {}) as Record<string, unknown>;
    const nestedImage = (nested.image ?? {}) as Record<string, unknown>;

    const emoteId = firstNonEmptyString([entry.emoteId, nested.emoteId]);
    if (!emoteId) continue;

    const imageUrl = firstNonEmptyString([
      entry.emoteImageUrl,
      image.imageUrl,
      nestedImage.imageUrl,
      Array.isArray(image.urlList) ? image.urlList[0] : undefined,
      Array.isArray(nestedImage.urlList) ? nestedImage.urlList[0] : undefined,
    ]);

    const place = entry.placeInComment;

    result.push({
      emoteId,
      // httpsに限る。将来クライアントが実際に画像を取りに行くため、平文URLを渡さない。
      imageUrl: imageUrl && imageUrl.startsWith("https:") ? imageUrl : null,
      placeInComment: typeof place === "number" && Number.isInteger(place) && place >= 0 ? place : null,
    });
  }

  return result;
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

/**
 * Worker が持っている TikTok Live 接続の状態。モバイルの「配信中 / 配信開始待ち」表示用。
 *
 * コメント・ギフトと違い**状態通知**なので dedup しない(重複しても冪等)。代わりに
 * 順序が要る。端末は `(roomId, revision)` で新旧を判定し、壁時計を比較しない。
 *
 * - `roomId`: TikTok ID を変更した直後の最大60秒間、旧 room の Worker が同じ
 *   `chat:{streamerId}` へ送れてしまう。端末が旧 room の状態を採らないための識別子
 * - `revision`: JSON に bigint を載せられないので10進文字列。単調増加(fencing と同じ値)
 */
export interface ChatListenerInput {
  streamerId: string;
  roomId: string;
  revision: string;
  status: string;
  activity: string;
  health: string;
  reason: string | null;
  message: string;
  updatedAt: string;
}

export interface ChatListenerPayload extends ChatListenerInput {
  schemaVersion: number;
}

/**
 * バトル終了の即時表示用。**トリガー通知に徹する**(ギフト/フォローと違い集計値を
 * 積まない) — 端末は受信をきっかけにバトル履歴タブを再取得する(貢献/ギフト履歴の
 * 自動更新と同じ `_load({silent})` 方式)。details(スコアやホスト情報)を積まないのは、
 * それらをそのまま表示する経路を作ると「サーバーの通知内容 = 表示内容」という別の
 * 契約が増え、REST側(queryBattles)との二重管理になるため。
 *
 * `startedAt` は必須(端末側が「バトルの開始日」で期間判定するため。日付は「今日」
 * ではなく開始日基準 — 深夜0時をまたぐバトルが「今日」判定だと漏れる)。
 */
export interface ChatBattleInput {
  streamerId: string;
  battleId: string;
  startedAt: string; // ISO8601
  endedAt: string; // ISO8601。通知するのはEND後のみなので必ず取れている
  receivedAt: string; // ISO8601
}

export interface ChatBattlePayload extends ChatBattleInput {
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

  // タイマーのギフト連動(desktop 5ウィジェット移植)。emitChatGiftは「コンボのdedupと
  // tickごとの正味増分(delta)」をWebプロセス単独で確定させる唯一の場所であり、
  // タイマー側もこの「正しく1回だけ数えられた増分」を必要とするためここへ相乗りする。
  // 動的importにしてあるのは (a) chat-feed.test.ts はprismaモックなしの純unitテストで、
  // 静的importするとテストのたびに実DB接続試行が走るため (b) overlay/timer.server.ts が
  // server-kinds.ts経由でこのファイルに戻ってくる循環を避けるため。
  import("./overlay/timer.server")
    .then(({ applyTimerGiftRule }) =>
      applyTimerGiftRule({ streamerId: input.streamerId, giftName: input.giftName, units: delta })
    )
    .catch((err) => console.error("[timer] gift rule apply error:", err));

  return true;
}

/**
 * listener の状態を配信する。**dedup しない** — 状態通知なので重複しても冪等で、
 * むしろ「後から購読した端末へ現在値を送り直す」ために同じ値の再送が要る。
 */
export async function emitChatListener(input: ChatListenerInput): Promise<boolean> {
  if (!isIoReady()) return false;
  const payload: ChatListenerPayload = { schemaVersion: CHAT_EVENT_SCHEMA_VERSION, ...input };
  g.__io?.to(`chat:${input.streamerId}`).emit("chat:listener", payload);
  return true;
}

/**
 * バトル終了(または終了後のスコア確定)を配信する。**dedupしない**
 * (`chat:listener` と同じ流儀。端末側の再取得は冪等なreloadなので、二重発火があっても
 * 表示が壊れることはない。端末は自前のdebounceで畳む)。
 */
export async function emitChatBattle(input: ChatBattleInput): Promise<boolean> {
  if (!isIoReady()) return false;
  const payload: ChatBattlePayload = { schemaVersion: CHAT_EVENT_SCHEMA_VERSION, ...input };
  g.__io?.to(`chat:${input.streamerId}`).emit("chat:battle", payload);
  return true;
}

/** テスト用: プロセスローカルなdedup/combo状態を初期化する。 */
export function __resetChatFeedStateForTest(): void {
  dedupByStreamer.clear();
  comboStates.clear();
}
