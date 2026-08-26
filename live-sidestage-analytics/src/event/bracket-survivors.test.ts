import { describe, expect, it } from "vitest";
import type { BracketSideDto } from "./public-event";
import { findSurvivorMatchIds } from "./bracket-survivors";

function side(
  participantIds: string[],
  isWinner: boolean,
  sideIndex = 0
): BracketSideDto {
  return {
    id: `side-${participantIds.join("-") || "empty"}-${sideIndex}-${isWinner}`,
    sideIndex,
    name: participantIds.length > 0 ? participantIds.join(" / ") : null,
    entrants: participantIds.map((id) => ({ participantId: id, displayName: id })),
    diamonds: "0",
    tiktokScore: null,
    isWinner,
    // 生存判定は配信状態を見ないので false 固定でよい(DTO の必須フィールドを埋めるだけ)。
    hasLiveStreamer: false,
  };
}

type MatchInput = {
  id: string;
  status: string;
  sides: BracketSideDto[];
};

function match(id: string, status: string, sides: BracketSideDto[]): MatchInput {
  return { id, status, sides };
}

describe("findSurvivorMatchIds", () => {
  it("決着していない試合は生存判定に含めない", () => {
    const matches = [match("m1", "LIVE", [side(["a"], false), side(["b"], false)])];
    expect(findSurvivorMatchIds(matches)).toEqual(new Set());
  });

  it("勝者がまだ何にも負けていなければ、その勝った試合を生存として返す", () => {
    const matches = [match("m1", "FINISHED", [side(["a"], true), side(["b"], false)])];
    expect(findSurvivorMatchIds(matches)).toEqual(new Set(["m1"]));
  });

  it("R1で勝った側がR2で負けると、R1の勝利は生存扱いから外れる", () => {
    const matches = [
      match("r1", "FINISHED", [side(["a"], true), side(["b"], false)]),
      match("r2", "FINISHED", [side(["a"], false), side(["c"], true)]),
    ];
    const result = findSurvivorMatchIds(matches);
    expect(result.has("r1")).toBe(false);
    expect(result.has("r2")).toBe(true);
  });

  it("R2がまだ未決着なら、R1の勝利は生存のまま光り続ける", () => {
    const matches = [
      match("r1", "FINISHED", [side(["a"], true), side(["b"], false)]),
      match("r2", "LIVE", [side(["a"], false), side(["c"], false)]),
    ];
    expect(findSurvivorMatchIds(matches)).toEqual(new Set(["r1"]));
  });

  it("不戦勝(片側が空)は相手側を敗退させず、勝者側は生存として返す", () => {
    const matches = [match("m1", "FINISHED", [side(["a"], true), side([], false)])];
    expect(findSurvivorMatchIds(matches)).toEqual(new Set(["m1"]));
  });

  it("VOIDになった試合は両側とも以後の生存対象から外す(敗北ではないが進めない)", () => {
    const matches = [
      match("r1", "FINISHED", [side(["a"], true), side(["b"], false)]),
      match("r2", "VOID", [side(["a"], false), side(["c"], true)]),
    ];
    const result = findSurvivorMatchIds(matches);
    expect(result.has("r1")).toBe(false);
  });

  it("NO_SHOWは主催者の手動確定待ちなので、それまでの勝利は生存のまま扱う", () => {
    const matches = [
      match("r1", "FINISHED", [side(["a"], true), side(["b"], false)]),
      match("r2", "NO_SHOW", [side(["a"], false), side(["c"], false)]),
    ];
    expect(findSurvivorMatchIds(matches)).toEqual(new Set(["r1"]));
  });

  it("決勝は結果集合から除くが、決勝の敗者が持つ準決勝以前の勝利は消す", () => {
    const matches = [
      match("semi1", "FINISHED", [side(["a"], true), side(["b"], false)]),
      match("semi2", "FINISHED", [side(["c"], true), side(["d"], false)]),
      match("final", "FINISHED", [side(["a"], false), side(["c"], true)]),
    ];
    const result = findSurvivorMatchIds(matches, "final");
    expect(result.has("final")).toBe(false);
    expect(result.has("semi1")).toBe(false); // aは決勝で負けたので生存ではない
    expect(result.has("semi2")).toBe(true); // cはまだ生存
  });

  it("チーム戦は出場者集合の順序が変わっても同一チームとして追跡する", () => {
    const matches = [
      match("r1", "FINISHED", [side(["a", "b"], true), side(["c", "d"], false)]),
      match("r2", "FINISHED", [side(["b", "a"], false), side(["e", "f"], true)]),
    ];
    const result = findSurvivorMatchIds(matches);
    expect(result.has("r1")).toBe(false); // [a,b] はr2で負けた
    expect(result.has("r2")).toBe(true);
  });
});
