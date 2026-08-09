'use strict';

const fs = require('fs');

// TikTok LIVE ギフト名（英語）→日本語表示名の静的テーブル。
// キーは trim + 小文字化した英語ギフト名。未収録のギフトは元の名前をそのまま返す
// （表示が空になったり壊れたりしないようフォールバックする）。
// マッチング用の値（trigger.giftName 等）には使わないこと。あくまで表示専用。
//
// 対訳は必ず実際のTikTok（日本語環境）で確認できたものだけを追加すること。
// 推測での翻訳は追加しない（例: "TikTok Universe" は日本語環境でも英語表記のまま）。
// このブロックは /db/gift-ja-editor.html からの手動入力で自動書き換えされる。
// GIFT_NAME_JA_MAP:START
const GIFT_NAME_JA_MAP = {
    'rosa': 'ローザ',
    'swan': '白鳥',
    'train': '列車',
    'fireworks': '花火',
    'whale diving': 'クジラのダイビング',
    'lili the leopard': 'ヒョウのリリー',
    'sports car': 'スポーツカー',
    'leon and lili': 'レオンとリリー',
    'falcon': 'ハヤブサ',
    'amusement park': '遊園地',
    'dragon flame': 'ドラゴンの炎'
};
// GIFT_NAME_JA_MAP:END

function normalizeGiftNameKey(name) {
    return String(name || '').trim().toLowerCase();
}

function getGiftDisplayNameJa(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        return '';
    }

    return GIFT_NAME_JA_MAP[normalizeGiftNameKey(trimmed)] || trimmed;
}

function serializeGiftNameJaMapBlock() {
    const keys = Object.keys(GIFT_NAME_JA_MAP).sort((a, b) => a.localeCompare(b, 'en'));
    const entries = keys
        .map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(GIFT_NAME_JA_MAP[key])}`)
        .join(',\n');

    return `// GIFT_NAME_JA_MAP:START\nconst GIFT_NAME_JA_MAP = {\n${entries}\n};\n// GIFT_NAME_JA_MAP:END`;
}

function persistGiftNameJaMap() {
    const filePath = __filename;
    const source = fs.readFileSync(filePath, 'utf8');
    const blockPattern = /\/\/ GIFT_NAME_JA_MAP:START[\s\S]*?\/\/ GIFT_NAME_JA_MAP:END/;

    if (!blockPattern.test(source)) {
        throw new Error('GIFT_NAME_JA_MAP のマーカーが見つかりませんでした。');
    }

    fs.writeFileSync(filePath, source.replace(blockPattern, serializeGiftNameJaMapBlock()), 'utf8');
}

// /db/gift-ja-editor.html からの手動入力を反映する。value が空ならエントリを削除
// (英語名フォールバックに戻す)。呼び出し元がユーザーの目視確認を経た値のみ渡すこと。
function setGiftDisplayNameJa(rawName, value) {
    const key = normalizeGiftNameKey(rawName);
    if (!key) {
        return { ok: false, error: 'ギフト名が空です。' };
    }

    const trimmedValue = String(value || '').trim();

    if (trimmedValue) {
        GIFT_NAME_JA_MAP[key] = trimmedValue;
    } else {
        delete GIFT_NAME_JA_MAP[key];
    }

    persistGiftNameJaMap();

    return { ok: true, key, value: trimmedValue };
}

module.exports = {
    GIFT_NAME_JA_MAP,
    getGiftDisplayNameJa,
    setGiftDisplayNameJa
};
