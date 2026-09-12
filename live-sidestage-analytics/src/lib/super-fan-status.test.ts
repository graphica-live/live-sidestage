import { describe, expect, it } from "vitest";
import {
  PORTRAIT_TAG_NOT_SUB,
  PORTRAIT_TAG_SUB_FOR_MO,
  isSuperFanBarrageDisplayType,
  resolveSuperFanJoinUserId,
  resolveSuperFanStatus,
} from "./super-fan-status";

function chatLike(overrides: {
  subAnchor: boolean;
  tag: string;
}): Record<string, unknown> {
  return {
    userIdentity: { isSubscriberOfAnchor: overrides.subAnchor },
    publicAreaMessageCommon: {
      portraitInfo: {
        portraitTag: [{ showValue: overrides.tag }],
      },
    },
  };
}

describe("resolveSuperFanStatus", () => {
  it("SF: subForMo + isSubscriberOfAnchor true", () => {
    expect(
      resolveSuperFanStatus(chatLike({ subAnchor: true, tag: PORTRAIT_TAG_SUB_FOR_MO }))
    ).toBe(true);
  });

  it("NSF: notSub + isSubscriberOfAnchor false", () => {
    expect(
      resolveSuperFanStatus(chatLike({ subAnchor: false, tag: PORTRAIT_TAG_NOT_SUB }))
    ).toBe(false);
  });

  it("タグ欠落 → null", () => {
    expect(resolveSuperFanStatus({ userIdentity: { isSubscriberOfAnchor: true } })).toBe(
      null
    );
  });

  it("矛盾 → null", () => {
    expect(
      resolveSuperFanStatus(chatLike({ subAnchor: false, tag: PORTRAIT_TAG_SUB_FOR_MO }))
    ).toBe(null);
  });
});

describe("barrage super fan join", () => {
  it("displayType", () => {
    expect(
      isSuperFanBarrageDisplayType("ttlive_superFan_commentNotif_superFanJoined")
    ).toBe(true);
    expect(isSuperFanBarrageDisplayType("pm_mt_fan_live_join")).toBe(false);
  });

  it("user_id from schema", () => {
    expect(
      resolveSuperFanJoinUserId({
        schema: "sslocal://webcast_profile?user_id=7409973246077076496&type=half",
      })
    ).toBe("7409973246077076496");
  });
});
