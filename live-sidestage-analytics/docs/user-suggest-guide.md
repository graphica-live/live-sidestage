# ユーザーID サジェスト実装ガイド

TikTok ライブ配信のギフト送信者をユーザーID入力欄でサジェストする機能の実装指示書。
tikeffect のトリガー設定画面の実装から抽出。

**設計方針: TikTok API 非使用。DB に保存済みのギフト送信者履歴をローカルフィルタリングする。**

---

## 1. データソース

ギフト受信時に `daily_contributors` テーブルに記録されたユーザー情報を使用する。
ニックネームオーバーライドがある場合は `listener_name_overrides` テーブルを優先する。

### SQL（better-sqlite3）

```js
const recentGiftSendersStmt = db.prepare(`
    SELECT
        dc.unique_id          AS uniqueId,
        COALESCE(lno.nickname, dc.nickname) AS nickname,
        dc.profile_image_url  AS image,
        MAX(dc.last_seen_at)  AS lastSeenAt
    FROM daily_contributors dc
    LEFT JOIN listener_name_overrides lno
        ON lno.broadcaster_id = dc.broadcaster_id
        AND lno.unique_id = dc.unique_id
    WHERE dc.broadcaster_id = ?
      AND dc.day_key >= ?
    GROUP BY dc.unique_id
    ORDER BY lastSeenAt DESC
    LIMIT ?
`);

// 使用例: 直近30日・最大200件
function getRecentGiftSenders(broadcasterId, limit = 200) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 30);
    const sinceDay = sinceDate.toISOString().slice(0, 10); // "YYYY-MM-DD"
    return recentGiftSendersStmt.all(broadcasterId, sinceDay, Number(limit) || 200);
}
```

返却される各ユーザーの shape:

```js
{
    uniqueId: "username123",      // TikTok ユーザーID（@なし）
    nickname: "表示名",
    image: "https://...",         // プロフィール画像URL（nullの場合あり）
    lastSeenAt: "2026-06-03T..."  // 最終ギフト送信日時
}
```

---

## 2. バックエンド API エンドポイント

```js
app.get('/api/users/recent', (req, res) => {
    const broadcasterId = getBroadcasterId();
    if (!broadcasterId) {
        return res.json({ users: [] });
    }
    const users = getRecentGiftSenders(broadcasterId, 200);
    return res.json({ users });
});
```

---

## 3. フロントエンド実装

### 3-1. 初期化

ページロード時（またはモーダルオープン時）に全候補を一括取得してメモリに保持する。
入力のたびに API を叩かない — ローカルフィルタリングで完結させる。

```js
let knownUserSuggestions = [];   // 全候補キャッシュ
let visibleUserSuggestions = []; // 表示中の候補
let activeUserSuggestionIndex = -1;

async function loadUserSuggestions() {
    const response = await fetch('/api/users/recent');
    if (!response.ok) return;
    const payload = await response.json();
    knownUserSuggestions = Array.isArray(payload.users)
        ? payload.users.filter((u) => u?.uniqueId)
        : [];
}
```

### 3-2. HTML 構造

```html
<div class="suggest-shell">
    <textarea id="user-ids-input" autocomplete="off"
        placeholder="複数可。改行・カンマ・スペース区切り。空欄なら全ユーザー対象">
    </textarea>
    <div class="suggestion-panel" id="user-suggestion-panel" hidden></div>
</div>
```

### 3-3. 入力トークン抽出

textarea は複数ユーザーID をカンマ・改行で区切って入力できる。
現在のカーソル位置から「今入力中のトークン」だけを抽出してフィルタに使う。

```js
function getCurrentToken(textarea) {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const match = before.match(/[^,\n]+$/);
    return match ? match[0].trim() : '';
}
```

### 3-4. フィルタリングとパネル表示

`uniqueId` または `nickname` の部分一致（大文字小文字無視）で最大20件を表示する。

```js
function updateUserSuggestionPanel(textarea, panel) {
    const q = getCurrentToken(textarea).toLowerCase();

    if (!q) {
        hidePanel(panel);
        return;
    }

    visibleUserSuggestions = knownUserSuggestions.filter((u) =>
        String(u.uniqueId || '').toLowerCase().includes(q)
        || String(u.nickname || '').toLowerCase().includes(q)
    ).slice(0, 20);

    if (!visibleUserSuggestions.length) {
        hidePanel(panel);
        return;
    }

    activeUserSuggestionIndex = 0;
    panel.innerHTML = visibleUserSuggestions.map((user, index) => {
        const imgMarkup = user.image
            ? `<img class="suggest-image" src="${escapeHtml(user.image)}" alt="">`
            : `<div class="suggest-image suggest-image--empty">?</div>`;
        return `
            <button type="button" class="suggest-item${index === activeUserSuggestionIndex ? ' is-active' : ''}"
                    data-user-index="${index}">
                ${imgMarkup}
                <div class="suggest-meta">
                    <div class="suggest-name">${escapeHtml(user.nickname || user.uniqueId)}</div>
                    <div class="suggest-desc">@${escapeHtml(user.uniqueId)}</div>
                </div>
            </button>
        `;
    }).join('');

    panel.removeAttribute('hidden');
    positionPanel(textarea, panel);
}

function hidePanel(panel) {
    panel.setAttribute('hidden', '');
    visibleUserSuggestions = [];
    activeUserSuggestionIndex = -1;
}
```

