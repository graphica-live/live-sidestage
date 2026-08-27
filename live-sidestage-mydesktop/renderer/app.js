'use strict';

// v1はページが「エフェクト予告」1つのみのため、サイドバーのクリックによる
// ページ切り替えは実装しない。2ページ目を追加する時点で、
// .nav-item の click ハンドラと .page の表示切り替えをここに足す。
window.addEventListener('DOMContentLoaded', () => {
    if (window.EffectsPreviewPage) {
        window.EffectsPreviewPage.init();
    }
});
