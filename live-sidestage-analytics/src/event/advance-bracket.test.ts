// 進行(`advanceBracket`)の単体テスト。**DBを使わない。**
//
// 実DBで回すと `public."TiktokRoom"` を worker / room cleanup と共有することになり、
// 並列で走る他ファイルの integration テストを揺らした(実際に落ちた)。ここで見たいのは
// 「読み込んだスナップショットを更新しながら1パスで伝播しきるか」というループの性質だけで、
// Prisma の呼び出しをスタブすれば十分に固定できる。
import { describe, it, expect } from "vitest";
import type { DbClient } from "./analytics-db";
import { advanceBracket } from "./match-results";

type Side = {
  id: string;
  sideIndex: number;
  teamId: string | null;
  participants: { participantId: string; participant: { roomId: string } }[];
};

type Match = {
  id: string;
  round: number;
  bracketPosition: number;
  status: string;
  winnerSideId: string | null;
  winnerDecidedBy: string | null;
  rules: unknown;
  sides: Side[];
};

function side(id: string, sideIndex: number, participantIds: string[] = []): Side {
  return {
    id,
    sideIndex,
    teamId: null,
    participants: participantIds.map((participantId) => ({
      participantId,
      participant: { roomId: `${participantId}-room` },
    })),
  };
}

function match(opts: {
  round: number;
  position: number;
  sides: Side[];
  status?: string;
  winnerSideId?: string | null;
  winnerDecidedBy?: string | null;
  bye?: boolean;
}): Match {
  return {
    id: `m${opts.round}-${opts.position}`,
    round: opts.round,
    bracketPosition: opts.position,
    status: opts.status ?? "SCHEDULED",
    winnerSideId: opts.winnerSideId ?? null,
    winnerDecidedBy: opts.winnerDecidedBy ?? null,
    rules: opts.bye ? { bye: true } : {},
    sides: opts.sides,
  };
}

/**
 * `advanceBracket` が触る Prisma の口だけを持つスタブ。
 *
 * `findMany` は**渡した配列をそのまま返す**。`advanceBracket` はその配列を in-place で
 * 書き換えながら進むので、テスト側は同じオブジェクトを見れば伝播の結果を確認できる。
 */
function fakeTx(matches: Match[]) {
  const writes = {
    participantDeletes: [] as string[],
    participantCreates: [] as { sideId: string; participantId: string }[],
    sideTeamUpdates: [] as { id: string; teamId: string | null }[],
    matchUpdates: [] as { id: string; data: Record<string, unknown> }[],
  };

  const tx = {
    eventMatch: {
      findMany: async () => matches,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        writes.matchUpdates.push({ id: where.id, data });
        return null;
      },
    },
    eventMatchSideParticipant: {
      deleteMany: async ({ where }: { where: { sideId: string } }) => {
        writes.participantDeletes.push(where.sideId);
        return { count: 0 };
      },
      createMany: async ({ data }: { data: { sideId: string; participantId: string }[] }) => {
        writes.participantCreates.push(...data);
        return { count: data.length };
      },
    },
    eventMatchSide: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { teamId: string | null };
      }) => {
        writes.sideTeamUpdates.push({ id: where.id, teamId: data.teamId });
        return null;
      },
    },
  };

  return { tx: tx as unknown as DbClient, writes };
}

const participantsOf = (s: Side) => s.participants.map((p) => p.participantId);

/** 標準シード方式(4人)。1回戦2枠 → 決勝。 */
function standardFour() {
  const m10 = match({
    round: 1,
    position: 0,
    sides: [side("s10a", 0, ["p0"]), side("s10b", 1, ["p3"])],
  });
  const m11 = match({
    round: 1,
    position: 1,
    sides: [side("s11a", 0, ["p1"]), side("s11b", 1, ["p2"])],
  });
  const m20 = match({ round: 2, position: 0, sides: [side("s20a", 0), side("s20b", 1)] });
  return { m10, m11, m20, all: [m10, m11, m20] };
}

/**
 * 段階的不戦勝方式(6人)。
 *
 *   round1: (1,0) 実試合 / (1,1) 実試合 / (1,2) 実試合
 *   round2: (2,0) 実試合 / (2,1) **不戦勝行**((1,2) の勝者だけが来る)
 *   round3: (3,0) 決勝
 *
 * `nextSlot` の座標では (1,2) → (2,1) の side0 → (3,0) の side1。
 * (1,2) の勝者は**2段**動くので、スナップショットを更新しないと1回では届かない。
 */
function stagedSix() {
  const m10 = match({
    round: 1,
    position: 0,
    sides: [side("s10a", 0, ["p0"]), side("s10b", 1, ["p1"])],
  });
  const m11 = match({
    round: 1,
    position: 1,
    sides: [side("s11a", 0, ["p2"]), side("s11b", 1, ["p3"])],
  });
  const m12 = match({
    round: 1,
    position: 2,
    sides: [side("s12a", 0, ["p4"]), side("s12b", 1, ["p5"])],
  });
  const m20 = match({ round: 2, position: 0, sides: [side("s20a", 0), side("s20b", 1)] });
  const m21 = match({
    round: 2,
    position: 1,
    sides: [side("s21a", 0), side("s21b", 1)],
    bye: true,
  });
  const m30 = match({ round: 3, position: 0, sides: [side("s30a", 0), side("s30b", 1)] });
  return { m10, m11, m12, m20, m21, m30, all: [m10, m11, m12, m20, m21, m30] };
}

