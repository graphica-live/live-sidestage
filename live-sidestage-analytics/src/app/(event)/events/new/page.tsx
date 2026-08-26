import { toJstInputValue } from "@/event/datetime";
import { MATCH_RULES_DEFAULT } from "@/event/match-rules";
import { DEFAULT_NOTICE_TEMPLATE } from "@/event/notice-template";
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
    matchRules: MATCH_RULES_DEFAULT,
    // 標準シード方式(プロ大会方式)を既定にする。段階的方式はTOURNAMENT選択時に選べる。
    bracketMethod: "STANDARD",
    // 順位決定戦は既定で行わない(1つ増やすごとに参加者の実バトルが増えるため)。
    placementDepth: 0,
    prizeText: "",
    noticeText: DEFAULT_NOTICE_TEMPLATE,
  };
}

export default function NewEventPage() {
  return (
    <div>
      <h1 className="mb-6 text-xl font-bold">新しいイベント</h1>
      <EventWizard initial={defaultDraft()} />
    </div>
  );
}
