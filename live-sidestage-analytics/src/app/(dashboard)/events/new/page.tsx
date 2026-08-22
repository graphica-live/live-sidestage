import Link from "next/link";
import { toJstInputValue } from "@/event/datetime";
import type { EventDraft } from "@/event/wizard";
import { EventWizard } from "../EventWizard";

export const dynamic = "force-dynamic";

function defaultDraft(): EventDraft {
  const now = Date.now();
  return {
    // 種目は既定値を持たせない。作成後に変更できないので、必ず主催者に選ばせる。
    format: null,
    title: "",
    description: "",
    entryMode: "SOLO",
    teamPreset: "GENERIC",
    visibility: "PRIVATE",
    // 既定は「明日から1週間」の1日程。JST に丸めるのは toJstInputValue が担当する。
    sessions: [
      {
        name: "",
        startAt: toJstInputValue(new Date(now + 24 * 3600_000)),
        endAt: toJstInputValue(new Date(now + 8 * 24 * 3600_000)),
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
