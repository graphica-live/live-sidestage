import type { EntryMode, EventFormat, EventStatus, TeamPreset, Visibility } from "@/lib/validation";

export const FORMAT_LABELS: Record<EventFormat, string> = {
  TOURNAMENT: "バトルトーナメント",
  DIAMOND_RACE: "獲得ダイヤレース",
  DEATHMATCH: "デスマッチ",
};

export const FORMAT_DESCRIPTIONS: Record<EventFormat, string> = {
  TOURNAMENT: "対戦カードと時間枠を組み、実際のバトルを自動検知して勝敗を決める",
  DIAMOND_RACE: "イベント期間中の獲得ダイヤを競う",
  DEATHMATCH: "ライフポイント制。マッチ結果に応じてライフが増減する",
};

export const ENTRY_MODE_LABELS: Record<EntryMode, string> = {
  SOLO: "個人戦",
  TEAM: "チーム戦",
};

export const TEAM_PRESET_LABELS: Record<TeamPreset, string> = {
  GENERIC: "汎用グループ(チーム名を自由に決める)",
  PREFECTURE: "都道府県(日本地図UI)",
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  PUBLIC: "公開",
  UNLISTED: "限定公開(URLを知っている人だけ)",
  PRIVATE: "非公開",
};

export const STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: "下書き",
  SCHEDULED: "開催予定",
  RUNNING: "開催中",
  FINISHED: "終了",
  ARCHIVED: "アーカイブ",
};

export const STATUS_CLASSES: Record<EventStatus, string> = {
  DRAFT: "text-gray-400 bg-white/5",
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
export const FORMAT_PENDING_NOTES: Partial<Record<EventFormat, string>> = {
  TOURNAMENT:
    "対戦の自動検知とトーナメント表は準備中。現在は期間中に獲得したダイヤだけを集計している。",
  DEATHMATCH:
    "ライフポイントの増減は準備中。現在は期間中に獲得したダイヤだけを集計している。",
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

export { formatJst, toJstInputValue } from "@/lib/datetime";
