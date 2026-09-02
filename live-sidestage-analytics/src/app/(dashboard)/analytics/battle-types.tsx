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

/** 左右split表示(vs)1メンバー分。1vs1・チーム戦の両方で使う共通の形。 */
export interface BattleParticipant {
  anchorId: string;
  tiktokId: string | null;
  displayId: string | null;
  nickName: string | null;
  avatarUrl: string | null;
}

export interface BattleListItem {
  battleId: string;
  startedAt: string;
  status: BattleStatus;
  opponent: BattleOpponent | null;
  /**
   * 左右split表示用。1vs1・チーム戦(2vs2/1vs3等)でhostTeamsが解決できた場合のみどちらも非null。
   * 対戦相手不明・チーム未解決のmulti・soloの場合はどちらもnull(既存のopponentでフォールバック表示する)。
   */
  selfTeam: BattleParticipant[] | null;
  opponentTeam: BattleParticipant[] | null;
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

export function tiktokProfileUrl(uniqueId: string): string {
  return `https://www.tiktok.com/@${encodeURIComponent(uniqueId)}`;
}

export function Avatar({
  src,
  alt,
  size = "md",
}: {
  src: string | null;
  alt: string;
  size?: "sm" | "md";
}) {
  const dimClass = size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={`${dimClass} rounded-full object-cover shrink-0 bg-panel`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div
      className={`${dimClass} rounded-full bg-surface border border-border flex items-center justify-center text-muted shrink-0`}
    >
      {alt.charAt(0).toUpperCase()}
    </div>
  );
}

/**
 * 対戦相手セルの左右split表示。「vs」を境に左=自チーム/右=相手チーム。
 * 親が`flex items-center`なので、1人チーム(単一行)・2〜3人チーム(縦並びスタック)
 * どちらも自然に上下中央揃えになる(相手側の高さが違っても揃う)。
 */
export function BattleVersus({
  selfTeam,
  opponentTeam,
  size,
}: {
  selfTeam: BattleParticipant[];
  opponentTeam: BattleParticipant[];
  size: "sm" | "md";
}) {
  return (
    <div className="flex items-center gap-2">
      <BattleTeamColumn team={selfTeam} size={size} />
      <span className={`shrink-0 text-muted ${size === "sm" ? "text-xs" : "text-sm"}`}>vs</span>
      <BattleTeamColumn team={opponentTeam} size={size} />
    </div>
  );
}

function BattleTeamColumn({ team, size }: { team: BattleParticipant[]; size: "sm" | "md" }) {
  const nameMaxWidth = size === "sm" ? "max-w-[100px]" : "max-w-[160px]";
  const nameTextClass = size === "sm" ? "text-xs" : "text-sm";
  return (
    <div className="flex flex-col items-center justify-center gap-1 min-w-0">
      {team.map((p) => {
        const label = p.nickName ?? (p.displayId ? `@${p.displayId}` : null) ?? p.tiktokId ?? "?";
        return (
          <div key={p.anchorId} className="flex items-center gap-1.5 min-w-0">
            <Avatar src={p.avatarUrl} alt={label} size={size} />
            <div className={`min-w-0 ${nameMaxWidth}`}>
              <div className={`font-medium truncate ${nameTextClass}`}>{label}</div>
              {team.length === 1 && (p.displayId || p.tiktokId) && (
                <div className="text-[10px] text-muted truncate">@{p.displayId ?? p.tiktokId}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