function winnerIs(m: Match, sideId: string) {
  m.status = "FINISHED";
  m.winnerSideId = sideId;
  m.winnerDecidedBy = "MANUAL";
}

describe("advanceBracket", () => {
  it("表が無ければ何もしない", async () => {
    const { tx, writes } = fakeTx([]);
    const summary = await advanceBracket(tx, "ev");

    // `Math.max(...[])` が -Infinity になる経路を踏まないこと。
    expect(summary).toEqual({ blocked: 0, advanced: 0 });
    expect(writes.participantCreates).toHaveLength(0);
  });

  it("確定した1回戦の勝者を次のラウンドへ送る", async () => {
    const b = standardFour();
    winnerIs(b.m10, "s10a");
    winnerIs(b.m11, "s11b");

    const { tx, writes } = fakeTx(b.all);
    const summary = await advanceBracket(tx, "ev");

    expect(participantsOf(b.m20.sides[0])).toEqual(["p0"]);
    expect(participantsOf(b.m20.sides[1])).toEqual(["p2"]);
    expect(writes.participantCreates).toEqual([
      { sideId: "s20a", participantId: "p0" },
      { sideId: "s20b", participantId: "p2" },
    ]);
    expect(summary).toEqual({ blocked: 0, advanced: 2 });
  });

  it("勝者が決まっていないラウンドへは何も送らない", async () => {
    const b = standardFour();

    const { tx, writes } = fakeTx(b.all);
    const summary = await advanceBracket(tx, "ev");

    expect(participantsOf(b.m20.sides[0])).toEqual([]);
    expect(writes.participantCreates).toHaveLength(0);
    expect(summary.advanced).toBe(0);
  });

  it("同じ状態でもう一度呼んでも書き込まない(冪等)", async () => {
    const b = standardFour();
    winnerIs(b.m10, "s10a");
    await advanceBracket(fakeTx(b.all).tx, "ev");

    const { tx, writes } = fakeTx(b.all);
    const summary = await advanceBracket(tx, "ev");

    expect(summary.advanced).toBe(0);
    expect(writes.participantCreates).toHaveLength(0);
    expect(writes.participantDeletes).toHaveLength(0);
  });

  it("不戦勝行を越えて決勝まで1回で届く", async () => {
    // **1パス収束の回帰テスト。** スナップショットの in-place 更新を外すと、
    // 不戦勝行までしか進まずここで落ちる。
    const b = stagedSix();
    winnerIs(b.m12, "s12a");

    const { tx, writes } = fakeTx(b.all);
    const summary = await advanceBracket(tx, "ev");

    // 不戦勝行に勝者が入り、バトルを待たずに確定していること。
    expect(participantsOf(b.m21.sides[0])).toEqual(["p4"]);
    expect(b.m21.status).toBe("FINISHED");
    expect(b.m21.winnerSideId).toBe("s21a");
    expect(b.m21.winnerDecidedBy).toBe("BYE");

    // **同じ呼び出しで**その先の決勝まで届いていること。
    expect(participantsOf(b.m30.sides[1])).toEqual(["p4"]);
    expect(writes.participantCreates).toContainEqual({ sideId: "s30b", participantId: "p4" });
    expect(summary.advanced).toBeGreaterThanOrEqual(3);
  });

  it("上流を無効にすると、下流から1回で消える", async () => {
    const b = stagedSix();
    winnerIs(b.m12, "s12a");
    await advanceBracket(fakeTx(b.all).tx, "ev");

    // 主催者が無効にしたのと同じ状態にする。
    b.m12.status = "VOID";
    b.m12.winnerSideId = null;
    b.m12.winnerDecidedBy = null;

    const { tx, writes } = fakeTx(b.all);
    await advanceBracket(tx, "ev");

    // 不戦勝行は未確定へ戻り、決勝からも消えていること(2段とも1回で)。
    expect(participantsOf(b.m21.sides[0])).toEqual([]);
    expect(b.m21.status).toBe("SCHEDULED");
    expect(b.m21.winnerSideId).toBeNull();
    expect(participantsOf(b.m30.sides[1])).toEqual([]);
    expect(writes.participantDeletes).toContain("s30b");
  });

  it("次の対戦が始まっていたら書き換えず blocked に数える", async () => {
    const b = standardFour();
    winnerIs(b.m10, "s10a");
    b.m20.status = "LIVE";

    const { tx, writes } = fakeTx(b.all);
    const summary = await advanceBracket(tx, "ev");

    expect(participantsOf(b.m20.sides[0])).toEqual([]);
    expect(writes.participantCreates).toHaveLength(0);
    expect(summary.blocked).toBe(1);
    // **blocked は advanced に数えない。** 数えると finalizedAt が永久に立たなくなる。
    expect(summary.advanced).toBe(0);
  });

  it("不戦勝行は進行中判定を素通りして上流の勝者へ追従する", async () => {
    // 不戦勝行は検知されないので LIVE にはならないが、自動確定(FINISHED + BYE)には
    // なる。それを「進行済み」と見て止めると、上流が変わったときに古い勝者で固まる。
    const b = stagedSix();
    winnerIs(b.m12, "s12a");
    await advanceBracket(fakeTx(b.all).tx, "ev");
    expect(b.m21.status).toBe("FINISHED");

    // 上流の勝者を差し替える。
    b.m12.winnerSideId = "s12b";

    const { tx } = fakeTx(b.all);
    await advanceBracket(tx, "ev");

    expect(participantsOf(b.m21.sides[0])).toEqual(["p5"]);
    expect(participantsOf(b.m30.sides[1])).toEqual(["p5"]);
  });
});
