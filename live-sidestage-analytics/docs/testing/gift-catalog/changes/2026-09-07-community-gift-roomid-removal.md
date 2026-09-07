---
date: 2026-09-07
feature: gift-catalog
risk: MEDIUM
reviewers: DeepSeek(Design Mode 1ラウンド, Code Mode 1ラウンド、TestCase十分性レビュー同時実施)
affected_baseline_cases: TC-GC-011(仕様変更), TC-GC-012(廃止), TC-GC-021(廃止), TC-GC-022(廃止), TC-GC-027(備考更新), TC-GC-028(仕様変更), TC-GC-029(新規)
---

## 変更概要

`resolveGiftCatalogSources()`(`tiktok-listener.ts`)がroom_id付きで複数部屋(最大3部屋)からカタログを取得していた仕組みを撤去し、room_id無し・1部屋(`GIFT_CATALOG_SOURCE_COUNT=1`)構成に単純化した。配信者固有のコミュニティギフト(community_gift)の事前収集機能そのものを削除する判断。

## 背景・経緯

直前のcommit(`ebeb2b4`、ja版取得を1部屋成功で打ち切る最適化)の完了後、ユーザーとの対話で以下が明らかになった。

1. ユーザーが「Giftテーブルにコミュニティギフトの日本語名がそのまま入っている」と指摘。`gift-name-verification/REPORT.md`発見2で裏付け実測済み(LIVE受信時点で既に日本語名確定、webcast_language非依存)。
2. これを受けユーザーが「だからカタログ取得にroom_idいらないよね」と提起。Claudeが`GET /api/mobile/gifts`(`route.ts`)の実装を確認し、カタログだけでなく`Gift`受信履歴からも候補を拾う和集合設計であること、履歴由来のlabelは`giftName`をそのまま使うためcommunity_giftは初回受信後に自動的に日本語名込みでピッカーに出ることを確認。
3. `gift-history.ts`のlabelJa差し替えも「無ければ元データ表示」がフォールバックのため、community_giftはlabelJa無しでも表示に問題がないことを確認。

→ room_id付き複数部屋取得の唯一の目的だった「community_gift事前収集」の価値が、「まだ一度も受信していない配信者固有ギフトをピッカーに事前表示する」ことだけに縮小していると判断し、撤去した。

## Reviewer指摘とVALID判断

- **Design Mode MEDIUM**: icon等の非name metadataも事前収集が必要では? → ALREADY_HANDLED。`route.ts`の`adoptImage()`が受信履歴側の`giftPictureUrl`からも画像を拾う設計であることをplanに明記
- **Design Mode MEDIUM**: `orderRoomsLiveFirst`削除で単一部屋がinactiveだと失敗率が上がるのでは? → ALREADY_HANDLED。base取得はHTTPのみでライブ中か問わない設計のため懸念自体は的外れだが、複数部屋フォールバック喪失はplanのrisk節に既述
- **Design Mode LOW**: `MAX_GIFT_CATALOG_SOURCES`という定数名が実態(固定1件)と不整合 → VALID。`GIFT_CATALOG_SOURCE_COUNT`へリネーム
- **Design Mode LOW**: 他箇所での`roomId`参照漏れ確認 → VALID。typecheckで検出・修正(テスト2ファイル、型定義)
- **Design Mode LOW**: 既存DBのcommunity_gift行が更新されず古いまま残留 → VALID。riskとして明記、明示的な削除ロジックは過剰実装としてスコープ外
- **Design Mode LOW**: 単一ソース失敗時のテスト不足 → VALID。TC-GC-029として追加
- **Code Mode**: NO ISSUES(finding 0件)

## 検証

- `npx vitest run src/lib/tiktok-gift-catalog.test.ts`: 65/65 PASS
- `npx vitest run --exclude '**/*.integration.test.ts'`(analytics全体): 1425/1425 PASS
- `npm run typecheck`: PASS
- `npx next build`: Errors 0(126 page+route生成確認)
- test:integration(DB要): カタログ書き込み経路・consumer側のクエリ形状は変更していないため対象外と判断。NOT RUN

## 残るリスク

- 配信者固有のコミュニティギフトが「まだ一度も受信していない」段階では、`GET /api/mobile/gifts`のピッカーに事前に出なくなる(自由入力導線はあるので機能停止ではない)
- 既存DBに残っているcommunity_gift行(icon URL等)は今後upsertで更新されず古いまま残る。表示専用データなので実害は小さいと判断し、削除ロジックは追加していない
- 複数部屋巡回のフォールバック性(1部屋目失敗時に2部屋目で救う)は`resolveSources()`側の防御コードとして維持しているが、`resolveGiftCatalogSources()`自体は通常1件しか返さないため、実運用では発動しない
