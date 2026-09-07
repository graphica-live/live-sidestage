---
date: 2026-09-07
feature: gift-catalog
risk: MEDIUM
reviewers: DeepSeek(Design Mode 2ラウンド, Code Mode 1ラウンド)
affected_baseline_cases: TC-GC-007, TC-GC-011, TC-GC-027(新規), TC-GC-028(新規)
---

## 変更概要

`refreshGiftCatalogIfStale()` のja版(`webcast_language=ja-JP`)取得を「複数部屋のうち1部屋成功したら以降スキップ」に変更。日本プロキシ(`GIFT_CATALOG_PROXY_URL`)経由のリクエストを、TTL(2時間)ごとに部屋数ぶんから実質1回に削減した。

## 背景

グローバルギフトの日本語名はどの部屋(room_id)から取得しても同一値、配信者固有のコミュニティギフト(`tracker_params.gift_subtype === "community_gift"`)はwebcast_language非依存でbase(default locale)取得時点から日本語名が確定している(2026-08-27/28実測、`gift-name-verification/REPORT.md` 発見2)。この実測に基づき、複数部屋全てにja版を叩く既存実装は冗長と判断した。

## Reviewer指摘とVALID判断

- **Design Mode 1ラウンド目 HIGH**: 「community_giftがbase時点で日本語確定」という前提の実測が計画書に無い → REPORT.mdへの参照を明記し解消(実測自体は既存)
- **Design Mode 1ラウンド目 MEDIUM**: ja取得を打ち切ると、打ち切り後の部屋にしか出現しないコミュニティギフトの`labelJa`が`null`のまま欠落する回帰リスク → VALID。`mergeLocalizedCatalog`に`hasJapaneseText()`フォールバック(baseのlabelがひらがな・カタカナを含めば`labelJa`へ採用)を追加して解消
- **Design Mode 2ラウンド目 CRITICAL**: 修正版の擬似コードが`jaByGiftId`の型(呼び出し元スコープの`Map<CatalogEntry>`と`mergeLocalizedCatalog`内ローカルの`Map<string>`)を混同していた → VALID。擬似コードの誤りであり、実装は`mergeLocalizedCatalog`内で完結させ型不整合を回避
- **Code Mode MEDIUM**: `hasJapaneseText`の正規表現がCJK統合漢字単独(中国語の可能性)を拾ってしまう → VALID。ひらがな・カタカナの存在のみを判定条件に狭めた(`/[぀-ヿ]/`、CJK統合漢字の範囲を除外)
- **Code Mode MEDIUM(TestCase)**: baseline.mdのTC-GC-007がフォールバック追加後の挙動を反映していない、ja取得打ち切り最適化のテストケースが無い → VALID。TC-GC-007を更新、TC-GC-027/028を新規追加

## 検証

- `npx vitest run src/lib/tiktok-gift-catalog.test.ts`: 69/69 PASS(新規4件含む)
- `npx vitest run --exclude '**/*.integration.test.ts'`(analytics全体): 1435/1435 PASS
- `npm run typecheck`: PASS
- `npx next build`: Errors 0(36 page + 90 route 生成確認)
- test:integration(DB要): 今回の変更は`CatalogEntry`/`LocalizedCatalogEntry`型・`writeCatalog`の書き込み経路・consumer側(`GET /api/mobile/gifts`等)の読み出しロジックを一切変更していないため対象外と判断。NOT RUN

## 残るリスク

- `hasJapaneseText()`はひらがな・カタカナの有無による簡易判定。ひらがな・カタカナを含まない(漢字のみ、または非日本語)コミュニティギフト名が将来現れた場合、その部屋がja取得打ち切り後に出現すると`labelJa`が欠落する可能性がある(実測した`REPORT.md`のサンプルは全てひらがな・カタカナを含んでいた)。発生時は目視での気づきに依存する
