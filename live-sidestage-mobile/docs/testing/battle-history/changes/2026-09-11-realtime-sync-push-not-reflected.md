---
date: 2026-09-11
feature: battle-history-tab
---

## 変更概要

Server Authoritative State + Socket.IO Push + Versioned State Synchronization刷新(Batch01〜05)の実装後コードレビューで、Codexレビューが2件のHIGHバグを検出し、Batch06として修正した(貢献タブ・ギフト履歴タブと共通の`lib/core/realtime_sync.dart`基盤に起因)。

## リスク

HIGH(実装後コードレビュー、Codex terra/medium + DeepSeek)。

## 経緯・理由

1. **push受信時にUIが更新されない**: `BattleHistorySyncStore`が正常なupsert pushを受信しても、`BattleHistoryTab`の`_onBattleHistoryUpsert()`は`store.needsResync`時のみ`_load()`を呼んでいた。`build()`も`_result`(RESTキャッシュ)のみ描画し、`store.getBattles()`を参照していなかった。
2. **REST取得後のversion tracker resetでpushが永久欠損扱いになる**: `acknowledgeResync()`が常に`VersionTracker.reset()`していたため、REST取得後の実サーバーversionと乖離し、次のpushが恒久的に「version欠損」と誤判定されるおそれがあった。

## 対応したbaselineケース

TC-BH-022(push受信時のUI反映)、TC-BH-023(REST後のversion同期)。

## 検証

- `flutter analyze`: No issues found(既存info 4件は本変更と無関係)
- `flutter test`: 566 tests, All tests passed!
- 実機/エミュレータでのpush反映確認はNOT RUN(worktree内に`.mcp.json`(Marionette MCP)無し、`adb`もPATH未導入のため。既存のTC-BH-014/015/016等と同じ制約)

## 残存リスク

push反映の実機での目視確認は未実施。
