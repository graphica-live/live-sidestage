// オーバーレイの「表示中の日」を決める計算。ギフトは JST の日付(dayKey)で束ねられている。
// contracts.ts と同様、ブラウザから import されても安全なように import ゼロを保つ。

export function jstDateKey(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// YYYY-MM-DD 文字列を起点にoffsetDays日シフトする(「今日」からの相対計算ではない点がjstDateKeyと異なる)。
export function shiftDayKey(dayKey: string, offsetDays: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

type OverlayDisplaySettings = {
  overlayDisplayReference: string;
  overlayDisplayDate: string | null;
};

// overlayDisplayReference が "fixed" なら固定された日付を、"today" なら常に現在のJST日付を返す。
// これにより「翌日ボタンで今日に追いつくと自動的に自動追従へ戻る」挙動を実現する。
export function resolveOverlayDayKey(streamer: OverlayDisplaySettings): string {
  if (streamer.overlayDisplayReference === "fixed") {
    return streamer.overlayDisplayDate || jstDateKey();
  }
  return jstDateKey();
}

export function inferOverlayDisplayReference(dayKey: string): "today" | "fixed" {
  return dayKey === jstDateKey() ? "today" : "fixed";
}
