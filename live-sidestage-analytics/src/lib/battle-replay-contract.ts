// バトル再生のサーバー↔クライアント契約。
//
// **このファイルは import を持たない。型と定数だけを置く**(`src/lib/overlay/contracts.ts` と同じ規約)。
// サーバー(`src/lib/battle-replay.ts`)とクライアント(再生UI)が両方これを読むため、
// prisma や next を引くと再生UIのバンドルにサーバーコードが混入する。
//
// バトル履歴の既存型(`src/lib/battle-history.ts` と `src/components/analytics/battle-types.tsx`)は
// サーバー・クライアントで手書きの二重定義になっているが、**再生では意図的にその方式を採らない**。
// ペイロードが辞書参照(インデックス)を含み、片側だけずれると無言で別人のギフトを描画するため。
// 既存2ファイルの統合は別課題として残す。

/** ペイロードの形。互換性を壊す変更を入れたら上げる。クライアントは不一致なら再生を拒否する。 */
export const BATTLE_REPLAY_VERSION = 1;

/** 1回のレスポンスに載せるギフトイベントの上限。超えたら時系列の先頭から残す。 */
export const MAX_REPLAY_EVENTS = 3000;

/** ギフトバーが画面に留まる時間。クライアントの描画にのみ使う。 */
export const REPLAY_BAR_LIFETIME_MS = 4000;

/** 再生できない理由。文言はクライアント側の辞書で持つ(サーバーは理由コードだけ返す)。 */
export type ReplayUnavailableReason =
  /** バトルがまだ確定していない(BattleHistory 行が無い)。 */
  | "not_finalized"
  /** スコア点が足りない。armies を取り逃した・旧room削除で消えた等。 */
  | "no_score_points"
  /** 窓の長さが想定外(30秒未満 / 30分超)。再生の時間軸が作れない。 */
  | "window_invalid"
  /** 参加者が足りない(2人未満、または自陣営が特定できない)。 */
  | "participants_invalid";

export type ReplayAvailability = { available: boolean; reason: ReplayUnavailableReason | null };

/** 再生可否の判定に使う最小の入力。DBの行そのものではなく、必要な列だけを写して渡す。 */
export type ReplayEligibility = {
  /** BattleHistory 行が存在するか。**false のときは他の値を見ない。** */
  finalized: boolean;
  scorePointCount: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  participantCount: number;
  hasSelfParticipant: boolean;
};

export const MIN_REPLAY_SCORE_POINTS = 2;
export const MIN_REPLAY_WINDOW_MS = 30_000;
export const MAX_REPLAY_WINDOW_MS = 30 * 60_000;

/** 画面下部の帯。`opening` は逆算、`bonus_*` は TikTok が配信してきた実測値。 */
export type ReplaySegmentKind = "opening" | "bonus_mission" | "bonus_reward";

export type ReplaySegment = {
  kind: ReplaySegmentKind;
  startMs: number;
  endMs: number;
  /** 倍率。判定不能なら null。 */
  multiplier: number | null;
  label: string;
  /**
   * 残り秒数を出してよいか。**区間の終了が実測できたときだけ true。**
   * 逆算の仮定値(OPENING_WINDOW_MS)から残り時間を作って見せない。
   */
  showCountdown: boolean;
  /** `opening` のみ。`measured` だけが赤帯の対象で、`inferred` はチップ止まり。 */
  confidence?: "measured" | "inferred";
};

export type ReplayParticipant = {
  anchorId: string;
  displayName: string;
  /** TikTokハンドル。**公開バリアントでは常に null。** */
  uniqueId: string | null;
  avatarUrl: string | null;
};

export type ReplayTeam = {
  index: number;
  isSelf: boolean;
  /** TikTok公式の最終スコア。未観測なら null。 */
  officialScore: string | null;
  participants: ReplayParticipant[];
};

/** ギフト送信者の辞書。`giftEvents[].s` がこの配列の添字を指す。 */
export type ReplaySender = {
  /** TikTokハンドル。**公開バリアントでは常に null**(リスナー個人のプロフィールへ直リンクできるため)。 */
  u: string | null;
  /** ニックネーム。 */
  n: string;
  /** アバターURL(署名付き・数時間で失効)。 */
  a: string | null;
};

/** ギフトの辞書。`giftEvents[].g` がこの配列の添字を指す。 */
export type ReplayGift = {
  /** TikTok の giftId。 */
  id: number;
  /** 表示名(`labelJa` 優先、無ければ確定時のギフト名スナップショット)。 */
  n: string;
  img: string | null;
};

/** スコア点。`a` は `teams[].participants` を平坦化した anchor 配列の添字。 */
export type ReplayScorePoint = {
  /** windowStart からの経過ms。 */
  t: number;
  a: number;
  /** 累積スコア。桁が大きいので文字列。 */
  s: string;
};

export type ReplayGiftEvent = {
  /** windowStart からの経過ms。負にはならない。 */
  t: number;
  /** 受け取った配信者。anchor 配列の添字。 */
  a: number;
  /** 送信者。`senders` の添字。 */
  s: number;
  /** ギフト。`gifts` の添字。 */
  g: number;
  /** 連打数。 */
  c: number;
  /** ダイヤ合計。 */
  d: number;
};

export type BattleReplayPayload = {
  version: typeof BATTLE_REPLAY_VERSION;
  battleId: string;
  /** ISO文字列。バトル開始時刻(= windowStart)。 */
  startedAt: string;
  durationMs: number;
  status: string;
  teams: ReplayTeam[];
  /** `teams[].participants` を陣営順・位置順に平坦化した anchorId 配列。添字の正本。 */
  anchors: string[];
  senders: ReplaySender[];
  gifts: ReplayGift[];
  scorePoints: ReplayScorePoint[];
  giftEvents: ReplayGiftEvent[];
  segments: ReplaySegment[];
  /**
   * 相手陣営のギフト明細が1件も無いか。**再生は可能**で、画面に注記を出すためだけに使う
   * (相手room未監視のバトルが多数を占める)。
   */
  opponentGiftsMissing: boolean;
  /** `MAX_REPLAY_EVENTS` を超えて後半を落としたか。 */
  truncated: boolean;
};
