import { prisma } from "./prisma";
import {
  aggregateGiftsBySegment,
  fetchListenerProfiles,
  type DbClient,
  type ListenerProfile,
} from "./analytics-db";
import {
  assignRanks,
  buildRateSegments,
  formatScaledPoints,
  scaledPoints,
  type MultiplierInput,
  type RateSegment,
  type TimeRange,
} from "./scoring";
import { detectMatches, ingestBattles, loadBattleRangesByRoom } from "./battles";
import { resolveMatchResults } from "./match-results";

// イベントの集計本体。
//
// 増分ではなく**全期間の再集計**をする。バトル区間が後から確定する(フェーズ4)ため、
// 一度計算したポイントが遡って変わりうるので、増分カーソルでは修正できない。
//
// 集計結果はスナップショット(EventContribution / EventStanding)として置き換える。
// 読み手が中間状態を見ないよう、削除と作成は同一トランザクションで行う。

/** イベント終了後もこの時間だけ集計を続ける(終了間際のギフトの取りこぼし対策)。 */
export const AGGREGATE_GRACE_MS = 60 * 60 * 1000;

/**
 * scope ごとに保存するリスナー貢献の上限。
 *
 * 全リスナーを保存すると (参加者数 + チーム数 + 1) × リスナー数の行を10秒ごとに
 * 入れ替えることになる。ランキングは上位しか表示しないので、ポイント上位だけを残す。
 * 順位表(EventStanding)の合計値は**切り捨て前の全ギフト**から計算しているので、
 * ここで切っても合計や順位には影響しない。
 */
export const MAX_CONTRIBUTION_ROWS = 200;

/**
 * 集計対象イベントの選択条件。
 *
 * RUNNING への遷移が明示的な開始になる。終了については status を見ない —
 * 主催者は開催中いつでも FINISHED にできるので、それを打ち切り条件にすると
 * 直前のギフトや遅れて保存されたギフトが永久に反映されないため。
 * 代わりに「締切(endAt + 猶予)後の最終集計が済んだか」を `finalizedAt` で持つ。
 */
export function aggregationWindow(now: Date) {
  return {
    status: { in: ["RUNNING", "FINISHED"] },
    startAt: { lte: now },
    finalizedAt: null,
  };
}

/** 締切。これを過ぎてからの集計が最終集計になる。 */
export function aggregationDeadline(endAt: Date): Date {
  return new Date(endAt.getTime() + AGGREGATE_GRACE_MS);
}

/**
 * イベントIDから advisory lock のキーを作る(FNV-1a 64bit)。
 *
 * Postgres の bigint は符号付きなので範囲へ落とす。ハッシュが衝突しても、
 * 別イベントの集計が一巡待たされるだけで結果は壊れない。
 */
export function advisoryLockKey(eventId: string): bigint {
  const MASK = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < eventId.length; i++) {
    hash = ((hash ^ BigInt(eventId.charCodeAt(i))) * 0x100000001b3n) & MASK;
  }
  return hash >= 1n << 63n ? hash - (1n << 64n) : hash;
}

type Bucket = { diamonds: bigint; points: bigint; giftCount: number };

function addTo(map: Map<string, Bucket>, key: string, add: Bucket) {
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...add });
    return;
  }
  cur.diamonds += add.diamonds;
  cur.points += add.points;
  cur.giftCount += add.giftCount;
}

function topRows(map: Map<string, Bucket>): [string, Bucket][] {
  const rows = [...map.entries()];
  rows.sort((a, b) => {
    if (a[1].points !== b[1].points) return a[1].points > b[1].points ? -1 : 1;
    if (a[1].diamonds !== b[1].diamonds) return a[1].diamonds > b[1].diamonds ? -1 : 1;
    return 0;
  });
  return rows.slice(0, MAX_CONTRIBUTION_ROWS);
}

function sumOf(map: Map<string, Bucket>): { diamonds: bigint; points: bigint } {
  let diamonds = 0n;
  let points = 0n;
  for (const b of map.values()) {
    diamonds += b.diamonds;
    points += b.points;
  }
  return { diamonds, points };
}

export type AggregateResult =
  | { status: "skipped"; reason: "locked" | "no-participants" }
  | { status: "done"; elapsedMs: number; contributionRows: number; standingRows: number };

/**
 * 1イベントを再集計する。
 *
 * advisory lock はトランザクション単位(`pg_try_advisory_xact_lock`)で取る。
 * セッション単位のロックだと、Prisma のコネクションプールで取得と解放が
 * 別の接続になりうるため使わない。
 */