### 3-5. パネル位置合わせ

```js
function positionPanel(inputEl, panel) {
    const rect = inputEl.getBoundingClientRect();
    panel.style.top = `${rect.bottom + window.scrollY}px`;
    panel.style.left = `${rect.left + window.scrollX}px`;
    panel.style.width = `${rect.width}px`;
}
```

### 3-6. 選択時のテキスト挿入

選択したユーザーの `uniqueId` を、現在のトークンと置き換えて textarea に挿入する。
前後のトークン（他ユーザーID）は保持する。

```js
function selectUser(user, textarea, panel) {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const after = textarea.value.slice(textarea.selectionStart);

    // 現在のトークン部分を削除して uniqueId を挿入
    const tokenMatch = before.match(/[^,\n]+$/);
    const prefix = tokenMatch
        ? before.slice(0, before.length - tokenMatch[0].length)
        : before;
    const needsSep = prefix.length > 0 && !/[\n,]\s*$/.test(prefix);

    textarea.value = prefix
        + (needsSep ? '\n' : '')
        + user.uniqueId
        + '\n'
        + after.replace(/^[^,\n]*/, '');

    hidePanel(panel);
    textarea.focus();
}
```

### 3-7. イベントリスナー登録

```js
const textarea = document.getElementById('user-ids-input');
const panel = document.getElementById('user-suggestion-panel');

// 入力するたびにフィルタリング
textarea.addEventListener('input', () => {
    updateUserSuggestionPanel(textarea, panel);
});

// キーボードナビゲーション
textarea.addEventListener('keydown', (e) => {
    if (panel.hidden) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeUserSuggestionIndex = Math.min(
            activeUserSuggestionIndex + 1,
            visibleUserSuggestions.length - 1
        );
        refreshActiveItem(panel, 'data-user-index', activeUserSuggestionIndex);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeUserSuggestionIndex = Math.max(activeUserSuggestionIndex - 1, 0);
        refreshActiveItem(panel, 'data-user-index', activeUserSuggestionIndex);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (activeUserSuggestionIndex >= 0 && visibleUserSuggestions[activeUserSuggestionIndex]) {
            e.preventDefault();
            selectUser(visibleUserSuggestions[activeUserSuggestionIndex], textarea, panel);
        }
    } else if (e.key === 'Escape') {
        hidePanel(panel);
    }
});

// クリックで選択
panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-user-index]');
    if (!btn) return;
    const index = Number(btn.dataset.userIndex);
    if (visibleUserSuggestions[index]) {
        selectUser(visibleUserSuggestions[index], textarea, panel);
    }
});

// パネル外クリックで閉じる
document.addEventListener('click', (e) => {
    if (!e.target.closest('.suggest-shell')) {
        hidePanel(panel);
    }
});

function refreshActiveItem(panel, attr, index) {
    panel.querySelectorAll(`[${attr}]`).forEach((btn) => {
        btn.classList.toggle('is-active', Number(btn.dataset[attr.replace('data-', '')]) === index);
    });
}
```

---

## 4. CSS

```css
.suggest-shell {
    position: relative;
    width: 100%;
}

.suggestion-panel {
    position: fixed;
    max-height: 260px;
    overflow-y: auto;
    background: var(--panel, #fff);
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    z-index: 9999;
}

.suggestion-panel[hidden] {
    display: none;
}

.suggest-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-bottom: 1px solid rgba(0,0,0,0.06);
    background: transparent;
    cursor: pointer;
    text-align: left;
}

.suggest-item:last-child { border-bottom: none; }
.suggest-item:hover,
.suggest-item.is-active { background: #eef4fa; }

.suggest-image {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}

.suggest-image--empty {
    display: grid;
    place-items: center;
    background: #e2e8f0;
    color: #94a3b8;
    font-size: 14px;
}

.suggest-meta { min-width: 0; }

.suggest-name,
.suggest-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.suggest-name { font-size: 14px; }
.suggest-desc { font-size: 12px; color: #94a3b8; }
```

---

## 5. 注意事項

- **TikTok API は叩かない** — 非公式 API はレート制限・仕様変更リスクがある。DB 履歴のみ使用
- **初回は候補なし** — DB にギフト履歴がないと候補が表示されない（仕様）
- **30日超のユーザーは出ない** — `sinceDay` の範囲外は返さない。必要なら期間を延ばす
- **`input` ではなく `textarea`** — 複数ユーザーIDをカンマ・改行区切りで入力できるため textarea を使用。`getCurrentToken` でカーソル位置のトークンだけ抽出する
- **パネル位置は `position: fixed`** — textarea が overflow: hidden の親要素の中でも正しく表示される
