"use strict";

const { mapGiftPayload, mapActorPayload } = require("../../backend/lib/analytics-live-client");

describe("analytics-live-client mapping", () => {
    it("maps desktop gift payload to TLC-like gift event", () => {
        const mapped = mapGiftPayload({
            isCombo: true,
            repeatEnd: false,
            repeatCount: 4,
            comboId: "g1",
            tiktokHandle: "alice",
            nickname: "Alice",
            profilePictureUrl: "https://example/a.png",
            giftId: "5655",
            giftName: "Rose",
            diamondCount: 1,
            msgId: "m1"
        });
        expect(mapped.giftType).toBe(1);
        expect(mapped.uniqueId).toBe("alice");
        expect(mapped.repeatCount).toBe(4);
        expect(mapped.groupId).toBe("g1");
    });

    it("maps actor fields from tiktokHandle", () => {
        const mapped = mapActorPayload({
            tiktokHandle: "bob",
            tiktokUid: "123",
            nickname: "Bob",
            comment: "hi"
        });
        expect(mapped.uniqueId).toBe("bob");
        expect(mapped.userId).toBe("123");
        expect(mapped.comment).toBe("hi");
    });
});