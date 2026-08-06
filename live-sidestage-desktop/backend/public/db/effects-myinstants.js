// テンプレート音声選択ボタンから共通サウンドピッカー(/shared/sound-picker.js)を開く。
// 検索・プレビュー・取り込みのロジック自体は共通化済みで、ここでは取り込み後の反映先だけを定義する。

eventModalTemplateAudioButton.addEventListener('click', () => {
    openSoundPicker({
        eventIdHint: editingEventId || pendingNewEventUploadId,
        onImported: (asset) => {
            pendingEventModalAudioAsset = asset;
            eventModalAudioEnabled.checked = true;
            eventModalAudioName.textContent = asset.name;
            setStatus(`音声 ${asset.name} を取り込みました。`, 'ok');
        }
    });
});
