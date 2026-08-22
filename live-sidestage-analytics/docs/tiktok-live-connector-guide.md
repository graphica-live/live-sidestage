# TikTok Live Connector 実装ガイド

他アプリで `tiktok-live-connector` を使って配信情報を取得するための実装指示書。
このアプリ（tikeffect）の実装から抽出した実践的なパターン集。

---

## 1. 依存パッケージ

```json
{
  "dependencies": {
    "tiktok-live-connector": "^2.1.1-beta1"
  }
}
```

---

## 2. 基本的な接続フロー

### 2-1. インポートと接続オブジェクト生成

```js
const { WebcastPushConnection } = require('tiktok-live-connector');

const connection = new WebcastPushConnection('@username', {
    processInitialData: false,       // 接続前の過去データを処理しない
    fetchRoomInfoOnConnect: true,    // 接続時にルーム情報を取得
    enableExtendedGiftInfo: false,   // 拡張ギフト情報は不要なら false
    enableWebsocketUpgrade: true,    // WebSocket を優先
    enableRequestPolling: false,     // ポーリングは使わない（WebSocket専用構成）
    disableEulerFallbacks: true,     // Euler フォールバックを無効化
    sessionId: undefined,            // 認証なし（匿名接続）
    authenticateWs: false,
    webClientParams: {
        app_language: 'ja',
        device_platform: 'web',
        browser_language: 'ja'
    },
    webClientHeaders: {
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    wsClientParams: {
        app_language: 'ja',
        device_platform: 'web',
        browser_language: 'ja'
    },
    wsClientHeaders: {
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
});
```

**重要な設計判断:**
- `sessionId` は渡さない。認証セッションを2本張ると TikTok のリスクスコアが上がり「異常な取引」エラーが発生する
- `enableRequestPolling: false` + `enableWebsocketUpgrade: true` で WebSocket 専用構成にする
- `processInitialData: false` で接続前の古いイベントを無視する

### 2-2. イベントリスナー登録（接続前に設定する）

**重要:** `disconnected` / `streamEnd` / `error` は `connect()` 実行中にも発火する。
`connect()` 中のエラーは catch ブロックで処理するため、`connectPromise` が存在する間はイベントを無視する。
このガードがないと「接続失敗 → disconnected 発火 → 10秒後再接続 → ループ」になる。

```js
// connect() 実行中かどうかを追跡するフラグ
let connectPromise = null;

// 切断（connect() 完了後のランタイム切断のみ処理）
connection.on('disconnected', () => {
    if (connectPromise) return; // connect() 中は catch が処理する
    scheduleReconnect('disconnected');
});

// 配信終了（同上）
connection.on('streamEnd', () => {
    if (connectPromise) return;
    scheduleReconnect('stream_end');
});

// ランタイムエラー（connect() 完了後に発生した WebSocket 切断など）
connection.on('error', (err) => {
    if (connectPromise) return; // connect() 中は catch が処理する
    if (isUserOfflineError(err)) {
        scheduleReconnect('user_offline');
        return;
    }
    scheduleReconnect('error', err?.message);
});

// ギフト
connection.on('gift', (data) => {
    // data.giftType === 1 → コンボ継続中
    // data.repeatEnd === true → コンボ終了
    // data.repeatCount → 個数
    // data.diamondCount → 1個あたりのコイン価値
    // data.uniqueId, data.nickname, data.profilePictureUrl
    // data.giftId, data.giftName, data.giftPictureUrl
});

// チャット（コメント）
connection.on('chat', (data) => {
    // data.uniqueId, data.nickname, data.comment
});

// いいね（likeCount は1イベントで複数いいね分まとめて来る）
connection.on('like', (data) => {
    // data.likeCount → このイベントでのいいね数
    // data.totalLikeCount → 累計いいね数
    // data.uniqueId, data.nickname
});

// 入室
connection.on('member', (data) => {
    // data.uniqueId, data.nickname
});

// フォロー
connection.on('follow', (data) => {
    // data.uniqueId, data.nickname
});

// シェア
connection.on('share', (data) => {
    // data.uniqueId, data.nickname
});

// サブスク
connection.on('subscribe', (data) => {
    // data.uniqueId, data.nickname
});

// 視聴者数
connection.on('roomUser', (data) => {
    // data.viewerCount
});
```

