'use strict';
// tiktok-live-connector を経由せず、node_modules/tiktok-live-connector/dist/lib/config.js と
// dist/lib/web/lib/http-client.js を実読して判明した実際のリクエスト仕様を、そのまま直接叩く。
//
// 判明した仕様(2.1.1-beta1, client.js:373-381 / http-client.js:75-171 / config.js):
//   - GET https://webcast.tiktok.com/webcast/gift/list/?<params>
//   - params は DEFAULT_HTTP_CLIENT_PARAMS(config.js) をベースに上書き
//   - ヘッダーは DEFAULT_HTTP_CLIENT_HEADERS(config.js)
//   - signRequest=false なので Euler 署名は不要(fetchAvailableGifts() は signRequest を渡さない = 既定false)
//   - Cookie は cookie-jar.js の既定 { 'tt-target-idc': 'useast1a' } が自動付与される
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'raw');
const HOST = 'https://webcast.tiktok.com/webcast/gift/list/';

// config.js の Device[6] (UserAgents配列7番目、RANDOMIZE無効時の固定選択) を再現。
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/128.0.2739.79';

const BASE_PARAMS = {
  aid: '1988',
  app_language: 'en',
  app_name: 'tiktok_web',
  browser_language: 'en-DE',
  browser_name: 'Mozilla',
  browser_online: 'true',
  browser_platform: 'Win32',
  browser_version: USER_AGENT,
  cookie_enabled: 'true',
  device_platform: 'web_pc',
  focus_state: 'true',
  from_page: 'user',
  history_len: '10',
  is_fullscreen: 'false',
  is_page_visible: 'true',
  screen_height: '1080',
  screen_width: '1920',
  tz_name: 'Europe/Berlin',
  referer: 'https://www.tiktok.com/',
  root_referer: 'https://www.tiktok.com/',
  channel: 'tiktok_web',
  data_collection_enabled: 'true',
  os: 'windows',
  priority_region: 'DE',
  region: 'DE',
  user_is_login: 'true',
  webcast_language: 'en',
  device_id: '7000000000000000000',
};

const BASE_HEADERS = {
  Connection: 'keep-alive',
  'Cache-Control': 'max-age=0',
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/json,application/protobuf',
  Referer: 'https://www.tiktok.com/',
  Origin: 'https://www.tiktok.com',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity', // gzip/deflateはNodeのfetchでは自動展開されないため無圧縮を明示
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Ua-Mobile': '?0',
};

const JAPANESE_RE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]/;
function looksJapanese(s) {
  return typeof s === 'string' && JAPANESE_RE.test(s);
}

const CASES = [
  { key: 'default-no-cookie', params: {}, cookie: null },
  { key: 'webcast_language-ja-JP-no-cookie', params: { webcast_language: 'ja-JP' }, cookie: null },
  { key: 'webcast_language-ja-JP-with-cookie', params: { webcast_language: 'ja-JP' }, cookie: 'tt-target-idc=useast1a' },
  { key: 'webcast_language-en-JP-region', params: { webcast_language: 'ja-JP', region: 'JP', priority_region: 'JP' }, cookie: null },
];

async function fetchOne({ key, params, cookie }) {
  const url = new URL(HOST);
  const merged = { ...BASE_PARAMS, ...params };
  for (const [k, v] of Object.entries(merged)) url.searchParams.set(k, v);

  const headers = { ...BASE_HEADERS };
  if (cookie) headers.Cookie = cookie;

  const startedAt = Date.now();
  const res = await fetch(url, { headers });
  const elapsedMs = Date.now() - startedAt;
  const status = res.status;
  const bodyText = await res.text();

  let gifts = null;
  let parseError = null;
  try {
    const json = JSON.parse(bodyText);
    gifts = json?.data?.gifts ?? null;
    if (!gifts) parseError = `no data.gifts (top-level keys: ${Object.keys(json || {}).join(',')})`;
  } catch (e) {
    parseError = e.message;
  }

  fs.writeFileSync(path.join(RAW_DIR, `direct-api-${key}.json`), bodyText);

  if (!gifts) {
    return { key, ok: false, status, elapsedMs, error: parseError, bodyPreview: bodyText.slice(0, 300) };
  }
  const jaCount = gifts.filter((g) => looksJapanese(g.name)).length;
  return {
    key,
    ok: true,
    status,
    elapsedMs,
    count: gifts.length,
    japaneseNameCount: jaCount,
    sample: gifts.slice(0, 3).map((g) => ({ id: g.id, name: g.name })),
  };
}

async function main() {
  const summary = { source: 'direct-http', endpoint: HOST, results: [] };
  for (const c of CASES) {
    process.stdout.write(`direct-api ${c.key} ... `);
    try {
      const r = await fetchOne(c);
      console.log(r.ok ? `OK status=${r.status} count=${r.count} ja=${r.japaneseNameCount}` : `FAIL status=${r.status} ${r.error}`);
      summary.results.push(r);
    } catch (e) {
      console.log('FAIL(exception)', e.message);
      summary.results.push({ key: c.key, ok: false, error: e.message });
    }
  }
  fs.writeFileSync(path.join(RAW_DIR, 'direct-api-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== summary written to raw/direct-api-summary.json ===');
}

main();
