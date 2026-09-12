import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatContributionShareRangeLabel } from "./contribution-share-range-label";

describe("formatContributionShareRangeLabel", () => {
  it("customはUTC ISOをJSTの時刻表示へ変換する", () => {
    const label = formatContributionShareRangeLabel({
      period: "custom",
      dateRange: {
        start: "2026-09-12T15:00:00.000Z",
        end: "2026-09-12T16:00:00.000Z",
      },
    });
    expect(label).toContain("9/13");
    expect(label).toMatch(/0:00:00/);
    expect(label).toMatch(/1:00:00/);
    expect(label).not.toContain("16:00");
  });

  it("非customはdateRangeをそのまま結合する", () => {
    expect(
      formatContributionShareRangeLabel({
        period: "week",
        dateRange: { start: "2026-09-08", end: "2026-09-14" },
      })
    ).toBe("2026-09-08 〜 2026-09-14");
  });
});

describe("PublicContributionClient import boundary", () => {
  it("クライアントは contribution-share.ts を import しない", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../app/(public)/c/[token]/PublicContributionClient.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/from ["']@\/lib\/contribution-share["']/);
    expect(src).toMatch(/from ["']@\/lib\/contribution-share-range-label["']/);
  });
});