### 2-3. 接続実行

```js
async function connectToTikTok() {
    if (connectPromise) return connectPromise; // 二重接続防止

    // ルームIDをリセット（配信開始時に新IDが割り当てられるため毎回クリア）
    if (connection.clientParams) {
        connection.clientParams.room_id = '';
        connection.clientParams.cursor = '';
        connection.clientParams.internal_ext = '';
    }

    connectPromise = (async () => {
        try {
            await connection.connect();
            console.log('接続成功');
        } catch (err) {
            // connect() 中のエラーはすべてここで処理
            // （disconnected/error/streamEnd イベントは connectPromise ガードでスキップ済み）
            if (isUserOfflineError(err)) {
                scheduleReconnect('user_offline');
                return;
            }
            if (isAlreadyConnectedError(err)) {
                return; // 既存接続を継続
            }
            scheduleReconnect('connect_failed', err?.message);
        } finally {
            connectPromise = null;
        }
    })();

    return connectPromise;
}
```

---

## 3. エラー判定ヘルパー

TikTok のエラーは構造が不安定なため、複数箇所を検査する必要がある。

```js
function isUserOfflineError(error) {
    const candidates = [
        error,
        error?.exception,
        error?.cause,
        error?.response?.data,
        error?.error
    ].filter(Boolean);

    const detailText = candidates.map((c) =>
        typeof c?.message === 'string' ? c.message
        : typeof c?.info === 'string' ? c.info
        : String(c || '')
    ).join('\n');

    const hasOfflineName = candidates.some((c) => c?.name === 'UserOfflineError');
    return hasOfflineName || /isn't online|user.+offline|requested user.+online/i.test(detailText);
}

function isAlreadyConnectedError(error) {
    const message = typeof error?.message === 'string' ? error.message : String(error || '');
    return /already connected!?/i.test(message);
}

function isRecoverableRoomInfoError(error) {
    const detailText = [
        error?.message,
        error?.info,
        error?.exception?.message,
        error?.cause?.message,
        error?.error?.message
    ].filter(Boolean).join('\n');

    return /Failed to retrieve Room ID from main page|SIGI_STATE|falling back to API source|blocked by TikTok/i.test(detailText);
}
```

---

## 4. 自動再接続

```js
const RECONNECT_DELAY_MS = 10000;         // 通常の再接続待ち
const OFFLINE_RECONNECT_DELAY_MS = 10000; // 配信オフライン時の待ち
const FIRST_CONNECT_RETRY_DELAY_MS = 3000; // 初回のルームID取得失敗時の短い待ち

let reconnectTimer = null;
let connectAttempts = 0;

function scheduleReconnect(reason = 'unknown', errorDetail = null) {
    if (reconnectTimer) return; // 二重スケジュール防止

    const isOffline = reason === 'user_offline';
    const delay = isOffline ? OFFLINE_RECONNECT_DELAY_MS : RECONNECT_DELAY_MS;

    console.warn(`再接続スケジュール (理由: ${reason}) ${delay}ms 後`);

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
            await connectToTikTok();
        } catch (err) {
            scheduleReconnect('retry_failed', err?.message);
        }
    }, delay);
}

async function disconnect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    connectAttempts = 0;
    connection.removeAllListeners?.();
    try {
        await Promise.resolve(connection.disconnect?.());
    } catch (err) {
        console.warn('切断エラー:', err);
    }
}
```

---

## 5. ギフトコンボ処理

コンボギフト（連続送信）は `giftType === 1` の間、`repeatEnd` が `false` で複数イベントが来る。
コンボ完了は `repeatEnd === true` のイベントで確定する。

**`repeatCount` は「その時点の累計」であって増分ではない。** 1→3→5 と届いたら実際に送られたのは
5個。各イベントの `repeatCount` をそのまま足すと 9 個になってしまう。

