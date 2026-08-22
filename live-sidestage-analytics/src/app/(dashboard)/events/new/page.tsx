import Link from "next/link";
import { toJstInputValue } from "@/event/datetime";
import type { EventDraft } from "@/event/wizard";
import { EventWizard } from "../EventWizard";

export const dynamic = "force-dynamic";

// "YYYY-MM-DDTHH:mm" の分を00に切り上げる(JSTはUTC+9固定でDSTがないため、UTC msでの丸めがそのままJSTの時刻境界になる)。
function ceilToHour(date: Date): Date {
  const hourMs = 3600_000;
  return new Date(Math.ceil(date.getTime() / hourMs) * hourMs);
}

function defaultDraft(): EventDraft {
  const now = Date.now();
  // 既定は「現在時刻の6時間後を00分に切り上げ」から2時間の1日程。JST に丸めるのは toJstInputValue が担当する。
  const startAt = ceilToHour(new Date(now + 6 * 3600_000));
  const endAt = new Date(startAt.getTime() + 2 * 3600_000);
  return {
    // 種目は既定値を持たせない。作成後に変更できないので、必ず主催者に選ばせる。
    format: null,
    title: "",
    description: "",
    entryMode: "SOLO",
    teamPreset: "GENERIC",
    // 公開範囲の選択UIは廃止した。常に公開で作成する(下の EventWizard 参照)。
    visibility: "PUBLIC",
    sessions: [
      {
        name: "",
        startAt: toJstInputValue(startAt),
        endAt: toJstInputValue(endAt),
      },
    ],
  };
}

export default function NewEventPage() {
  return (
    <div>
      <Link href="/events" className="text-xs text-gray-500 hover:text-white">
        ← イベント一覧
      </Link>
      <h1 className="mb-6 mt-2 text-xl font-bold">新しいイベント</h1>
      <EventWizard initial={defaultDraft()} />
    </div>
  );
}
