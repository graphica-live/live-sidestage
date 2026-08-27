import { describe, it, expect } from "vitest";
import {
  buildWinnerFeederGraph,
  defaultSourceOf,
  feederFlowEdges,
  feederOf,
  targetOf,
  type WinnerFeederRow,
} from "./winner-feeders";

function row(round: number, position: number, rules: unknown = {}): WinnerFeederRow {
  return { round, bracketPosition: position, rules };
}

function withWinnerFeeders(
  r: WinnerFeederRow,
  slots: [{ round: number; position: number }, { round: number; position: number }]
): WinnerFeederRow {
  return { ...r, rules: { winnerFeeders: { slots, changedAt: "2026-08-26T00:00:00.000Z" } } };
}

describe("defaultSourceOf", () => {
  it("1回戦(round<=1)はsourceを持たない", () => {
    expect(defaultSourceOf(1, 0, 0)).toBeNull();
    expect(defaultSourceOf(1, 0, 1)).toBeNull();
  });

  it("round2以降はnextSlotの逆算になる", () => {
    expect(defaultSourceOf(2, 0, 0)).toEqual({ round: 1, position: 0 });
    expect(defaultSourceOf(2, 0, 1)).toEqual({ round: 1, position: 1 });
    expect(defaultSourceOf(3, 1, 0)).toEqual({ round: 2, position: 2 });
    expect(defaultSourceOf(3, 1, 1)).toEqual({ round: 2, position: 3 });
  });
});

