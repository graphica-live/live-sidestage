'use strict';
// tiktok-live-connector (2.1.1-beta1) の fetchAvailableGifts() を、locale/region/cookie の
// 組み合わせを変えながら呼び、生レスポンスを raw/ に保存する。
//
// 未接続の使い捨てクライアントから呼ぶ(接続前にHTTPで gift/list/ を1回叩くだけ)。
// signRequest=false なので Euler 署名は不要 — 2.1.1-beta1 の実装(前段の client.js 読解で確認済み)。
const { WebcastPushConnection } = require('tiktok-live-connector');
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'raw');
const TARGET = process.env.TARGET_UNIQUE_ID || 'yu_ki_nojo';

const JAPANESE_RE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]/;
function looksJapanese(s) {
  return typeof s === 'string' && JAPANESE_RE.test(s);
}

// 実在すると確認済みのパラメータのみ使う(connector 2.1.1-beta1 の dist/lib/config.js 実測)。
const MATRIX = [
  { key: 'default', webClientParams: {} },
  { key: 'webcast_language-ja', webClientParams: { webcast_language: 'ja' } },
  { key: 'webcast_language-ja-JP', webClientParams: { webcast_language: 'ja-JP' } },
  { key: 'webcast_language-ja_JP', webClientParams: { webcast_language: 'ja_JP' } },
  { key: 'webcast_language-en', webClientParams: { webcast_language: 'en' } },
  { key: 'webcast_language-en-US', webClientParams: { webcast_language: 'en-US' } },
  { key: 'app_language-ja-JP', webClientParams: { app_language: 'ja-JP' } },
  { key: 'browser_language-ja-JP', webClientParams: { browser_language: 'ja-JP' } },
  { key: 'region-JP', webClientParams: { region: 'JP', priority_region: 'JP' } },
  {
    key: 'region-JP_plus_webcast_language-ja-JP',
    webClientParams: { region: 'JP', priority_region: 'JP', webcast_language: 'ja-JP' },
  },
  {
    key: 'accept-language-header-ja-JP',
    webClientParams: {},
    webClientHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' },
  },
  {
    // ライブラリ既定(cookie-jar.js の DEFAULT_HTTP_CLIENT_COOKIES)を明示指定。
    // 実際は何も指定せずとも自動で付与される(全ケース共通)ため、意図を明示する目的のみ。
    key: 'cookie-default-tt-target-idc',
    webClientParams: {},
    webClientHeaders: { Cookie: 'tt-target-idc=useast1a' },
  },
];

function pickFields(item) {
  const record = item && typeof item === 'object' ? item : {};
  const found = {};
  for (const key of ['name', 'title', 'displayName', 'giftName', 'describe', 'description']) {
    if (key in record) found[key] = record[key];
  }
  return found;
}

async function fetchOne({ key, webClientParams, webClientHeaders }) {
  const conn = new WebcastPushConnection(`@${TARGET}`, {
    processInitialData: false,
    fetchRoomInfoOnConnect: false,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: false,
    enableRequestPolling: false,
    authenticateWs: false,
    sessionId: undefined,
    webClientParams,
    ...(webClientHeaders ? { webClientHeaders } : {}),
  });

  const startedAt = Date.now();
  try {
    const gifts = await conn.fetchAvailableGifts();
    const elapsedMs = Date.now() - startedAt;
    fs.writeFileSync(path.join(RAW_DIR, `node-giftlist-${key}.json`), JSON.stringify(gifts, null, 2));

    const fieldsSeen = new Set();
    for (const g of gifts) {
      for (const k of Object.keys(pickFields(g))) fieldsSeen.add(k);
    }
    const jaCount = gifts.filter((g) => looksJapanese(g.name)).length;

    return {
      key,
      ok: true,
      elapsedMs,
      count: gifts.length,
      japaneseNameCount: jaCount,
      fieldsPresent: Array.from(fieldsSeen),
      sample: gifts.slice(0, 3).map((g) => ({ id: g.id, ...pickFields(g) })),
    };
  } catch (err) {
    return { key, ok: false, elapsedMs: Date.now() - startedAt, error: err.message };
  } finally {
    try {
      conn.disconnect?.();
    } catch {
      /* 未接続のdisconnectは無視 */
    }
  }
}

async function main() {
  const summary = { library: 'tiktok-live-connector', libraryVersion: '2.1.1-beta1', target: TARGET, results: [] };
  for (const entry of MATRIX) {
    process.stdout.write(`fetching ${entry.key} ... `);
    const result = await fetchOne(entry);
    console.log(result.ok ? `OK count=${result.count} ja=${result.japaneseNameCount}` : `FAIL ${result.error}`);
    summary.results.push(result);
  }
  fs.writeFileSync(path.join(RAW_DIR, 'node-giftlist-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== summary written to raw/node-giftlist-summary.json ===');
}

main();
