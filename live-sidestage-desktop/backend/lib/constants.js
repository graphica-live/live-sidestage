'use strict';

const TIME_ZONE = 'Asia/Tokyo';
const BROADCASTER_ID_STATE_KEY = 'tiktok_broadcaster_id';
const DISPLAY_STATE_KEY = 'active_day_key';
const DISPLAY_DAY_REFERENCE_STATE_KEY = 'active_day_reference';
const CONTRIBUTORS_DISPLAY_RANGE_STATE_KEY = 'contributors_display_range';
const CONTRIBUTORS_SESSION_STARTED_AT_STATE_KEY = 'contributors_session_started_at';
const CONTRIBUTORS_SESSION_ENDED_AT_STATE_KEY = 'contributors_session_ended_at';
const DISPLAY_THRESHOLD_STATE_KEY = 'display_threshold';
const GOAL_COUNT_STATE_KEY = 'display_goal_count';
const DISPLAY_AVATAR_VISIBILITY_STATE_KEY = 'display_avatar_visibility';
const DISPLAY_FONT_FAMILY_STATE_KEY = 'display_font_family';
const DISPLAY_COLOR_THEME_STATE_KEY = 'display_color_theme';
const DISPLAY_STROKE_WIDTH_STATE_KEY = 'display_stroke_width';
const COMMENT_SETTINGS_STATE_KEY = 'comment_feed_settings';
const COMMENT_OBSERVED_EMOTES_STATE_KEY = 'comment_observed_emotes';
const COMMENT_OBSERVED_EMOJIS_STATE_KEY = 'comment_observed_emojis';
const EFFECT_EVENTS_STATE_KEY = 'effect_events';
const EFFECT_TRIGGERS_STATE_KEY = 'effect_triggers';
const WIDGET_TOP_GIFT_SETTINGS_STATE_KEY = 'widget_top_gift_settings';
const WIDGET_LIKE_CONTRIBUTION_SETTINGS_STATE_KEY = 'widget_like_contribution_settings';
const WIDGET_GOAL_GIFTS_STATE_KEY = 'widget_goal_gifts';
const WIDGET_GOAL_GIFT_FEEDBACK_SETTINGS_STATE_KEY = 'widget_goal_gift_feedback_settings';
const CONTRIBUTORS_FEEDBACK_SETTINGS_STATE_KEY = 'contributors_feedback_settings';
const SHARED_WIDGET_FEEDBACK_SETTINGS_STATE_KEY = 'shared_widget_feedback_settings';
const WIDGET_GOAL_GIFTS_FONT_STATE_KEY = 'widget_goal_gifts_font';
const WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY = 'widget_goal_gifts_text_style';
const WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY = 'widget_goal_gifts_stroke_width';
const WIDGET_GOAL_GIFTS_NOTE_FONT_SIZE_STATE_KEY = 'widget_goal_gifts_note_font_size';
const WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_SIZE_STATE_KEY = 'widget_goal_gifts_achievement_badge_size';
const WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_STYLE_STATE_KEY = 'widget_goal_gifts_achievement_badge_style';
const WIDGET_GOAL_GIFT_ACTIVITY_COUNTS_STATE_KEY = 'widget_goal_gift_activity_counts';
const WIDGET_GOAL_GIFT_LIKE_TOTALS_STATE_KEY = 'widget_goal_gift_like_totals';
const WIDGET_GOAL_GIFT_LIKE_UNIQUE_SEEN_STATE_KEY = 'widget_goal_gift_like_unique_seen';
const WIDGET_GOAL_GIFT_FOLLOW_STATE_KEY = 'widget_goal_gift_follow_state';
const WIDGET_LIKE_CONTRIBUTION_USER_TOTALS_STATE_KEY = 'widget_like_contribution_user_totals';
const WIDGET_LIKE_CONTRIBUTION_USER_NICKNAMES_STATE_KEY = 'widget_like_contribution_user_nicknames';
const WIDGET_LIKE_CONTRIBUTION_USER_AVATARS_STATE_KEY = 'widget_like_contribution_user_avatars';
const WIDGET_TAP_LIST_SETTINGS_STATE_KEY = 'widget_tap_list_settings';
const WIDGET_CONTRIBUTORS_FONT_STATE_KEY = 'widget_contributors_font';
const WIDGET_CONTRIBUTORS_TEXT_STYLE_STATE_KEY = 'widget_contributors_text_style';
const WIDGET_CONTRIBUTORS_STROKE_WIDTH_STATE_KEY = 'widget_contributors_stroke_width';
const WIDGET_TOP_GIFT_FONT_STATE_KEY = 'widget_top_gift_font';
const WIDGET_TOP_GIFT_TEXT_STYLE_STATE_KEY = 'widget_top_gift_text_style';
const WIDGET_TOP_GIFT_STROKE_WIDTH_STATE_KEY = 'widget_top_gift_stroke_width';
const WIDGET_LIKE_CONTRIBUTION_FONT_STATE_KEY = 'widget_like_contribution_font';
const WIDGET_LIKE_CONTRIBUTION_TEXT_STYLE_STATE_KEY = 'widget_like_contribution_text_style';
const WIDGET_LIKE_CONTRIBUTION_STROKE_WIDTH_STATE_KEY = 'widget_like_contribution_stroke_width';
const WIDGET_TAP_LIST_FONT_STATE_KEY = 'widget_tap_list_font';
const WIDGET_TAP_LIST_TEXT_STYLE_STATE_KEY = 'widget_tap_list_text_style';
const WIDGET_TAP_LIST_STROKE_WIDTH_STATE_KEY = 'widget_tap_list_stroke_width';
const WIDGET_COIN_LIST_SETTINGS_STATE_KEY = 'widget_coin_list_settings';
const WIDGET_COIN_LIST_FONT_STATE_KEY = 'widget_coin_list_font';
const WIDGET_COIN_LIST_TEXT_STYLE_STATE_KEY = 'widget_coin_list_text_style';
const WIDGET_COIN_LIST_STROKE_WIDTH_STATE_KEY = 'widget_coin_list_stroke_width';
const WIDGET_GIFT_JAR_FONT_STATE_KEY = 'widget_gift_jar_font';
const WIDGET_GIFT_JAR_TEXT_STYLE_STATE_KEY = 'widget_gift_jar_text_style';
const WIDGET_GIFT_JAR_STROKE_WIDTH_STATE_KEY = 'widget_gift_jar_stroke_width';
const WIDGET_PUSH_PULL_FONT_STATE_KEY = 'widget_push_pull_font';
const WIDGET_PUSH_PULL_TEXT_STYLE_STATE_KEY = 'widget_push_pull_text_style';
const WIDGET_PUSH_PULL_STROKE_WIDTH_STATE_KEY = 'widget_push_pull_stroke_width';

