'use strict';

const fs = require('fs');
const path = require('path');

// ユーザーが実際のTikTok日本語クライアントから収集した、コイン価格昇順のギフト名一覧。
// gift-name-ja.js の辞書とは別物 — こちらは「英語名との対応が未確定な参照候補リスト」。
// gift-ja-editor.html の候補サジェストにのみ使う。ここに載っているからといって順番通りに
// カタログへ機械的に割り当てて良いわけではない（同価格帯のギフトが多く、単純な位置合わせでは
// 対応がずれることを確認済み）。あくまで人間が目視で選ぶための近傍候補の絞り込みに使う。
//
// 正本はモノレポ共通資産 shared/gift-names/gift-names-ja-reference.json。
// ここが読むのは shared/gift-names/sync.mjs が配った生成コピーなので直接編集しない。

const REFERENCE_LIST_PATH = path.join(__dirname, 'gift-names', 'gift-names-ja-reference.json');

let GIFT_NAME_JA_REFERENCE_LIST = [];

try {
    const parsed = JSON.parse(fs.readFileSync(REFERENCE_LIST_PATH, 'utf8'));
    if (Array.isArray(parsed)) {
        GIFT_NAME_JA_REFERENCE_LIST = parsed.filter((name) => typeof name === 'string' && name.trim());
    }
} catch (error) {
    // 候補サジェストが空になるだけで、対訳の手入力自体はできる。
    console.warn('[gift-name-ja] 参照リストを読み込めませんでした:', error?.message || error);
}

module.exports = { GIFT_NAME_JA_REFERENCE_LIST };
