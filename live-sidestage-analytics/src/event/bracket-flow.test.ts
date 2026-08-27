import { describe, it, expect } from "vitest";
import { buildFlowPath, type FlowRect } from "./bracket-flow";

const bounds = { width: 1000, height: 800 };

function rect(x: number, y: number, w = 176, h = 96): FlowRect {
  return { x, y, w, h };
}

describe("buildFlowPath", () => {
  it("targetが右にあるとき、sourceの右辺からtargetの左辺へ向かう", () => {
    const source = rect(100, 100);
    const target = rect(500, 300);
    const result = buildFlowPath(source, target, bounds);

    expect(result.d.startsWith(`M ${source.x + source.w + 4} ${source.y + source.h / 2}`)).toBe(
      true
    );
    expect(result.headX).toBeCloseTo(target.x - 4);
    expect(result.headY).toBeCloseTo(target.y + target.h / 2);
  });

  it("targetが左にあるとき、sourceの左辺からtargetの右辺へ向かう(左右対称)", () => {
    const source = rect(500, 100);
    const target = rect(100, 300);
    const result = buildFlowPath(source, target, bounds);

    expect(result.d.startsWith(`M ${source.x - 4} ${source.y + source.h / 2}`)).toBe(true);
    expect(result.headX).toBeCloseTo(target.x + target.w + 4);
  });

  it("同一カラム(x中心がほぼ同じ)は左翼なら左、右翼なら右の木の外側へ膨らむ", () => {
    // rootの中心(500)より左にあるので、左(小さいx)へ膨らむ。
    const leftWingSource = rect(50, 100);
    const leftWingTarget = rect(50, 400);
    const left = buildFlowPath(leftWingSource, leftWingTarget, bounds);
    // 制御点(c1x)はtailXより小さい(左へ膨らむ)。d文字列の2つ目の数値がc1x。
    const leftNums = left.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [tailX, , c1x] = leftNums;
    expect(c1x).toBeLessThan(tailX);

    // rootの中心より右にあるので、右(大きいx)へ膨らむ。
    const rightWingSource = rect(900, 100, 60, 96);
    const rightWingTarget = rect(900, 400, 60, 96);
    const right = buildFlowPath(rightWingSource, rightWingTarget, bounds);
    const rightNums = right.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [rTailX, , rC1x] = rightNums;
    expect(rC1x).toBeGreaterThan(rTailX);
  });

  it("bowIndexを増やすと同一カラムの膨らみが単調に増える", () => {
    const source = rect(50, 100);
    const target = rect(50, 400);
    const bow0 = buildFlowPath(source, target, bounds, 0);
    const bow1 = buildFlowPath(source, target, bounds, 1);
    const bow2 = buildFlowPath(source, target, bounds, 2);

    const bulgeOf = (path: typeof bow0) => {
      const nums = path.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      return nums[2]; // c1x
    };
    // 左翼なので値が小さいほど膨らみが大きい(rootの外側=より小さいx)。
    expect(bulgeOf(bow1)).toBeLessThan(bulgeOf(bow0));
    expect(bulgeOf(bow2)).toBeLessThan(bulgeOf(bow1));
  });

  it("同一カラムの膨らみがroot幅を超えても座標はboundsの内側にclampされる", () => {
    const source = rect(2, 100, 10, 96); // 木の最外郭(左端ぎりぎり)の極端なケース
    const target = rect(2, 400, 10, 96);
    const result = buildFlowPath(source, target, bounds, 20); // 大きいbowIndex
    const nums = result.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(0);
    }
    // x座標(偶数インデックス)はboundsの幅を超えない。
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeLessThanOrEqual(bounds.width);
    }
    expect(result.headX).toBeGreaterThanOrEqual(0);
    expect(result.headX).toBeLessThanOrEqual(bounds.width);
  });

  it("rootの右端ぎりぎりの矩形でも座標がboundsの外へ出ない", () => {
    const source = rect(bounds.width - 12, 100, 10, 96);
    const target = rect(bounds.width - 12, 400, 10, 96);
    const result = buildFlowPath(source, target, bounds, 20);
    const nums = result.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeLessThanOrEqual(bounds.width);
      expect(nums[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it("headAngleDegはheadへ向かう向きになる(右向きはおよそ0度)", () => {
    const source = rect(100, 100);
    const target = rect(500, 100); // 同じy、真横
    const result = buildFlowPath(source, target, bounds);
    expect(Math.abs(result.headAngleDeg)).toBeLessThan(30);
  });
});
