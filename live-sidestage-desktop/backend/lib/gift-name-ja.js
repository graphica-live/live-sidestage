'use strict';

// TikTok LIVE ギフト名（英語）→日本語表示名の静的テーブル。
// キーは trim + 小文字化した英語ギフト名。未収録のギフトは元の名前をそのまま返す
// （表示が空になったり壊れたりしないようフォールバックする）。
// マッチング用の値（trigger.giftName 等）には使わないこと。あくまで表示専用。
//
// 対訳は必ず実際のTikTok（日本語環境）で確認できたものだけを追加すること。
// 推測での翻訳は追加しない（例: "TikTok Universe" は日本語環境でも英語表記のまま）。
const GIFT_NAME_JA_MAP = {
    'rosa': 'ローザ'
};

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

module.exports = {
    GIFT_NAME_JA_MAP,
    getGiftDisplayNameJa
};
