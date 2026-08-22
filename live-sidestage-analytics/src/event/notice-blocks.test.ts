import { describe, it, expect } from "vitest";
import { parseNoticeBlocks } from "./notice-blocks";

describe("parseNoticeBlocks", () => {
  it("見出し2・箇条書き・見出し3・段落を分類する", () => {
    const raw = [
      "## 注意事項",
      "",
      "* 1つ目",
      "* 2つ目",
      "",
      "## FAQ",
      "",
      "### Q. 質問1",
      "",
      "回答1行目",
      "回答2行目",
    ].join("\n");

    expect(parseNoticeBlocks(raw)).toEqual([
      { type: "heading2", text: "注意事項" },
      { type: "list", items: ["1つ目", "2つ目"] },
      { type: "heading2", text: "FAQ" },
      { type: "heading3", text: "Q. 質問1" },
      { type: "paragraph", text: "回答1行目\n回答2行目" },
    ]);
  });

  it("空文字は空配列", () => {
    expect(parseNoticeBlocks("")).toEqual([]);
    expect(parseNoticeBlocks("   \n  \n")).toEqual([]);
  });

  it("記法に合わない行は段落として扱う(例外を投げない)", () => {
    expect(parseNoticeBlocks("ただの自由記述\n2行目")).toEqual([
      { type: "paragraph", text: "ただの自由記述\n2行目" },
    ]);
  });

  it("- 始まりの箇条書きにも対応する", () => {
    expect(parseNoticeBlocks("- 項目A\n- 項目B")).toEqual([
      { type: "list", items: ["項目A", "項目B"] },
    ]);
  });

  it("見出し直後(空行なし)でも前のブロックを区切る", () => {
    expect(parseNoticeBlocks("段落\n## 見出し")).toEqual([
      { type: "paragraph", text: "段落" },
      { type: "heading2", text: "見出し" },
    ]);
  });
});
