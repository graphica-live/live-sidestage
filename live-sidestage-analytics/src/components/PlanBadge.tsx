import Link from "next/link";

/**
 * Web各サービスヘッダーのプラン表示。表示文字列はサーバー側`getPlanDisplay`が組み立てた
 * `label`をそのまま渡す(β前置きの正本はplan-display.ts。クライアントで組み立て直さない)。
 */
export function PlanBadge({ label }: { label: string }) {
  return (
    <Link
      href="/billing"
      className="inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[11px] font-bold text-white hover:opacity-90 transition-opacity"
      style={{
        background: "linear-gradient(90deg, #d81f36, #ff4d5e)",
      }}
      title="プラン"
    >
      {label}
    </Link>
  );
}