### 単一プロセスなら：前回値との差分

```js
const pendingCombos = new Map(); // comboKey -> { repeatCount, ... }

connection.on('gift', (data) => {
    const isCombo = data.giftType === 1;
    // groupId は1回の連打バーストの識別子。protobuf の既定値 "0" は除く（後述 14-2）
    const groupId = /^[1-9][0-9]{0,31}$/.test(String(data.groupId ?? '')) ? String(data.groupId) : null;
    const comboKey = isCombo ? (groupId ?? `${data.uniqueId}:${data.giftId}`) : null;
    const currentRepeat = Math.max(1, Number(data.repeatCount) || 1);

    if (!isCombo) {
        onGiftReceived(data, currentRepeat);
        return;
    }

    const prev = pendingCombos.get(comboKey);
    const prevRepeat = prev ? Number(prev.repeatCount) || 0 : 0;
    const delta = Math.max(0, currentRepeat - prevRepeat);

    if (data.repeatEnd) {
        pendingCombos.delete(comboKey);
    } else {
        pendingCombos.set(comboKey, { ...data, repeatCount: currentRepeat });
    }

    // repeatEnd のイベントも「累計」なので、ここでも差分だけ処理する。
    // currentRepeat を渡すとコンボ全体を二重計上する。
    if (delta > 0) onGiftReceived(data, delta);
});

function onGiftReceived(data, count) {
    console.log(`ギフト: ${data.giftName} × ${count} from ${data.nickname}`);
    // 例: diamonds = (data.diamondCount || 0) * count
}
```

### 複数プロセスが同じ配信を見るなら：前回値を共有ストアから引く

上のやり方は「前回値」がプロセスのメモリにある。デプロイの入れ替えで新旧2プロセスが
同じ配信に同時接続する構成（Railway の deployment overlap など）だと、両者の前回値がズレて
**同じイベントから別の delta が出る**。片方が 5-3=2、もう片方が 5-1=4 を書き、どちらが
採用されるかはタイミング次第になる。行の重複排除では直らない（行は1つで、中の数字が違う）。

analytics 側（`src/lib/tiktok-listener.ts` の `saveComboGift()`）はこれを避けるため、
delta を DB から計算している。

```sql
-- 同じグループへの同時書き込みを直列化してから
SELECT pg_advisory_xact_lock(hashtext($roomId), hashtext($groupId));
-- 保存済みの増分合計 = そのバーストの現在の累計
SELECT COALESCE(SUM("repeatCount"), 0) FROM gifts WHERE "roomId" = $roomId AND "groupId" = $groupId;
-- delta = 受信した累計 - 保存済み合計。0以下なら再送・逆順到着なので何もしない
```

保存後の合計は必ず `max(保存済み, 受信した累計)` になるので、重複・逆順・再試行・複数プロセスの
どれでも壊れない。集計範囲に時間窓や日付の区切りを入れないこと — 窓から古い増分が落ちると
差分が過大になり、長いコンボで誤差が累積する。`groupId` が1回のバーストに対応していて
再利用されないことが前提（実測: 複数行を持つ948グループすべてが1分未満、5分超の間隔0件）。

---

## 6. ギフトカタログ取得（別接続を使う場合）

ギフトカタログ取得のために別接続を作る場合、**メイン接続の sessionId を使わない**こと。
同一アカウントで2本の認証セッションを張るとリスクスコアが上がる。

```js
const { WebcastPushConnection } = require('tiktok-live-connector');

async function fetchGiftCatalog(broadcasterId) {
    const catalogConnection = new WebcastPushConnection(broadcasterId, {
        processInitialData: false,
        enableExtendedGiftInfo: false,
        enableWebsocketUpgrade: false,
        enableRequestPolling: false,
        authenticateWs: false,
        sessionId: undefined,      // 認証情報を意図的に除外
        ttTargetIdc: undefined,
        signedWebSocketProvider: undefined
    });

    try {
        const gifts = await catalogConnection.fetchAvailableGifts();
        return gifts;
    } finally {
        await catalogConnection.disconnect().catch(() => {});
    }
}
```

