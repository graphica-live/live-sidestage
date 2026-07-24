'use strict';

const MYINSTANTS_HOST = 'www.myinstants.com';
const MYINSTANTS_BASE = `https://${MYINSTANTS_HOST}`;
const REQUEST_HEADERS = { 'User-Agent': 'Mozilla/5.0 (TikEffect)' };
const BUTTON_RE = /<button class="small-button" onclick="play\('([^']+)'[^)]*\)"[^>]*title="Play ([\s\S]*?) sound"/g;

function decodeHtmlEntities(value) {
    return String(value)
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

async function searchMyinstants(query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];

    const url = `${MYINSTANTS_BASE}/en/search/?name=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, { headers: REQUEST_HEADERS });

    // myinstantsは検索結果0件のとき200ではなく404を返す仕様のため、404は空配列として扱う
    if (!response.ok && response.status !== 404) {
        throw new Error(`myinstants検索に失敗しました (HTTP ${response.status})`);
    }

    const html = await response.text();
    const results = [];
    let match;

    BUTTON_RE.lastIndex = 0;
    while ((match = BUTTON_RE.exec(html)) && results.length < 30) {
        const mp3Path = match[1];
        const name = decodeHtmlEntities(match[2]);
        results.push({
            name,
            mp3Url: mp3Path.startsWith('http') ? mp3Path : `${MYINSTANTS_BASE}${mp3Path}`
        });
    }

    return results;
}

async function downloadMyinstantsSound(mp3Url) {
    let parsed;
    try {
        parsed = new URL(String(mp3Url || ''));
    } catch {
        throw new Error('無効なURLです。');
    }

    if (parsed.hostname !== MYINSTANTS_HOST || parsed.protocol !== 'https:') {
        throw new Error('myinstants.com のURLのみ取り込めます。');
    }

    const response = await fetch(parsed.toString(), { headers: REQUEST_HEADERS });

    if (!response.ok) {
        throw new Error(`音声のダウンロードに失敗しました (HTTP ${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

module.exports = { searchMyinstants, downloadMyinstantsSound };
