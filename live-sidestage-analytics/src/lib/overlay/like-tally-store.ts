// Like(いいね)の日次累計を保持するプロセス内インメモリストア。**サーバー専用**。
// 旧LikeTallyテーブル(Postgres)の置き換え。当日分しか読まれない(過去日を読む経路が
// 元から存在しない)ため、DB永続化は不要と判断した。webはRailway上numReplicas:1固定の
// 単一プロセスであることが前提(スケールアウトすると集計が分裂する。増やす場合は
// このストアをDBまたは外部キャッシュへ戻すこと)。
//
// Next.jsのルートハンドラはモジュールインスタンスがバンドルごとに分かれ得るため、
// emit.ts(__io / __overlayEmitThrottle)と同じくglobalThis経由で共有する。
//
// プロセス再起動・デプロイ切替のたびに当日分の累計が消える(旧DB版には無かった挙動)。
// 同一リスナーが同日中に同じマイルストーンを跨いで通知が再発火し得るが、単発イベントの
// ログを保持しない方針(データ量爆発回避)である以上は受容する。

import { jstDateKey } from "./day-key";

type Entry = {
  dayKey: string;
  nickname: string;
  profileImageUrl: string | null;
  totalLikes: number;
};

// roomごとに「最後にstaleエントリを掃除した日」を持ち、日付が変わった後の最初のアクセスで
// 前日以前のエントリを一括削除する。これが無いと、二度と来ないリスナー(uniqueId)のエントリが
// プロセス寿命いっぱい溜まり続ける(再訪時の上書き以外に消える経路が無いため)。
type RoomState = {
  entries: Map<string, Entry>;
  lastPrunedDayKey: string;
};

const g = global as typeof globalThis & {
  __likeTallyStore?: Map<string, RoomState>;
};

const store = (g.__likeTallyStore ??= new Map<string, RoomState>());

function getRoomState(roomId: string, today: string): RoomState {
  let state = store.get(roomId);
  if (!state) {
    state = { entries: new Map(), lastPrunedDayKey: today };
    store.set(roomId, state);
    return state;
  }
  if (state.lastPrunedDayKey !== today) {
    for (const [uniqueId, entry] of state.entries) {
      if (entry.dayKey !== today) state.entries.delete(uniqueId);
    }
    state.lastPrunedDayKey = today;
  }
  return state;
}

export function incrementLike(
  roomId: string,
  uniqueId: string,
  nickname: string,
  profileImageUrl: string | null,
  likeCount: number
): { dayKey: string; previousTotal: number; newTotal: number } {
  const dayKey = jstDateKey();
  const { entries } = getRoomState(roomId, dayKey);
  const existing = entries.get(uniqueId);
  const previousTotal = existing?.dayKey === dayKey ? existing.totalLikes : 0;
  const newTotal = previousTotal + likeCount;
  entries.set(uniqueId, {
    dayKey,
    // nickname/profileImageUrlが空文字のイベントで既存の良い値を上書きしないよう、非空のときだけ更新。
    nickname: nickname || existing?.nickname || "",
    profileImageUrl: profileImageUrl || existing?.profileImageUrl || null,
    totalLikes: newTotal,
  });
  return { dayKey, previousTotal, newTotal };
}

export function getTopEntries(
  roomId: string,
  maxEntries: number
): { uniqueId: string; nickname: string; profileImageUrl: string | null; totalLikes: number }[] {
  const today = jstDateKey();
  const { entries } = getRoomState(roomId, today);
  const rows: { uniqueId: string; nickname: string; profileImageUrl: string | null; totalLikes: number }[] = [];
  for (const [uniqueId, entry] of entries) {
    if (entry.dayKey !== today || entry.totalLikes <= 0) continue;
    rows.push({ uniqueId, nickname: entry.nickname, profileImageUrl: entry.profileImageUrl, totalLikes: entry.totalLikes });
  }
  rows.sort((a, b) => b.totalLikes - a.totalLikes);
  return rows.slice(0, maxEntries);
}

/** 配信者の手動リセットボタン用。当日分のみ消す(過去日はgetRoomStateの遅延pruneに任せる)。 */
export function resetRoomToday(roomId: string): void {
  const today = jstDateKey();
  const { entries } = getRoomState(roomId, today);
  for (const [uniqueId, entry] of entries) {
    if (entry.dayKey === today) entries.delete(uniqueId);
  }
}

export function __resetLikeTallyStoreForTest(): void {
  store.clear();
}

/** prune(stale削除)が実際にMapから消しているかをテストで確認するための内部状態アクセス。 */
export function __getEntryCountForTest(roomId: string): number {
  return store.get(roomId)?.entries.size ?? 0;
}
