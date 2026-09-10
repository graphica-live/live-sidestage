# 2026-09-10 コイン閾値を配信者ごとに設定可能にし、トグル・しきい値をDBへ永続化

- feature: battle-history-list (web) / battle-history-list (mobile)
- risk: HIGH (Prisma schema変更。新規テーブルのみ、既存テーブル・列は無変更)
- reviewers: design-review = DeepSeek V4 Flash / Gemini 3.7 Flash(agy) / Codex-terra(medium)、code-review = DeepSeek(high) + Codex-terra(medium)、TestCase review = DeepSeek(high)

## 変更概要

- 新テーブル `battle_history_filter_settings`(Streamer 1:1、`hideLowDiamondEnabled` 既定 false / `threshold` 既定 100)を追加
- `GET/PATCH /api/streamer/battle-filter-settings`(自Streamerのみ、`resolveStreamerId()` で認可)
- `AnalyticsView` にしきい値の数値入力を追加。`persistBattleFilter` prop が true(`/analytics` のみ)のときだけ設定APIで永続化し、管理画面(`/admin/rooms/[roomId]`)はローカル state のみで動作(設定APIを一切呼ばない)
- mobile側 `BattleFilterStore` の既定トグルを true → false へ変更し、web側の既定値と統一

## reviewerの重要判断

- design-review: 命名 `hideSmallEnabled`→`hideLowDiamondEnabled` へ変更(DeepSeek MEDIUM, VALID)。admin除外機構を `persistBattleFilter` prop として明文化(DeepSeek HIGH, VALID)。fallback値を false/100 へ統一(Gemini LOW・DeepSeek MEDIUM, VALID)
- code-review: DeepSeekの「unmount後のsetState警告」指摘(MEDIUM)は **INVALID** — React 18.3.1 では当該コンソール警告自体が廃止済みで再現しない
- code-review: Codexは OmniRoute 503(Chat admission capacity)で2回失敗。3回目で完了、finding無し(NO ISSUES、canary対象外の通常サイズ)
- TestCase review(DeepSeek): finding 7件中6件VALID。しきい値上限境界(2147483647/超過)・部分PATCH・不正JSONボディ・`threshold` に boolean/null を許容してしまう検証の緩さ(→ `typeof "number"` 必須へ締めた)・UI不正入力ケースの記述強化をbaselineとテストへ反映。GET既存行の重複指摘は既存の「値を変更できる」テストで担保済みのため ALREADY_HANDLED

## verification

- typecheck PASS / test:unit 1521件PASS / test:integration 935件PASS(新規15件含む、うち1件は本diff無関係の残存DB行が原因のFAILを特定・清掃して解消)
- mobile: `flutter test test/battle_filter_store_test.dart` 4/4 PASS、`flutter analyze` clean
- Playwright実ブラウザ: 既定表示(トグルOFF・100)/しきい値1500・50000反映/リロード後永続化/不正入力(-5)復元・PATCH未送信/admin画面で設定API呼び出し0件/設定API失敗時のエラー表示、をそれぞれ確認・撮影

## remaining risks

- mobile側の既定OFF化は実機(Pixel 7a)での動作確認は NOT RUN(定数変更のみでロジック無変更のため `flutter test` で代替。理由はmobile側baselineに明記)
