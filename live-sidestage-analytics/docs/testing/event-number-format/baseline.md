---
project: live-sidestage-analytics
feature: event-number-format
last_updated: 2026-09-09
last_risk: MEDIUM
last_reviewers: Gemini (Code Mode)
---

# イベント表示用 数値フォーマッタ

公開イベントページ (`/e/[slug]`) と大会運営画面 (`/events/[id]/matches`) が
ギフト数・ポイントを表示するときの整形規約。実装は `src/event/format.ts`。

集計値は Prisma の `BigInt` / `Decimal` 由来の**文字列**で渡る。`Number` へ落とすと
`Number.MAX_SAFE_INTEGER` 超で桁が壊れるため、フォーマッタは文字列のまま整形する。

`src/event/format.ts` は client component からも値で import される。
server 専用の依存 (prisma / sharp) を引くモジュールに置いてはならない。

## 正常

| ID | 内容 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- |
| TC-NF-001 | 4桁以上の整数を表示する | 3桁ごとにカンマが入る (`1234567` → `1,234,567`) | `npx vitest run src/event/format.test.ts` | PASS |
| TC-NF-002 | 小数を含む値を表示する | 整数部だけ区切られ、小数部は区切られない (`1234567.89` → `1,234,567.89`) | 同上 | PASS |
| TC-NF-003 | ポイントの小数部が `.00` の値を表示する | `.00` が落ちる (`1234.00` → `1,234`) | 同上 | PASS |
| TC-NF-004 | ポイントの小数部が `.00` 以外の値を表示する | 小数部が保たれる (`1234.50` → `1,234.50`) | 同上 | PASS |

## 境界

| ID | 内容 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- |
| TC-NF-005 | 区切りが発生しない上限 (`999`) と発生する下限 (`1000`) | `999` はそのまま / `1000` は `1,000` | `npx vitest run src/event/format.test.ts` | PASS |
| TC-NF-006 | `0` を表示する | `0` がそのまま出る（空文字や `-0` にならない） | 同上 | PASS |
| TC-NF-007 | `Number.MAX_SAFE_INTEGER` を超える桁数の値を表示する | 桁が欠けず全桁が区切られる (`9007199254740993` → `9,007,199,254,740,993`) | 同上 | PASS |

## 異常

| ID | 内容 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- |
| TC-NF-008 | 負数を表示する | 符号が先頭に残り、整数部だけ区切られる (`-1234567` → `-1,234,567`) | `npx vitest run src/event/format.test.ts` | PASS |
| TC-NF-009 | 負数のポイントで小数部が `.00` | 符号を保ったまま `.00` が落ちる (`-1234.00` → `-1,234`) | 同上 | PASS |

## 回帰

| ID | 内容 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- |
| TC-NF-010 | `"use client"` のコンポーネントがフォーマッタを値 import した状態で本番ビルドする | `next build` が成功する（client bundle へ `sharp` 等の server 専用依存が入らず `node:*` の解決に失敗しない） | `npm run build` | PASS |

## Out of Scope

- ロケール別の桁区切り（現状は日本向けの `,` 固定。多言語対応の要件は無い）
- 表示桁数の丸め・単位変換（`K` / `M` 表記等）。集計側が渡した値をそのまま整形する仕様
