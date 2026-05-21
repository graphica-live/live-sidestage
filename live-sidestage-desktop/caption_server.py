#!/usr/bin/env python3
"""
Parakeet ASR server for TikEffect caption widget.
Captures mic audio and POSTs recognized text to the TikEffect backend.

Install:
  pip install nemo_toolkit[asr] sounddevice soundfile numpy requests
  (requires CUDA + NVIDIA GPU for best performance)

Usage:
  python caption_server.py [--port 38100] [--device 0] [--chunk 4.0]
"""
import os
import sys
import json
import time
import threading
import argparse
import tempfile
import numpy as np

def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=38100)
    parser.add_argument('--device', type=int, default=None, help='sounddevice input device index')
    parser.add_argument('--chunk', type=float, default=4.0, help='seconds to accumulate before transcribing')
    parser.add_argument('--min-chunk', type=float, default=0.8, help='minimum silence seconds before flushing early')
    args = parser.parse_args()

    backend_url = f'http://localhost:{args.port}/api/widgets/caption/asr-text'

    try:
        import sounddevice as sd
    except ImportError:
        emit({'type': 'error', 'message': 'sounddevice が見つかりません。pip install sounddevice を実行してください。'})
        sys.exit(1)

    try:
        import soundfile as sf
    except ImportError:
        emit({'type': 'error', 'message': 'soundfile が見つかりません。pip install soundfile を実行してください。'})
        sys.exit(1)

    try:
        import requests
    except ImportError:
        emit({'type': 'error', 'message': 'requests が見つかりません。pip install requests を実行してください。'})
        sys.exit(1)

    emit({'type': 'status', 'message': 'Parakeet モデルを読み込んでいます（初回は数分かかります）...'})

    try:
        import nemo.collections.asr as nemo_asr
        model = nemo_asr.models.ASRModel.from_pretrained('nvidia/parakeet-tdt_ctc-0.6b-ja')
        model.eval()
        emit({'type': 'status', 'message': 'Parakeet モデル読み込み完了'})
    except Exception as e:
        emit({'type': 'error', 'message': f'モデル読み込み失敗: {e}'})
        sys.exit(1)

    SAMPLE_RATE = 16000
    STEP = int(SAMPLE_RATE * 0.1)  # 100ms callbacks

    audio_chunks = []
    audio_lock = threading.Lock()
    running = True

    def audio_callback(indata, frames, time_info, status):
        with audio_lock:
            audio_chunks.append(indata[:, 0].copy())

    def transcribe_loop():
        while running:
            time.sleep(args.min_chunk)
            with audio_lock:
                if not audio_chunks:
                    continue
                combined = np.concatenate(audio_chunks)
                duration = len(combined) / SAMPLE_RATE
                if duration < args.min_chunk:
                    continue
                audio_chunks.clear()

            # Skip near-silent frames
            rms = float(np.sqrt(np.mean(combined ** 2)))
            if rms < 0.003:
                continue

            try:
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
                    fname = f.name
                sf.write(fname, combined, SAMPLE_RATE)
                result = model.transcribe([fname])
                os.unlink(fname)

                text = ''
                if result:
                    if isinstance(result[0], str):
                        text = result[0]
                    elif hasattr(result[0], 'text'):
                        text = result[0].text

                text = text.strip()
                if text:
                    emit({'type': 'transcript', 'text': text, 'isFinal': True})
                    try:
                        requests.post(
                            backend_url,
                            json={'text': text, 'isFinal': True, 'srcLang': 'ja'},
                            timeout=3
                        )
                    except Exception:
                        pass
            except Exception as e:
                emit({'type': 'error', 'message': str(e)})

    thread = threading.Thread(target=transcribe_loop, daemon=True)
    thread.start()

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='float32',
            blocksize=STEP,
            callback=audio_callback,
            device=args.device
        ):
            emit({'type': 'status', 'message': 'マイク録音を開始しました'})
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        running = False
        emit({'type': 'status', 'message': '停止しました'})
    except Exception as e:
        running = False
        emit({'type': 'error', 'message': f'マイクエラー: {e}'})
        sys.exit(1)


if __name__ == '__main__':
    main()
