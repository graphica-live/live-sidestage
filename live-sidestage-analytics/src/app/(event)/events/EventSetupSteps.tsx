import type { EventFormat } from "@/event/validation";

/**
 * イベント作成直後の続きの流れ(参加者登録 → トーナメント表作成 → 完了)を示す進捗表示。
 *
 * `EventWizard` の手順バーと違い、ここは実際の DB 状態(参加者・対戦の有無)を主催者が
 * 自分で判断して次へ進むだけの目印。飛ばしても・後で戻っても壊れない(公開は既に有効なので)。
 */
const STEP_LABELS = {
  basics: "基本情報",
  participants: "参加者登録",
  bracket: "トーナメント表作成",
  done: "完了・公開中",
} as const;

type Step = keyof typeof STEP_LABELS;

export function EventSetupSteps({
  format,
  current,
}: {
  format: EventFormat;
  current: "participants" | "bracket";
}) {
  const steps: Step[] =
    format === "TOURNAMENT"
      ? ["basics", "participants", "bracket", "done"]
      : ["basics", "participants", "done"];
  const currentIndex = steps.indexOf(current);

  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step} className="flex items-center gap-2">
            {index > 0 && <span className="text-muted">›</span>}
            <span
              className={
                active ? "font-medium text-strong" : done ? "text-muted" : "text-muted opacity-60"
              }
            >
              {index + 1}. {STEP_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
