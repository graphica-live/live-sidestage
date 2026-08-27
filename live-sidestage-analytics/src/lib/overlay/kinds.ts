// オーバーレイ種類のメタ情報。表示ページ・管理画面・API がここを唯一の一覧として参照する。
//
// **このファイルはブラウザ(クライアントコンポーネント)からも import される。**
// contracts.ts と同じく import ゼロを保つこと。サーバー側の実装(集計関数)の対応表は
// server-kinds.ts にあり、そちらが `satisfies Record<OverlayKind, ...>` で
// 「ここに足したのに実装が無い」を型エラーにする。
//
// 種類を増やすときは (1) ここに1エントリ (2) server-kinds.ts に実装 (3) 表示ページを
// src/app/(overlay)/overlay/<kind>/page.tsx に置く、の3点で載る。
// ただし設定の保存は /api/streamer/overlay-settings が contribution 固定なので、
// 設定が要る種類を足すときはその API の設計から必要になる(hasSettings を参照)。

// desktop(TikEffect)の5ウィジェット移植で "coin-list"/"top-gift"/"like-contribution"/
// "tap-list"/"timer" を追加。kind名はdesktop側のウィジェットファイル名と一致させてある
// (backend/public/widgets/<name>.html)。サポート対応時にdesktop版と混同なく照合できる。
export const OVERLAY_KINDS = [
  "contribution",
  "coin-list",
  "top-gift",
  "like-contribution",
  "tap-list",
  "timer",
] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export type OverlayKindMeta = {
  kind: OverlayKind;
  label: string;
  description: string;
  /** OBS ブラウザソースに貼るパス。`?token=` は呼び出し側が付ける */
  path: string;
  /** socket.io で snapshot が流れてくるイベント名。**既存の OBS が購読しているので変えない** */
  snapshotEvent: string;
  /** /api/streamer/overlay-settings で設定を保存できる種類かどうか */
  hasSettings: boolean;
};

export const OVERLAY_KIND_META: Record<OverlayKind, OverlayKindMeta> = {
  contribution: {
    kind: "contribution",
    label: "貢献リスト",
    description: "設定したコイン数を超えたリスナーを、超えた順に並べて表示します。",
    path: "/overlay/contribution",
    snapshotEvent: "overlay:contribution:snapshot",
    hasSettings: true,
  },
  "coin-list": {
    kind: "coin-list",
    label: "コイン数一覧",
    description: "本日のコイン貢献者を金額順に一覧表示します。",
    path: "/overlay/coin-list",
    snapshotEvent: "overlay:coin-list:snapshot",
    hasSettings: true,
  },
  "top-gift": {
    kind: "top-gift",
    label: "本日最高ギフト",
    description: "本日届いた単価最高のギフトを表示します。",
    path: "/overlay/top-gift",
    snapshotEvent: "overlay:top-gift:snapshot",
    hasSettings: true,
  },
  "like-contribution": {
    kind: "like-contribution",
    label: "Like貢献通知",
    description: "いいねが一定数貯まるごとにポップアップで通知します。",
    path: "/overlay/like-contribution",
    snapshotEvent: "overlay:like-contribution:snapshot",
    hasSettings: true,
  },
  "tap-list": {
    kind: "tap-list",
    label: "Like数一覧",
    description: "本日のいいね数ランキングを一覧表示します。",
    path: "/overlay/tap-list",
    snapshotEvent: "overlay:tap-list:snapshot",
    hasSettings: true,
  },
  timer: {
    kind: "timer",
    label: "タイマー",
    description: "カウントダウンタイマーを表示します。ギフト受信で時間を増減できます。",
    path: "/overlay/timer",
    snapshotEvent: "overlay:timer:snapshot",
    hasSettings: true,
  },
};

export const OVERLAY_KIND_LIST: OverlayKindMeta[] = OVERLAY_KINDS.map((kind) => OVERLAY_KIND_META[kind]);

export function isOverlayKind(value: string): value is OverlayKind {
  return (OVERLAY_KINDS as readonly string[]).includes(value);
}

/** OBS に貼る絶対 URL。origin はブラウザ側でしか分からないので呼び出し側から渡す */
export function overlayUrlFor(meta: OverlayKindMeta, origin: string, token: string): string {
  return `${origin}${meta.path}?token=${encodeURIComponent(token)}`;
}
