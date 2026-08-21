import Link from "next/link";
import { EventForm, type EventFormValues } from "../EventForm";
import { toJstInputValue } from "@/event/datetime";

export const dynamic = "force-dynamic";

function defaultValues(): EventFormValues {
  const now = Date.now();
  return {
    title: "",
    description: "",
    format: "DIAMOND_RACE",
    entryMode: "SOLO",
    teamPreset: "GENERIC",
    visibility: "UNLISTED",
    // 既定は「明日から1週間」。JST に丸めるのは toJstInputValue が担当する。
    startAt: toJstInputValue(new Date(now + 24 * 3600_000)),
    endAt: toJstInputValue(new Date(now + 8 * 24 * 3600_000)),
  };
}

export default function NewEventPage() {
  return (
    <div>
      <Link href="/events" className="text-xs text-gray-500 hover:text-white">
        ← イベント一覧
      </Link>
      <h1 className="mb-6 mt-2 text-xl font-bold">新しいイベント</h1>
      <EventForm mode="create" initial={defaultValues()} />
    </div>
  );
}
