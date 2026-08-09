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
    "adam’s dream": "アダムの夢",
    "amusement park": "遊園地",
    "baseball": "野球",
    "castle fantasy": "幻のキャッスル",
    "creeper": "クリーパー",
    "cyber roar": "サイバーロア",
    "dragon flame": "ドラゴンの炎",
    "falcon": "ハヤブサ",
    "finger heart": "フィンガーハート",
    "fire phoenix": "ファイアフェニックス",
    "fireworks": "花火",
    "fly love": "飛ぶ愛",
    "future journey": "未来への旅",
    "golden gallop": "伝説の白馬",
    "gorilla": "ゴリラ",
    "infinite heart": "永遠のハート",
    "julius the champion": "絶対王者ジュリアス",
    "king leonardo": "レオナルド王",
    "legend marcellus": "レジェンドのマーセラス",
    "leon and lili": "レオンとリリー",
    "leon and lion": "レオンとライオン",
    "level ship": "レベルシップ",
    "light castle": "ライトキャッスル",
    "lili the leopard": "ヒョウのリリー",
    "lion": "ライオン",
    "overreact": "オーバーなリアクション",
    "party on&on": "パーティーは続く",
    "pegasus": "ホワイトペガサス",
    "phoenix": "フェニックス",
    "premium shuttle": "プレミアムロケット",
    "rosa": "ローザ",
    "rosa nebula": "ローザの星雲",
    "rose carriage": "バラ馬車",
    "rust vs world": "眠れる戦士 vs 世界",
    "skyforge citadel": "スカイフォージ要塞",
    "sports car": "スポーツカー",
    "stadium": "熱狂スタジアム",
    "swan": "白鳥",
    "thunder falcon": "サンダーファルコン",
    "tiktok shuttle": "TikTokシャトル",
    "train": "列車",
    "undersea kingdom": "深海王国",
    "valerian's oath": "ヴァレリアンの誓い",
    "whale diving": "クジラのダイビング",
    "zeus": "ゼウス"
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
