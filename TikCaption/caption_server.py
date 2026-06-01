#!/usr/bin/env python3
"""Parakeet + silero-VAD ASR server for TikCaption."""

import json
import sys

# Log immediately before any heavy imports so UI shows feedback right away
def log(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

log({'type': 'loading', 'message': '起動中...'})

import argparse
import threading
import time
import numpy as np
import requests
import sounddevice as sd
import torch

SAMPLE_RATE = 16000
BLOCK_SIZE = 512  # 32ms per block


def find_device_index(label):
    if not label:
        return None
    devs = sd.query_devices()
    for i, d in enumerate(devs):
        if label.lower() in d['name'].lower() and d['max_input_channels'] > 0:
            return i
    return None


def load_vad():
    model, utils = torch.hub.load(
        'snakers4/silero-vad',
        'silero_vad',
        trust_repo=True,
    )
    get_speech_ts = utils[0]
    return model, get_speech_ts


def load_asr():
    import nemo.collections.asr as nemo_asr
    model = nemo_asr.models.EncDecCTCModelBPE.from_pretrained(
        'nvidia/parakeet-tdt_ctc-0.6b-ja'
    )
    model.eval()
    return model


def transcribe(asr_model, audio_np):
    """Transcribe numpy float32 array at 16kHz mono."""
    import tempfile, soundfile as sf, os
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp_path = f.name
    sf.write(tmp_path, audio_np, SAMPLE_RATE)
    try:
        result = asr_model.transcribe([tmp_path])
        text = result[0] if result else ''
        if not isinstance(text, str):
            text = getattr(text, 'text', str(text))
    finally:
        os.unlink(tmp_path)
    return text.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=38200)
    parser.add_argument('--device-label', type=str, default='')
    parser.add_argument('--max-chunk', type=float, default=4.0)
    parser.add_argument('--silence-dur', type=float, default=0.8)
    parser.add_argument('--vad-threshold', type=float, default=0.5)
    parser.add_argument('--min-speech-dur', type=float, default=0.5)
    parser.add_argument('--padding-dur', type=float, default=0.2)
    args = parser.parse_args()

    device_idx = find_device_index(args.device_label)

    log({'type': 'loading', 'message': 'VAD モデルをロード中...'})

    try:
        vad_model, _ = load_vad()
    except Exception as e:
        log({'type': 'error', 'message': f'VAD ロード失敗: {e}'})
        sys.exit(1)

    log({'type': 'loading', 'message': 'Parakeet ASR モデルをロード中...'})

    try:
        asr_model = load_asr()
    except Exception as e:
        log({'type': 'error', 'message': f'Parakeet ロード失敗: {e}'})
        sys.exit(1)

    # VAD state
    speech_buffer = []
    silence_frames = 0
    is_speech = False
    silence_threshold_frames = int(args.silence_dur * SAMPLE_RATE / BLOCK_SIZE)
    max_frames = int(args.max_chunk * SAMPLE_RATE / BLOCK_SIZE)
    min_speech_frames = int(args.min_speech_dur * SAMPLE_RATE / BLOCK_SIZE)
    padding_frames = int(args.padding_dur * SAMPLE_RATE / BLOCK_SIZE)
    pre_buffer = []

    def flush_buffer(keep_speech=False):
        nonlocal speech_buffer, is_speech, silence_frames, pre_buffer
        if len(speech_buffer) < min_speech_frames:
            speech_buffer = []
            is_speech = False
            silence_frames = 0
            return
        audio_np = np.concatenate(speech_buffer, axis=0).astype(np.float32)
        if keep_speech:
            # rolling flush mid-speech: keep overlap for context
            speech_buffer = list(speech_buffer[-padding_frames:])
            silence_frames = 0
            # is_speech stays True
        else:
            speech_buffer = []
            is_speech = False
            silence_frames = 0
        threading.Thread(target=send_transcription, args=(audio_np,), daemon=True).start()

    def send_transcription(audio_np):
        try:
            text = transcribe(asr_model, audio_np)
            if text:
                log({'type': 'transcript', 'text': text, 'isFinal': True})
                requests.post(
                    f'http://127.0.0.1:{args.port}/api/caption/asr-text',
                    json={'text': text, 'isFinal': True, 'srcLang': 'ja'},
                    timeout=5,
                )
        except Exception as e:
            log({'type': 'error', 'message': f'転写エラー: {e}'})

    def audio_callback(indata, frames, time_info, status):
        nonlocal speech_buffer, is_speech, silence_frames, pre_buffer

        chunk = indata[:, 0].copy()
        tensor = torch.from_numpy(chunk.astype(np.float32))

        try:
            prob = vad_model(tensor, SAMPLE_RATE).item()
        except Exception:
            prob = 0.0

        speech_detected = prob >= args.vad_threshold

        if speech_detected:
            if not is_speech:
                # speech start — prepend padding frames from pre_buffer
                is_speech = True
                speech_buffer = list(pre_buffer[-padding_frames:]) + [chunk]
            else:
                speech_buffer.append(chunk)
            silence_frames = 0
        else:
            if is_speech:
                speech_buffer.append(chunk)
                silence_frames += 1
                if silence_frames >= silence_threshold_frames:
                    flush_buffer()
                elif len(speech_buffer) >= max_frames:
                    flush_buffer(keep_speech=True)
            else:
                pre_buffer.append(chunk)
                if len(pre_buffer) > padding_frames * 2:
                    pre_buffer.pop(0)

    log({'type': 'status', 'message': 'マイク録音を開始しました'})

    try:
        with sd.InputStream(
            device=device_idx,
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='float32',
            blocksize=BLOCK_SIZE,
            callback=audio_callback,
        ):
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        pass
    except Exception as e:
        log({'type': 'error', 'message': f'録音エラー: {e}'})
        sys.exit(1)


if __name__ == '__main__':
    main()
