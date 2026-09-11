---
date: 2026-09-11
feature: 貢献タブ(ContributionTab)
---

## 変更概要

Server Authoritative State + Socket.IO Push + Versioned State Synchronization刷新(Batch01〜05)の実装後コードレビューで、Codexレビューが2件のHIGHバグを検出し、Batch06として修正した。

## リスク

HIGH(実装後コードレビュー、Codex terra/medium + DeepSeek)。

## 経緯・理由

1. **push受信時にUIが更新されない**: `RankingSyncStore`が正常なsnapshot pushを受信しても、`ContributionTab`の`_onRankingSnapshot()`は`store.needsResync`が`true`(mismatch検知時)の場合だけ`_load()`(REST再取得)を呼んでいた。`build()`も`_result`(RESTキャッシュ)のみを描画し、`store.getSnapshot()`を一切参照していなかった。結果、通常のpush経路が実質機能していなかった。
2. **REST取得後のversion tracker resetでpushが永久欠損扱いになる**: `acknowledgeResync()`が`VersionTracker.reset()`(lastVersion=0)を呼んでいたため、REST取得時点でサーバーversionが既に進んでいる(例: 7)場合、次のpush(version 8)が「version欠損」と誤判定され、REST再取得→再度reset→また欠損、という無限ループになりうる。

## 対応したbaselineケース

TC-CT-017(push受信時のUI反映)、TC-CT-018(REST後のversion同期)。

## 検証

- `flutter analyze`: エラーなし(既存info 4件は本変更と無関係)
- `flutter test`: 566件全pass(`test/realtime_sync_test.dart`のacknowledge()関連ケース含む)
- 実機/エミュレータでのpush反映確認はNOT RUN(worktree内に`.mcp.json`(Marionette MCP)無し、`adb`もPATH未導入のため)

## 残存リスク

push反映の実機での目視確認は未実施。次回このworktree外(本チェックアウト)でMarionette MCP/adbが使える環境なら実施が望ましい。
