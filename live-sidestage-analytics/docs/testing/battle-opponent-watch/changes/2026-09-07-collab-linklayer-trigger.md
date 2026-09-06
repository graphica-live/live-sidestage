---
date: 2026-09-07
feature: battle-opponent-watch
risk: HIGH
reviewers: DeepSeek V4 Flash（初回 + 修正後）/ Fable（Codex・Gemini とも quota 切れのためユーザー承認の上で代理、追加確認1回）
---

# コラボ相手の監視トリガを AGREE 限定から「全員 LINKED」判定へ

## 変更概要

`linkLayer`（`messageType:18`）で相手 room を監視対象へ入れる条件を、`source` に `REPLY_STATUS_AGREE` を
含むイベント限定から、**`groupChangeContent.groupUser.userList` が全員 LINKED のイベント**へ広げた
（`shouldWatchCollabSnapshot()`）。それ以外は従来どおり AGREE のみ通す。

## なぜ必要だったか

直近14日の `tiktok_battles.opponentWatch` で `battle_start`（コラボ承諾を観測できずバトル開始まで
相手を発見できなかった）が29件あり、**全件が4人戦**だった。陣営でも自 room の接続タイミングでも説明できず、
残る説明が `isCollabJoinSource` の足切りだった。AGREE は probe ログ169件中14件（8%）しかない。

`battle_start` 経由は接続確立まで数秒〜10秒ギフトを観測できず、`battle_history_participants.captureStatus`
の悪化に直結する。

## 撤回した原案と、その根拠（重要）

原案は「`source` を完全に無視して `userInfos` 全員を監視」。**資源暴走を招くため撤回した。**

probe ログ169件の実測:

- `userInfos` の要素数 = `userList` の LINKED(status:3) + WAITING(status:1) が **167件で一致**。
  つまり `userInfos` には**招待中でまだ承諾していない人が載る**
- `userList` のエントリは `channelId` キーで `userInfos` の userId と**対応付けられない**。
  「誰が LINKED か」を個人単位で判別する手段はこのメッセージ単体に無く、使えるのは件数の一致だけ
- `source` 分布: 招待送信系97 / AGREE 14 / `live_end` 1 / `"1"` 7 / `""` 7

原案のままだと、おすすめリストから連続招待する配信者1人につき招待した全員の room を作成・接続する
（実測相当で15分に20〜30room）。2026-09-06 の EulerStream 署名枠を日次上限まで消費した障害と同じ経路。

## reviewer の重要指摘と判断

| finding | 分類 | 対応 |
| --- | --- | --- |
| Fable(MEDIUM): 「WAITING が0」で判定すると未知 status に fail-open。proto の `GroupStatus` には `GROUP_STATUS_UNKNOWN = 0` があり、値2は未定義 | VALID | 判定を「**LINKED 以外が0**」へ変更（`otherCount` を追加）。実測169件では1と3しか出ないので観測済みトラフィックでの挙動は不変 |
| Fable(LOW): `userInfos` が LINKED 件数より多い実例が2件ある（`userList` に居ない人が混ざる） | VALID | `displayIds.length <= linkedCount` を条件に追加。`displayIds` は重複除去・空文字除去で小さくなる方向にしかずれないため「多い = 余分な人が居る」 |
| DeepSeek(LOW): `displayIds` 空時の warn が `otherCount` を数えていない | VALID | 条件へ `otherCount` を加算 |
| DeepSeek(MEDIUM): 負の integration テストが固定 200ms 待ちで脆い | VALID | `expect.poll`（2秒 / 50ms 間隔）へ変更 |
| DeepSeek(MEDIUM): `linkedCount > 0` が「`userList` 欠落」も塞ぐので将来の payload 変更で発見漏れ | INVALID | finding 本文自身が LOW へ格下げしており、fail-closed は設計上の意図。構造変化時に暴走側へ倒れないことを優先する |
| DeepSeek(LOW): `linkedCount` が `userList` の重複を除去していない | INVALID | 重複時に増えるのは冪等な `ensureRoomWatchedForCollab` の呼び出しのみ |

Fable への追加確認（`userList` が「存在するが空配列」のケース）:
`Array.isArray(...) ? ... : []` の正規化でキー欠落と同じ値になり、`linkedCount > 0` が false のため
AGREE 以外は採用しない。probe ログでは空配列・キー欠落とも0件（未観測）。
「`linkedCount > 0` が必須条件」という境界を名指しで固定するため TC-BOW-026 を追加した。

## 検証

- Quality Gate: `tsc --noEmit` / `npm run test:unit`（94 files / 1328 tests）/ `npx next build` / 関連 integration 18 tests — 全 PASS
- 影響ケース: TC-BOW-020〜026 を追加（baseline 参照）

## 残るリスク

4人戦の相手陣営が自 room の linkmic グループに載る保証は無い。載らない場合この変更は無害だが
`battle_start` は残る。効果測定は本番デプロイ後に `opponentWatch` の `battle_start` 件数と、
新設した `[collab] groupChange` ログ（`source` / `linked` / `waiting` / `other` / `ids`）で行う。