const EXPORTABLE_SCOPED_SETTINGS_KEYS = [
    CONTRIBUTORS_DISPLAY_RANGE_STATE_KEY,
    GOAL_COUNT_STATE_KEY,
    DISPLAY_THRESHOLD_STATE_KEY,
    DISPLAY_AVATAR_VISIBILITY_STATE_KEY,
    DISPLAY_COLOR_THEME_STATE_KEY,
    DISPLAY_STROKE_WIDTH_STATE_KEY,
    DISPLAY_FONT_FAMILY_STATE_KEY,
    WIDGET_TOP_GIFT_SETTINGS_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_SETTINGS_STATE_KEY,
    SHARED_WIDGET_FEEDBACK_SETTINGS_STATE_KEY,
    CONTRIBUTORS_FEEDBACK_SETTINGS_STATE_KEY,
    WIDGET_GOAL_GIFT_FEEDBACK_SETTINGS_STATE_KEY,
    WIDGET_GOAL_GIFTS_FONT_STATE_KEY,
    WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY,
    WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY,
    WIDGET_GOAL_GIFTS_NOTE_FONT_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_STYLE_STATE_KEY,
    WIDGET_GOAL_GIFTS_STATE_KEY,
    WIDGET_TAP_LIST_SETTINGS_STATE_KEY,
    WIDGET_COIN_LIST_SETTINGS_STATE_KEY,
    COMMENT_SETTINGS_STATE_KEY,
    COMMENT_OBSERVED_EMOTES_STATE_KEY,
    COMMENT_OBSERVED_EMOJIS_STATE_KEY,
    EFFECT_EVENTS_STATE_KEY,
    EFFECT_TRIGGERS_STATE_KEY,
    WIDGET_CONTRIBUTORS_FONT_STATE_KEY,
    WIDGET_CONTRIBUTORS_TEXT_STYLE_STATE_KEY,
    WIDGET_CONTRIBUTORS_STROKE_WIDTH_STATE_KEY,
    WIDGET_TOP_GIFT_FONT_STATE_KEY,
    WIDGET_TOP_GIFT_TEXT_STYLE_STATE_KEY,
    WIDGET_TOP_GIFT_STROKE_WIDTH_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_FONT_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_TEXT_STYLE_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_STROKE_WIDTH_STATE_KEY,
    WIDGET_TAP_LIST_FONT_STATE_KEY,
    WIDGET_TAP_LIST_TEXT_STYLE_STATE_KEY,
    WIDGET_TAP_LIST_STROKE_WIDTH_STATE_KEY,
    WIDGET_COIN_LIST_FONT_STATE_KEY,
    WIDGET_COIN_LIST_TEXT_STYLE_STATE_KEY,
    WIDGET_COIN_LIST_STROKE_WIDTH_STATE_KEY,
    WIDGET_GIFT_JAR_FONT_STATE_KEY,
    WIDGET_GIFT_JAR_TEXT_STYLE_STATE_KEY,
    WIDGET_GIFT_JAR_STROKE_WIDTH_STATE_KEY,
    WIDGET_PUSH_PULL_FONT_STATE_KEY,
    WIDGET_PUSH_PULL_TEXT_STYLE_STATE_KEY,
    WIDGET_PUSH_PULL_STROKE_WIDTH_STATE_KEY,
];

