const triggerGiftsSettingsToggle = document.getElementById('trigger-gifts-settings-button');
const triggerGiftsSettingsModal = document.getElementById('trigger-gifts-settings-modal');
const triggerGiftsFontSelect = document.getElementById('trigger-gifts-font');
const triggerGiftsTextStyleSelect = document.getElementById('trigger-gifts-text-style');
const triggerGiftsStrokeWidthInput = document.getElementById('trigger-gifts-stroke-width');
const triggerGiftsFontSizeInput = document.getElementById('trigger-gifts-font-size');

const TRIGGER_GIFTS_FONT_OPTIONS = [
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
const TRIGGER_GIFTS_TEXT_STYLE_OPTIONS = [
    { key: 'gold-night', label: 'LIVE Gold', preview: 'color:#fbbf24;-webkit-text-stroke:3px #0f172a;' },
    { key: 'ice-night', label: 'Ice Blue', preview: 'color:#dbeafe;-webkit-text-stroke:3px #172554;' },
    { key: 'candy-pop', label: 'Candy Pop', preview: 'color:#f9a8d4;-webkit-text-stroke:3px #831843;' },
    { key: 'mint-lime', label: 'Mint Shot', preview: 'color:#d9f99d;-webkit-text-stroke:3px #14532d;' },
    { key: 'sunset-party', label: 'Sunset Glow', preview: 'color:#fdba74;-webkit-text-stroke:3px #7c2d12;' },
    { key: 'violet-flash', label: 'Violet Beat', preview: 'color:#c4b5fd;-webkit-text-stroke:3px #312e81;' },
    { key: 'mono-impact', label: 'Mono Impact', preview: 'color:#ffffff;-webkit-text-stroke:3px #111827;' },
    { key: 'sakura-bloom', label: 'Sakura Glow', preview: 'color:#fbcfe8;-webkit-text-stroke:3px #9d174d;' },
    { key: 'ocean-glow', label: 'Ocean Beam', preview: 'color:#67e8f9;-webkit-text-stroke:3px #164e63;' },
    { key: 'emerald-city', label: 'Emerald Neon', preview: 'color:#6ee7b7;-webkit-text-stroke:3px #064e3b;' },
    { key: 'ruby-flare', label: 'Ruby Flame', preview: 'color:#fb7185;-webkit-text-stroke:3px #3f0d12;' },
    { key: 'lemon-pop', label: 'Lemon Punch', preview: 'color:#fde047;-webkit-text-stroke:3px #1e3a8a;' },
    { key: 'midnight-aqua', label: 'Midnight Aqua', preview: 'color:#99f6e4;-webkit-text-stroke:3px #0f172a;' },
    { key: 'peach-fizz', label: 'Peach Fizz', preview: 'color:#fdba74;-webkit-text-stroke:3px #7f1d1d;' },
    { key: 'festival-red', label: 'Festival Red', preview: 'color:#fca5a5;-webkit-text-stroke:3px #1f2937;' },
    { key: 'rose-gold', label: 'Rose Luxe', preview: 'color:#f8b4a6;-webkit-text-stroke:3px #5b342e;' },
    { key: 'cyber-teal', label: 'Cyber Teal', preview: 'color:#67e8f9;-webkit-text-stroke:3px #0f2740;' },
    { key: 'aurora-dream', label: 'Aurora Dream', preview: 'color:#e9d5ff;-webkit-text-stroke:3px #4c1d95;' },
    { key: 'coral-soda', label: 'Coral Soda', preview: 'color:#fb7185;-webkit-text-stroke:3px #7f1d1d;' },
    { key: 'platinum-pop', label: 'Platinum Pop', preview: 'color:#e2e8f0;-webkit-text-stroke:3px #334155;' },
    { key: 'champagne-shine', label: 'Champagne Shine', preview: 'color:#f8e7b5;-webkit-text-stroke:3px #6b4f2a;' },
    { key: 'royal-velvet', label: 'Royal Velvet', preview: 'color:#d8b4fe;-webkit-text-stroke:3px #312e81;' },
    { key: 'emerald-luxe', label: 'Emerald Luxe', preview: 'color:#a7f3d0;-webkit-text-stroke:3px #14532d;' },
    { key: 'sunrise-opal', label: 'Sunrise Opal', preview: 'color:#fdba74;-webkit-text-stroke:3px #9a3412;' },
    { key: 'prism-burst', label: 'Prism Burst', preview: 'color:#7dd3fc;-webkit-text-stroke:3px #4338ca;' },
    { key: 'tropical-punch', label: 'Tropical Punch', preview: 'color:#fb7185;-webkit-text-stroke:3px #7f1d1d;' },
    { key: 'lagoon-shine', label: 'Lagoon Shine', preview: 'color:#2dd4bf;-webkit-text-stroke:3px #155e75;' },
    { key: 'berry-mist', label: 'Berry Mist', preview: 'color:#f472b6;-webkit-text-stroke:3px #701a75;' },
    { key: 'polar-neon', label: 'Polar Neon', preview: 'color:#67e8f9;-webkit-text-stroke:3px #1e293b;' },
    { key: 'citrus-splash', label: 'Citrus Splash', preview: 'color:#a3e635;-webkit-text-stroke:3px #166534;' }
];

function getTriggerGiftsFontOptionsMarkup(selectedKey) {
    return TRIGGER_GIFTS_FONT_OPTIONS.map((option) => `
        <option value="${option.key}" style="font-family: ${option.family};" ${option.key === selectedKey ? 'selected' : ''}>${option.label}</option>
    `).join('');
}

function getTriggerGiftsTextStyleOptionsMarkup(selectedKey) {
    return TRIGGER_GIFTS_TEXT_STYLE_OPTIONS.map((option) => `
        <option value="${option.key}" style="${option.preview}" ${option.key === selectedKey ? 'selected' : ''}>${option.label}</option>
    `).join('');
}

async function loadTriggerGiftsAppearance() {
    try {
        const response = await fetch('/api/effects/trigger-gifts/appearance');
        const payload = await response.json();
        const appearance = payload.appearance || {};

        triggerGiftsFontSelect.innerHTML = getTriggerGiftsFontOptionsMarkup(appearance.fontKey || 'default');
        triggerGiftsTextStyleSelect.innerHTML = getTriggerGiftsTextStyleOptionsMarkup(appearance.textStyleKey || 'gold-night');
        triggerGiftsStrokeWidthInput.value = String(appearance.strokeWidth ?? 3);
        triggerGiftsFontSizeInput.value = String(appearance.fontSize ?? 20);
    } catch {
        // 読み込み失敗時は既定値のまま
    }
}

async function saveTriggerGiftsAppearance() {
    try {
        await fetch('/api/effects/trigger-gifts/appearance', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appearance: {
                    fontKey: triggerGiftsFontSelect.value,
                    textStyleKey: triggerGiftsTextStyleSelect.value,
                    strokeWidth: triggerGiftsStrokeWidthInput.value,
                    fontSize: triggerGiftsFontSizeInput.value
                }
            })
        });
    } catch {
        setStatus('表示設定の保存に失敗しました。', 'error');
    }
}

triggerGiftsSettingsToggle.addEventListener('click', () => {
    openModal(triggerGiftsSettingsModal);
});

document.querySelectorAll('[data-action="close-trigger-gifts-settings-modal"]').forEach((button) => {
    button.addEventListener('click', () => closeModal(triggerGiftsSettingsModal));
});

triggerGiftsFontSelect.addEventListener('change', saveTriggerGiftsAppearance);
triggerGiftsTextStyleSelect.addEventListener('change', saveTriggerGiftsAppearance);
triggerGiftsStrokeWidthInput.addEventListener('change', saveTriggerGiftsAppearance);
triggerGiftsFontSizeInput.addEventListener('change', saveTriggerGiftsAppearance);

loadTriggerGiftsAppearance();
