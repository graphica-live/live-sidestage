'use strict';

const WIDGET_FONT_OPTIONS = [
    { key: 'default', label: 'M PLUS Rounded 1c', family: '"M PLUS Rounded 1c", sans-serif' },
    { key: 'gothic', label: 'Noto Sans JP', family: '"Noto Sans JP", sans-serif' },
    { key: 'ui-gothic', label: 'Zen Kaku Gothic New', family: '"Zen Kaku Gothic New", sans-serif' },
    { key: 'mincho', label: 'Noto Serif JP', family: '"Noto Serif JP", serif' },
    { key: 'ud-gothic', label: 'Kosugi', family: '"Kosugi", sans-serif' },
    { key: 'ud-mincho', label: 'Zen Old Mincho', family: '"Zen Old Mincho", serif' },
    { key: 'meiryo', label: 'Klee One', family: '"Klee One", cursive' },
    { key: 'rounded', label: 'Zen Maru Gothic', family: '"Zen Maru Gothic", sans-serif' },
    { key: 'kyokasho', label: '教科書風 Klee One', family: '"Klee One", cursive' },
    { key: 'gyosho', label: 'Yuji Syuku', family: '"Yuji Syuku", cursive' },
    { key: 'togarie', label: 'トガリエ', family: '"Dela Gothic One", sans-serif' },
    { key: 'ln-pop', label: 'ラノベポップ', family: '"Mochiy Pop One", sans-serif' },
    { key: 'comic-impact', label: 'コミックインパクト', family: '"Rampart One", sans-serif' },
    { key: 'pop-idol', label: 'Hachi Maru Pop', family: '"Hachi Maru Pop", cursive' },
    { key: 'entame', label: 'RocknRoll One', family: '"RocknRoll One", sans-serif' },
    { key: 'marker', label: 'Yusei Magic', family: '"Yusei Magic", cursive' },
    { key: 'retro-bold', label: 'Kaisei Decol', family: '"Kaisei Decol", serif' },
    { key: 'luxury-mincho', label: 'Shippori Mincho B1', family: '"Shippori Mincho B1", serif' },
    { key: 'antique-modern', label: 'Zen Antique', family: '"Zen Antique", serif' },
    { key: 'atelier-brush', label: 'Yuji Mai', family: '"Yuji Mai", cursive' },
    { key: 'pixel-code', label: 'PIXEL CODE', family: '"DotGothic16", "Noto Sans JP", sans-serif' },
    { key: 'sawarabi-mincho', label: 'Sawarabi Mincho「さわらび明朝」', family: '"Sawarabi Mincho", serif' },
    { key: 'potta-one', label: 'Potta One「ボールドインパクト」', family: '"Potta One", sans-serif' },
    { key: 'murecho-thin', label: 'Murecho Thin「モダン細字」', family: '"Murecho", sans-serif' },
    { key: 'stick', label: 'Stick「超細字」', family: '"Stick", sans-serif' }
];

// 上記フォント一覧をレンダリングするために必要な Google Fonts のインポートURL。
// 各ウィジェットのオーバーレイHTMLで @import しているものと同一。
const WIDGET_FONT_GOOGLE_FONTS_URL = 'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700;800;900&family=Noto+Sans+JP:wght@400;700;900&family=Zen+Kaku+Gothic+New:wght@400;700;900&family=Noto+Serif+JP:wght@400;700;900&family=Kosugi&family=Zen+Old+Mincho:wght@400;700;900&family=Klee+One:wght@400;600&family=Zen+Maru+Gothic:wght@400;700;900&family=Yuji+Syuku&family=Dela+Gothic+One&family=DotGothic16&family=Hachi+Maru+Pop&family=RocknRoll+One&family=Yusei+Magic&family=Kaisei+Decol:wght@400;500;700&family=Mochiy+Pop+One&family=Rampart+One&family=Shippori+Mincho+B1:wght@500;700;800&family=Zen+Antique&family=Yuji+Mai&family=Sawarabi+Mincho&family=Potta+One&family=Murecho:wght@100;300;400;700&family=Stick&display=swap';

const WIDGET_FONT_OPTION_MAP = new Map(WIDGET_FONT_OPTIONS.map((option) => [option.key, option]));

function normalizeWidgetFontKey(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    return WIDGET_FONT_OPTION_MAP.has(normalizedValue) ? normalizedValue : 'default';
}

function getWidgetFontFamilyByKey(value) {
    return WIDGET_FONT_OPTION_MAP.get(normalizeWidgetFontKey(value))?.family || WIDGET_FONT_OPTIONS[0].family;
}

function buildWidgetFontOptionsMarkup(selectedKey, escapeHtmlFn) {
    const escape = typeof escapeHtmlFn === 'function' ? escapeHtmlFn : (value) => String(value);
    const normalizedKey = normalizeWidgetFontKey(selectedKey);
    return WIDGET_FONT_OPTIONS.map((option) => `
        <option value="${escape(option.key)}" style="font-family: ${escape(option.family)};" ${option.key === normalizedKey ? 'selected' : ''}>${escape(option.label)}</option>
    `).join('');
}
