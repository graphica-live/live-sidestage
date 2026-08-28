// page.tsx(Next.jsのpage moduleはdefault export等の限られたexportしか許可しない)と
// BattleDetailModal.tsxで共有する型・コンポーネント。

export type BattleStatus = "live" | "finished" | "cut_short" | "unknown";

export interface BattleOpponent {
  tiktokId: string | null;
  displayId: string | null;
  nickName: string | null;
  avatarUrl: string | null;
  count: number;
}

export interface BattleListItem {
  battleId: string;
  startedAt: string;
  status: BattleStatus;
  opponent: BattleOpponent | null;
  selfScore: string | null;
  opponentScore: string | null;
  selfTotalDiamonds: number;
}

export interface BattleContributor {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: string;
}

export interface BattleContributorsData {
  contributors: BattleContributor[];
  status: BattleStatus;
}

export const BATTLE_STATUS_LABELS: Record<BattleStatus, string> = {
  live: "進行中",
  finished: "終了",
  cut_short: "中断",
  unknown: "判定不可",
};

export function Avatar({ src, alt }: { src: string | null; alt: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className="w-8 h-8 rounded-full object-cover shrink-0 bg-panel"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-gray-500 text-xs shrink-0">
      {alt.charAt(0).toUpperCase()}
    </div>
  );
}
