'use strict';
// 全取得方法の結果を giftId で突合し、比較表(CSV/JSON)と差分抽出を生成する。
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, 'raw');
const JAPANESE_RE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]/;
const isJapanese = (s) => typeof s === 'string' && JAPANESE_RE.test(s);

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(RAW, file), 'utf-8'));
  } catch {
    return null;
  }
}

function readJsonlSafe(file) {
  try {
    const text = fs.readFileSync(path.join(RAW, file), 'utf-8');
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// --- gift-list系のソース ---
const nodeDefault = readJsonSafe('node-giftlist-default.json') || [];
const nodeJaJp = readJsonSafe('node-giftlist-webcast_language-ja-JP.json') || [];
const nodeRoomScoped = readJsonSafe('node-extended-gift-info.json'); // availableGifts(room_id付き)は別途保存していないので後段でrawから拾う
const pythonDefault = readJsonSafe('python-giftlist-default.json') || [];
const pythonJaJp = readJsonSafe('python-giftlist-webcast_language-ja-JP.json') || [];
const directDefault = (() => {
  const raw = readJsonSafe('direct-api-default-no-cookie.json');
  return raw?.data?.gifts || [];
})();
const directJaJp = (() => {
  const raw = readJsonSafe('direct-api-webcast_language-ja-JP-no-cookie.json');
  return raw?.data?.gifts || [];
})();

// room_id付きで取得した拡張カタログ(コミュニティギフト含む)。専用の一括取得を1回叩いて保存する。
let nodeRoomScopedGifts = readJsonSafe('node-giftlist-room-scoped.json');

// --- live event系のソース ---
const nodeEvents = readJsonlSafe('node-gift-events.jsonl');
const pythonEvents = readJsonlSafe('python-gift-events.jsonl');
const csharpEvents = readJsonlSafe('csharp-gift-events.jsonl');

function toMap(list, idKey = 'id') {
  const m = new Map();
  for (const item of list) {
    if (item && item[idKey] != null) m.set(Number(item[idKey]), item);
  }
  return m;
}

const mDefault = toMap(nodeDefault);
const mJaJp = toMap(nodeJaJp);
const mPyDefault = toMap(pythonDefault);
const mPyJaJp = toMap(pythonJaJp);
const mDirectDefault = toMap(directDefault);
const mDirectJaJp = toMap(directJaJp);
const mRoomScoped = nodeRoomScopedGifts ? toMap(nodeRoomScopedGifts) : new Map();

// 最新のlive eventの名前をgiftIdごとに1つ採用(複数回受信していれば最後の値)
function latestEventNameMap(events, nameKey) {
  const m = new Map();
  for (const e of events) {
    const id = Number(e.giftId);
    const name = nameKey(e);
    if (name != null) m.set(id, name);
  }
  return m;
}
const mNodeEvent = latestEventNameMap(nodeEvents, (e) => e.giftName);
const mPyEvent = latestEventNameMap(pythonEvents, (e) => e.gift?.name);
const mCsEvent = latestEventNameMap(csharpEvents, (e) => e.giftName);

// 全giftIdの和集合
const allIds = new Set([
  ...mDefault.keys(),
  ...mJaJp.keys(),
  ...mPyDefault.keys(),
  ...mPyJaJp.keys(),
  ...mDirectDefault.keys(),
  ...mDirectJaJp.keys(),
  ...mRoomScoped.keys(),
  ...mNodeEvent.keys(),
  ...mPyEvent.keys(),
  ...mCsEvent.keys(),
]);

const rows = [];
for (const id of allIds) {
  const nodeDefaultName = mDefault.get(id)?.name ?? null;
  const nodeJaJpName = mJaJp.get(id)?.name ?? null;
  const pyDefaultName = mPyDefault.get(id)?.name ?? null;
  const pyJaJpName = mPyJaJp.get(id)?.name ?? null;
  const directDefaultName = mDirectDefault.get(id)?.name ?? null;
  const directJaJpName = mDirectJaJp.get(id)?.name ?? null;
  const roomScopedName = mRoomScoped.get(id)?.name ?? null;
  const nodeEventName = mNodeEvent.get(id) ?? null;
  const pyEventName = mPyEvent.get(id) ?? null;
  const csEventName = mCsEvent.get(id) ?? null;

  const diamond =
    mDefault.get(id)?.diamond_count ?? mPyDefault.get(id)?.diamond_count ?? mRoomScoped.get(id)?.diamond_count ?? null;

  // DIFF判定:
  //   (a) 同一locale条件内(ja-JP同士、既定同士、event同士)でライブラリ間の名前が食い違う
  //   (b) GiftList(カタログ取得)の名前とGiftEvent(実LIVE受信)の名前がそもそも別物
  //       (例: giftId 13651 は GiftList="Go Popular" だが LIVE配信では "Popular Vote" として届く)
  const jaJpNames = [nodeJaJpName, pyJaJpName, directJaJpName].filter((n) => n != null);
  const defaultNames = [nodeDefaultName, pyDefaultName, directDefaultName].filter((n) => n != null);
  const eventNames = [nodeEventName, pyEventName, csEventName].filter((n) => n != null);
  const uniq = (arr) => new Set(arr).size;
  const giftListVsEventDiff =
    defaultNames.length > 0 && eventNames.length > 0 && !defaultNames.some((n) => eventNames.includes(n));
  const diff = uniq(jaJpNames) > 1 || uniq(defaultNames) > 1 || uniq(eventNames) > 1 || giftListVsEventDiff;

  const anyJaName = [nodeJaJpName, pyJaJpName, directJaJpName, roomScopedName, nodeEventName, pyEventName, csEventName].find(
    (n) => n != null
  );

  rows.push({
    giftId: id,
    nodeGiftListDefault: nodeDefaultName,
    nodeGiftListJaJp: nodeJaJpName,
    nodeGiftListRoomScoped: roomScopedName,
    nodeEvent: nodeEventName,
    pythonGiftListDefault: pyDefaultName,
    pythonGiftListJaJp: pyJaJpName,
    pythonEvent: pyEventName,
    csharpEvent: csEventName,
    directApiDefault: directDefaultName,
    directApiJaJp: directJaJpName,
    diamondCount: diamond,
    isJapanese: isJapanese(anyJaName),
    diff,
    giftListVsEventDiff,
    inRegularCatalog: mDefault.has(id),
    seenOnlyViaLiveOrRoomScoped: !mDefault.has(id) && (mRoomScoped.has(id) || mNodeEvent.has(id) || mPyEvent.has(id)),
  });
}

rows.sort((a, b) => a.giftId - b.giftId);

// --- CSV ---
const csvHeader = [
  'giftId',
  'nodeGiftListDefault',
  'nodeGiftListJaJp',
  'nodeGiftListRoomScoped',
  'nodeEvent',
  'pythonGiftListDefault',
  'pythonGiftListJaJp',
  'pythonEvent',
  'csharpEvent',
  'directApiDefault',
  'directApiJaJp',
  'diamondCount',
  'isJapanese',
  'diff',
  'giftListVsEventDiff',
  'inRegularCatalog',
  'seenOnlyViaLiveOrRoomScoped',
];
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
const csvLines = [csvHeader.join(',')];
for (const row of rows) {
  csvLines.push(csvHeader.map((k) => csvEscape(row[k])).join(','));
}
fs.writeFileSync(path.join(__dirname, 'gift-comparison.csv'), csvLines.join('\n') + '\n');

// --- JSON (全件) ---
fs.writeFileSync(path.join(__dirname, 'gift-comparison.json'), JSON.stringify(rows, null, 2));

// --- 差分のみ ---
const diffRows = rows.filter((r) => r.diff);
fs.writeFileSync(path.join(__dirname, 'gift-name-differences.json'), JSON.stringify(diffRows, null, 2));

// --- コンソール表示: DIFFがあるもの + イベントで観測されたもの ---
console.log('=== summary ===');
console.log('total gift ids:', rows.length);
console.log('regular catalog size (node default):', mDefault.size);
console.log('japanese-name rows (ja-JP condition):', rows.filter((r) => r.isJapanese).length);
console.log('rows with cross-method name diff:', diffRows.length);
console.log('rows only visible via live/room-scoped (not in default catalog):', rows.filter((r) => r.seenOnlyViaLiveOrRoomScoped).length);
console.log();

console.log('=== gift ids observed live or with name diffs ===');
const interesting = rows.filter((r) => r.nodeEvent || r.pythonEvent || r.csharpEvent || r.diff);
const printRow = (r) =>
  console.log(
    `${r.giftId}\t${r.nodeGiftListDefault ?? '-'}\t${r.nodeEvent ?? '-'}\t${r.pythonGiftListDefault ?? '-'}\t${r.pythonEvent ?? '-'}\t${r.csharpEvent ?? '-'}\t${r.directApiDefault ?? '-'}\t${r.diamondCount ?? '-'}\t${r.diff ? 'DIFF' : ''}`
  );
console.log('giftId\tNodeGiftList\tNodeEvent\tPythonGiftList\tPythonEvent\tC#Event\tDirectAPI\tcoin\t');
for (const r of interesting) printRow(r);

console.log('\n=== written: gift-comparison.csv / gift-comparison.json / gift-name-differences.json ===');
