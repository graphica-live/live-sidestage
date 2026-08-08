'use strict';

// TikTok LIVE ギフト名（英語）→日本語表示名の静的テーブル。
// キーは trim + 小文字化した英語ギフト名。未収録のギフトは元の名前をそのまま返す
// （表示が空になったり壊れたりしないようフォールバックする）。
// マッチング用の値（trigger.giftName 等）には使わないこと。あくまで表示専用。
const GIFT_NAME_JA_MAP = {
    // 無料 / 低額
    'rose': 'ローズ',
    'tiktok': 'TikTok',
    'heart': 'ハート',
    'love you': 'ラブユー',
    'ice cream cone': 'アイスクリームコーン',
    'doughnut': 'ドーナツ',
    'finger heart': 'フィンガーハート',
    'hand hearts': 'ハンドハート',
    'heart me': 'ハートミー',
    'thumbs up': 'サムズアップ',
    'cheer you up': 'チアーユーアップ',
    'sunglasses': 'サングラス',
    'music note': 'ミュージックノート',
    'coffee': 'コーヒー',
    'friendship necklace': '友情ネックレス',
    'perfume': 'パフューム',
    'gg': 'GG',
    'rosa': 'ローザ',
    'little crown': 'リトルクラウン',
    'ladybug': 'てんとう虫',
    'panda': 'パンダ',
    'corgi': 'コーギー',
    'confetti': 'コンフェッティ',
    'marvelous confetti': 'マーベラスコンフェッティ',
    'rainbow puke': 'レインボープーク',
    'hat and mustache': '帽子とひげ',
    'adore you': 'アドアユー',
    'garland headpiece': 'ガーランドヘッドピース',
    'star': 'スター',
    'stars': 'スター',
    'i\'m very rich': 'アイム・ベリー・リッチ',
    'im very rich': 'アイム・ベリー・リッチ',
    'massage for you': 'マッサージ・フォー・ユー',
    'team bracelet': 'チームブレスレット',
    'training gloves': 'トレーニンググローブ',
    'money gun': 'マネーガン',
    'sending you home': 'センディング・ユー・ホーム',
    'tom cat': 'トムキャット',
    'like-pop': 'いいねポップ',
    'cap': 'キャップ',
    'butterfly': 'バタフライ',
    'swan': '白鳥',
    'ice cream': 'アイスクリーム',
    'boxing gloves': 'ボクシンググローブ',
    'love ring': 'ラブリング',
    'gaming buddy': 'ゲーミングバディ',
    'lollipop': 'ロリポップ',
    'wolfie': 'ウルフィー',
    'star throne': 'スタースローン',

    // 中額
    'rock star': 'ロックスター',
    'football': 'フットボール',
    'sports car': 'スポーツカー',
    'concert': 'コンサート',
    'diamond crown': 'ダイヤモンドクラウン',
    'travel with you': 'トラベル・ウィズ・ユー',
    'flying kiss': 'フライングキス',
    'catch of the day': 'キャッチ・オブ・ザ・デイ',
    'sunset speedway': 'サンセット・スピードウェイ',
    'motorcycle': 'モーターサイクル',
    'stardom trophy': 'スターダム・トロフィー',
    'leon the kitten': 'ライオン・ザ・キトゥン',
    'i love you': 'アイラブユー',
    'blooming ribbon': 'ブルーミングリボン',
    'jollie the pigeon': 'ジョリー・ザ・ピジョン',
    'birthday cake': 'バースデーケーキ',
    'money bag': 'マネーバッグ',
    'watermelon love': 'ウォーターメロンラブ',
    'sneaker': 'スニーカー',
    'karma': 'カルマ',
    'guitar': 'ギター',
    'party face': 'パーティフェイス',
    'streamer': 'ストリーマー',
    'go popular': 'ゴーポピュラー',

    // 高額 / プレミアム
    'lion': 'ライオン',
    'interstellar': 'インターステラー',
    'whale diving': 'ホエールダイビング',
    'falcon': 'ファルコン',
    'planet': 'プラネット',
    'octopus': 'オクトパス',
    'train': 'トレイン',
    'galaxy': 'ギャラクシー',
    'meteor shower': '流星群',
    'drama queen': 'ドラマクイーン',
    'phoenix': 'フェニックス',
    'castle fantasy': 'キャッスルファンタジー',
    'yacht': 'ヨット',
    'private jet': 'プライベートジェット',
    'dragon flame': 'ドラゴンフレイム',
    'dragon': 'ドラゴン',
    'thunder cheer': 'サンダーチアー',
    'sunset speedway heat': 'サンセット・スピードウェイ・ヒート',
    'gift box': 'ギフトボックス',
    'mystery box': 'ミステリーボックス',
    'level-up sparks': 'レベルアップスパークス',
    'the passion': 'ザ・パッション',

    // フォロー/イベント系（システム扱い）
    'follow': 'フォロー',
    'share': 'シェア',
    'like': 'いいね'
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
