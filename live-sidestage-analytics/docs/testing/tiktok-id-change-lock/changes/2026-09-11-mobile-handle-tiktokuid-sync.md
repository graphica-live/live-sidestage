date: 2026-09-11
feature: tiktok-id-change-lock
change summary: `PATCH /api/mobile/streamer`(`src/app/api/mobile/streamer/route.ts`)のハンドル変更処理で、実在確認により取得済みの新`tiktokUid`(`entryCheck.tiktokUid`)を`Streamer.tiktokUid`へ書き込んでいなかった実装漏れを修正。`resolveRoomForStreamer()`は`Streamer.tiktokUid`をキーに`TiktokRoom`を解決するため、修正前はハンドルを何度変えても常に最初に登録したアカウントのroomへ紐付き続け、新アカウントの実データ(gift/comment/貢献欄)が反映されない不具合が本番で発生していた。冪等分岐を「真の冪等リトライ(`verifiedTiktokUid: null`)」と「大文字小文字のみの変更(`verifiedTiktokUid`非null、実在確認は走る)」に分割し、後者は通常分岐と同じCAS(`tiktokHandleChangedAt`条件の`updateMany`)・`verified`リセットを適用する。
risk: HIGH(DB書込み・認証所有権判定に近い領域、`principalId`/`tiktokUid`/`tiktokHandle`の3語彙の一角に触れる)。ただしmigration不要、単一UPDATE文への1フィールド追加、git revertで安全に戻せるためCRITICALではない。
reason: ユーザー実測報告「モバイルからtiktokhandle変えても貢献欄やギフトがyu_ki_nojoのもののまま」を受けた原因調査で、`checkTiktokUidMatch()`の一時無効化(2026-09-11、別件)により別アカウントへの付け替え自体は通るようになっていたが、`Streamer.tiktokUid`の追従書き込みが元から欠落していたことが判明。`isTiktokUidMismatchCheckDisabled()`自体は今回変更しない(別件)。
affected baseline cases: TC-LOCK-702/705の期待結果を「`tiktokUid`は不変」から「`tiktokUid`も検証済みの新しい値へ追従する」へ反転。新規: TC-LOCK-206(room再解決の実証)、TC-LOCK-207(冪等リトライでtiktokUid不変)、TC-LOCK-208(大文字小文字のみ変更でtiktokUid追従・verifiedリセット)、TC-LOCK-302(fail-closedレースの実リクエスト再現)。
reviewers: design-review: DeepSeek + Codex-terra(HIGH、独立並列)。code-review: DeepSeek + Codex-terra(HIGH、2ラウンド)。test-auto TestCase Mode: DeepSeek + Codex-terra(HIGH、code-reviewで`--testcase-file`未使用のため単独実施)。
important findings:
- design-review DeepSeek(MEDIUM、VALID): 冪等分岐にCAS(`tiktokHandleChangedAt`条件)が無かった → `tx.streamer.updateMany()`へ変更
- design-review Codex(HIGH、VALID): 同分岐で`verified`/`verifiedAt`リセット漏れ → 上記CAS修正と合わせて解消
- design-review Codex(MEDIUM、VALID): room再解決の実テストが無い(既存テストは`resolveRoomForStreamer`をグローバルモックで固定していた) → TC-LOCK-206として当該テストのみモック上書きで実装本体を検証するテストを追加
- code-review 1ラウンド目 DeepSeek(HIGH、VALID): `verifiedTiktokUid!`のnon-null assertionが、事前読取後・tx内再読取前のレースで実は`null`になりうる(fail-closed違反、`tiktokUid: null`のDB書込みリスク) → `if (!verifiedTiktokUid) return {kind: "conflict"}`ガードを追加、assertion除去
- code-review DeepSeek(MEDIUM、INVALID、計2ラウンドで繰り返し): 外側ゲート(`cleanTiktokHandle !== user.streamer.tiktokHandle`)を「正規化後比較」と誤読していたが、実際は生文字列比較であり大文字小文字のみの変更でもentryCheckは正しく実行される
- code-review 2ラウンド目 DeepSeek(HIGH、INVALID): room解決テストが`checkTiktokExistence`を未mockと主張したが、実際はテストファイル冒頭でグローバルmock済み(Grepで実証)
- code-review Codex(2ラウンドともNO ISSUES)
- test-auto TestCase Mode DeepSeek(HIGH、VALID): 大文字小文字のみの変更分岐(`verifiedTiktokUid`付きの冪等分岐)を直接テストするケースが無かった → TC-LOCK-208として新規テストコード追加(verifiedリセットの有無で分岐を識別)
- test-auto TestCase Mode Codex(HIGH、VALID): TC-LOCK-302(fail-closedレース)がコードレビューのみでPASSとしていたが、実リクエスト2本のレースを再現するテストが無かった → `prisma.$transaction`を`vi.spyOn`で割り込み、txコールバック実行直前に別UPDATEでハンドルを変更する方式で実際にレースを再現するテストへ格上げ
- test-auto TestCase Mode Codex(LOW、指摘時点でVALID、対応中に別経路で解消): TC-LOCK-207が完全同一ハンドルのみで大文字小文字のみの変更をカバーしていない → Codex実行と並行してTC-LOCK-208を追加済みだったため、結果的にALREADY_HANDLED
verification: `npm run typecheck` / `npm run test:unit`(1554件PASS) / `npm run test:integration`(101ファイル951件PASS、`route.integration.test.ts`は11件PASS)
remaining risks: 孤立`TiktokRoom`行(修正前に新アカウントのgiftが流れ込んでいた別room)への過去データの遡及的付け替えは対象外(フォワード修正のみ)。`isTiktokUidMismatchCheckDisabled()`の一時無効化状態自体は別件のため今回変更していない — 再有効化された場合、この修正で追加された「大文字小文字のみの変更でもtiktokUidを検証済み値へ追従させる」経路自体は影響を受けない(`checkTiktokUidMatch`は一致判定のみで、追従書き込みの可否とは独立)。Web版(`/api/verify/generate`)に同種の実装漏れが無いかは未調査(design-review時点でこの修正はmobile PATCH経路のみを対象と判断)。
