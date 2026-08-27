import {
  aggregateGiftsBySegment,
  fetchListenerProfiles,
  type DbClient,
  type ListenerProfile,
} from "./analytics-db";
import { resolveMatchSpans, type MatchSpanResult } from "./match-spans";
import { resolveEventWindows, type EventWindow } from "./sessions";
import {
  buildRateSegments,
  FACTOR_SCALE,
  formatScaledPoints,
  scaledPoints,
  type MultiplierInput,
} from "./scoring";

// 対戦1件のリスナー貢献を、**枠(出場している配信枠 = EventParticipant)ごと**に集計する。
//
// `match-results.ts` の `scoreSides()` と同じ区間・同じ倍率で数えるが、集計キーが
// `sideId` ではなく `participantId × uniqueId` になる。2vs2 なら1サイドが2枠に割れる。
//
// **DB へは書かない。** 主催者がモーダルを開いたときだけ走るオンデマンド集計で、
// `EventContribution` のスナップショット(10秒ごとの全置換)には載せていない。
// 対戦ごとに scope を作ると 32人トーナメントで 31対戦 × 2枠 = 62 scope を毎周
// 入れ替えることになり、閲覧頻度に対して割に合わないため。
//
// **バトルスコア(TikTok の hostScore)はここでは出せない。** あれは配信者(anchorId)
// 単位でしか配信されず、リスナー別の内訳が payload に存在しない。サイド合計としてなら
// `battle-score.ts` が出せるので、UI 側が `MatchSlotRow.sideIndex` で突き合わせる。

/**
 * 結果が確定していない対戦。数字は出すが「参考値」と明示する。
 *
 * `canShowTiktokScore()` は同じ状態を弾いているが、あちらは「カード上の対戦相手とは
 * 別の戦いのスコアが載りうる」ため。こちらは**自分の room に入ったギフトの内訳**なので、
 * 相手が誰であれ枠の数字自体は正しい。むしろ AMBIGUOUS を手動確定するとき、
 * 貢献者の顔ぶれはどのバトルだったかを判断する材料になる。
 */
const UNCONFIRMED_STATUSES = new Set(["NEEDS_REVIEW", "VOID"]);

/** 集計中の1リスナーぶん。`points` は100倍された内部値(`aggregate.ts` と同じ規約)。 */
export type Bucket = { diamonds: bigint; points: bigint; giftCount: number };

export type MatchListenerRow = {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  /** BigInt を JSON へ載せられないので文字列 */
  diamonds: string;
  /** 倍率適用後のポイント。Decimal 文字列 */
  points: string;
  giftCount: number;
};

export type MatchSlotRow = {
  participantId: string;
  displayName: string;
  tiktokId: string;
  /** どちらのサイドの枠か。列の並び順と、バトルスコアの突き合わせに使う */
  sideIndex: number;
  diamonds: string;
  points: string;
  giftCount: number;
  listeners: MatchListenerRow[];
};

export type MatchContributionResult =
  | Exclude<MatchSpanResult, { status: "ok" }>
  | {
      status: "ok";
      /** 実際に集計した区間(日程で切ったあと)。ISO 文字列 */
      spans: { start: string; end: string }[];
      provisional: boolean;
      unconfirmed: boolean;
      hasMultiplier: boolean;
      slots: MatchSlotRow[];
    };

export type SlotInput = {
  participantId: string;
  displayName: string;
  tiktokId: string;
  sideIndex: number;
};

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

