// 注意事項/FAQ(Event.noticeText)の軽量Markdownサブセットパーサ。
//
// プロジェクトにMarkdownライブラリの依存が無い(package.json確認済み)ため、新規依存を足さず
// テンプレートが使う記法(見出し2種・箇条書き・空行区切り段落)だけを解釈する。自由編集で
// パターンに合わない行が来ても例外は投げず、そのまま段落として扱う。

export type NoticeBlock =
  | { type: "heading2"; text: string }
  | { type: "heading3"; text: string }
  | { type: "list"; items: string[] }
  | { type: "paragraph"; text: string };

export function parseNoticeBlocks(raw: string): NoticeBlock[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: NoticeBlock[] = [];
  let listBuffer: string[] = [];
  let paragraphBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push({ type: "list", items: listBuffer });
      listBuffer = [];
    }
  };
  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      blocks.push({ type: "paragraph", text: paragraphBuffer.join("\n") });
      paragraphBuffer = [];
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    const h3Match = /^###\s+(.+)$/.exec(trimmed);
    if (h3Match) {
      flushList();
      flushParagraph();
      blocks.push({ type: "heading3", text: h3Match[1].trim() });
      continue;
    }

    const h2Match = /^##\s+(.+)$/.exec(trimmed);
    if (h2Match) {
      flushList();
      flushParagraph();
      blocks.push({ type: "heading2", text: h2Match[1].trim() });
      continue;
    }

    const listMatch = /^[*-]\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      flushParagraph();
      listBuffer.push(listMatch[1].trim());
      continue;
    }

    if (trimmed === "") {
      flushList();
      flushParagraph();
      continue;
    }

    flushList();
    paragraphBuffer.push(trimmed);
  }
  flushList();
  flushParagraph();

  return blocks;
}
