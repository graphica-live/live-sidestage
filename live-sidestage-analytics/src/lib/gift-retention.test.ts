import { describe, it, expect } from "vitest";
import { deletionSkipReason, dayKeyStartUtc } from "./gift-retention";
import {
  GIFT_ROLLUP_READ_CUTOFF_DAYS,
  dayKeyOf,
  isWithinRawGiftWindow,
  shiftDayKey,
} from "./gift-retention-window";

describe("deletionSkipReason", () => {
  it("watermarkが未設定(バックフィル未完了)なら削除しない", () => {
    expect(deletionSkipReason(null, "2026-06-07")).toContain("未設定");
  });

  it("watermarkが削除対象の最大dayKeyに届いていなければ削除しない", () => {
    expect(deletionSkipReason("2026-06-01", "2026-06-07")).toContain("追いついていない");
    // 同値も不可(その日がロールアップ済みでも、境界を跨ぐ判断はより安全側へ倒す)。
    expect(deletionSkipReason("2026-06-07", "2026-06-07")).toContain("追いついていない");
  });

  it("watermarkが削除対象より新しければ削除してよい", () => {
    expect(deletionSkipReason("2026-06-08", "2026-06-07")).toBeNull();
    expect(deletionSkipReason("2026-09-05", "2026-06-07")).toBeNull();
  });
});

describe("dayKeyStartUtc", () => {
  it("dayKeyをJSTの日の始まりとして解釈する", () => {
    expect(dayKeyStartUtc("2026-09-06").toISOString()).toBe("2026-09-05T15:00:00.000Z");
  });
});

describe("dayKeyOf", () => {
  it("UTCの15:00以降は翌日のdayKeyになる(JST)", () => {
    expect(dayKeyOf(new Date("2026-09-05T14:59:59.000Z"))).toBe("2026-09-05");
    expect(dayKeyOf(new Date("2026-09-05T15:00:00.000Z"))).toBe("2026-09-06");
  });
});

describe("isWithinRawGiftWindow", () => {
  const now = new Date("2026-09-06T03:00:00.000Z");
  const today = dayKeyOf(now);

  it("下限が80日前以降ならロールアップを読む必要がない(DBを引かずに判定できる)", () => {
    expect(isWithinRawGiftWindow(shiftDayKey(today, -GIFT_ROLLUP_READ_CUTOFF_DAYS), now)).toBe(true);
    expect(isWithinRawGiftWindow(today, now)).toBe(true);
  });

  it("下限が80日より前、または範囲が無制限なら分割の判断が要る", () => {
    expect(isWithinRawGiftWindow(shiftDayKey(today, -(GIFT_ROLLUP_READ_CUTOFF_DAYS + 1)), now)).toBe(
      false
    );
    expect(isWithinRawGiftWindow(null, now)).toBe(false);
  });
});
