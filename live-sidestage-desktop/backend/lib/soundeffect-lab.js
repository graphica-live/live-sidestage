'use strict';

const SOUNDEFFECT_LAB_HOST = 'soundeffect-lab.info';
const SOUNDEFFECT_LAB_BASE = `https://${SOUNDEFFECT_LAB_HOST}`;
const REQUEST_HEADERS = { 'User-Agent': 'Mozilla/5.0 (TikEffect)', 'Referer': `${SOUNDEFFECT_LAB_BASE}/` };
const ITEM_RE = /<li><span>([^<]*)<\/span>[^<]*<a href="([^"]+\.mp3)"[^>]*download=/g;

function decodeHtmlEntities(value) {
    return String(value)
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

async function searchSoundEffectLab(query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];

    const url = `${SOUNDEFFECT_LAB_BASE}/sound/search.php?s=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, { headers: REQUEST_HEADERS });

    if (!response.ok) {
        throw new Error(`効果音ラボ検索に失敗しました (HTTP ${response.status})`);
    }

    const html = await response.text();
    const results = [];
    let match;

    ITEM_RE.lastIndex = 0;
    while ((match = ITEM_RE.exec(html)) && results.length < 30) {
        const name = decodeHtmlEntities(match[1]);
        const mp3Path = match[2];
        results.push({
            name,
            mp3Url: mp3Path.startsWith('http') ? mp3Path : `${SOUNDEFFECT_LAB_BASE}${mp3Path}`
        });
    }

    return results;
}

async function downloadSoundEffectLabSound(mp3Url) {
    let parsed;
    try {
        parsed = new URL(String(mp3Url || ''));
    } catch {
        throw new Error('無効なURLです。');
    }

    if (parsed.hostname !== SOUNDEFFECT_LAB_HOST || parsed.protocol !== 'https:') {
        throw new Error('soundeffect-lab.info のURLのみ取り込めます。');
    }

    const response = await fetch(parsed.toString(), { headers: REQUEST_HEADERS });

    if (!response.ok) {
        throw new Error(`音声のダウンロードに失敗しました (HTTP ${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

module.exports = { searchSoundEffectLab, downloadSoundEffectLabSound, SOUNDEFFECT_LAB_HOST };
