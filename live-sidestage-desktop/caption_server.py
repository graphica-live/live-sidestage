#!/usr/bin/env python3
"""
Parakeet ASR + silero-VAD server for TikEffect caption widget.
Captures mic audio, detects speech boundaries via VAD, and POSTs recognized text.

Install:
  pip install nemo_toolkit[asr] sounddevice soundfile numpy requests torch
  (requires CUDA + NVIDIA GPU for best performance)

Usage:
  python caption_server.py [--port 38100] [--device 0] [--max-chunk 8.0] [--silence-dur 0.8] [--vad-threshold 0.5]
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
    parser.add_argument('--max-chunk', type=float, default=8.0, help='max seconds before forced flush')
    parser.add_argument('--silence-dur', type=float, default=0.8, help='seconds of VAD silence to end utterance')
    parser.add_argument('--vad-threshold', type=float, default=0.5, help='silero-VAD speech confidence threshold (0-1)')
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

    emit({'type': 'status', 'message': 'silero-VAD を読み込んでいます...'})
    try:
        import torch
        vad_model, vad_utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False,
            trust_repo=True,
        )
        vad_model.eval()
        emit({'type': 'status', 'message': 'silero-VAD 読み込み完了'})
    except Exception as e:
        emit({'type': 'error', 'message': f'silero-VAD 読み込み失敗: {e}'})
        sys.exit(1)

    emit({'type': 'status', 'message': 'Parakeet モデルを読み込んでいます（初回は数分かかります）...'})
    try:
        import nemo.collections.asr as nemo_asr
        asr = nemo_asr.models.ASRModel.from_pretrained('nvidia/parakeet-tdt_ctc-0.6b-ja')
        asr.eval()
        emit({'type': 'status', 'message': 'Parakeet モデル読み込み完了'})
    except Exception as e:
        emit({'type': 'error', 'message': f'モデル読み込み失敗: {e}'})
        sys.exit(1)

    SAMPLE_RATE = 16000
    # silero-VAD requires exactly 512 samples (32ms) per frame at 16kHz
    BLOCKSIZE = 512

    SILENCE_FRAMES_THRESHOLD = int(args.silence_dur * SAMPLE_RATE / BLOCKSIZE)
    MAX_SPEECH_FRAMES = int(args.max_chunk * SAMPLE_RATE / BLOCKSIZE)

    raw_frames = []
    raw_lock = threading.Lock()
    new_data_event = threading.Event()

    def audio_callback(indata, frames, time_info, status):
        with raw_lock:
            raw_frames.append(indata[:, 0].copy())
        new_data_event.set()

    def do_transcribe(audio_np):
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            fname = f.name
        try:
            sf.write(fname, audio_np, SAMPLE_RATE)
            result = asr.transcribe([fname])
            if result:
                r = result[0]
                text = r if isinstance(r, str) else getattr(r, 'text', '')
                return text.strip()
        finally:
            try:
                os.unlink(fname)
            except Exception:
                pass
        return ''

    def transcribe_loop():
        speech_buf = []     # frames accumulated for current utterance
        speech_frames = 0   # VAD-positive frame count
        silence_frames = 0  # consecutive VAD-negative frames after speech started

        while True:
            new_data_event.wait(timeout=0.2)
            new_data_event.clear()

            with raw_lock:
                if not raw_frames:
                    continue
                incoming = list(raw_frames)
                raw_frames.clear()

            for frame in incoming:
                # VAD inference on 512-sample frame
                tensor = torch.from_numpy(frame).float()
                with torch.no_grad():
                    conf = vad_model(tensor, SAMPLE_RATE).item()
                is_speech = conf >= args.vad_threshold

                if is_speech:
                    speech_buf.append(frame)
                    speech_frames += 1
                    silence_frames = 0
                elif speech_frames > 0:
                    # Include silence frames within utterance (natural pauses)
                    speech_buf.append(frame)
                    silence_frames += 1
                # else: pre-speech silence → discard

                end_of_utterance = silence_frames >= SILENCE_FRAMES_THRESHOLD and speech_frames > 0
                forced_flush = (speech_frames + silence_frames) >= MAX_SPEECH_FRAMES and speech_frames > 0

                if end_of_utterance or forced_flush:
                    # Trim trailing silence before transcribing
                    trim_to = len(speech_buf) - silence_frames if end_of_utterance else len(speech_buf)
                    audio = np.concatenate(speech_buf[:trim_to])

                    speech_buf = []
                    speech_frames = 0
                    silence_frames = 0
                    vad_model.reset_states()

                    try:
                        text = do_transcribe(audio)
                        if text:
                            emit({'type': 'transcript', 'text': text, 'isFinal': True})
                            try:
                                requests.post(
                                    backend_url,
                                    json={'text': text, 'isFinal': True, 'srcLang': 'ja'},
                                    timeout=3,
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
            blocksize=BLOCKSIZE,
            callback=audio_callback,
            device=args.device,
        ):
            emit({'type': 'status', 'message': 'マイク録音を開始しました'})
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        emit({'type': 'status', 'message': '停止しました'})
    except Exception as e:
        emit({'type': 'error', 'message': f'マイクエラー: {e}'})
        sys.exit(1)


if __name__ == '__main__':
    main()
