'use strict';
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'japanese-gifts-with-dupes.json'), 'utf-8'));
const dupCount = data.filter((g) => g.duplicateOf).length;
const dupJaDiffersCount = data.filter((g) => g.duplicateJaDiffers).length;

const html = `<title>TikTokギフト図鑑</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500;700;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

  :root {
    --bg: #f4f5fb;
    --surface: #ffffff;
    --surface-2: #ebedf7;
    --border: #dcdfec;
    --ink: #1a1c2c;
    --ink-soft: #565a72;
    --ink-faint: #8d90a6;
    --accent: #a9782f;
    --accent-ink: #ffffff;
    --accent-soft: #f4e9d6;
    --rank-1: #efe3c2;
    --rank-2: #e7c98a;
    --rank-3: #cf9f4a;
    --rank-4: #a9782f;
    --warn-bg: #fbe4e0;
    --warn-ink: #a1352a;
    --warn-bg-soft: #fbe4e0;
    --shadow: 0 1px 2px rgba(26, 28, 44, 0.06), 0 8px 24px -12px rgba(26, 28, 44, 0.18);
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14151f;
      --surface: #1b1c29;
      --surface-2: #232537;
      --border: #33354a;
      --ink: #eceef7;
      --ink-soft: #a8abc2;
      --ink-faint: #71748c;
      --accent: #d9a75a;
      --accent-ink: #1a1206;
      --accent-soft: #3a2f1a;
      --rank-1: #2c2a22;
      --rank-2: #4a3d22;
      --rank-3: #6b5226;
      --rank-4: #d9a75a;
      --warn-bg: #3d2220;
      --warn-ink: #f0a89e;
      --warn-bg-soft: #3d2220;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px -14px rgba(0, 0, 0, 0.6);
    }
  }
  :root[data-theme="dark"] {
    --bg: #14151f;
    --surface: #1b1c29;
    --surface-2: #232537;
    --border: #33354a;
    --ink: #eceef7;
    --ink-soft: #a8abc2;
    --ink-faint: #71748c;
    --accent: #d9a75a;
    --accent-ink: #1a1206;
    --accent-soft: #3a2f1a;
    --rank-1: #2c2a22;
    --rank-2: #4a3d22;
    --rank-3: #6b5226;
    --rank-4: #d9a75a;
    --warn-bg: #3d2220;
    --warn-ink: #f0a89e;
    --warn-bg-soft: #3d2220;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px -14px rgba(0, 0, 0, 0.6);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: "Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .page {
    max-width: 980px;
    margin: 0 auto;
    padding: 48px 24px 80px;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 32px;
  }

  .eyebrow {
    font-family: "IBM Plex Mono", monospace;
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 500;
  }

  h1 {
    font-family: "Shippori Mincho B1", "Hiragino Mincho ProN", serif;
    font-weight: 800;
    font-size: clamp(30px, 4.4vw, 42px);
    line-height: 1.25;
    margin: 0;
    text-wrap: balance;
    letter-spacing: 0.01em;
  }

  .lede {
    color: var(--ink-soft);
    font-size: 14.5px;
    line-height: 1.7;
    max-width: 62ch;
    margin: 0;
  }

  .lede code {
    font-family: "IBM Plex Mono", monospace;
    background: var(--surface-2);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.92em;
  }

  .stats {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 6px;
  }

  .stat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 16px;
    box-shadow: var(--shadow);
  }

  .stat .n {
    font-family: "IBM Plex Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size: 20px;
    font-weight: 600;
    color: var(--accent);
    display: block;
    line-height: 1.2;
  }

  .stat .l {
    font-size: 11.5px;
    color: var(--ink-faint);
    letter-spacing: 0.04em;
  }

  .controls {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 10px;
    padding: 14px 0;
    background: linear-gradient(var(--bg) 72%, transparent);
    margin-bottom: 4px;
  }

  .search-wrap {
    position: relative;
    flex: 1;
  }

  .search-wrap svg {
    position: absolute;
    left: 13px;
    top: 50%;
    transform: translateY(-50%);
    width: 15px;
    height: 15px;
    stroke: var(--ink-faint);
    pointer-events: none;
  }

  #search {
    width: 100%;
    padding: 11px 14px 11px 36px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
    font-family: inherit;
    font-size: 14.5px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  #search:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  #search::placeholder { color: var(--ink-faint); }

  #count-live {
    font-family: "IBM Plex Mono", monospace;
    font-size: 13px;
    color: var(--ink-faint);
    white-space: nowrap;
    align-self: center;
    padding-right: 4px;
    font-variant-numeric: tabular-nums;
  }

  .table-shell {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .table-scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 560px;
  }

  thead th {
    position: sticky;
    top: 0;
    text-align: left;
    font-size: 11.5px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--ink-faint);
    font-weight: 600;
    padding: 13px 16px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  thead th:hover { color: var(--ink); }

  thead th .arrow {
    display: inline-block;
    margin-left: 4px;
    opacity: 0.35;
    font-size: 10px;
  }

  thead th[data-active] .arrow { opacity: 1; color: var(--accent); }

  tbody tr {
    border-bottom: 1px solid var(--border);
    transition: background 0.1s ease;
  }

  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--surface-2); }

  td {
    padding: 12px 16px;
    vertical-align: middle;
  }

  .col-id {
    font-family: "IBM Plex Mono", monospace;
    font-size: 12.5px;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .col-name {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .col-name .primary {
    font-size: 16px;
    font-weight: 500;
  }

  .dupe-note {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    width: fit-content;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px 2px 7px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--ink-faint);
  }

  .dupe-note.is-branch {
    background: var(--warn-bg);
    color: var(--warn-ink);
  }

  .dupe-note svg { width: 10px; height: 10px; flex: none; }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink-soft);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  }

  .filter-chip svg { width: 13px; height: 13px; flex: none; }

  .filter-chip[data-on="true"] {
    border-color: var(--warn-ink);
    color: var(--warn-ink);
    background: var(--warn-bg-soft);
  }

  .col-en {
    font-size: 12.5px;
    color: var(--ink-faint);
    white-space: nowrap;
  }

  .col-diamond {
    text-align: right;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: "IBM Plex Mono", monospace;
    font-size: 12.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--rank-1);
    color: var(--ink);
    white-space: nowrap;
  }

  .badge svg { width: 10px; height: 10px; flex: none; }

  .badge[data-rank="2"] { background: var(--rank-2); }
  .badge[data-rank="3"] { background: var(--rank-3); color: #fff; }
  .badge[data-rank="4"] { background: var(--rank-4); color: var(--accent-ink); }

  .empty {
    display: none;
    padding: 60px 20px;
    text-align: center;
    color: var(--ink-faint);
    font-size: 14px;
  }

  footer {
    margin-top: 28px;
    color: var(--ink-faint);
    font-size: 12.5px;
    line-height: 1.7;
  }

  footer a { color: var(--accent); }

  @media (max-width: 560px) {
    .col-en { display: none; }
    .page { padding: 32px 16px 60px; }
  }
</style>

<div class="page">
  <header>
    <span class="eyebrow">TikTok LIVE &middot; Gift Catalog JA</span>
    <h1>ギフト図鑑</h1>
    <p class="lede">
      TikTok LIVE のギフト一覧を <code>webcast_language=ja-JP</code> で取得し、日本語名になっている
      ${data.length}種のみを抽出した。ダイヤ数は各ギフトの必要コイン数(1回分)。
      同じ絵柄・同額なのに giftId が別々に重複登録されているギフトが${dupCount}件あり、
      うち${dupJaDiffersCount}件は日本語名まで枝分かれしている(実配信で使われない方の名前だけが
      表示されうる例が実際にあった。詳細は下の「表示名が枝分かれ」フィルタを参照)。
    </p>
    <div class="stats">
      <div class="stat"><span class="n">${data.length}</span><span class="l">日本語ギフト</span></div>
      <div class="stat"><span class="n">${Math.max(...data.map((g) => g.diamondCount || 0)).toLocaleString()}</span><span class="l">最高ダイヤ数</span></div>
      <div class="stat"><span class="n">${data.filter((g) => (g.diamondCount || 0) <= 1).length}</span><span class="l">1ダイヤ(無料級)</span></div>
      <div class="stat"><span class="n">${dupJaDiffersCount}</span><span class="l">表示名が枝分かれ中</span></div>
    </div>
  </header>

  <div class="controls">
    <div class="search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="search" type="text" placeholder="ギフト名・英語名・IDで検索" autocomplete="off" />
    </div>
    <button class="filter-chip" id="dupe-filter" type="button" data-on="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      枝分かれのみ
    </button>
    <span id="count-live"></span>
  </div>

  <div class="table-shell">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th data-key="giftId" data-type="num">ID<span class="arrow">▲</span></th>
            <th data-key="name" data-type="str">日本語名<span class="arrow">▲</span></th>
            <th data-key="englishName" data-type="str">英語名<span class="arrow">▲</span></th>
            <th data-key="diamondCount" data-type="num" data-active data-dir="asc">ダイヤ<span class="arrow">▲</span></th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p class="empty" id="empty-state">一致するギフトが見つからない</p>
  </div>

  <footer>
    yu_ki_nojo 配信で実測した TikTok Webcast API のレスポンス(2026-08-28検証)から抽出。全684件中${data.length}件が日本語名。
    「枝分かれ」は同一の絵柄・値段のギフトが別giftIdで重複登録され、日本語名だけが別々に付いているケース(全684件中21組)。
    詳細は検証レポート(gift-name-verification/REPORT.md 7節・発見4)を参照。
  </footer>
</div>

<script>
  const DATA = ${JSON.stringify(data)};
  const tbody = document.getElementById('rows');
  const searchInput = document.getElementById('search');
  const countLive = document.getElementById('count-live');
  const emptyState = document.getElementById('empty-state');
  const ths = Array.from(document.querySelectorAll('thead th'));

  let sortKey = 'diamondCount';
  let sortDir = 'asc';
  let query = '';

  function diamondRank(v) {
    if (v <= 1) return 1;
    if (v <= 100) return 2;
    if (v <= 2000) return 3;
    return 4;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let dupeOnly = false;

  function render() {
    const q = query.trim().toLowerCase();
    let rows = DATA.filter((g) => {
      if (dupeOnly && !g.duplicateJaDiffers) return false;
      if (!q) return true;
      return (
        (g.name || '').toLowerCase().includes(q) ||
        (g.englishName || '').toLowerCase().includes(q) ||
        String(g.giftId).includes(q)
      );
    });

    rows = rows.slice().sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (typeof av === 'string') {
        const r = av.localeCompare(bv, 'ja');
        return sortDir === 'asc' ? r : -r;
      }
      av = av ?? 0;
      bv = bv ?? 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    countLive.textContent = (q || dupeOnly) ? rows.length + ' / ' + DATA.length + ' 件' : DATA.length + ' 件';
    emptyState.style.display = rows.length ? 'none' : 'block';

    tbody.innerHTML = rows
      .map((g) => {
        const rank = diamondRank(g.diamondCount || 0);
        let dupeNote = '';
        if (g.duplicateOf) {
          const partners = g.duplicateOf.map((id) => '#' + id).join(', ');
          const cls = g.duplicateJaDiffers ? 'is-branch' : '';
          const label = g.duplicateJaDiffers
            ? '表示名が枝分かれ中(' + partners + 'と同一ギフト)'
            : '同一ギフトが' + partners + 'にも重複登録';
          dupeNote =
            '<span class="dupe-note ' + cls + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
            escapeHtml(label) +
            '</span>';
        }
        return (
          '<tr>' +
          '<td class="col-id">#' + g.giftId + '</td>' +
          '<td class="col-name"><span class="primary">' + escapeHtml(g.name) + '</span>' + dupeNote + '</td>' +
          '<td class="col-en">' + escapeHtml(g.englishName || '—') + '</td>' +
          '<td class="col-diamond"><span class="badge" data-rank="' + rank + '">' +
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 2 9l10 13L22 9Z"/></svg>' +
          (g.diamondCount ?? 0).toLocaleString() +
          '</span></td>' +
          '</tr>'
        );
      })
      .join('');
  }

  searchInput.addEventListener('input', (e) => {
    query = e.target.value;
    render();
  });

  const dupeFilterBtn = document.getElementById('dupe-filter');
  dupeFilterBtn.addEventListener('click', () => {
    dupeOnly = !dupeOnly;
    dupeFilterBtn.dataset.on = String(dupeOnly);
    render();
  });

  ths.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = th.dataset.type === 'str' ? 'asc' : 'desc';
      }
      ths.forEach((t) => {
        t.removeAttribute('data-active');
        t.querySelector('.arrow').textContent = '▲';
      });
      th.setAttribute('data-active', '');
      th.dataset.dir = sortDir;
      th.querySelector('.arrow').textContent = sortDir === 'asc' ? '▲' : '▼';
      render();
    });
  });

  render();
</script>
`;

fs.writeFileSync(path.join(__dirname, 'japanese-gifts.html'), html);
console.log('wrote japanese-gifts.html,', data.length, 'gifts');
