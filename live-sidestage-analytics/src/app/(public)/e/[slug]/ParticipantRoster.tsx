import type { RosterParticipantDto, RosterTeamDto } from "@/event/public-event";

/**
 * 出場者一覧・プロフィール。既存の順位表(EventResults)とは別の、名前+アイコン+ハンドルだけの
 * カード一覧。アイコンは公開API `/api/public/avatar/<participantId>` を再利用する
 * (TikTokのavatar URLは署名付きで約47時間で失効するため、キャッシュ・再取得の面倒はそちら任せ)。
 */
export function ParticipantRoster({
  participants,
  teams,
  entryMode,
}: {
  participants: RosterParticipantDto[];
  teams: RosterTeamDto[];
  entryMode: string;
}) {
  if (participants.length === 0) {
    return <p className="card text-sm text-gray-500">まだ出場者が登録されていない。</p>;
  }

  if (entryMode !== "TEAM") {
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {participants.map((p) => (
          <ParticipantCard key={p.id} participant={p} />
        ))}
      </ul>
    );
  }

  const byTeam = new Map<string, RosterParticipantDto[]>();
  const unassigned: RosterParticipantDto[] = [];
  for (const p of participants) {
    if (!p.teamId) {
      unassigned.push(p);
      continue;
    }
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }

  return (
    <div className="grid gap-5">
      {teams.map((team) => {
        const members = byTeam.get(team.id) ?? [];
        if (members.length === 0) return null;
        return (
          <div key={team.id}>
            <div className="mb-2 flex items-center gap-2">
              {team.colorHex && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: team.colorHex }}
                  aria-hidden
                />
              )}
              <span className="text-sm font-medium text-white">{team.name}</span>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {members.map((p) => (
                <ParticipantCard key={p.id} participant={p} />
              ))}
            </ul>
          </div>
        );
      })}

      {unassigned.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-gray-400">未所属</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {unassigned.map((p) => (
              <ParticipantCard key={p.id} participant={p} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ParticipantCard({ participant }: { participant: RosterParticipantDto }) {
  return (
    <li>
      <a
        href={`https://www.tiktok.com/@${participant.tiktokId}`}
        target="_blank"
        rel="noreferrer"
        className="card flex items-center gap-2 hover:border-brand/40"
      >
        {/* 外部(TikTok CDN)経由の画像なのでnext/imageの最適化は通さない。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/public/avatar/${participant.id}`}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full bg-white/5 object-cover"
          loading="lazy"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{participant.displayName}</p>
          <p className="truncate font-mono text-xs text-gray-500">@{participant.tiktokId}</p>
        </div>
      </a>
    </li>
  );
}
