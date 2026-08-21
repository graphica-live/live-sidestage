import { describe, it, expect } from "vitest";
import { buildEventSlug, isValidSlug, randomSuffix, slugifyTitle } from "./slug";

// 決定的なテストにするため乱数を固定する
const fixedRand = () => 0;

describe("slugifyTitle", () => {
  it("英数字のタイトルをそのまま使う", () => {
    expect(slugifyTitle("Summer Battle 2026")).toBe("summer-battle-2026");
  });

  it("日本語だけのタイトルは空になる", () => {
    expect(slugifyTitle("全国ライバー対抗戦")).toBe("");
  });

  it("前後と連続する記号を落とす", () => {
    expect(slugifyTitle("--- Hello!! World ---")).toBe("hello-world");
  });

  it("長すぎるタイトルを切り詰め、末尾のハイフンを残さない", () => {
    const slug = slugifyTitle("a".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("buildEventSlug", () => {
  it("タイトルにランダムsuffixを付ける", () => {
    expect(buildEventSlug("Summer Battle", fixedRand)).toBe("summer-battle-aaaaaa");
  });

  it("日本語だけのタイトルでも有効なslugを返す", () => {
    const slug = buildEventSlug("全国ライバー対抗戦", fixedRand);
    expect(slug).toBe("e-aaaaaa");
    expect(isValidSlug(slug)).toBe(true);
  });
});

describe("randomSuffix", () => {
  it("6文字を返す", () => {
    expect(randomSuffix(fixedRand)).toHaveLength(6);
  });
});

describe("isValidSlug", () => {
  it("有効なslugを通す", () => {
    expect(isValidSlug("summer-battle-2026")).toBe(true);
  });

  it("大文字・記号・短すぎるものを弾く", () => {
    expect(isValidSlug("Summer")).toBe(false);
    expect(isValidSlug("a")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("has_underscore")).toBe(false);
  });
});
