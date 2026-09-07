import { describe, it, expect } from "vitest";
import { parseBreakdownRange, resolveBreakdownWindow } from "./gift-breakdown";
import type { GiftAggregateWhere, SplitPlan } from "./gift-analytics";

const ROOM = "room_1";
const USER = { in: ["listener_1"] };

function splitPlan(cutoffDayKey: string): SplitPlan {
  return { kind: "split", cutoffDayKey, rollupLower: null, rollupUpper: null };
}

describe("resolveBreakdownWindow", () => {
  it("明細だけで足りる期間(raw)は where をそのまま使い、全範囲カバー扱いにする", () => {
    const where: GiftAggregateWhere = {
      roomId: ROOM,
      uniqueId: USER,
      dayKey: { gte: "2026-09-01", lte: "2026-09-07" },
    };

    const { rawWhere, coverage } = resolveBreakdownWindow(where, { kind: "raw" });

    expect(rawWhere).toBe(where);
    expect(coverage).toEqual({ detailAvailable: true, rawFrom: null, partial: false });
  });

  it("範囲がカットオフをまたぐ(dayKey)ときは、明細側の下限をカットオフへ引き上げて partial にする", () => {
    const where: GiftAggregateWhere = {
      roomId: ROOM,
      uniqueId: USER,
      dayKey: { gte: "2026-01-01", lte: "2026-09-07" },
    };

    const { rawWhere, coverage } = resolveBreakdownWindow(where, splitPlan("2026-06-19"));

    expect(rawWhere?.dayKey).toEqual({ gte: "2026-06-19", lte: "2026-09-07" });
    expect(coverage).toEqual({ detailAvailable: true, rawFrom: "2026-06-19", partial: true });
  });

  it("範囲がまるごとカットオフより古い(dayKey)ときは内訳を出せないと返す", () => {
    const where: GiftAggregateWhere = {
      roomId: ROOM,
      uniqueId: USER,
      dayKey: { gte: "2026-01-01", lte: "2026-03-31" },
    };

    const { rawWhere, coverage } = resolveBreakdownWindow(where, splitPlan("2026-06-19"));

    expect(rawWhere).toBeNull();
    expect(coverage).toEqual({ detailAvailable: false, rawFrom: null, partial: false });
  });

  // narrowToRawWindow は receivedAt 指定のとき null を返さない(dayKeyの下限を足すだけ)ので、
  // この分岐を自前で弾いていないと「明細ゼロ件」が「空の内訳」として表示されてしまう。
  it("範囲がまるごとカットオフより古い(receivedAt)ときも内訳を出せないと返す", () => {
    const where: GiftAggregateWhere = {
      roomId: ROOM,
      uniqueId: USER,
      receivedAt: { gte: new Date("2026-01-01T00:00:00Z"), lte: new Date("2026-03-31T23:59:59Z") },
    };

    const { rawWhere, coverage } = resolveBreakdownWindow(where, splitPlan("2026-06-19"));

    expect(rawWhere).toBeNull();
    expect(coverage.detailAvailable).toBe(false);
  });

  it("receivedAt 指定でカットオフをまたぐときは dayKey 下限を足して partial にする", () => {
    const where: GiftAggregateWhere = {
      roomId: ROOM,
      uniqueId: USER,
      receivedAt: { gte: new Date("2026-01-01T00:00:00Z"), lte: new Date("2026-09-07T23:59:59Z") },
    };

    const { rawWhere, coverage } = resolveBreakdownWindow(where, splitPlan("2026-06-19"));

    expect(rawWhere?.dayKey?.gte).toBe("2026-06-19");
    expect(rawWhere?.receivedAt).toEqual(where.receivedAt); // 時刻側の条件は残す
    expect(coverage).toEqual({ detailAvailable: true, rawFrom: "2026-06-19", partial: true });
  });
});

describe("parseBreakdownRange", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("period+date 指定は dayKey 範囲になる", () => {
    const r = parseBreakdownRange(q("period=day&date=2026-09-05"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.where.dayKey).toEqual({ gte: "2026-09-05", lte: "2026-09-05" });
    expect(r.where.receivedAt).toBeUndefined();
  });

  it("startDatetime と endDatetime が両方そろえば receivedAt 範囲になる", () => {
    const r = parseBreakdownRange(
      q("startDatetime=2026-09-05T00:00:00.000Z&endDatetime=2026-09-05T23:59:59.000Z")
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.where.receivedAt?.gte.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(r.where.dayKey).toBeUndefined();
  });

  it("片方だけ渡されたら黙って period へ落とさず弾く", () => {
    expect(parseBreakdownRange(q("startDatetime=2026-09-05T00:00:00Z")).ok).toBe(false);
    expect(parseBreakdownRange(q("endDatetime=2026-09-05T00:00:00Z")).ok).toBe(false);
  });

  it("解釈できない日時は弾く(Invalid Date を Prisma へ渡さない)", () => {
    const r = parseBreakdownRange(q("startDatetime=2026-13-01T00:00:00Z&endDatetime=hello"));
    expect(r.ok).toBe(false);
  });
});
