# リリース前手動確認項目

## TikTok ID自動合流(live-sidestage-analytics)

- 配信者アカウントでTikTok ID変更 → `mergeTick()`実行後、旧ハンドルのroomが削除され
  Gift/バトル履歴が現ハンドル側へ引き継がれていること
- **合流後、旧ハンドルのTikTok listenerが残っていないこと**(`watchedRoomFilter()`が
  削除済みroomIdを対象外にすること。worker側のreconcileログで確認)
- Web `/setup` とmobile設定タブに合流通知バナーが表示され、閉じると再表示されないこと
  (`TiktokIdMergeLog.acknowledgedAt`)
- `BLOCKED_OLD_HANDLE_ALIVE`/`SELF_NOT_FOUND`時、赤を使わない中立トーンで
  「引き継げなかったデータがあります」バナーが出ること
