# TikTok ID自動合流 サポート手順書

配信者がTikTokのハンドル(表示ID)を変更すると、`TiktokIdMergeJob` → `mergeTick()`(`event-worker.ts`)が
数値userIdを鍵に旧ハンドルのroomを自動で現ハンドルへ合流させる。実装は
[src/lib/tiktok-id-migration.ts](../src/lib/tiktok-id-migration.ts)、判定結果は全て
`TiktokIdMergeLog`(`outcome`列)に記録される(`NO_CANDIDATE`以外は全件記録)。

問い合わせが来たら `TiktokIdMergeLog` を `streamerId` で検索し、直近の行の `outcome` を見る。

```sql
SELECT * FROM public."TiktokIdMergeLog"
WHERE "streamerId" = '<streamerId>'
ORDER BY "createdAt" DESC LIMIT 5;
```

## outcome別の対応

### `BLOCKED_OLD_HANDLE_ALIVE` — 旧ハンドルがTikTok上にまだ存在する

自動合流の3条件(新ハンドルのuserId取得成功・候補roomのhostUserId完全一致・旧ハンドルがTikTok上でMISSING)のうち
「旧ハンドルがMISSING」を満たさない。24hバックオフで最大7〜30日再試行してから`failed`になる。

想定される原因は3つ、切り分けはユーザーへのヒアリングと`hostUserId`の突き合わせで行う。

1. **TikTokが旧ハンドルを一定期間予約・リダイレクトしている**(改名直後)→ 数日待って再確認。
   まだ`pending`で残っていれば自然に解消するのを待つのが基本
2. **squatter(第三者)が旧ハンドルを取得した** → 本人の旧ハンドルではなくなっているので、
   この自動合流は成立させてはいけない。データは`TiktokRoom`に残っているので、
   本人確認が取れた場合のみ手動で`absorbRooms()`相当の操作を検討する(下記「手動合流」)
3. **本人が旧ハンドルを別アカウントで取り直した** → 実質2と同じ状態。本人であることの確認を優先する

**旧room・現roomのそれぞれの`hostUserId`を比較する**ことで、本人の旧ハンドルかどうかの判断材料になる
(一致していれば同一TikTokアカウント)。

```sql
SELECT id, "tiktokId", "hostUserId" FROM public."TiktokRoom"
WHERE id IN ('<oldRoomId>', '<survivingRoomId>');
```

### `BLOCKED_HOST_MISMATCH` — 現roomの保存済みhostUserIdが実際のuserIdと食い違う

**多くの場合、対応不要な正常系。** 典型的にはハンドルの使い回し(前の持ち主が手放したハンドルを
別人が取得して登録)。合流自体はブロックされず、実userIdでの候補探索へ自動的に続行するため、
このoutcomeだけが最終結果として残っているなら「その周回でたまたま候補が0件だった」ことを意味する。

手動対応が必要になるのは、room分離(将来`TiktokRoom.abandonedAt`案)で明示的に切り離す場合のみ。
現状この機能は未実装のため、基本的に静観でよい。

### `SELF_NOT_FOUND` — 新ハンドル自体がTikTok上で見つからない

打ち間違いの可能性が高い。入口の実在確認(`checkAccountExistence`)は登録時に1回通しているが、
その後TikTok側でアカウントが消えた・凍結された等の理由でここに落ちることもある。
本人にTikTok側のアカウント状態を確認してもらう。

### `EVENT_ACTIVE` — 候補roomが未finalizeのイベントに参加中

一時的なブロック。該当イベントが終了しfinalizeされれば次の周回(1時間おきに再試行)で自動的に合流する。
問い合わせが来た場合は「イベント終了後に自動で反映される」旨を案内すれば足りる。手動対応は不要。

### `failed`(ジョブの最終状態) — 上限(`attempts`既定10)を超えて失敗

`lastError`列を確認する。`BLOCKED_OLD_HANDLE_ALIVE`が7〜30日続いた末に`failed`になっているケースが最多。
自動再試行はもう走らないため、状況が変わった(旧ハンドルが本当にMISSINGになった等)と判明したら
`TiktokIdMergeJob`を手動で`pending`へ戻す。

```sql
UPDATE public."TiktokIdMergeJob"
SET status = 'pending', attempts = 0, "nextAttemptAt" = now(), "lastError" = NULL
WHERE "streamerId" = '<streamerId>';
```

## 手動合流(squatterでない本人確認済みのケースのみ)

自動合流の3条件を満たさないが、本人確認が取れて手動合流が妥当と判断した場合は、
`src/lib/tiktok-id-migration.ts`の`absorbRooms()`相当の処理を手動実行する。
Gift・TiktokBattle・BattleHistory・AgencyWatch・EventRoomLease・Streamerの6種のリレーションを
1トランザクションで移動する必要があり、片手落ちの手動SQLは事故の元なので、
原則スクリプト経由(`absorbRooms()`を呼ぶワンオフスクリプト)で実行し、**旧room削除前に対象streamerIdの
Gift件数を控えてから行う**。いいね集計(旧LikeTally)はプロセス内インメモリ(当日分のみ)のため
合流の対象外——候補room側の当日分は引き継がず破棄される。

## イベント期間中の合流による順位変動

合流が開催中のイベント期間内に起きると、旧ハンドルの過去Gift(イベント期間内に旧ハンドルで受けた分を含む)が
新roomへ移り、10秒ごとの全期間再集計で順位が変わることがある。同一TikTokアカウントのギフトなので帰属は
正しいが、主催者から順位変動の問い合わせが来た場合はこの仕組みを説明する。finalize済みイベントには
反映されない(`EVENT_ACTIVE`でブロックされるため)。

## 関連ドキュメント

- 実装計画全体: `~/.claude/plans/tiktokid-orweb-id-id-1-id-rippling-moore.md`
- hostUserId補完の仕組み: [src/event/CLAUDE.md](../src/event/CLAUDE.md)「hostUserId」節
