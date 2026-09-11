/**
 * リアルタイム同期のversion・epoch管理。
 *
 * 貢献ランキング・ギフト履歴・バトル履歴の各機能について、
 * (streamerId, syncKind)単位でepoch・versionをプロセス内メモリで
 * 管理する。参考実装: src/lib/chat-feed.ts の comboStates、
 * src/lib/overlay/emit.ts の emitThrottle と同じ global パターンを踏襲。
 */

/**
 * syncKindの許可値。3機能に限定し、任意文字列を拒否することで
 * Mapキーが際限なく増えるリスクを排除する。
 */
export type SyncKind = "ranking" | "gift-history" | "battle-history";

/**
 * version・epochの組。
 */
export interface VersionState {
  /** Full reset単位。ランキングのみ使用。他のsyncKindは常に0。 */
  epoch: number;
  /** (streamerId, syncKind, epoch)単位の単調増加番号 */
  version: number;
}

/**
 * bootId込みのversion状態。SyncEnvelope生成時にそのまま使える形。
 */
export interface VersionStateWithBootId extends VersionState {
  /** webプロセスの起動識別子。プロセス再起動のたびに変わる。 */
  bootId: string;
}

/**
 * Next.jsのモジュール再生成をまたいで生存させるため、
 * chat-feed.tsの comboStates と同じ global 経由パターンを使う。
 */
const g = global as typeof globalThis & {
  __versionStore?: Map<string, VersionState>;
  __versionStoreBootId?: string;
};

if (!g.__versionStore) g.__versionStore = new Map();
if (!g.__versionStoreBootId) g.__versionStoreBootId = crypto.randomUUID();
const versionStore = g.__versionStore;

/**
 * (streamerId, syncKind)単位のversion・epochの状態を保持する
 * Mapのキーを構築する。
 *
 * @param syncKind 同期方式
 * @param streamerId 配信者ID
 * @returns "${syncKind}:${streamerId}" の形のキー
 */
function makeVersionKey(syncKind: SyncKind, streamerId: string): string {
  return `${syncKind}:${streamerId}`;
}

/**
 * (streamerId, syncKind)の現在のstate、またはデフォルト値を取得する。
 * 既存エントリがなければ { epoch: 0, version: 0 } を返す。
 */
function getState(syncKind: SyncKind, streamerId: string): VersionState {
  const key = makeVersionKey(syncKind, streamerId);
  return versionStore.get(key) || { epoch: 0, version: 0 };
}

/**
 * 次のversionを払い出し、内部カウンタを +1 する。
 *
 * 同一の (syncKind, streamerId) に対して呼ぶたびに version が 1 ずつ増える。
 * epoch bump によってリセットされるまで単調増加を続ける。
 *
 * @param syncKind 同期方式
 * @param streamerId 配信者ID
 * @returns 払い出し直後のversion・epoch
 */
export function nextVersion(syncKind: SyncKind, streamerId: string): VersionStateWithBootId {
  // 同期関数として実装する: このMapの読み取り(getState)と書き込み(set)の間に
  // awaitを挟まないことで、Node.jsのシングルスレッド実行を利用し、同一キーへの
  // 並行呼び出しでもversionが重複しないことを保証する。
  const key = makeVersionKey(syncKind, streamerId);
  const current = getState(syncKind, streamerId);

  const next: VersionState = {
    epoch: current.epoch,
    version: current.version + 1,
  };

  versionStore.set(key, next);
  return { ...next, bootId: g.__versionStoreBootId! };
}

/**
 * epochを +1 してversionを 0 にリセット。
 *
 * 日付変更など「過去データをすべて破棄して再開」するタイミングで呼ぶ。
 * (現状、ランキング機能のみが使う想定)
 *
 * @param syncKind 同期方式
 * @param streamerId 配信者ID
 * @returns bump直後のepoch・version(常に0)
 */
export function bumpEpoch(syncKind: SyncKind, streamerId: string): VersionStateWithBootId {
  const key = makeVersionKey(syncKind, streamerId);
  const current = getState(syncKind, streamerId);

  const next: VersionState = {
    epoch: current.epoch + 1,
    version: 0,
  };

  versionStore.set(key, next);
  return { ...next, bootId: g.__versionStoreBootId! };
}

/**
 * 現在のversion・epochを取得する。(状態を更新しない)
 *
 * @param syncKind 同期方式
 * @param streamerId 配信者ID
 * @returns 現在のversion・epoch、またはデフォルト値 { epoch: 0, version: 0 }
 */
export function currentVersion(syncKind: SyncKind, streamerId: string): VersionStateWithBootId {
  return { ...getState(syncKind, streamerId), bootId: g.__versionStoreBootId! };
}

/**
 * 現在のbootIdを取得する。webプロセス起動ごとに1回だけ生成される値。
 */
export function currentBootId(): string {
  return g.__versionStoreBootId!;
}

/**
 * テスト用: プロセスローカルなversion・epoch状態を初期化する。
 *
 * テスト間で状態が持ち越されるのを防ぐため、各テストの最初か
 * beforeEach で呼ぶ。命名規則は既存の __resetChatFeedStateForTest に準ずる。
 */
export function __resetVersionStoreForTest(): void {
  versionStore.clear();
}

/**
 * テスト用: bootIdを再生成する。プロセス再起動相当の状況
 * (bootId不一致によるクライアント側の強制resync)を単体テストで再現するために使う。
 */
export function __regenerateBootIdForTest(): void {
  g.__versionStoreBootId = crypto.randomUUID();
}
