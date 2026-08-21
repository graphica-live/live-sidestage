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

export { formatJst, toJstInputValue } from "@/lib/datetime";
