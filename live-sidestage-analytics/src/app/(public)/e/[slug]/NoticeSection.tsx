import { parseNoticeBlocks } from "@/event/notice-blocks";

/** 注意事項とFAQ。軽量Markdownサブセット(見出し2種・箇条書き・段落)を描画する。 */
export function NoticeSection({ text }: { text: string }) {
  const blocks = parseNoticeBlocks(text);
  if (blocks.length === 0) return null;

  return (
    <div className="grid gap-3">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading2":
            return (
              <h3
                key={index}
                className="mt-2 flex items-center gap-2.5 font-[family-name:var(--font-battle)] text-xl font-black tracking-tight text-white first:mt-0"
              >
                <span className="h-5 w-1.5 shrink-0 -skew-x-12 bg-brand" aria-hidden />
                {block.text}
              </h3>
            );
          case "heading3":
            return (
              <h4 key={index} className="mt-1 text-sm font-bold text-gray-200">
                {block.text}
              </h4>
            );
          case "list":
            return (
              <ul key={index} className="grid gap-1 pl-4 text-sm text-gray-300">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="list-disc marker:text-brand/70">
                    {item}
                  </li>
                ))}
              </ul>
            );
          case "paragraph":
            return (
              <p key={index} className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                {block.text}
              </p>
            );
        }
      })}
    </div>
  );
}