/** ポイント降順 → ダイヤ降順 → uniqueId 昇順。順位表(`assignRanks`)と同じ基準に揃える。 */
function compareListeners(a: [string, Bucket], b: [string, Bucket]): number {
  if (a[1].points !== b[1].points) return a[1].points > b[1].points ? -1 : 1;
  if (a[1].diamonds !== b[1].diamonds) return a[1].diamonds > b[1].diamonds ? -1 : 1;
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/**
 * 集計結果を枠ごとの行に組み立てる。**純粋関数**(DB に触らない)。
 *
 * - 並びは `sideIndex` 昇順 → 渡された順(参加者の登録順)。`Array.sort` は安定なので保たれる
 * - リスナーは打ち切らず全件返す(表示側がスクロールで無制限に見せる)
 * - ギフトが1件も無い枠も 0 で必ず載せる(出場している以上、列が消えると横並びが崩れる)
 */
export function buildSlotRows(
  slots: SlotInput[],
  byParticipant: Map<string, Map<string, Bucket>>,
  profiles: Map<string, ListenerProfile>
): MatchSlotRow[] {
  const seen = new Set<string>();
  const out: MatchSlotRow[] = [];

  for (const slot of [...slots].sort((a, b) => a.sideIndex - b.sideIndex)) {
    // 同じ参加者が両サイドに入るのは `single-match.ts` の DUPLICATE_SUBJECT が拒否済み
    // だが、二重計上は数字が黙って倍になるので、ここでも落としておく。
    if (seen.has(slot.participantId)) continue;
    seen.add(slot.participantId);

    const rows = [...(byParticipant.get(slot.participantId) ?? new Map<string, Bucket>()).entries()];
    rows.sort(compareListeners);

    let diamonds = 0n;
    let points = 0n;
    let giftCount = 0;
    for (const [, bucket] of rows) {
      diamonds += bucket.diamonds;
      points += bucket.points;
      giftCount += bucket.giftCount;
    }

    out.push({
      participantId: slot.participantId,
      displayName: slot.displayName,
      tiktokId: slot.tiktokId,
      sideIndex: slot.sideIndex,
      diamonds: diamonds.toString(),
      points: formatScaledPoints(points),
      giftCount,
      listeners: rows.map(([uniqueId, bucket]) => ({
        uniqueId,
        // 名前を解決できないリスナーは uniqueId をそのまま出す(`buildContributionRows` と同じ)。
        nickname: profiles.get(uniqueId)?.nickname ?? uniqueId,
        profileImageUrl: profiles.get(uniqueId)?.profileImageUrl ?? null,
        diamonds: bucket.diamonds.toString(),
        points: formatScaledPoints(bucket.points),
        giftCount: bucket.giftCount,
      })),
    });
  }

  return out;
}

/**
 * 対戦1件の枠ごとリスナー貢献を引く。対戦が無ければ null。
 *
 * **トランザクションも advisory lock も取らない。** 表示専用の読み取りで、
 * 読んでいる最中に再検知が走ると区間が微妙にずれうるが、集計ワーカーは10秒ごとに
 * 回っているので次に開けば揃う。書き込みと競合させないためにロックを取ると、
 * 閲覧が集計の周回を待たされる。
 */
export async function loadMatchContributions(
  client: DbClient,
  params: { eventId: string; matchId: string; now: Date }
): Promise<MatchContributionResult | null> {
  const match = await client.eventMatch.findFirst({
    // eventId で絞ることで、他人のイベントの matchId を渡されても引けないようにする。
    where: { id: params.matchId, eventId: params.eventId },
    select: {
      status: true,
      detectedStartAt: true,
      detectedEndAt: true,
      // 数えるギフトは**この対戦を行う日程の中だけ**(`match-results.ts` と同じ)。
      session: { select: { startAt: true, endAt: true, name: true } },
      sides: {
        orderBy: { sideIndex: "asc" },
        select: {
          sideIndex: true,
          participants: {
            select: {
              participant: {
                select: { id: true, displayName: true, tiktokId: true, roomId: true },
              },
            },
          },
        },
      },
    },
  });
  if (!match) return null;

  const event = await client.event.findUnique({
    where: { id: params.eventId },
    select: {
      startAt: true,
      endAt: true,
      sessions: {
        orderBy: { startAt: "asc" },
        select: { id: true, startAt: true, endAt: true, name: true },
      },
    },
  });
  if (!event) return null;

  // 日程が付いていない対戦(移行前のデータ)だけ、従来どおり全日程と交差させる。
  const windows: EventWindow[] = match.session
    ? [
        {
          id: null,
          start: match.session.startAt,
          end: match.session.endAt,
          name: match.session.name,
        },
      ]
    : resolveEventWindows(event);

  const span = resolveMatchSpans(match, windows, params.now);
  if (span.status !== "ok") return span;

  const slots: SlotInput[] = [];
  const roomToParticipant = new Map<string, string>();
  for (const side of match.sides) {
    for (const entry of side.participants) {
      slots.push({
        participantId: entry.participant.id,
        displayName: entry.participant.displayName,
        tiktokId: entry.participant.tiktokId,
        sideIndex: side.sideIndex,
      });
      roomToParticipant.set(entry.participant.roomId, entry.participant.id);
    }
  }

  const spans = span.spans.map((s) => ({
    start: s.start.toISOString(),
    end: s.end.toISOString(),
  }));
  const unconfirmed = UNCONFIRMED_STATUSES.has(match.status);

  const roomIds = [...roomToParticipant.keys()];
  if (roomIds.length === 0) {
    // 出場者が未確定のサイドしかない。クエリを投げる意味がない。
    return {
      status: "ok",
      spans,
      provisional: span.provisional,
      unconfirmed,
      hasMultiplier: false,
      slots: [],
    };
  }

  // kind で絞らず全件渡す(`resolveMatchResults` と同じ)。検知区間は必ず BATTLE 扱いに
  // なるので、SOLO_STREAM の倍率は `buildRateSegments` の中で構造的に効かない。
  const multiplierRows = await client.eventMultiplier.findMany({
    where: { eventId: params.eventId },
    select: { kind: true, factor: true, startAt: true, endAt: true },
  });
  // factor は Decimal。`number` へ落とすと大きなダイヤ値で精度が落ちるので文字列で渡す
  // (`aggregate.ts` と同じ)。
  const multipliers: MultiplierInput[] = multiplierRows.map((m) => ({
    kind: m.kind,
    factor: m.factor.toString(),
    startAt: m.startAt,
    endAt: m.endAt,
  }));

  const byParticipant = new Map<string, Map<string, Bucket>>();
  let hasMultiplier = false;

  for (const s of span.spans) {
    // 区間の全体が「バトル中」。期間限定の倍率が区間内で切り替わることがあるので、
    // 区間そのものを buildRateSegments に通して倍率の変わり目で分ける。
    const segments = buildRateSegments({
      eventStart: s.start,
      eventEnd: s.end,
      multipliers,
      battleRanges: [s],
    });

    for (const segment of segments) {
      if (segment.scaledFactor !== FACTOR_SCALE) hasMultiplier = true;

      const rows = await aggregateGiftsBySegment(client, {
        roomIds,
        start: segment.start,
        end: segment.end,
      });

      for (const row of rows) {
        const participantId = roomToParticipant.get(row.roomId);
        if (!participantId) continue;

        let map = byParticipant.get(participantId);
        if (!map) {
          map = new Map<string, Bucket>();
          byParticipant.set(participantId, map);
        }
        addTo(map, row.uniqueId, {
          diamonds: row.diamonds,
          points: scaledPoints(row.diamonds, segment.scaledFactor),
          giftCount: row.giftCount,
        });
      }
    }
  }

  // 表示名とアイコンは倍率と無関係なので、区間を分けず1回だけ引く。
  // spans は日程順に並んでいるので、先頭の開始 〜 末尾の終了で覆える
  // (日程をまたいだ隙間ぶんを余分に拾うが、`buildSlotRows` が捨てるだけ)。
  const profiles = await fetchListenerProfiles(client, {
    roomIds,
    start: span.spans[0].start,
    end: span.spans[span.spans.length - 1].end,
  });

  return {
    status: "ok",
    spans,
    provisional: span.provisional,
    unconfirmed,
    hasMultiplier,
    slots: buildSlotRows(slots, byParticipant, profiles),
  };
}