---

## 7. 全イベント一覧

`tiktok-live-connector` v2.x が発火するイベント（`COMMENT_FEED_EVENT_DEFINITIONS` ベース）:

| イベント名 | 内容 |
|---|---|
| `gift` | ギフト送信（コンボ含む） |
| `chat` | コメント |
| `like` | いいね |
| `member` | 入室 |
| `follow` | フォロー |
| `share` | シェア |
| `social` | ソーシャルアクション全般 |
| `subscribe` | サブスクリプション |
| `questionNew` | 質問 |
| `roomUser` | 視聴者数更新 |
| `emote` | エモート |
| `envelope` | 宝箱 |
| `liveIntro` | ライブ紹介 |
| `streamEnd` | 配信終了 |
| `goalUpdate` | ゴール更新 |
| `roomMessage` | ルームメッセージ |
| `captionMessage` | 字幕 |
| `pollMessage` | 投票 |
| `rankUpdate` | ランキング更新 |
| `disconnected` | 切断（ライブラリ発火） |
| `error` | エラー（ライブラリ発火） |

---

## 8. NoWSUpgradeError 対策 — Euler 署名

`NoWSUpgradeError: Unexpected server response: 200` が出る場合、TikTok がその配信で匿名 WebSocket upgrade を拒否している。
`signedWebSocketProvider` + `TikTokWebClient.fetchSignedWebSocketFromEuler` で署名済み URL を使うと解決する。

**Euler 署名 ≠ アカウント認証:**
- `sessionId` をオプションに渡す → ユーザーアカウントで認証 → **アカウントリスクあり（使わない）**
- `fetchSignedWebSocketFromEuler` → Euler サービスが WS URL を署名するだけ → sessionId 不使用 → **アカウントリスクなし**

Electron 限定ではなく、通常の Node.js アプリでも使える。

```js
const { WebcastPushConnection, TikTokWebClient } = require('tiktok-live-connector');

const connection = new WebcastPushConnection('@username', {
    // ... 基本オプション ...
    sessionId: undefined,       // 引き続き sessionId は渡さない
    authenticateWs: false,
    signedWebSocketProvider: async (params) => {
        const webClient = new TikTokWebClient({
            customHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' },
            axiosOptions: {},
            clientParams: { app_language: 'ja', device_platform: 'web' },
            authenticateWs: false   // ここも false — sessionId は使わない
        });
        return webClient.fetchSignedWebSocketFromEuler(params);
    }
});
```

`signedWebSocketProvider` が設定されている場合、ライブラリは WebSocket 接続前にこの関数を呼び出して署名済み URL を取得する。`sessionId` は依然として渡さないため匿名接続のまま。

---

## 9. 接続状態の管理

状態遷移の設計（参考）:

```
not_configured → (ユーザーID設定) → idle
idle → (接続開始) → connecting
connecting → (成功) → connected
connecting → (オフライン) → retrying → connecting ...
connected → (切断/streamEnd/error) → retrying → connecting ...
retrying → (手動停止) → idle
```

状態オブジェクト例:

```js
{
    status: 'connected',    // not_configured | idle | connecting | connected | retrying | error
    message: '接続中',
    broadcasterId: '@username',
    transportMethod: 'websocket',  // websocket | polling | unknown
    retryScheduled: false,
    retryReason: null,
    retryDelayMs: null,
    updatedAt: '2026-06-03T00:00:00.000Z'
}
```

---

## 10. よくあるエラーと対処

| エラー | 原因 | 対処 |
|---|---|---|
| `UserOfflineError` / `isn't online` | 配信していない | `OFFLINE_RECONNECT_DELAY_MS` 待って再試行 |
| `already connected!` | 二重接続 | スキップして既存接続を継続使用 |
| `Failed to retrieve Room ID from main page` | TikTok ページスクレイピング失敗 | 短い遅延（3秒）で再試行 |
| `NoWSUpgradeError` | 匿名 WebSocket が拒否された | `signedWebSocketProvider` + `fetchSignedWebSocketFromEuler` を使う（セクション8参照） |
| `SIGI_STATE` / `blocked by TikTok` | ページブロック | `isRecoverableRoomInfoError` で検出して再試行 |

