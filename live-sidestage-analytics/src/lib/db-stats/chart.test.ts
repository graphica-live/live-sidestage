import { describe, it, expect } from "vitest";
import { renderTrendChartPng } from "@/lib/db-stats/chart";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("renderTrendChartPng", () => {
  it("有効なPNG(先頭マジックバイト一致)を返す", () => {
    const png = renderTrendChartPng("全体件数の推移", [
      { label: "09-04", value: 100 },
      { label: "09-05", value: 150 },
      { label: "09-06", value: 200 },
    ]);

    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  it("データ点が1件でも例外を投げずPNGを返す", () => {
    const png = renderTrendChartPng("単一点", [{ label: "09-06", value: 10 }]);
    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  it("データが空でも「データなし」プレースホルダをPNGとして返す", () => {
    const png = renderTrendChartPng("空データ", []);
    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
  });
});