export async function aggregateEvent(eventId: string): Promise<AggregateResult> {
  const startedAt = Date.now();

  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${advisoryLockKey(eventId)}::bigint) AS locked
      `;
      if (!locked) {
        return { status: "skipped", reason: "locked" } as const;
      }

      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { id: true, format: true, startAt: true, endAt: true },
      });
      if (!event) {
        return { status: "skipped", reason: "no-participants" } as const;
      }

      const [participants, multipliers, teams] = await Promise.all([
        tx.eventParticipant.findMany({
          where: { eventId, status: "ACTIVE" },
          select: { id: true, roomId: true, teamId: true },
        }),
        tx.eventMultiplier.findMany({
          where: { eventId },
          select: { kind: true, factor: true, startAt: true, endAt: true },
        }),
        // ギフトが1件もないチームも順位表に0点で載せるため、参加者の所属からではなく
        // チーム一覧そのものを引く。
        tx.eventTeam.findMany({ where: { eventId }, select: { id: true } }),
      ]);

      const now = new Date();
      const finalizedAt = now >= aggregationDeadline(event.endAt) ? now : undefined;

      if (participants.length === 0) {
        // 参加者がいなくなったらスナップショットも空にする(古い順位を残さない)。
        await tx.eventContribution.deleteMany({ where: { eventId } });
        await tx.eventStanding.deleteMany({ where: { eventId } });
        await tx.event.update({
          where: { id: eventId },
          data: { lastAggregatedAt: now, aggregateMs: Date.now() - startedAt, finalizedAt },
        });
        return { status: "skipped", reason: "no-participants" } as const;
      }

      const roomToParticipant = new Map(participants.map((p) => [p.roomId, p]));
      const roomIds = participants.map((p) => p.roomId);
      const multiplierInputs: MultiplierInput[] = multipliers.map((m) => ({
        kind: m.kind,
        factor: m.factor.toString(),
        startAt: m.startAt,
        endAt: m.endAt,
      }));

      // バトルの取り込み・照合・勝敗確定。倍率区間がこれに依存するので集計本体より先に
      // 済ませる(同じトランザクション内なので読み手に中間状態は見えない)。
      let battleRanges = new Map<string, TimeRange[]>();
      if (event.format === "TOURNAMENT" || event.format === "DEATHMATCH") {
        await ingestBattles(tx as DbClient, {
          roomIds,
          start: event.startAt,
          end: event.endAt,
        });
        await detectMatches(tx as DbClient, { eventId, now });
        await resolveMatchResults(tx as DbClient, {
          eventId,
          multipliers: multiplierInputs,
          now,
        });
        battleRanges = await loadBattleRangesByRoom(tx as DbClient, eventId);
      }

      // BATTLE 倍率が設定されていなければ、バトル区間で分けても倍率は変わらない。
      // 参加者ごとのクエリは高くつくので、その場合は全員まとめて1本で集約する。
      const battleFactorInUse =
        multiplierInputs.some((m) => m.kind === "BATTLE") && battleRanges.size > 0;

      const perRoomRooms = battleFactorInUse
        ? roomIds.filter((id) => (battleRanges.get(id)?.length ?? 0) > 0)
        : [];
      const perRoomSet = new Set(perRoomRooms);
      const commonRooms = roomIds.filter((id) => !perRoomSet.has(id));

      const byParticipant = new Map<string, Map<string, Bucket>>();
      const byTeam = new Map<string, Map<string, Bucket>>();
      const byEvent = new Map<string, Bucket>();

      const consume = (row: { roomId: string; uniqueId: string; diamonds: bigint; giftCount: number }, segment: RateSegment) => {
        const participant = roomToParticipant.get(row.roomId);
        if (!participant) return; // 集計中に参加者が外れた場合

        const bucket: Bucket = {
          diamonds: row.diamonds,
          points: scaledPoints(row.diamonds, segment.scaledFactor),
          giftCount: row.giftCount,
        };

        let perParticipant = byParticipant.get(participant.id);
        if (!perParticipant) {
          perParticipant = new Map();
          byParticipant.set(participant.id, perParticipant);
        }
        addTo(perParticipant, row.uniqueId, bucket);
        addTo(byEvent, row.uniqueId, bucket);

        if (participant.teamId) {
          let perTeam = byTeam.get(participant.teamId);
          if (!perTeam) {
            perTeam = new Map();
            byTeam.set(participant.teamId, perTeam);
          }
          addTo(perTeam, row.uniqueId, bucket);
        }
      };

      const aggregateRooms = async (rooms: string[], ranges: TimeRange[]) => {
        if (rooms.length === 0) return;
        const segments = buildRateSegments({
          eventStart: event.startAt,
          eventEnd: event.endAt,
          multipliers: multiplierInputs,
          battleRanges: ranges,
        });
        for (const segment of segments) {
          const rows = await aggregateGiftsBySegment(tx as DbClient, {
            roomIds: rooms,
            start: segment.start,
            end: segment.end,
          });
          for (const row of rows) consume(row, segment);
        }
      };

      // バトル区間を持たない参加者はまとめて1本。持つ参加者だけ個別に回す。
      await aggregateRooms(commonRooms, []);
      for (const roomId of perRoomRooms) {
        await aggregateRooms([roomId], battleRanges.get(roomId) ?? []);
      }

      const profiles = await fetchListenerProfiles(tx as DbClient, {
        roomIds,
        start: event.startAt,
        end: event.endAt,
      });

      const contributions = [
        ...buildContributionRows(eventId, "EVENT", "", byEvent, profiles),
        ...[...byParticipant].flatMap(([id, map]) =>
          buildContributionRows(eventId, "PARTICIPANT", id, map, profiles)
        ),
        ...[...byTeam].flatMap(([id, map]) =>
          buildContributionRows(eventId, "TEAM", id, map, profiles)
        ),
      ];

      // 順位表は切り捨て前の全ギフトから作る。
      // ギフトが1件もない参加者・チームも0点で載せる(順位表から消えないように)。
      const participantTotals = participants.map((p) => ({
        subjectId: p.id,
        ...sumOf(byParticipant.get(p.id) ?? new Map()),
      }));
      const teamTotals = teams.map((t) => ({
        subjectId: t.id,
        ...sumOf(byTeam.get(t.id) ?? new Map()),
      }));

      const standings = [
        ...assignRanks(participantTotals).map((r) => ({
          eventId,
          subjectType: "PARTICIPANT",
          subjectId: r.subjectId,
          diamonds: r.diamonds,
          points: formatScaledPoints(r.points),
          rank: r.rank,
        })),
        ...assignRanks(teamTotals).map((r) => ({
          eventId,
          subjectType: "TEAM",
          subjectId: r.subjectId,
          diamonds: r.diamonds,
          points: formatScaledPoints(r.points),
          rank: r.rank,
        })),
      ];

      await tx.eventContribution.deleteMany({ where: { eventId } });
      if (contributions.length > 0) {
        await tx.eventContribution.createMany({ data: contributions });
      }
      await tx.eventStanding.deleteMany({ where: { eventId } });
      if (standings.length > 0) {
        await tx.eventStanding.createMany({ data: standings });
      }

      const elapsedMs = Date.now() - startedAt;
      await tx.event.update({
        where: { id: eventId },
        data: { lastAggregatedAt: now, aggregateMs: elapsedMs, finalizedAt },
      });

      return {
        status: "done",
        elapsedMs,
        contributionRows: contributions.length,
        standingRows: standings.length,
      } as const;
    },
    // 全期間再集計 + スナップショット入れ替えを1トランザクションで行うので、
    // Prisma 既定の5秒では足りない。SLO(10秒)を超えた場合の検知は aggregateMs で行う。
    { timeout: 120_000, maxWait: 10_000 }
  );
}

function buildContributionRows(
  eventId: string,
  scope: string,
  scopeId: string,
  map: Map<string, Bucket>,
  profiles: Map<string, ListenerProfile>
) {
  return topRows(map).map(([uniqueId, bucket]) => ({
    eventId,
    scope,
    scopeId,
    listenerUniqueId: uniqueId,
    nickname: profiles.get(uniqueId)?.nickname ?? uniqueId,
    profileImageUrl: profiles.get(uniqueId)?.profileImageUrl ?? null,
    diamonds: bucket.diamonds,
    points: formatScaledPoints(bucket.points),
    giftCount: bucket.giftCount,
  }));
}

/** 集計対象のイベントを1周ぶん処理する。ワーカーから呼ぶ。 */
export async function aggregateDueEvents(now: Date = new Date()): Promise<{
  processed: number;
  skipped: number;
  failed: number;
  totalMs: number;
}> {
  const startedAt = Date.now();
  const due = await prisma.event.findMany({
    where: aggregationWindow(now),
    select: { id: true, title: true },
    orderBy: { lastAggregatedAt: { sort: "asc", nulls: "first" } },
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of due) {
    try {
      const result = await aggregateEvent(event.id);
      if (result.status === "done") processed++;
      else skipped++;
    } catch (err) {
      // 1イベントの失敗で全体を止めない。
      failed++;
      console.error(`[aggregate] ${event.title}(${event.id}) の集計に失敗:`, err);
    }
  }

  return { processed, skipped, failed, totalMs: Date.now() - startedAt };
}