---

## 11. 最小構成サンプル

```js
'use strict';

const { WebcastPushConnection } = require('tiktok-live-connector');

const RECONNECT_DELAY_MS = 10000;

let connection = null;
let reconnectTimer = null;
let connectPromise = null; // connect() 実行中フラグ

function isUserOfflineError(error) {
    const text = [error?.message, error?.exception?.message, error?.cause?.message]
        .filter(Boolean).join('\n');
    return error?.name === 'UserOfflineError' || /isn't online|user.+offline/i.test(text);
}

function scheduleReconnect(reason) {
    if (reconnectTimer) return;
    const delay = reason === 'user_offline' ? RECONNECT_DELAY_MS * 3 : RECONNECT_DELAY_MS;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; start(); }, delay);
}

async function start(username = '@your_username') {
    if (connection) {
        connection.removeAllListeners?.();
        await connection.disconnect?.().catch(() => {});
        connectPromise = null;
    }

    connection = new WebcastPushConnection(username, {
        processInitialData: false,
        fetchRoomInfoOnConnect: true,
        enableExtendedGiftInfo: false,
        enableWebsocketUpgrade: true,
        enableRequestPolling: false,
        disableEulerFallbacks: true,
        sessionId: undefined,
        authenticateWs: false
    });

    // connect() 中は connectPromise が存在するためガードで弾く。
    // catch ブロックがすべてのエラーを処理する。
    connection.on('disconnected', () => { if (connectPromise) return; scheduleReconnect('disconnected'); });
    connection.on('streamEnd',    () => { if (connectPromise) return; scheduleReconnect('stream_end'); });
    connection.on('error',        (err) => { if (connectPromise) return; scheduleReconnect(isUserOfflineError(err) ? 'user_offline' : 'error'); });

    connection.on('gift', (data) => {
        if (data.giftType === 1 && !data.repeatEnd) return; // コンボ途中はスキップ
        console.log(`ギフト: ${data.giftName} × ${data.repeatCount} from ${data.nickname}`);
    });

    connection.on('chat',   (data) => { console.log(`コメント: ${data.nickname}: ${data.comment}`); });
    connection.on('like',   (data) => { console.log(`いいね: ${data.likeCount} from ${data.nickname}`); });
    connection.on('member', (data) => { console.log(`入室: ${data.nickname}`); });

    if (connection.clientParams) {
        connection.clientParams.room_id = '';
        connection.clientParams.cursor = '';
    }

    connectPromise = (async () => {
        try {
            await connection.connect();
            console.log(`接続成功: ${username}`);
        } catch (err) {
            scheduleReconnect(isUserOfflineError(err) ? 'user_offline' : 'connect_failed');
        } finally {
            connectPromise = null;
        }
    })();

    return connectPromise;
}

start('@your_username');
```

---

## 12. device_id の永続化

`device_id` を毎回ランダム生成すると TikTok に「新規デバイス」として認識され続け、bot 検知リスクが上がる。
アプリ初回起動時に生成してファイルに保存し、以降は再利用する。

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEVICE_ID_PATH = path.join(process.env.APPDATA || process.env.HOME, '.myapp', 'device.env');

function loadOrCreateDeviceId() {
    try {
        const content = fs.readFileSync(DEVICE_ID_PATH, 'utf8');
        const match = content.match(/TIKTOK_DEVICE_ID=(\d{19})/);
        if (match) return match[1];
    } catch {}

    // 19桁の数字を生成（TikTok の device_id フォーマット）
    const id = Array.from({ length: 19 }, () => Math.floor(Math.random() * 10)).join('');
    try {
        fs.mkdirSync(path.dirname(DEVICE_ID_PATH), { recursive: true });
        fs.writeFileSync(DEVICE_ID_PATH, `TIKTOK_DEVICE_ID=${id}\n`, 'utf8');
    } catch {}
    return id;
}

const DEVICE_ID = loadOrCreateDeviceId();

