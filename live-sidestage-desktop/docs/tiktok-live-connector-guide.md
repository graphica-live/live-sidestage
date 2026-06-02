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

```js
// 切断
connection.on('disconnected', () => {
    scheduleReconnect();
});

// 配信終了
connection.on('streamEnd', () => {
    scheduleReconnect();
});

// ランタイムエラー（接続後に発生した WebSocket 切断など）
connection.on('error', (err) => {
    if (isUserOfflineError(err)) {
        scheduleReconnect('user_offline'); // 配信開始待ち
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
    // ルームIDをリセット（配信開始時に新IDが割り当てられるため毎回クリア）
    if (connection.clientParams) {
        connection.clientParams.room_id = '';
        connection.clientParams.cursor = '';
        connection.clientParams.internal_ext = '';
    }

    try {
        await connection.connect();
        console.log('接続成功');
    } catch (err) {
        if (isUserOfflineError(err)) {
            scheduleReconnect('user_offline');
            return;
        }
        throw err;
    }
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

```js
const pendingCombos = new Map(); // comboKey -> { repeatCount, ... }

connection.on('gift', (data) => {
    const isCombo = data.giftType === 1;
    const comboKey = isCombo ? `${data.uniqueId}:${data.giftId}` : null;
    const currentRepeat = Math.max(1, Number(data.repeatCount) || 1);

    if (isCombo && !data.repeatEnd) {
        // コンボ継続中：差分だけ処理
        const prev = pendingCombos.get(comboKey);
        const prevRepeat = prev ? Number(prev.repeatCount) || 0 : 0;
        const delta = Math.max(0, currentRepeat - prevRepeat);

        pendingCombos.set(comboKey, { ...data, repeatCount: currentRepeat });

        if (delta > 0) {
            onGiftReceived(data, delta); // delta 個分だけ処理
        }
        return;
    }

    // コンボ終了 or 通常ギフト
    if (comboKey) {
        pendingCombos.delete(comboKey);
    }
    onGiftReceived(data, currentRepeat);
});

function onGiftReceived(data, count) {
    console.log(`ギフト: ${data.giftName} × ${count} from ${data.nickname}`);
    // 例: diamonds = (data.diamondCount || 0) * count
}
```

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

## 8. 接続状態の管理

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

## 9. よくあるエラーと対処

| エラー | 原因 | 対処 |
|---|---|---|
| `UserOfflineError` / `isn't online` | 配信していない | `OFFLINE_RECONNECT_DELAY_MS` 待って再試行 |
| `already connected!` | 二重接続 | スキップして既存接続を継続使用 |
| `Failed to retrieve Room ID from main page` | TikTok ページスクレイピング失敗 | 短い遅延（3秒）で再試行 |
| `NoWSUpgradeError` | 匿名 WebSocket が拒否された | Electron なら `signedWebSocketProvider` を使う。それ以外は時間をおいて再試行 |
| `SIGI_STATE` / `blocked by TikTok` | ページブロック | `isRecoverableRoomInfoError` で検出して再試行 |

---

## 10. 最小構成サンプル

```js
'use strict';

const { WebcastPushConnection } = require('tiktok-live-connector');

const RECONNECT_DELAY_MS = 10000;

let connection = null;
let reconnectTimer = null;

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

    connection.on('disconnected', () => scheduleReconnect('disconnected'));
    connection.on('streamEnd', () => scheduleReconnect('stream_end'));
    connection.on('error', (err) => scheduleReconnect(isUserOfflineError(err) ? 'user_offline' : 'error'));

    connection.on('gift', (data) => {
        if (data.giftType === 1 && !data.repeatEnd) return; // コンボ途中はスキップ
        console.log(`ギフト: ${data.giftName} × ${data.repeatCount} from ${data.nickname}`);
    });

    connection.on('chat', (data) => {
        console.log(`コメント: ${data.nickname}: ${data.comment}`);
    });

    connection.on('like', (data) => {
        console.log(`いいね: ${data.likeCount} from ${data.nickname}`);
    });

    connection.on('member', (data) => {
        console.log(`入室: ${data.nickname}`);
    });

    if (connection.clientParams) {
        connection.clientParams.room_id = '';
        connection.clientParams.cursor = '';
    }

    try {
        await connection.connect();
        console.log(`接続成功: ${username}`);
    } catch (err) {
        scheduleReconnect(isUserOfflineError(err) ? 'user_offline' : 'connect_failed');
    }
}

start('@your_username');
```
