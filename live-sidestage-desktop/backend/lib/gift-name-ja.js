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
    "blooming ribbons": "金の紙吹雪",
    "castle fantasy": "幻のキャッスル",
    "cat paws": "猫の足",
    "charmer bow": "ハートハンターの矢",
    "corgi": "コーギー",
    "creeper": "クリーパー",
    "crystal heart": "クリスタルのハート",
    "cyber roar": "サイバーロア",
    "doughnut": "ドーナッツ",
    "dragon flame": "ドラゴンの炎",
    "dream team": "団結",
    "falcon": "ハヤブサ",
    "feather flock": "羽根",
    "finger heart": "フィンガーハート",
    "fire phoenix": "ファイアフェニックス",
    "fireworks": "花火",
    "fly love": "飛ぶ愛",
    "flying jets": "空飛ぶジェット",
    "forever rosa": "永遠の薔薇",
    "friendship necklace": "友情ネックレス",
    "frozen magic": "雪の魔法",
    "future encounter": "未来との遭遇",
    "future journey": "未来への旅",
    "galaxy": "銀河",
    "gem gun": "宝石銃",
    "genius": "天才",
    "gg": "GG",
    "golden gallop": "伝説の白馬",
    "gorilla": "ゴリラ",
    "greeting heart": "ハートタッチ",
    "guardian's pledge": "ガーディアンの誓い",
    "hand heart": "Hand Heart",
    "hat and mustache": "帽子と口ひげ",
    "heart hood": "ハートのフード",
    "heart me": "ハートミー",
    "hearts": "ハート",
    "infinite heart": "永遠のハート",
    "interstellar": "星から星へ",
    "joker ball": "ジョーカーのボール",
    "julius the champion": "絶対王者ジュリアス",
    "king leonardo": "レオナルド王",
    "legend marcellus": "レジェンドのマーセラス",
    "leon and lili": "レオンとリリー",
    "leon and lion": "レオンとライオン",
    "leon the kitten": "子猫のレオン",
    "level ship": "レベルシップ",
    "level-up sparks": "ファンケーキ",
    "light castle": "ライトキャッスル",
    "lili the leopard": "ヒョウのリリー",
    "lion": "ライオン",
    "little crown": "小さな王冠",
    "love you": "愛してる",
    "meteor shower": "流星群",
    "mishka bear": "ミシカベア",
    "money gun": "マネーガン",
    "overreact": "オーバーなリアクション",
    "paper crane": "折り鶴",
    "party on&on": "パーティーは続く",
    "pegasus": "ホワイトペガサス",
    "perfume": "香水",
    "phoenix": "フェニックス",
    "popular vote": "人気アップ",
    "premium shuttle": "プレミアムロケット",
    "private jet": "プライベートジェット",
    "ramune": "ラムネ",
    "rhythmic bear": "リスミカルなクマ",
    "rosa": "ローザ",
    "rosa nebula": "ローザの星雲",
    "rose": "バラ",
    "rose carriage": "バラ馬車",
    "rust vs world": "眠れる戦士 vs 世界",
    "sam in new city": "未来への旅",
    "seaside romance": "ロマンスイルカ",
    "shateki-chocolate": "射的",
    "skyforge citadel": "スカイフォージ要塞",
    "slow motion": "スローモーション",
    "spidey pin": "ヒーローの証",
    "sports car": "スポーツカー",
    "stadium": "熱狂スタジアム",
    "star map polaris": "キラキラ星座",
    "storm blade": "ストームブレード",
    "stroke me": "なでられ待ち",
    "strong finish": "華麗なフィニッシュ",
    "sunglasses": "サングラス",
    "super popular": "スーパー人気",
    "suprised fish": "びっくりした魚",
    "swan": "白鳥",
    "thunder falcon": "サンダーファルコン",
    "tiktok": "TikTok",
    "tiktok shuttle": "TikTokシャトル",
    "train": "列車",
    "treasure clover": "宝のクローバー",
    "udon-nou": "うどん脳",
    "under control": "すべてOK",
    "undersea kingdom": "深海王国",
    "unicorn": "ユニコーン",
    "unicorn fantasy": "伝説のユニコーン",
    "valerian's oath": "ヴァレリアンの誓い",
    "whale diving": "クジラのダイビング",
    "white wolf": "ホワイトウルフ",
    "work hard play harder": "たくさん働いてたくさん遊ぶ",
    "you're awesome": "すばらしい！",
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
