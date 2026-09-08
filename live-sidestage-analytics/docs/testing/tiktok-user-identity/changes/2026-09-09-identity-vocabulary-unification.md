---
date: 2026-09-09
feature: tiktok-user-identity
risk: CRITICAL
reviewers: (設計) Codex x3 + Fable x3 + Gemini x3 + DeepSeek(8周) / (実装後) review-auto Code Mode
---

# 識別子3語彙統一 — TikTokUser 導入と全テーブル TRUNCATE 移行

## 変更の要旨

人物識別を `principalId`(sidestage `User.id`)/ `tiktokUid`(TikTok の不変な数値ID)/ `tiktokHandle`
(可変の @ハンドル)の3語彙へ統一し、可変ハンドルを同一性キーにする設計を全廃した。
`TikTokUser`(`tiktokUid @id`)を表示名の正本として新設し、生観測系(`Gift` / `ListenerComment` /
`GiftDailyListenerStat` / `TiktokBattleTapPoint` ほか)から `uniqueId` / `nickname` / `profileImageUrl` を削除した。

## なぜ記録するか

- **後方互換を意図的に捨てた**: モバイル JWT の claim・Stripe metadata・公開シェアリンク・OBS の
  `overlayToken` / desktop の `apiKey` がすべて無効になる。運用開始前という前提でのみ成立する判断で、
  **運用開始後に同じ改修はできない**(JWT 90日 / Stripe metadata 無期限 / OBS URL は配信者の手作業)
- **移行が RENAME ではなく全テーブル TRUNCATE**: `scripts/migrate-tiktok-userid-reset.ts` は
  「旧形の列が1つでも存在する → `public` / `event` 両スキーマを TRUNCATE」の1枝しか持たない。
  判定を marker ではなく**旧形検出**にしたのは、marker が立たない正当な経路(新規DB初回起動)と
  組むと2回目のデプロイでデータを全消去するため

## 設計上、実コードで決着させた対立

- **`EventMatch` の手動確定を残すか消すか** — Fable「主催者入力は復元不能なので残せ」vs
  Codex「残すとブラケットが不整合のまま `finalizedAt` で永久固定」。`match-results.ts:177` の
  `MANUAL_DECISIONS` 除外 → `blocked` → `aggregate.ts` が `advanced` しか見ない、の3段を実コードで
  確認して **Codex 採用**(全件リセット + `AppSetting` へ write-once バックアップ)。多数決にしていない

## 実装後レビューで採用した VALID finding

| finding | 対処 |
| --- | --- |
| 登録ゲートが6時間の positive キャッシュ由来の uid を所有の根拠にしている(逆引き表そのもの) | `ExistenceCheckOptions.skipPositiveCache` を新設し、所有を確定する5経路(verify/generate・mobile/streamer・agency・worker-status・event participants)だけバイパス。negative キャッシュと in-flight 共有は維持 |
| `handleStaleAt` が立った room を監視停止の候補にしてしまう | `selectCleanupCandidates()` から除外。あわせて `tiktok-room-cleanup` の give-up 機構(`hostTiktokUidBackfillGaveUpAt` / `explicitNotFound`)を uid 化により廃止 |
| `AnalyticsView.tsx` が `&tiktokHandle=` を送り、両ルートとも `tiktokUid` 必須なので恒久 400 | クエリ・breakdown キャッシュキー・React key を `tiktokUid` へ。クライアント側 `interface` はサーバー DTO への嘘なので **tsc をすり抜けていた** |
| nullable 化した `tiktokHandle` / `nickname` で `.toLowerCase()` / `.localeCompare()` / `.replace()` が実行時 TypeError | `displayNameOf()`(`nickname → tiktokHandle → tiktokUid`)と `SenderIdentity` へ集約。ハンドル欠損時は `@null` を出さずプロフィールリンクも張らない |

INVALID として不対応にしたもの: `AppSetting` の `deleteMany` へ `RETENTION_DELETED_THROUGH_KEY` を
足す提案 — 計画が「削除済みの日を過少値で上書きしない安全弁として残す」と明示している。

## 検証

- `npm run typecheck` PASS / `npm run test:unit` PASS(105 files / 1470 tests) /
  `npm run test:integration` PASS(96 files / 889 tests)
- 実ブラウザ(`dev:local` + `seed:local` + Playwright): ランキング / 内訳展開 / ギフト履歴 / 390px の4面。
  `TikTokUser` 未観測の送信者を1件差し込み、表示名が `tiktokUid` まで落ちること・リンクを出さないことを実測

## 残るリスク・申し送り

- `TIKTOK_EXISTENCE_CHECK_DISABLED=1`(TikTok 障害時の kill switch)は uid 必須化により**登録を通せなくなる**。
  フラグの意味が変わった
- mobile の `RecentMergeNotice` / `AccountStatusStore` の `recentMerge` 経路が死にコード化した
  (`tiktok-id-migration.ts` 削除の帰結)
- `docs/testing/*/baseline.md` に残る「本番実測値」は本番データ削除後は再現できない。次回の実測で置き換える
- 本番適用は §9 の順序が前提(worker-guardian → worker1/2/3 → event-worker → web の順で停止 →
  web デプロイ → 逆順で再開)。cutover 後は `Dockerfile` の CMD から reset スクリプトを外す
