---
date: 2026-09-07
feature: tiktok-account-confirm-modal
risk: HIGH
reviewers: DeepSeek(Design/Code/TestCase Mode。Codex/Geminiは当時利用不能、ユーザー指示によりDeepSeekのみで完了扱い)
---

## 変更概要

TikTok ID登録(setup画面の初回登録 / admin-workers画面の監視対象追加)を「入力→即登録」から
「入力→サーバがTikTok実在確認(nickname/avatar/BIO/フォロー数/フォロワー数取得)→確認モーダル表示→
ユーザーの確定操作→初めて登録」の2段階へ変更。取得失敗時は登録を全面ブロックし、
日本語メッセージ+エラーコードで表示する。

## 理由

なりすまし・誤入力による意図しないID登録を防ぐため。既存のfail-closedな実在確認ゲート
(`requireExistingTiktokAccount`)を拡張し、追加のTikTok通信・署名消費なしでプレビュー情報を取得する。

## reviewer指摘とVALID/INVALID判断

Code Mode(DeepSeek): finding 2件、実コード照合の結果いずれもINVALID。

TestCase Mode(DeepSeek): finding 7件、全件VALID。

- HIGH×2(採用・修正): `extractVerifiedAccountPreview`/`previewTiktokAccount`の単体テスト欠如
  → `tiktok-profile.test.ts`/`tiktok-existence.test.ts`へテスト追加
- MEDIUM×1(採用・修正): admin側の確認失敗時に`setConfirmPreview(null)`を呼ばずモーダルが開いたままになる回帰
  (setup側は元から閉じる実装で、admin側だけ非対称だった)
  → `admin/workers/page.tsx`の`handleConfirmAdd`を修正、TC-TACM-012として恒久ケース化
- MEDIUM×1(見送り): 確定API(`/api/verify/generate`等)自体のエラーコード網羅テスト欠如
- LOW×3(見送り): 認証ガード・DB非書き込み・loading状態の検証が単体テスト化されずコードレビュー止まり

見送り4件の判断根拠: 指摘は技術的に正しいが、本プロジェクトは`route.ts`ハンドラ自体を単体テスト化せず
コードレビュー+Playwrightでカバーする既存慣習を持つ(`admin-workers-watch`baselineのTC-AWW-008が先例)。
新規機能だけこの慣習を破ると一貫性が崩れるため、既存方針を踏襲し追加テスト化を見送った。

## Visual QA判断: DESIGN.md陳腐化

採用comp(spec.md)はTikTok Red(#fe2c55)を指定していたが、実装は既存`.btn-primary`(`bg-brand`、
実測indigo `rgb(79 70 229)`)をそのまま踏襲した。判断: DESIGN.md自体が「TikTok Redは現行実装からの
抽出記録であり恒久ブランドではない」と明記しており、実装は既存コンポーネント・サイト全体の配色と
完全に一致している(全スクリーンショットでindigo以外のボタン色が存在しない)。よってこれを実装欠陥ではなく
DESIGN.md/spec.mdの陳腐化と判定し、DESIGN.mdへ注記を追加(実装色は変更せず)。
構造・余白・タイポ・角丸・情報密度・要素インベントリはcompと完全一致(MAJOR差分ゼロ)。

## 検証

- typecheck: エラー0
- test:unit: 1431件全通過(新規追加11件含む)
- Playwright実ブラウザ確認: setup/admin-workers両画面、10状態撮影、コンソール/ネットワークエラーなし
- Visual QA Compare Mode: PASS(色を除き完全一致、色は上記の通りDESIGN.md陳腐化と判定)

## 残存リスク

- レート制限・タイムアウト時のUNVERIFIED経路(TC-TACM-003)はUI経由の実地再現は行わず、既存の
  fail-closedゲートの単体テストのみで担保。実配信環境でのサーキットブレーカー発火は未実地検証
- DESIGN.mdの色トークン自体(indigo vs TikTok Red)の整合性は本タスクのスコープ外。ブランド刷新の
  経緯が未確認のため、値の是正は別タスクとする
