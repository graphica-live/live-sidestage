import type { BracketMethod } from "@/event/bracket";
import type { BoosterLevel, GloveLevel, RetryLevel, ViolationHandling } from "@/event/match-rules";
import type { EntryMode, EventFormat, EventStatus, TeamPreset, Visibility } from "@/event/validation";

export const FORMAT_LABELS: Record<EventFormat, string> = {
  TOURNAMENT: "バトルトーナメント",
  DIAMOND_RACE: "獲得ダイヤレース",
  DEATHMATCH: "デスマッチ",
};

export const FORMAT_DESCRIPTIONS: Record<EventFormat, string> = {
  TOURNAMENT: "対戦カードを開催日程に割り当て、実際のバトルを自動検知して勝敗を決める",
  DIAMOND_RACE: "イベント期間中の獲得ダイヤを競う",
  DEATHMATCH: "ライフポイント制。マッチ結果に応じてライフが増減する",
};

export const BRACKET_METHOD_LABELS: Record<BracketMethod, string> = {
  STANDARD: "標準シード方式",
  STAGED_BYE: "段階的不戦勝方式",
};

export const BRACKET_METHOD_SUBTITLES: Record<BracketMethod, string> = {
  STANDARD: "プロ大会でよく使われる方式",
  STAGED_BYE: "アマチュア大会でよく使われる方式",
};

export const BRACKET_METHOD_DESCRIPTIONS: Record<BracketMethod, string> = {
  STANDARD:
    "不戦勝を1回戦にまとめ、上位シードへ優先的に割り当てる。参加者が2のべき乗でない場合、1回戦で複数人が同時に不戦勝になることがある(例: 5人なら3人が同時に不戦勝)。上位シードほど早い段階で潰し合わずに済む。",
  STAGED_BYE:
    "各ラウンドの参加者数を半分に分け、奇数なら1人だけ不戦勝にする。同じラウンドで複数人が同時に不戦勝になることはない(例: 5人なら1回戦は1人だけ不戦勝で、標準方式の「3人同時」にはならない)。ただし、同じ人が複数ラウンドにわたって不戦勝になることはある。",
};

export const ENTRY_MODE_LABELS: Record<EntryMode, string> = {
  SOLO: "個人戦",
  TEAM: "チーム戦",
};

export const TEAM_PRESET_LABELS: Record<TeamPreset, string> = {
  GENERIC: "汎用グループ(チーム名を自由に決める)",
  PREFECTURE: "都道府県(日本地図UI)",
};

// 公開範囲がすべてを制御する(下書き概念は無い)。非公開ならオーナー以外誰にも見えない。
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  PUBLIC: "公開",
  PRIVATE: "非公開",
};

// SCHEDULED は「まだ始まっていない」ではなく「開催に向けて準備している」状態を指す
// (この間に参加者登録・トーナメント表の作成をやる)。公開ページも同じ辞書を使うので、
// リスナーにも「開催準備中」と出る。
export const STATUS_LABELS: Record<EventStatus, string> = {
  SCHEDULED: "開催準備中",
  RUNNING: "開催中",
  FINISHED: "終了",
  ARCHIVED: "アーカイブ",
};

export const STATUS_CLASSES: Record<EventStatus, string> = {
  SCHEDULED: "text-yellow-400 bg-yellow-400/10",
  RUNNING: "text-green-400 bg-green-400/10",
  FINISHED: "text-gray-400 bg-white/5",
  ARCHIVED: "text-gray-500 bg-white/5",
};

// 順位表の見出し。獲得ダイヤレース以外は「順位」を名乗らせない —
// トーナメントの勝敗もデスマッチの生存も、獲得ダイヤの多寡では決まらないため。
// (非ダイヤ系でもイベント対象ダイヤは集計する。要件どおり全体リスナーランキングを出すため)
export const STANDING_HEADINGS: Record<EventFormat, string> = {
  DIAMOND_RACE: "順位",
  TOURNAMENT: "獲得ダイヤ",
  DEATHMATCH: "獲得ダイヤ",
};