const EXPORTABLE_GLOBAL_SETTINGS_KEYS = [
    'gift_jar_drop_above_jar',
    'gift_jar_size_multiplier',
    'gift_jar_size_ratio_coeff',
    'gift_jar_theme',
];

const EFFECT_SCREEN_COUNT = 10;
const DEFAULT_DISPLAY_THRESHOLD = 1000;
const DEFAULT_GOAL_COUNT = 10;
const DEFAULT_CONTRIBUTORS_DISPLAY_RANGE = 'today';
const DEFAULT_DISPLAY_SORT_ORDER = 'qualified_at_asc';
const DEFAULT_DISPLAY_AVATAR_VISIBILITY = 'show';
const DEFAULT_DISPLAY_FONT_FAMILY = 'default';
const DEFAULT_DISPLAY_COLOR_THEME = 'gold-night';
const DEFAULT_DISPLAY_STROKE_WIDTH = 4;
const MAX_DISPLAY_STROKE_WIDTH = 12;
const TIKTOK_GIFT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_GOAL_GIFT_WIDGET_ITEMS = 10;
const DEFAULT_WIDGET_TOP_GIFT_SETTINGS = {
    title: '本日最高ギフト',
    senderDisplayMode: 'latest',
    metalEffectKey: 'none'
};
const DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS = {
    title: 'Likeありがとう！',
    interval: 50,
    soundVolume: 100,
    balloonDesignKey: 'dark-glass',
    countFontSize: 42,
    nameFontSize: 34
};
// 新デザイン追加時は db/widgets.html の select#like-contribution-balloon-design と
// widgets/like-contribution.html の BALLOON_DESIGN_KEYS も同時に更新すること。
const ALLOWED_BALLOON_DESIGN_KEYS = new Set(['dark-glass', 'horizontal-pill', 'big-number', 'side-accent', 'compact-banner', 'stacked-center', 'wa-stamp', 'singer-stage', 'dance-floor', 'kitchen-chalk', 'paw-pop']);
const ALLOWED_LIKE_CONTRIBUTION_FONT_KEYS = new Set(['default','gothic','ui-gothic','mincho','ud-gothic','ud-mincho','meiryo','rounded','kyokasho','gyosho','togarie','ln-pop','comic-impact','pop-idol','entame','marker','retro-bold','luxury-mincho','antique-modern','atelier-brush','pixel-code','sawarabi-mincho','potta-one','murecho-thin','stick']);
const ALLOWED_LIKE_CONTRIBUTION_TEXT_STYLE_KEYS = new Set(['gold-night','ice-night','candy-pop','mint-lime','sunset-party','violet-flash','mono-impact','sakura-bloom','ocean-glow','emerald-city','ruby-flare','lemon-pop','midnight-aqua','peach-fizz','festival-red','rose-gold','cyber-teal','aurora-dream','coral-soda','platinum-pop','champagne-shine','royal-velvet','emerald-luxe','sunrise-opal','prism-burst','tropical-punch','lagoon-shine','berry-mist','polar-neon','citrus-splash']);
const DEFAULT_WIDGET_FEEDBACK_SETTINGS = {
    soundEnabled: true,
    effectEnabled: true,
    soundKey: 'business08',
    effectKey: 'glow'
};
const DEFAULT_GOAL_GIFT_WIDGET_ITEM = {
    enabled: false,
    giftId: '',
    giftName: '',
    displayName: '',
    note: '',
    giftImage: '',
    targetCount: 1,
    countUniqueUsers: false,
    currentCountOffset: 0,
    resetAtMidnight: false,
    currentCountOffsetDayKey: ''
};
const DEFAULT_GOAL_GIFT_WIDGET_FONT_KEY = 'default';
const DEFAULT_GOAL_GIFT_WIDGET_TEXT_STYLE_KEY = 'gold-night';
const DEFAULT_GOAL_GIFT_WIDGET_STROKE_WIDTH = 3;
const MAX_GOAL_GIFT_WIDGET_STROKE_WIDTH = 24;
const DEFAULT_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE = 28;
const MIN_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE = 8;
const MAX_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE = 96;
const DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE = 152;
const MIN_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE = 40;
const MAX_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE = 400;
const DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_STYLE = 'stamp-red';
const ALLOWED_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLES = new Set(['stamp-red', 'stamp-blue', 'stamp-gold', 'stamp-green', 'stamp-dark']);
const GOAL_GIFT_SYSTEM_IDS = {
    like: '__system__:like',
    follow: '__system__:follow'
};
const GOAL_GIFT_SYSTEM_LABELS = {
    [GOAL_GIFT_SYSTEM_IDS.like]: 'タップ',
    [GOAL_GIFT_SYSTEM_IDS.follow]: 'フォロー'
};
const GOAL_GIFT_SYSTEM_IMAGE_DATA_URLS = {
    [GOAL_GIFT_SYSTEM_IDS.like]: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
            <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#fb7185"/>
                    <stop offset="100%" stop-color="#f59e0b"/>
                </linearGradient>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#7c2d12" flood-opacity="0.28"/>
                </filter>
            </defs>
            <rect width="320" height="320" rx="72" fill="url(#bg)"/>
            <circle cx="242" cy="82" r="30" fill="rgba(255,255,255,0.18)"/>
            <circle cx="254" cy="70" r="10" fill="rgba(255,255,255,0.48)"/>
            <g filter="url(#shadow)">
                <path d="M160 250c-8 0-16-3-22-9l-50-47c-22-21-24-56-4-78 19-20 50-23 72-7l4 3 4-3c22-16 53-13 72 7 20 22 18 57-4 78l-50 47c-6 6-14 9-22 9z" fill="#fff7ed"/>
                <path d="M204 108c14 0 27 6 36 16 14 16 13 41-3 56l-50 47c-7 7-18 7-25 0l-50-47c-16-15-17-40-3-56 15-16 40-18 57-6l14 10 14-10c7-6 16-10 25-10z" fill="#ffffff" opacity="0.3"/>
                <circle cx="103" cy="104" r="14" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.9"/>
                <path d="M88 74c10-14 21-22 34-26" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.82"/>
                <path d="M118 60c8-4 16-6 26-7" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.68"/>
            </g>
        </svg>
    `)}`,
    [GOAL_GIFT_SYSTEM_IDS.follow]: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
            <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#38bdf8"/>
                    <stop offset="100%" stop-color="#14b8a6"/>
                </linearGradient>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#164e63" flood-opacity="0.26"/>
                </filter>
            </defs>
            <rect width="320" height="320" rx="72" fill="url(#bg)"/>
            <circle cx="242" cy="94" r="56" fill="rgba(255,255,255,0.16)"/>
            <g filter="url(#shadow)">
                <circle cx="136" cy="118" r="42" fill="#ecfeff"/>
                <path d="M64 244c0-36 29-65 65-65h14c36 0 65 29 65 65v14H64z" fill="#ecfeff"/>
                <circle cx="230" cy="186" r="42" fill="#ffffff"/>
                <path d="M230 162v48" stroke="#0f766e" stroke-width="14" stroke-linecap="round"/>
                <path d="M206 186h48" stroke="#0f766e" stroke-width="14" stroke-linecap="round"/>
            </g>
        </svg>
    `)}`
};
const TIKTOK_JA_LOCALE_CLIENT_PARAMS = {
    app_language: 'ja',
    browser_language: 'ja-JP',
    webcast_language: 'ja',
    priority_region: 'JP',
    region: 'JP',
    tz_name: 'Asia/Tokyo'
};
const TIKTOK_JA_LOCALE_HEADERS = {
    'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8'
};
// Electron ログインウィンドウと同じ UA を使用することでフィンガープリントの一致を保つ
const TIKTOK_DESKTOP_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '132.0.0.0'} Safari/537.36`;
const RECONNECT_DELAY_MS = 10000;
const OFFLINE_RECONNECT_DELAY_MS = 10000;
const FIRST_CONNECT_RETRY_DELAY_MS = 3000;
const RAW_EVENT_BATCH_SIZE = 100;
const RAW_EVENT_FLUSH_DELAY_MS = 250;
const RAW_EVENT_RETRY_DELAY_MS = 1000;
const LIVE_COMMENT_HISTORY_LIMIT = 100;
// TikTok WS イベントの受信遅延を可視化するための計測ログ。
// process.env.WS_LATENCY_LOG === '0' で無効化可能。既定は有効（診断目的）。
const WS_LATENCY_LOG_ENABLED = process.env.WS_LATENCY_LOG !== '0';
// 1 種別あたり最低この間隔を空けて出力（高頻度な like を間引く）
const WS_LATENCY_LOG_MIN_INTERVAL_MS = {
    like: 1000,
    member: 1000,
    roomUser: 2000
};
const COMMENT_DISPLAY_TTL_MS = 0;
const COMMENT_READ_ALOUD_EFFECT_SCREEN = 1;
const COMMENT_READ_ALOUD_MAX_AGE_MS = 15000;
const COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION = 2;
const COMMENT_OBSERVED_EMOTE_CACHE_LIMIT = 200;
const COMMENT_OBSERVED_EMOJI_CACHE_LIMIT = 200;
const COMMENT_READ_ALOUD_DEFAULT_FILTERS = [
    '死ね',
    '殺す',
    '自殺',
    '殺意',
    '薬物',
    '大麻',
    '覚醒剤',
    'コカイン',
    'マンコ',
    'クリトリス',
    'オメコ',
    'チンポ',
    'チンコ',
    'フェラ',
    'クンニ',
    '中出し',
    'セフレ',
    '援交',
    '立ちんぼ',
    '部落',
    'エッタ',
    'チョン',
    'シナ人',
    'チャンコロ',
    '黒んぼ',
    'ホモ',
    'レズ',
    'おかま',
    'ガイジ',
    '知障',
    'カタワ',
    'ブス',
    'デブ',
    'ハゲ',
    'デッパ',
    '整形モンスター',
    '失敗作',
    'ババア',
    '引退',
    'ゴミ',
    'カス',
    '無能',
    '詐欺',
    'ウンコ',
    'ゲロ',
    'スカトロ',
    '食糞',
    'あへあへ',
    'イクイク'
];
const COMMENT_FEED_EVENT_DEFINITIONS = [
    { type: 'chat', label: 'コメント', system: false },
    { type: 'member', label: '入室', system: true },
    { type: 'like', label: 'いいね', system: true },
    { type: 'social', label: 'ソーシャル', system: true },
    { type: 'follow', label: 'フォロー', system: true },
    { type: 'share', label: 'シェア', system: true },
    { type: 'questionNew', label: '質問', system: true },
    { type: 'roomUser', label: '視聴者数', system: true },
    { type: 'subscribe', label: 'サブスク', system: true },
    { type: 'emote', label: 'エモート', system: true },
    { type: 'envelope', label: '宝箱', system: true },
    { type: 'liveIntro', label: 'ライブ紹介', system: true },
    { type: 'streamEnd', label: '配信終了', system: true },
    { type: 'goalUpdate', label: 'ゴール更新', system: true },
    { type: 'roomMessage', label: 'ルームメッセージ', system: true },
    { type: 'imDelete', label: '削除', system: true },
    { type: 'unauthorizedMember', label: '制限メンバー', system: true },
    { type: 'inRoomBanner', label: 'ルームバナー', system: true },
    { type: 'rankUpdate', label: 'ランキング更新', system: true },
    { type: 'pollMessage', label: '投票', system: true },
    { type: 'rankText', label: 'ランキング表示', system: true },
    { type: 'oecLiveShopping', label: 'ライブショッピング', system: true },
    { type: 'msgDetect', label: 'メッセージ検知', system: true },
    { type: 'linkMessage', label: 'リンクメッセージ', system: true },
    { type: 'roomVerify', label: 'ルーム認証', system: true },
    { type: 'linkLayer', label: 'リンクレイヤー', system: true },
    { type: 'roomPin', label: '固定メッセージ', system: true }
];

module.exports = {
    TIME_ZONE,
    BROADCASTER_ID_STATE_KEY,
    DISPLAY_STATE_KEY,
    DISPLAY_DAY_REFERENCE_STATE_KEY,
    CONTRIBUTORS_DISPLAY_RANGE_STATE_KEY,
    CONTRIBUTORS_SESSION_STARTED_AT_STATE_KEY,
    CONTRIBUTORS_SESSION_ENDED_AT_STATE_KEY,
    DISPLAY_THRESHOLD_STATE_KEY,
    GOAL_COUNT_STATE_KEY,
    DISPLAY_AVATAR_VISIBILITY_STATE_KEY,
    DISPLAY_FONT_FAMILY_STATE_KEY,
    DISPLAY_COLOR_THEME_STATE_KEY,
    DISPLAY_STROKE_WIDTH_STATE_KEY,
    COMMENT_SETTINGS_STATE_KEY,
    COMMENT_OBSERVED_EMOTES_STATE_KEY,
    COMMENT_OBSERVED_EMOJIS_STATE_KEY,
    EFFECT_EVENTS_STATE_KEY,
    EFFECT_TRIGGERS_STATE_KEY,
    WIDGET_TOP_GIFT_SETTINGS_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_SETTINGS_STATE_KEY,
    WIDGET_GOAL_GIFTS_STATE_KEY,
    WIDGET_GOAL_GIFT_FEEDBACK_SETTINGS_STATE_KEY,
    CONTRIBUTORS_FEEDBACK_SETTINGS_STATE_KEY,
    SHARED_WIDGET_FEEDBACK_SETTINGS_STATE_KEY,
    WIDGET_GOAL_GIFTS_FONT_STATE_KEY,
    WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY,
    WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY,
    WIDGET_GOAL_GIFTS_NOTE_FONT_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_STYLE_STATE_KEY,
    WIDGET_GOAL_GIFT_ACTIVITY_COUNTS_STATE_KEY,
    WIDGET_GOAL_GIFT_LIKE_TOTALS_STATE_KEY,
    WIDGET_GOAL_GIFT_LIKE_UNIQUE_SEEN_STATE_KEY,
    WIDGET_GOAL_GIFT_FOLLOW_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_USER_TOTALS_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_USER_NICKNAMES_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_USER_AVATARS_STATE_KEY,
    WIDGET_TAP_LIST_SETTINGS_STATE_KEY,
    WIDGET_CONTRIBUTORS_FONT_STATE_KEY,
    WIDGET_CONTRIBUTORS_TEXT_STYLE_STATE_KEY,
    WIDGET_CONTRIBUTORS_STROKE_WIDTH_STATE_KEY,
    WIDGET_TOP_GIFT_FONT_STATE_KEY,
    WIDGET_TOP_GIFT_TEXT_STYLE_STATE_KEY,
    WIDGET_TOP_GIFT_STROKE_WIDTH_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_FONT_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_TEXT_STYLE_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_STROKE_WIDTH_STATE_KEY,
    WIDGET_TAP_LIST_FONT_STATE_KEY,
    WIDGET_TAP_LIST_TEXT_STYLE_STATE_KEY,
    WIDGET_TAP_LIST_STROKE_WIDTH_STATE_KEY,
    WIDGET_COIN_LIST_SETTINGS_STATE_KEY,
    WIDGET_COIN_LIST_FONT_STATE_KEY,
    WIDGET_COIN_LIST_TEXT_STYLE_STATE_KEY,
    WIDGET_COIN_LIST_STROKE_WIDTH_STATE_KEY,
    WIDGET_GIFT_JAR_FONT_STATE_KEY,
    WIDGET_GIFT_JAR_TEXT_STYLE_STATE_KEY,
    WIDGET_GIFT_JAR_STROKE_WIDTH_STATE_KEY,
    WIDGET_PUSH_PULL_FONT_STATE_KEY,
    WIDGET_PUSH_PULL_TEXT_STYLE_STATE_KEY,
    WIDGET_PUSH_PULL_STROKE_WIDTH_STATE_KEY,
    EXPORTABLE_SCOPED_SETTINGS_KEYS,
    EXPORTABLE_GLOBAL_SETTINGS_KEYS,
    EFFECT_SCREEN_COUNT,
    DEFAULT_DISPLAY_THRESHOLD,
    DEFAULT_GOAL_COUNT,
    DEFAULT_CONTRIBUTORS_DISPLAY_RANGE,
    DEFAULT_DISPLAY_SORT_ORDER,
    DEFAULT_DISPLAY_AVATAR_VISIBILITY,
    DEFAULT_DISPLAY_FONT_FAMILY,
    DEFAULT_DISPLAY_COLOR_THEME,
    DEFAULT_DISPLAY_STROKE_WIDTH,
    MAX_DISPLAY_STROKE_WIDTH,
    TIKTOK_GIFT_CACHE_TTL_MS,
    MAX_GOAL_GIFT_WIDGET_ITEMS,
    DEFAULT_WIDGET_TOP_GIFT_SETTINGS,
    DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS,
    ALLOWED_BALLOON_DESIGN_KEYS,
    ALLOWED_LIKE_CONTRIBUTION_FONT_KEYS,
    ALLOWED_LIKE_CONTRIBUTION_TEXT_STYLE_KEYS,
    DEFAULT_WIDGET_FEEDBACK_SETTINGS,
    DEFAULT_GOAL_GIFT_WIDGET_ITEM,
    DEFAULT_GOAL_GIFT_WIDGET_FONT_KEY,
    DEFAULT_GOAL_GIFT_WIDGET_TEXT_STYLE_KEY,
    DEFAULT_GOAL_GIFT_WIDGET_STROKE_WIDTH,
    MAX_GOAL_GIFT_WIDGET_STROKE_WIDTH,
    DEFAULT_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE,
    MIN_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE,
    MAX_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE,
    DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE,
    MIN_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE,
    MAX_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE,
    DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_STYLE,
    ALLOWED_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLES,
    GOAL_GIFT_SYSTEM_IDS,
    GOAL_GIFT_SYSTEM_LABELS,
    GOAL_GIFT_SYSTEM_IMAGE_DATA_URLS,
    TIKTOK_JA_LOCALE_CLIENT_PARAMS,
    TIKTOK_JA_LOCALE_HEADERS,
    TIKTOK_DESKTOP_USER_AGENT,
    RECONNECT_DELAY_MS,
    OFFLINE_RECONNECT_DELAY_MS,
    FIRST_CONNECT_RETRY_DELAY_MS,
    RAW_EVENT_BATCH_SIZE,
    RAW_EVENT_FLUSH_DELAY_MS,
    RAW_EVENT_RETRY_DELAY_MS,
    LIVE_COMMENT_HISTORY_LIMIT,
    WS_LATENCY_LOG_ENABLED,
    WS_LATENCY_LOG_MIN_INTERVAL_MS,
    COMMENT_DISPLAY_TTL_MS,
    COMMENT_READ_ALOUD_EFFECT_SCREEN,
    COMMENT_READ_ALOUD_MAX_AGE_MS,
    COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION,
    COMMENT_OBSERVED_EMOTE_CACHE_LIMIT,
    COMMENT_OBSERVED_EMOJI_CACHE_LIMIT,
    COMMENT_READ_ALOUD_DEFAULT_FILTERS,
    COMMENT_FEED_EVENT_DEFINITIONS,
};
