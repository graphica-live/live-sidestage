import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { queryBattleContributors, type BattleContributorDetail, type BattleTeamContributors } from "@/lib/battle-history";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";

const buildUnregisteredResponse = () => NextResponse.json({ error: "Not found" }, { status: 404 });

const sanitizeContributors = (list: BattleContributorDetail[]): BattleContributorDetail[] =>
  list.map((c) => ({ ...c, profileImageUrl: sanitizeAvatarUrl(c.profileImageUrl) }));

const sanitizeTeams = (teams: BattleTeamContributors[] | null): BattleTeamContributors[] | null =>
  teams === null
    ? null
    : teams.map((team) => ({
        ...team,
        contributors: sanitizeContributors(team.contributors),
        participants: team.participants.map((p) => ({
          ...p,
          contributors: sanitizeContributors(p.contributors),
        })),
      }));

export async function GET(req: NextRequest, { params }: { params: { battleId: string } }) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const result = await queryBattleContributors(ctx.streamer.roomId, ctx.streamer.id, params.battleId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(
    {
      contributors: sanitizeContributors(result.contributors),
      status: result.status,
      teams: sanitizeTeams(result.teams),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