describe("buildWinnerFeederGraph", () => {
  // 標準8人: round1 4試合、round2 2試合、round3(決勝)1試合。
  const standardEight: WinnerFeederRow[] = [
    row(1, 0),
    row(1, 1),
    row(1, 2),
    row(1, 3),
    row(2, 0),
    row(2, 1),
    row(3, 0),
  ];

  it("overrideが無ければ既定のnextSlot逆算で解決する", () => {
    const result = buildWinnerFeederGraph(standardEight, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feederOf(result.graph, 2, 0, 0)).toEqual({ round: 1, position: 0 });
    expect(feederOf(result.graph, 2, 0, 1)).toEqual({ round: 1, position: 1 });
    expect(feederOf(result.graph, 3, 0, 0)).toEqual({ round: 2, position: 0 });
    expect(feederOf(result.graph, 3, 0, 1)).toEqual({ round: 2, position: 1 });
    expect(targetOf(result.graph, 1, 0)).toEqual({ round: 2, position: 0, sideIndex: 0 });
    expect(targetOf(result.graph, 2, 1)).toEqual({ round: 3, position: 0, sideIndex: 1 });
  });

  it("1回戦は既定でtargetとしてグラフに現れない(sourceを持たないため)", () => {
    const result = buildWinnerFeederGraph(standardEight, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feederOf(result.graph, 1, 0, 0)).toBeNull();
  });

  it("overrideがあればそちらを優先し、逆向き(targetOf)も正しく解決される", () => {
    // transposition(2つのtarget間で1本ずつ入れ替える)として整合させる。全単射を
    // 崩さない実際の書き込み方(`swapWinnerFeeders`)と同じ形。
    const rows = standardEight.map((r) => {
      if (r.round === 2 && r.bracketPosition === 0) {
        return withWinnerFeeders(r, [
          { round: 1, position: 3 },
          { round: 1, position: 1 },
        ]);
      }
      if (r.round === 2 && r.bracketPosition === 1) {
        return withWinnerFeeders(r, [
          { round: 1, position: 2 },
          { round: 1, position: 0 },
        ]);
      }
      return r;
    });
    const result = buildWinnerFeederGraph(rows, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feederOf(result.graph, 2, 0, 0)).toEqual({ round: 1, position: 3 });
    expect(feederOf(result.graph, 2, 0, 1)).toEqual({ round: 1, position: 1 });
    expect(targetOf(result.graph, 1, 3)).toEqual({ round: 2, position: 0, sideIndex: 0 });
    // (1,0)は既定なら(2,0)のside0を指していたが、overrideで(2,1)のside1へ移った。
    expect(targetOf(result.graph, 1, 0)).toEqual({ round: 2, position: 1, sideIndex: 1 });
  });

  it("malformedなoverrideはok:false(フォールバックしない)", () => {
    const rows = standardEight.map((r) =>
      r.round === 2 && r.bracketPosition === 0
        ? {
            ...r,
            rules: {
              winnerFeeders: {
                slots: [{ round: 1, position: 0 }],
                changedAt: "2026-08-26T00:00:00.000Z",
              },
            },
          }
        : r
    );
    expect(buildWinnerFeederGraph(rows, 3)).toEqual({ ok: false });
  });

  it("source.round !== target.round-1 のoverrideはok:false(ラウンド不整合)", () => {
    const rows = standardEight.map((r) =>
      r.round === 2 && r.bracketPosition === 0
        ? withWinnerFeeders(r, [
            { round: 2, position: 0 },
            { round: 1, position: 1 },
          ])
        : r
    );
    expect(buildWinnerFeederGraph(rows, 3)).toEqual({ ok: false });
  });

  it("実在しない座標を指すoverrideはok:false(source不在。既定計算とは違いnullへ読み替えない)", () => {
    const rows = standardEight.map((r) =>
      r.round === 2 && r.bracketPosition === 0
        ? withWinnerFeeders(r, [
            { round: 1, position: 99 },
            { round: 1, position: 1 },
          ])
        : r
    );
    expect(buildWinnerFeederGraph(rows, 3)).toEqual({ ok: false });
  });

  it("複数のtargetが同じsourceを指すとok:false(全単射崩壊)", () => {
    const rows = standardEight.map((r) =>
      r.round === 2 && r.bracketPosition === 1
        ? withWinnerFeeders(r, [
            { round: 1, position: 0 }, // round2 position0のside0とも重複する
            { round: 1, position: 3 },
          ])
        : r
    );
    expect(buildWinnerFeederGraph(rows, 3)).toEqual({ ok: false });
  });

  it("孤児source: 実在行の勝者辺がどのtargetにも向かわなければok:false", () => {
    // round2 position0 の行が欠落している(データ不整合を模擬)。round1 position0/1の
    // 勝者はどこにも転送先を持たなくなる。
    const rows = standardEight.filter((r) => !(r.round === 2 && r.bracketPosition === 0));
    expect(buildWinnerFeederGraph(rows, 3)).toEqual({ ok: false });
  });

  it("決勝(round===roundCount)は孤児source検出の対象外(勝者辺を持たない)", () => {
    // 決勝を対象に含めても誤検出しないことを、標準8人の正常系で確認する。
    const result = buildWinnerFeederGraph(standardEight, 3);
    expect(result.ok).toBe(true);
  });

  it('段階的不戦勝方式で「誰も来ない」座標をsource不在エラーにせずnullとして扱う', () => {
    // 6人段階的不戦勝(advance-bracket.test.ts の stagedSix と同型)。
    // round1: position0/1/2 の3行。round2: position0(実試合)、position1(不戦勝。
    // side0のsourceはround1 position2(実在)、side1のsourceはround1 position3(実在しない)。
    const staged: WinnerFeederRow[] = [
      row(1, 0),
      row(1, 1),
      row(1, 2),
      row(2, 0),
      row(2, 1, { bye: true }),
      row(3, 0),
    ];
    const result = buildWinnerFeederGraph(staged, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feederOf(result.graph, 2, 1, 0)).toEqual({ round: 1, position: 2 });
    expect(feederOf(result.graph, 2, 1, 1)).toBeNull();
    // 不戦勝行自身(round1 position2)の勝者辺は正しく(2,1)のside0として登録され、
    // 孤児として誤検出されない。
    expect(targetOf(result.graph, 1, 2)).toEqual({ round: 2, position: 1, sideIndex: 0 });
  });
});

describe("feederOf / targetOf", () => {
  it("グラフに存在しない座標を渡すとnullを返す", () => {
    const result = buildWinnerFeederGraph(
      [row(1, 0), row(1, 1), row(2, 0)],
      2
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feederOf(result.graph, 9, 9, 0)).toBeNull();
    expect(targetOf(result.graph, 9, 9)).toBeNull();
  });
});