// 種目のうち、まだ勝敗判定を実装していないものの注記。
// フェーズ4・5で TOURNAMENT と DEATHMATCH を実装したので、現在は空。
export const FORMAT_PENDING_NOTES: Partial<Record<EventFormat, string>> = {};

// 対戦の状態。schema.prisma の EventMatch.status と対応する。
export const MATCH_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "検知待ち",
  LIVE: "バトル中",
  DETECTED: "検知済み",
  NEEDS_REVIEW: "要確認",
  FINISHED: "確定",
  NO_SHOW: "未実施",
  VOID: "無効",
};

export const MATCH_STATUS_CLASSES: Record<string, string> = {
  SCHEDULED: "text-gray-400 bg-white/5",
  // バトル中だけは赤。カード側の赤い発光(.live-glow)と揃えて、表でも一覧でも同じ色で読める。
  LIVE: "text-red-400 bg-red-500/15",
  DETECTED: "text-blue-400 bg-blue-400/10",
  NEEDS_REVIEW: "text-yellow-400 bg-yellow-400/10",
  FINISHED: "text-white bg-white/10",
  NO_SHOW: "text-gray-500 bg-white/5",
  VOID: "text-red-400 bg-red-400/10",
};

// 勝敗をどう決めたか。公開ページでも出して、自動と手動を区別できるようにする。
export const WINNER_DECIDED_BY_LABELS: Record<string, string> = {
  AGGREGATE: "集計",
  MANUAL: "主催者判定",
  DRAW: "引き分け",
  BYE: "不戦勝",
};

// 検知の信頼度。要確認になる理由を主催者に説明するために使う。
export const CONFIDENCE_NOTES: Record<string, string> = {
  exact: "対戦カードどおりの組み合わせを検知した。",
  partial:
    "片側の配信しか観測できなかった。相手が参加者でない配信とのバトルだった可能性があるため、確認してから確定すること。",
};

// analytics 側の TiktokRoom.listenerStatus(src/lib/tiktok-listener.ts の ListenerStatus)。
// 配信していない配信者への接続は失敗して retrying を繰り返すので、
// retrying は異常ではなく「監視はしているが、まだ配信が始まっていない」状態を指す。
export const LISTENER_STATUS_LABELS: Record<string, string> = {
  idle: "起動中",
  connecting: "接続中",
  connected: "配信に接続中",
  retrying: "配信開始を待機中",
  error: "接続エラー",
};

export const LISTENER_STATUS_CLASSES: Record<string, string> = {
  idle: "text-gray-400 bg-white/5",
  connecting: "text-yellow-400 bg-yellow-400/10",
  connected: "text-green-400 bg-green-400/10",
  retrying: "text-gray-400 bg-white/5",
  error: "text-red-400 bg-red-400/10",
};

// 対戦ルール(Event.rules.matchRules)のラベル。
export const GLOVE_LEVEL_LABELS: Record<GloveLevel, string> = {
  NONE: "なし",
  ONE: "1個",
  TWO: "2個",
  THREE: "3個",
  FREE: "自由(フルグローブ可)",
};

export const BOOSTER_LEVEL_LABELS: Record<BoosterLevel, string> = {
  NONE: "なし",
  ONE_EACH: "各1つ",
  TWO_EACH: "各2つ",
  FREE: "自由(フルブースター可)",
};

export const VIOLATION_HANDLING_LABELS: Record<ViolationHandling, string> = {
  DISQUALIFY: "失格",
  REVIEW: "審議",
  WARNING_ONLY: "警告のみ",
};

export const RETRY_LEVEL_LABELS: Record<RetryLevel, string> = {
  NONE: "やり直し無し",
  FIRST_X3: "ファースト3倍まで",
  SPICHA_X3: "スピチャ3倍まで",
};

export { formatJst, toJstInputValue } from "@/event/datetime";
