# バトルイベント対応(live-sidestage fork独自機能)

TikTok LIVEの1vs1/1vsNバトル(対戦)中に起きる「バトルアイテム使用」「ボーナスミッション」「初ギフトx倍区間」を
検出するために追加した機能。upstreamには存在しない。

**調査知見の正本は `~/.claude/skills/tiktok-probe/KNOWLEDGE.md`。** ここに書いているのは実装で使うための要約。
バイト単位の詳細な調査過程・未解決の残課題はそちらを参照する。

## 1. バトルアイテム使用の検出

### イベント

`WebcastEvent.LINK_MIC_BATTLE_ITEM_CARD`(`'linkMicBattleItemCard'`)。legacy client(`WebcastPushConnection`)・
v2 client(`TikTokLiveConnection`)どちらでも購読できる。

```ts
// legacy client (analytics / desktop が使っている方)
import { WebcastPushConnection, getBattleItemCard, getBattleItemCardSender, BattleItemCardType } from 'tiktok-live-connector';

const conn = new WebcastPushConnection('@someone');
conn.on('linkMicBattleItemCard', (msg) => {
    const card = getBattleItemCard(msg); // cardType に応じたスロットを解決
    if (!card) return; // cardType=POWER_UP_SUMMARY(4)、または未知のcardType

    const sender = getBattleItemCardSender(card); // User | undefined
    console.log({
        cardType: msg.cardType,
        battleId: msg.battleId,
        targetHostUserId: card.targetHostUserId, // 使用された側の配信主userId
        senderUserId: sender?.userId,
        senderNickname: sender?.nickname,
        senderUniqueId: sender?.uniqueId,
    });
});
```

```ts
// v2 client
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const conn = new TikTokLiveConnection('someone');
conn.on(WebcastEvent.LINK_MIC_BATTLE_ITEM_CARD, (msg) => { /* 同上 */ });
```

### `BattleItemCardType`(cardType判別表)

| 値 | 定数 | 意味 |
| --- | --- | --- |
| 2 | `GLOVE` | グローブ使用(クリティカル5倍) |
| 4 | `POWER_UP_SUMMARY` | 貢献上位者への定期パワーアップ通知。**アイテム使用ではない**。senderが無いのでノイズとして無視してよい |
| 6 | `HAMMER` | ハンマー(エフェクトカード)使用 |
| 10 | `TOP2_BOOSTER` | 2位ブースター使用 |
| 11 | `TOP3_BOOSTER` | 3位ブースター使用 |
| 12 | `VAULT_GLOVE` | 金グローブ(Vault Glove)使用。シークレットギフト限定でx6、通常ギフトはx5(ユーザー提供仕様、未裏取り) |

このイベントは**バトル参加全ルームへ同報される**。`card.targetHostUserId`で「どちら側の配信主で使われたか」を
判別できるので、片方のルームだけ監視していても両陣営のアイテム使用を検出できる。

### 実装上の注意

- `card.comment`配下(`commentKey`/`commentTemplate`)にはUI表示用の文言テンプレートが入っている(例:
  `"pm_mt_boost_send_crit_comment"` / `"{0:user} sent 1 boosting glove"`)。ロジック分岐には使わず、
  デバッグ表示程度に留めること(cardTypeで判別済みのため)
- カード名・アイコン画像(`ttlive_vaultGlove_name`等)はスキーマに含めていない。cardTypeによって内部階層が
  微妙に異なり(グローブ/ハンマー/金グローブはフラット、ブースターは1段深い)、item検出には不要なため
- グローブ・金グローブの効果時間は**30秒で確定**(ユーザー確認済み仕様)。効果ウィンドウを終了通知等で
  サーバー側から追跡する方法は未発見 — 検出は下記2の「ギフトへの倍率刻印」で行う(ウィンドウ計算は不要)

## 2. ギフトへの倍率刻印

アイテムの効果は`WebcastGiftMessage.matchInfo`にギフト単位で刻印される。追加のイベント購読は不要。

```ts
conn.on('gift', (gift) => {
    const m = gift.matchInfo;
    if (m.multiplierType !== 0) {
        console.log(`倍率${m.multiplierValue}倍(type=${m.multiplierType})`);
    }
});
```

`MultiplierType` enum(既存生成enumをそのまま使う):

| 値 | 意味 |
| --- | --- |
| 1 (`CRITICAL_STRIKE`) | グローブ crit。5倍 |
| 2 (`TOP_2`) | 2位ブースター。2倍 |
| 3 (`TOP_3`) | 3位ブースター。2倍 |
| 4 (`VAULT_GLOVE_CRITICAL_STRIKE`、fork独自追加) | 金グローブ crit。通常ギフト5倍/シークレットギフト6倍(未裏取り) |

`matchInfo.effectCardInUse`(既存フィールド)はハンマー(`HAMMER`)使用中のギフトで`true`になる(倍率は付かず、
演出系エフェクトの発動を示すのみ)。

**倍率は重複しない**: グローブcritとボーナス区間(下記3)が同時に有効でも、適用されるのは高い方の倍率のみ
(掛け算での重複はしない、ユーザー確認済み仕様)。

## 3. ボーナスミッション(2倍/3倍区間)

### イベント

`WebcastEvent.LINK_MIC_BATTLE_TASK`(`'linkMicBattleTask'`)、メッセージ型`WebcastLinkmicBattleTaskMessage`。
スキーマ自体はupstreamに既に存在していたが、legacy clientにcaseが無く発火していなかった(このforkで追加)。