describe("feederFlowEdges", () => {
  // 標準8人: round1 4試合、round2 2試合、round3(決勝)1試合。
  const standardEight: WinnerFeederRow[] = [
    row(1, 0),
    row(1, 1),
    row(1, 2),
    row(1, 3),
    row(2, 0),
    row(2, 1),
    row(3, 0),
  ];

  it("overrideが無ければ辺は0本", () => {
    const result = feederFlowEdges(standardEight, 3);
    expect(result).toEqual({ ok: true, edges: [] });
  });

  it("transposition(2つのtarget間の入れ替え)からちょうど2本の差分辺が出る。並びは座標順", () => {
    const rows = standardEight.map((r) => {
      if (r.round === 2 && r.bracketPosition === 0) {
        return withWinnerFeeders(r, [
          { round: 1, position: 3 },
          { round: 1, position: 1 },
        ]);
      }
      if (r.round === 2 && r.bracketPosition === 1) {
        return withWinnerFeeders(r, [
          { round: 1, position: 2 },
          { round: 1, position: 0 },
        ]);
      }
      return r;
    });
    // (2,0)は側0だけが既定(1,0)から(1,3)へ変わっている(側1の(1,1)は既定のまま)。
    // (2,1)は側1だけが既定(1,3)から(1,0)へ変わっている(側0の(1,2)は既定のまま)。
    // 差分が出るのは2本だけ。
    const result = feederFlowEdges(rows, 3);
    expect(result).toEqual({
      ok: true,
      edges: [
        { from: { round: 1, position: 3 }, to: { round: 2, position: 0, sideIndex: 0 } },
        { from: { round: 1, position: 0 }, to: { round: 2, position: 1, sideIndex: 1 } },
      ],
    });
  });

  it("元の組み合わせへ戻すと、キーは残っていても辺は0本になる(raw overrideと実効差分の区別)", () => {
    // 一度スワップしてから戻した状態を模す: winnerFeeders キー自体はchangedAt保持のため
    // 残るが、slotsは既定座標と一致する。
    const rows = standardEight.map((r) =>
      r.round === 2 && r.bracketPosition === 0
        ? withWinnerFeeders(r, [
            { round: 1, position: 0 },
            { round: 1, position: 1 },
          ])
        : r
    );
    const result = feederFlowEdges(rows, 3);
    expect(result).toEqual({ ok: true, edges: [] });
  });

  it("malformed・source不在・全単射崩壊・孤児sourceでは矢印を1本も出さない", () => {
    const malformed = standardEight.map((r) =>
      r.round === 2 && r.bracketPosition === 0
        ? {
            ...r,
            rules: {
              winnerFeeders: {
                slots: [{ round: 1, position: 0 }],
                changedAt: "2026-08-26T00:00:00.000Z",
              },
            },
          }
        : r
    );
    expect(feederFlowEdges(malformed, 3)).toEqual({ ok: false, edges: [] });

    const orphanSource = standardEight.filter((r) => !(r.round === 2 && r.bracketPosition === 0));
    expect(feederFlowEdges(orphanSource, 3)).toEqual({ ok: false, edges: [] });
  });

  it("段階的不戦勝方式(staged bye)を含むグラフでも安全に(誤検出せず)動く", () => {
    const staged: WinnerFeederRow[] = [
      row(1, 0),
      row(1, 1),
      row(1, 2),
      row(2, 0),
      row(2, 1, { bye: true }),
      row(3, 0),
    ];
    expect(feederFlowEdges(staged, 3)).toEqual({ ok: true, edges: [] });
  });

  it("3者以上の連鎖スワップでも全単射を保ったまま辺が重複なく出る", () => {
    // round1の3枠を3すくみに回す循環transposition: (2,0)のside0/1を(1,1)/(1,2)、
    // (2,1)のside0を(1,3)、side1は既定のまま(1,2)…ではなく、ここでは
    // (1,0)→(2,0).0, (1,1)→(2,1).0, (1,2)→(2,0).1 という3本の循環にする。
    const rows = standardEight.map((r) => {
      if (r.round === 2 && r.bracketPosition === 0) {
        return withWinnerFeeders(r, [
          { round: 1, position: 1 },
          { round: 1, position: 2 },
        ]);
      }
      if (r.round === 2 && r.bracketPosition === 1) {
        return withWinnerFeeders(r, [
          { round: 1, position: 0 },
          { round: 1, position: 3 },
        ]);
      }
      return r;
    });
    const result = feederFlowEdges(rows, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edges).toHaveLength(3);
    // 座標順(target優先)に並んでいる
    expect(result.edges.map((e) => e.to)).toEqual([
      { round: 2, position: 0, sideIndex: 0 },
      { round: 2, position: 0, sideIndex: 1 },
      { round: 2, position: 1, sideIndex: 0 },
    ]);
  });
});
