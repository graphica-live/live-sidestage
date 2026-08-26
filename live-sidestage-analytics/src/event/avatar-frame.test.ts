import { describe, expect, it } from "vitest";
import {
  DEFAULT_AVATAR_OFFSET_X,
  DEFAULT_AVATAR_OFFSET_Y,
  DEFAULT_AVATAR_ZOOM,
  avatarFrameStyle,
  clampOffset,
  clampZoom,
  coverDimensions,
  dragDeltaToOffsetDelta,
  resolveAvatarFrame,
} from "./avatar-frame";

describe("resolveAvatarFrame", () => {
  it("null/undefinedはすべて現状のデフォルト値に解決する", () => {
    expect(resolveAvatarFrame(null, null, null)).toEqual({
      offsetX: DEFAULT_AVATAR_OFFSET_X,
      offsetY: DEFAULT_AVATAR_OFFSET_Y,
      zoom: DEFAULT_AVATAR_ZOOM,
    });
    expect(resolveAvatarFrame(undefined, undefined, undefined)).toEqual({
      offsetX: DEFAULT_AVATAR_OFFSET_X,
      offsetY: DEFAULT_AVATAR_OFFSET_Y,
      zoom: DEFAULT_AVATAR_ZOOM,
    });
  });

  it("値があればそれを使う", () => {
    expect(resolveAvatarFrame(10, 90, 2)).toEqual({ offsetX: 10, offsetY: 90, zoom: 2 });
  });
});

describe("avatarFrameStyle", () => {
  it("zoom=1(既定)のときtransformを付けない", () => {
    const style = avatarFrameStyle({ offsetX: 50, offsetY: 30, zoom: 1 });
    expect(style.transform).toBeUndefined();
    expect(style.objectPosition).toBe("50% 30%");
  });

  it("transformOriginはobjectPositionと必ず同じ値にする(ズームの中心を揃えるため)", () => {
    const style = avatarFrameStyle({ offsetX: 12, offsetY: 88, zoom: 2.5 });
    expect(style.transformOrigin).toBe(style.objectPosition);
    expect(style.transform).toBe("scale(2.5)");
  });
});

describe("coverDimensions", () => {
  it("正方形画像を正方形枠に入れると、両軸とも枠と同じサイズになる(余白ゼロ)", () => {
    const { width, height } = coverDimensions(100, 100, 200, 200);
    expect(width).toBe(200);
    expect(height).toBe(200);
  });

  it("横長画像を横長枠より縦長の枠に入れると、幅が枠をはみ出す(高さでcoverする)", () => {
    // 画像 16:9, 枠 1:1 → 高さを枠に合わせるので幅が枠よりはみ出す
    const { width, height } = coverDimensions(1600, 900, 200, 200);
    expect(height).toBe(200);
    expect(width).toBeGreaterThan(200);
  });
});

describe("dragDeltaToOffsetDelta", () => {
  it("zoom=1で画像サイズ=枠サイズ(はみ出し無し)の軸は動かせない", () => {
    expect(dragDeltaToOffsetDelta(50, 100, 100, 1)).toBe(0);
  });

  it("はみ出しがある軸は、ドラッグ方向と逆向きにoffsetを動かす", () => {
    // frame=100, image=200(はみ出し100), zoom=1 → denom=100
    // 右へ50pxドラッグ(deltaPx=50) → 画像を右へ動かす操作なので、
    // 「切り出し窓」は左へ動く = offset%は減る方向になる
    const delta = dragDeltaToOffsetDelta(50, 100, 200, 1);
    expect(delta).toBeLessThan(0);
    expect(delta).toBeCloseTo(-50, 5);
  });

  it("zoomが大きいほど同じpx移動でのoffset変化は小さくなる(高倍率ほど微調整になる)", () => {
    const d1 = dragDeltaToOffsetDelta(50, 100, 200, 1);
    const d2 = dragDeltaToOffsetDelta(50, 100, 200, 2);
    expect(Math.abs(d2)).toBeLessThan(Math.abs(d1));
  });
});

describe("clampOffset / clampZoom", () => {
  it("0-100の範囲外を丸める", () => {
    expect(clampOffset(-10)).toBe(0);
    expect(clampOffset(150)).toBe(100);
    expect(clampOffset(42)).toBe(42);
  });

  it("1-3の範囲外を丸める", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(10)).toBe(3);
    expect(clampZoom(2)).toBe(2);
  });
});
