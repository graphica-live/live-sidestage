import { describe, it, expect } from "vitest";
import {
  USER_NOT_FOUND_STATUS_CODE,
  classifyAccountExistence,
  isAllowedAvatarUrl,
  parseProfileResponse,
} from "./tiktok-profile";

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
    expect(parsed).toEqual({ avatarUrl: REAL_AVATAR, nickname: "テスト配信者", userId: null });
  });

  it("解像度の高いものが使えなければ順に落とす", () => {
    const parsed = parseProfileResponse(
      response({
        avatarLarger: "https://evil.example.com/x.png",
        avatarMedium: "https://p16.tiktokcdn.com/medium.webp",
        nickname: "  ",
      })
    );
    expect(parsed).toEqual({ avatarUrl: "https://p16.tiktokcdn.com/medium.webp", nickname: null, userId: null });
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
      .toEqual({ avatarUrl: REAL_AVATAR, nickname: null, userId: null });
  });

  it("uniqueId がレスポンスに無ければ照合しない", () => {
    expect(parseProfileResponse(response({ avatarLarger: REAL_AVATAR }), "target_user")).toEqual({
      avatarUrl: REAL_AVATAR,
      nickname: null,
      userId: null,
    });
  });

  it("data.user.id を数値 userId として拾う", () => {
    // 実測(2026-08)では文字列で返る。19桁でも JSON.parse の精度落ちが起きない。
    expect(parseProfileResponse(response({ avatarLarger: REAL_AVATAR, id: "5831967" }))?.userId).toBe(
      "5831967"
    );
    expect(
      parseProfileResponse(response({ avatarLarger: REAL_AVATAR, id: "6745191554084586437" }))?.userId
    ).toBe("6745191554084586437");
  });

  it("数値で来ても安全な範囲なら拾い、精度が落ちている値は捨てる", () => {
    expect(parseProfileResponse(response({ avatarLarger: REAL_AVATAR, id: 107955 }))?.userId).toBe(
      "107955"
    );
    // 19桁の数値リテラルは JSON.parse の時点で既に別の値になっている。誤った id は保存しない。
    expect(
      parseProfileResponse(response({ avatarLarger: REAL_AVATAR, id: 6745191554084586437 }))?.userId
    ).toBeNull();
  });

  it("id が無い・数字でない場合は userId を null にする(アイコンは返す)", () => {
    for (const id of [undefined, "", "abc", "12.5", null, {}]) {
      const parsed = parseProfileResponse(response({ avatarLarger: REAL_AVATAR, id }));
      expect(parsed?.avatarUrl).toBe(REAL_AVATAR);
      expect(parsed?.userId).toBeNull();
    }
  });

  it("想定外の形でも落ちない", () => {
    expect(parseProfileResponse(null)).toBeNull();
    expect(parseProfileResponse("<html>")).toBeNull();
    expect(parseProfileResponse({})).toBeNull();
    expect(parseProfileResponse({ statusCode: 0, data: {} })).toBeNull();
    expect(parseProfileResponse({ statusCode: 0, data: { user: null } })).toBeNull();
  });
});

describe("classifyAccountExistence", () => {
  it("実在するアカウントを EXISTS にする(実測の形)", () => {
    // 2026-08-24 に @tiktok を引いた応答を縮めたもの。
    const body = {
      statusCode: 0,
      message: "",
      data: { user: { uniqueId: "tiktok", id: "107955", nickname: "TikTok" } },
    };
    expect(classifyAccountExistence(body, "tiktok")).toBe("EXISTS");
  });

  it("アイコンが取れなくても EXISTS にする", () => {
    // 実在確認は avatar と無関係。CDN のホストが変わっても壊れてはいけない。
    const body = { statusCode: 0, data: { user: { uniqueId: "someone" } } };
    expect(classifyAccountExistence(body, "someone")).toBe("EXISTS");
  });

  it("存在しないアカウントを MISSING にする(実測の形)", () => {
    // 2026-08-24 に存在しないハンドルを引いた応答。
    const body = { statusCode: USER_NOT_FOUND_STATUS_CODE, message: "user_not_found", data: null };
    expect(classifyAccountExistence(body, "zzq_notexist_9c8f7e6d5a4b3")).toBe("MISSING");
    expect(USER_NOT_FOUND_STATUS_CODE).toBe(19881007);
  });

  it("statusCode が変わっても message が user_not_found なら MISSING にする", () => {
    expect(classifyAccountExistence({ statusCode: 12345, message: "user_not_found" }, "x")).toBe(
      "MISSING"
    );
  });

  it("**未知の非 0 statusCode は MISSING にしない**", () => {
    // レート制限・bot 判定・地域ブロックで実在アカウントを一斉に弾かないための肝。
    for (const statusCode of [10221, 2, 100, -1, 19881008]) {
      expect(classifyAccountExistence({ statusCode, message: "something else" }, "x")).toBe(
        "UNVERIFIED"
      );
    }
  });

  it("別人のレスポンスは判定不能にする", () => {
    const body = { statusCode: 0, data: { user: { uniqueId: "someone_else" } } };
    expect(classifyAccountExistence(body, "target_user")).toBe("UNVERIFIED");
  });

  it("uniqueId の大文字小文字は区別しない", () => {
    const body = { statusCode: 0, data: { user: { uniqueId: "Target_User" } } };
    expect(classifyAccountExistence(body, "target_user")).toBe("EXISTS");
  });

  it("uniqueId がレスポンスに無ければ照合しない(parseProfileResponse と同じ方針)", () => {
    expect(classifyAccountExistence({ statusCode: 0, data: { user: { id: "1" } } }, "x")).toBe(
      "EXISTS"
    );
  });

  it("矛盾した応答では拒否側へ倒さない", () => {
    // statusCode 0(成功)なのに message が user_not_found。実在を返しているほうを信じる。
    expect(
      classifyAccountExistence(
        { statusCode: 0, message: "user_not_found", data: { user: { uniqueId: "x" } } },
        "x"
      )
    ).toBe("EXISTS");

    // 「いない」と言いながら user を返している。判定不能にする。
    expect(
      classifyAccountExistence(
        {
          statusCode: USER_NOT_FOUND_STATUS_CODE,
          message: "user_not_found",
          data: { user: { uniqueId: "x" } },
        },
        "x"
      )
    ).toBe("UNVERIFIED");
  });

  it("想定外の形はすべて判定不能にする", () => {
    for (const body of [null, undefined, "<html>", 123, {}, { statusCode: 0 }, { statusCode: 0, data: {} }, { statusCode: 0, data: { user: null } }]) {
      expect(classifyAccountExistence(body, "x")).toBe("UNVERIFIED");
    }
  });
});