```ts
conn.on('linkMicBattleTask', (msg) => {
    switch (msg.battleTaskMessageType) {
        case 0: // taskStart -- ミッション開始。条件・報酬倍率・スケジュールが入る
            const cfg = msg.taskStart.battleBonusConfig;
            console.log({
                targetType: cfg.taskPeriodConfig.targetType, // 1=人数系 / 2=実弾(pt)系 / 8=チーム戦pt系
                progressTarget: cfg.taskPeriodConfig.progressTarget, // 目標値(人数 or pt数)
                rewardMultiple: cfg.rewardPeriodConfig.rewardMultiple, // 2 or 3
            });
            break;
        case 1: // taskUpdate -- 進捗。fromUserUidで貢献者を特定できる
            console.log(msg.taskUpdate.taskProgress, msg.taskUpdate.fromUserUid);
            break;
        case 2: // taskSettle -- 確定
            console.log(msg.taskSettle.taskResult); // 0=中間settle / 1=未達成 / 2=達成
            break;
        case 3: // rewardSettle -- 報酬(倍率)区間の終了。sumはそのルームが区間中に獲得したボーナスpt合計
            console.log(msg.rewardSettle.rewardSettlePrompt.promptElements);
            break;
    }
});
```

ライフサイクル: `0(taskStart)` → `1(taskUpdate)`×n → `2(taskSettle)` → [報酬区間] → `3(rewardSettle)`。
`taskSettle.rewardStartTimestamp`は報酬区間の実開始より数秒〜十数秒早い値を取りうる(準備演出の分)。
実装で区間の正確な開始・終了を扱うなら、`rewardSettle`受信を「区間終了」の正、`taskSettle(result=2)`受信の
数秒後を「区間開始目安」として扱うのが実表示と近い。

`targetType`(`taskPeriodConfig.targetType`)判別表:

| 値 | 意味 |
| --- | --- |
| 1 | 人数系(「ギフターn人」ミッション)。`progressTarget`=人数 |
| 2 | 実弾系(ポイント獲得ミッション)。`progressTarget`=pt数 |
| 8 | チーム戦(1vsN)版の実弾系。`progressTarget`=pt数 |

`WebcastGiftMessage`自体にはこの区間の倍率は刻印されない(2の`matchInfo`とは非対称)。区間中の倍率適用有無を
ギフト単位で知りたい場合は、`WebcastLinkMicArmies`(`teamArmies[].teamUsers[].score`、チーム戦時。1vs1では
`battleItems[].userArmy[].score`)のスコア増分をギフトのdiamondCountと突き合わせて逆算する(下記4参照)。

## 4. 「初ギフトx倍」区間(2倍/3倍/なし)

バトル開始直後に発生する区間。**3のボーナスミッションとは別の仕組み**で、専用のプッシュメッセージが
存在しない(`WebcastLinkMicBattle`のバトル設定にも`WebcastLinkMicArmies`の定期更新にも倍率情報は現れない)。

- **発生タイミングは`WebcastLinkMicBattle.battleSetting.startTimeMs`から固定**(5分バトルで実測: 開始から
  約48秒間。1vs3の一部バトルではこれより長く適用された観測もあり、durationやバトル形式による差は未確定)
- **倍率は3パターン(2倍/3倍/なし)。ランダムではなく毎回固定発動するわけでもない**(ユーザー確認済み仕様)
- 倍率そのものを直接取得する手段が無いため、**`WebcastLinkMicArmies`のスコア増分をギフトの`diamondCount`で
  割って逆算する**しかない。実装例:

```ts
// 区間中(startTimeMs 〜 +48秒程度)に届いた単発ギフト1件について
// 直後のLinkMicArmies更新でのスコア増分を突き合わせる。
// multiplier = scoreDelta / gift.diamondCount (1なら"なし"扱いでよい)
```

同時多発ギフト・comboの連打では増分の切り分けが難しくなるため、判定は単発かつ`diamondCount`が大きめの
ギフトのタイミングで行うのが安全(小粒ギフトはArmies更新間隔とのズレで誤差が出やすい)。

## 5. 相手陣営の個別貢献者(ギフター)情報について(利用側=analyticsの既知制約)

- `anchorInfo`は両陣営分が自roomの受信だけで同時に届くため、**相手ホストの名前・ハンドル・アイコンは
  相手が未登録でも取れる**(live-sidestage-analyticsの`hostProfiles`、2026-08-27本番実証済み)
- ただし**相手陣営へギフトを送った視聴者個々の情報(誰が何をいくつ投げたか)はTikTok側が自room配信に
  同報しない**。取得するには相手roomにも別途接続して`gift`イベントを受信する必要がある
- **live-sidestage-analyticsは現状この相手room接続を行っておらず、個別貢献者明細
  (`BattleHistoryGiftEvent`)は自陣・相手陣とも常に0件**(2026-09-05 本番DB実測、全1113 participant中
  giftEvent 0件。`roomId`/`observedGiftTotal`/`captureStatus`等、2026-09-03に追加された対応列もPhase1
  バックフィル未実施で全participant null)
- 現状取得できるのは陣営合計スコア(`hostScores`)とホストのプロフィールのみ。ギフター個別の内訳は
  スキーマの受け皿はあるが実装が稼働しておらず取得不可