// 接続オプションに渡す
const options = {
    // ...
    webClientParams: { app_language: 'ja', device_platform: 'web', device_id: DEVICE_ID },
    wsClientParams:  { app_language: 'ja', device_platform: 'web', device_id: DEVICE_ID },
};
```

**やってはいけないこと:**
- 毎回 `crypto.randomBytes` や `Math.random()` で新しい device_id を生成する → デバイス識別が崩れる
- room_id をファイルに保存して再利用する → 配信開始時に TikTok は新しい room_id を割り当てるため古い値で接続失敗する
- WebSocket セッション自体を保存・復元しようとする → TikTok の WS は stateful なセッションではなくリアルタイムストリーム。再接続は常にフルコネクト

---

## 13. やってはいけないこと（アカウントリスク・接続安定性）

| やってはいけないこと | 理由 |
|---|---|
| `sessionId` を接続オプションに渡す | ユーザーアカウントで認証 → TikTok のリスクスコア上昇 → 「異常な取引が検出されました」等のエラー |
| `authenticateWs: true` にする | 同上 |
| ギフトカタログ取得用の別接続にメイン接続の `sessionId` を流用する | 同一アカウントで2本の認証セッション → リスクスコア上昇 |
| `connect()` 中に `disconnected`/`error`/`streamEnd` で再接続する | `connectPromise` ガードなしだと再接続ループ（10秒おきに切断・再試行）になる |
| room_id をキャッシュして再利用する | 配信開始時に新 room_id が割り当てられるため古い room_id で接続不可 → 毎回クリアする |
| `NoWSUpgradeError` を無視して止まる | 一時的な TikTok 側の拒否の場合があるため再接続が必要 |
| `enableRequestPolling: true` + `disableEulerFallbacks: false` を同時に使う | Euler 経由のポーリングフォールバックが発動し、意図しない認証フローになる可能性がある |

---

## 14. 重複排除キーの実態（本番実測 2026-08-21）

### 14-1. common は必ずトップレベルへ平坦化される

`simplifyObject()`（`dist/lib/_legacy/data-converter.js`）は**型に依存せず** `common` を展開する。

```js
if (originalObject.common) {
    Object.assign(webcastObject, webcastObject.common);
    delete webcastObject.common;
}
```

`WebcastGiftMessage` / `WebcastChatMessage` はどちらも `common: CommonMessageData` を持つので、`data.msgId` と `data.createTime` はハンドラに届く時点でトップレベルにある。`data.common?.msgId` を読んではいけない。

実測での裏付け: `gifts` 全 13804 行の `timeSource` が `"tiktok"`（`createTime` 欠落によるフォールバックは 0 件）。

### 14-2. protobuf の既定値がそのまま流れてくる

`CommonMessageData` の既定値は `msgId: "0"`。メッセージ側がフィールドを持たないと、デコード結果は空ではなく **`"0"`** になる。

同じことが `groupId` でも起きていて、本番の `gifts` には `groupId = "0"` の行が **3591 件**ある。

`"0"` を実IDとして扱うと、無関係なイベント同士が同一キーを共有する。実害の形はキーの用途で変わる。

- **dedup キーに使うと**: 2件目以降が「重複」と判定され、正常なイベントが捨てられる
- **combo キーに使うと**: 別ユーザー・別ギフトが同じ pending state を共有し、`delta` が過少になる

そのため `resolveMsgId()` / `resolveGroupId()` は `/^[1-9][0-9]{0,31}$/` にマッチしない値をすべて `null` に倒す。`null` は「dedup できない」を意味し、イベント自体は通す（捨てるより重複を許すほうが安全）。`groupId` は `Gift.groupId` 列にも `null` で保存する — 列の意味を「使える combo/dedup 識別子、無ければ null」に揃えるため。

**`data.groupId ? String(data.groupId) : null` では弾けない。** 文字列 `"0"` は truthy なのでそのまま通る。数値 `0` は落ちるが、実際に届くのは文字列側。

### 14-3. `orderId` は当てにならない

`WebcastGiftMessage.orderId` は型定義には存在するが、既定値は空文字で、実測では **13804 行中 13783 行（99.85%）が空**だった。

`gifts` の `@@unique([roomId, orderId])` は Postgres が NULL 同士を重複とみなさないため、この状態では制約として機能していない。**この制約に dedup を期待してはいけない。**

combo の各段に同じ `orderId` が付くと、2段目以降が P2002 で落ちて正当な増分が消える。
`saveComboGift()` は combo 行の `orderId` を常に `null` で保存してこれを構造的に避けている
（combo の dedup は `groupId` 単位の単調増加判定で足りるため）。

### 14-4. 現在の dedup（2026-08-22 時点の実装）

`msgId` は dedup キーとして使っている。**unique 制約は張っていない**。

- `Gift.roomId` は配信セッションではなく永続的な `TiktokRoom.id` なので、将来の別ライブで
  `msgId` が再利用されたら正当なギフトを恒久的に弾く
- `prisma db push` は Dockerfile の CMD でコンテナ起動時に走る。既存の重複行があると
  unique index の作成に失敗して web が起動しなくなる

代わりに非 unique な `@@index([roomId, msgId])` を張り、アプリ側で2層に分けて判定する。

| 層 | 実体 | 効く範囲 |
| --- | --- | --- |
| プロセス内 FIFO | `ListenerInstance.recentGiftMsgIds`（1000件） | 同一プロセスへの再送。同じ tick の二重処理も止まる |
| DB 照会 | `saveGift()` が直近5分の `(roomId, msgId)` を引く | 別プロセスが既に書いた行（デプロイ中の新旧 Worker 並走） |

片方だけでは塞げない。FIFO はプロセスを跨げず、DB 照会は保存を待たない `.then()` 経路の
同一 tick 競合を防げない。

**有効な `groupId` を持つ combo はこの2層をどちらも通さない。** `saveComboGift()` の
「delta = 受信した累計 − 保存済み合計」がそのまま冪等な dedup になっているため
（同じ tick が何度届いても delta が 0 以下になる）。FIFO を通すと、保存前に記録する都合上、
DB エラー後の再送を同一プロセス内で捨ててしまう副作用のほうが大きい。

`msgId` の性質（実測）:

- snowflake 形式。上位ビットが ms 時刻で、1ms あたりの増分が 2^22 前後
- combo は段階ごとに別の `msgId` を持つ（同一 `groupId` 29行で `msgId` も29種類）
- 部屋をまたいで同じ `msgId` が使われた例は0件

再確認したくなったときのクエリ:

```sql
-- 1. 同じ (roomId, msgId) の重複が残っていないか
SELECT "roomId", "msgId", COUNT(*) FROM gifts
WHERE "msgId" IS NOT NULL AND "receivedAt" > '<列追加のデプロイ時刻>'
GROUP BY 1, 2 HAVING COUNT(*) > 1;

-- 2. 充足率（列追加前の行は必ず NULL なので期間で切る）
SELECT COUNT(*) FILTER (WHERE "msgId" IS NULL)::float / COUNT(*) AS null_ratio
FROM gifts WHERE "receivedAt" > '<列追加のデプロイ時刻>';

-- 3. combo の各 tick が別 msgId を持つか（同一 groupId 内の分布）
SELECT "groupId", COUNT(*) AS rows, COUNT(DISTINCT "msgId") AS ids
FROM gifts WHERE "giftType" = 1 AND "receivedAt" > '<列追加のデプロイ時刻>'
GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 20;

-- 4. groupId が1回のバーストに対応しているか（再利用されていたら delta 計算が壊れる）
SELECT MAX(span) FROM (
  SELECT EXTRACT(EPOCH FROM (MAX("receivedAt") - MIN("receivedAt"))) AS span
  FROM gifts WHERE "groupId" IS NOT NULL
  GROUP BY "roomId", "groupId" HAVING COUNT(*) > 1
) t;
```

行を消す必要が出た場合、`gifts` は `GiftEdit` から参照されている（`onDelete: Cascade`）ので、
ユーザーの手動編集も一緒に消える点に注意。
