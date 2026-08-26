// kind → サーバー側実装の対応表。**サーバー専用**(集計が prisma を引く)。
//
// `satisfies Record<OverlayKind, ...>` にしてあるので、kinds.ts に種類を足して
// ここへ実装を書き忘れると型エラーになる。この2ファイルが揃わないと
// 「管理画面にカードは出るのに API は 404」という半端な状態が生まれるため、
// 完全性は型で担保する。

import { OVERLAY_KIND_META, type OverlayKind } from "./kinds";
import { buildOverlaySnapshot } from "./contribution.server";

export type OverlayKindServer = {
  /** socket.io で流すイベント名。kinds.ts の値をそのまま使う(2箇所に書かない) */
  snapshotEvent: string;
  /** 表示に必要な全データ。null は「この配信者では出せない」(roomId 未設定など) */
  buildSnapshot: (streamerId: string) => Promise<object | null>;
};

export const OVERLAY_KIND_SERVER = {
  contribution: {
    snapshotEvent: OVERLAY_KIND_META.contribution.snapshotEvent,
    buildSnapshot: buildOverlaySnapshot,
  },
} satisfies Record<OverlayKind, OverlayKindServer>;
