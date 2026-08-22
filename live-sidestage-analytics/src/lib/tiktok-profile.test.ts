import { describe, it, expect } from "vitest";
import { isAllowedAvatarUrl, parseProfileResponse } from "./tiktok-profile";

// 実際のレスポンス(2026-08 時点、https://www.tiktok.com/api-live/user/room/)を縮めたもの。
const REAL_AVATAR =
  "https://p16-common-sign.tiktokcdn.com/tos-maliva-avt-0068/ba67b11de451691939223e9d978e613a~tplv-tiktokx-cropcenter:1080:1080.webp?dr=14579&refresh_token=2823b5f0&x-expires=1787533200&x-signature=abc";

function response(user: Record<string, unknown>) {
  return { statusCode: 0, message: "", data: { user } };
}

describe("isAllowedAvatarUrl", () => {
  it("TikTok の画像 CDN の https URL を通す", () => {
    expect(isAllowedAvatarUrl(REAL_AVATAR)).toBe(true);
    expect(isAllowedAvatarUrl("https://p19-sign.tiktokcdn-us.com/x.jpeg")).toBe(true);
    expect(isAllowedAvatarUrl("https://p16-webcast.ibyteimg.com/x.png")).toBe(true);
  });

  it("http と非 CDN ホストを弾く", () => {
    expect(isAllowedAvatarUrl("http://p16-common-sign.tiktokcdn.com/x.webp")).toBe(false);
    expect(isAllowedAvatarUrl("https://evil.example.com/x.png")).toBe(false);
    // ホスト名の末尾一致を偽装したもの。
    expect(isAllowedAvatarUrl("https://tiktokcdn.com.evil.example/x.png")).toBe(false);
  });

  it("URL でない値とスキーム悪用を弾く", () => {
    expect(isAllowedAvatarUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedAvatarUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isAllowedAvatarUrl("")).toBe(false);
    expect(isAllowedAvatarUrl(null)).toBe(false);
    expect(isAllowedAvatarUrl(123)).toBe(false);
  });

  it("極端に長い URL を弾く", () => {
    expect(isAllowedAvatarUrl(`https://p16.tiktokcdn.com/${"a".repeat(1200)}`)).toBe(false);
  });
});

describe("parseProfileResponse", () => {
  it("avatarLarger を優先して採る", () => {
    const parsed = parseProfileResponse(
      response({
        avatarLarger: REAL_AVATAR,
        avatarMedium: "https://p16.tiktokcdn.com/medium.webp",
        avatarThumb: "https://p16.tiktokcdn.com/thumb.webp",
        nickname: "テスト配信者",
      })
    );
    expect(parsed).toEqual({ avatarUrl: REAL_AVATAR, nickname: "テスト配信者" });
  });

  it("解像度の高いものが使えなければ順に落とす", () => {
    const parsed = parseProfileResponse(
      response({
        avatarLarger: "https://evil.example.com/x.png",
        avatarMedium: "https://p16.tiktokcdn.com/medium.webp",
        nickname: "  ",
      })
    );
    expect(parsed).toEqual({ avatarUrl: "https://p16.tiktokcdn.com/medium.webp", nickname: null });
  });

  it("statusCode がエラーなら null", () => {
    expect(
      parseProfileResponse({
        statusCode: 10221,
        message: "user not found",
        data: { user: { avatarLarger: REAL_AVATAR } },
      })
    ).toBeNull();
  });

  it("使える avatar が1つもなければ null", () => {
    expect(parseProfileResponse(response({ nickname: "だれか" }))).toBeNull();
    expect(parseProfileResponse(response({ avatarLarger: "" }))).toBeNull();
  });

  it("uniqueId を渡すと別人のレスポンスを弾く", () => {
    const body = response({ avatarLarger: REAL_AVATAR, uniqueId: "someone_else" });
    expect(parseProfileResponse(body, "target_user")).toBeNull();
    // 大文字小文字は無視する(TikTok のハンドルは大小を区別しない)。
    expect(parseProfileResponse(response({ avatarLarger: REAL_AVATAR, uniqueId: "Target_User" }), "target_user"))
      .toEqual({ avatarUrl: REAL_AVATAR, nickname: null });
  });

  it("uniqueId がレスポンスに無ければ照合しない", () => {
    expect(parseProfileResponse(response({ avatarLarger: REAL_AVATAR }), "target_user")).toEqual({
      avatarUrl: REAL_AVATAR,
      nickname: null,
    });
  });

  it("想定外の形でも落ちない", () => {
    expect(parseProfileResponse(null)).toBeNull();
    expect(parseProfileResponse("<html>")).toBeNull();
    expect(parseProfileResponse({})).toBeNull();
    expect(parseProfileResponse({ statusCode: 0, data: {} })).toBeNull();
    expect(parseProfileResponse({ statusCode: 0, data: { user: null } })).toBeNull();
  });
});
