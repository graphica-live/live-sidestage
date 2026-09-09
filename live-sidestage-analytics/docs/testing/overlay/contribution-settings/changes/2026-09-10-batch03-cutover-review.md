---
date: 2026-09-10
feature: Overlay Contribution Settings (Batch03: アプリケーションコードcutover)
risk: HIGH
reviewers: DeepSeek (deepseek-v4-flash@high), Codex (terra@medium)
---

## Change summary

`/api/streamer/overlay-settings`(GET/PATCH)と`buildOverlaySnapshot()`を、Streamer列直読み・直書きから新テーブル`OverlayContributionSettings`経由へ切替。`src/lib/overlay/settings-kinds.ts`に既存5テーブルと同じ`{load, patch}`パターンで`contributionSettingsServer`を追加。

## Reason

Batch01(テーブル追加)・Batch02(backfill)は既に本番反映済み。本Batchはその読み書き先を実際に新テーブルへ切り替える段階で、既存の確立済みパターン(settings-kinds.ts)を複製するだけの変更として計画された(Risk: MEDIUM想定)。

## Reviewer findings — VALID採用

1. **DeepSeek HIGH**: `route.ts`のPATCHハンドラが`contributionSettingsServer.patch()`の内部payload(`result.payload`)をそのまま応答として返していた。この内部payloadは`OverlaySettingsPayload`契約が要求する`overlayToken`・`isToday`を持たず、`align`/`headingBackground`/`displaySpeed`の正規化(`normalizeOverlayAlign`等)も通していない。旧実装(cutover前)はPATCH応答も`toResponse()`経由でGETと同じ完全な契約形を返していたため、これは実質的なAPI契約破壊の回帰だった。
   - 修正: PATCHハンドラを`toResponse({overlayToken: streamer.overlayToken, overlayContributionSettings: result.payload})`経由に変更。
   - 同時にDeepSeekのTEST PLAN指摘(既存route統合テストがoverlayTokenをアサートしておらず検出できなかった)もVALID。`route.integration.test.ts`にoverlayToken/isToday/正規化値のアサーションを追加(baseline TC-OVCS-010)。

2. **Codex MEDIUM**: `contributionSettingsServer.patch()`内の`clampInt`が、threshold/goalCount/visibleRows/nameMaxWidthへ新規の上限(1,000,000 / 1,000,000 / 100 / 1,000)を追加していた。旧Streamer列直書き実装(cutover前)はこれらに上限を課していなかったため、既存クライアントが送っていた値が理由なく400になる後方互換性の破壊だった。
   - 修正: 上限をPostgres Int32の上限(2,147,483,647)へ緩和し、実質的な新規ビジネスルールを持ち込まない形にした。
   - 回帰防止テストを追加(baseline TC-OVCS-014、`route.integration.test.ts`)。

## Reviewer findings — INVALID（対応不要）

- DeepSeek LOW: 「`data`が空オブジェクトのままupsertされるとPrismaがエラーになる可能性」。実際にはPrismaの`upsert`は`update: {}`を許容し、対象フィールドを変更せず`updatedAt`のみ触れる正常動作のため実害なし。旧実装(`prisma.streamer.update({data: {}})`)でも同様の呼び出し形だったため、cutoverによる新規リスクでもない。

## Verification

- `npm run typecheck`: PASS
- `npm run test:unit`: PASS (1520/1520)
- `contribution.server.integration.test.ts`: PASS (2/2)
- `route.integration.test.ts`: PASS (10/10、修正過程で2ケース追加)

## Remaining risks

- Streamer旧9列はこのBatchでもまだ削除しない(Batch04で別途、CRITICAL・不可逆、ユーザー明示許可必須)。
- 本番backfill(Batch02)が完了している前提でこのcutoverを反映する必要がある(計画書のInvariants参照)。
