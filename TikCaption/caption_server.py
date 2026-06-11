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
import unicodedata
import warnings
warnings.filterwarnings('ignore', category=RuntimeWarning, module='pydub')


def normalize_text(text):
    return unicodedata.normalize('NFKC', text)

_transcribe_lock = threading.Lock()
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
    import os
    hub_dir = torch.hub.get_dir()
    local_repo = os.path.join(hub_dir, 'snakers4_silero-vad_master')
    # Try local cache first (source='local' avoids network + hubconf path bugs)
    if os.path.isfile(os.path.join(local_repo, 'hubconf.py')):
        try:
            model, utils = torch.hub.load(
                local_repo,
                'silero_vad',
                source='local',
                trust_repo=True,
            )
            return model, utils[0]
        except Exception:
            pass
    # Fallback: download from network
    try:
        model, utils = torch.hub.load(
            'snakers4/silero-vad',
            'silero_vad',
            trust_repo=True,
        )
        return model, utils[0]
    except Exception as e:
        raise RuntimeError(
            f'VAD load failed. Cache: {local_repo}. Error: {e}'
        ) from e


def _patch_tqdm_for_logging():
    try:
        import tqdm as _tqdm_mod
        import tqdm.auto as _tqdm_auto
        _Orig = _tqdm_mod.tqdm

        class _JsonTqdm(_Orig):
            def update(self, n=1):
                result = super().update(n)
                if self.total and self.total > 1024 * 1024:
                    pct = int(100 * self.n / self.total)
                    mb_done = self.n / 1024 / 1024
                    mb_total = self.total / 1024 / 1024
                    log({'type': 'loading', 'message': f'モデルDL中: {pct}% ({mb_done:.0f} / {mb_total:.0f} MB)'})
                return result

        _tqdm_mod.tqdm = _JsonTqdm
        _tqdm_auto.tqdm = _JsonTqdm
    except Exception:
        pass


def load_asr():
    _patch_tqdm_for_logging()
    import nemo.collections.asr as nemo_asr
    from omegaconf import OmegaConf
    model = nemo_asr.models.EncDecCTCModelBPE.from_pretrained(
        'nvidia/parakeet-tdt_ctc-0.6b-ja'
    )
    try:
        decoding_cfg = OmegaConf.create({
            'strategy': 'beam',
            'beam': {'beam_size': 10, 'return_best_hypothesis': True, 'score_norm': True},
        })
        model.change_decoding_strategy(decoding_cfg)
        log({'type': 'loading', 'message': 'ビーム探索デコーディング有効'})
    except Exception as e:
        log({'type': 'loading', 'message': f'ビーム探索不可、greedy使用: {e}'})
    model.freeze()
    return model


def normalize_audio(audio_np):
    peak = np.max(np.abs(audio_np))
    if peak > 0.01:
        return audio_np / peak * 0.95
    return audio_np


def transcribe(asr_model, audio_np):
    """Transcribe numpy float32 array at 16kHz mono."""
    import tempfile, soundfile as sf, os
    audio_np = normalize_audio(audio_np)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp_path = f.name
    sf.write(tmp_path, audio_np, SAMPLE_RATE)
    try:
        with _transcribe_lock:
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
    parser.add_argument('--overlap-dur', type=float, default=1.0)
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
    overlap_frames = int(args.overlap_dur * SAMPLE_RATE / BLOCK_SIZE)
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
            speech_buffer = list(speech_buffer[-overlap_frames:])
            silence_frames = 0
            # is_speech stays True
        else:
            speech_buffer = []
            is_speech = False
            silence_frames = 0
        threading.Thread(target=send_transcription, args=(audio_np, keep_speech), daemon=True).start()

    def send_transcription(audio_np, is_interim=False):
        try:
            text = normalize_text(transcribe(asr_model, audio_np))
            if text:
                is_final = not is_interim
                log({'type': 'transcript', 'text': text, 'isFinal': is_final})
                requests.post(
                    f'http://127.0.0.1:{args.port}/api/caption/asr-text',
                    json={'text': text, 'isFinal': is_final, 'srcLang': 'ja'},
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
            if len(speech_buffer) >= max_frames:
                flush_buffer(keep_speech=True)
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

    def run_stream(device):
        with sd.InputStream(
            device=device,
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='float32',
            blocksize=BLOCK_SIZE,
            callback=audio_callback,
        ):
            while True:
                time.sleep(1)

    MIC_HINT = '「設定 → プライバシーとセキュリティ → マイク」でアクセスが許可されているか確認してください。'

    try:
        run_stream(device_idx)
    except KeyboardInterrupt:
        pass
    except Exception as e:
        if device_idx is not None:
            log({'type': 'error', 'message': f'録音エラー (デフォルトデバイスで再試行): {e}'})
            try:
                run_stream(None)
            except KeyboardInterrupt:
                pass
            except Exception as e2:
                log({'type': 'error', 'message': f'録音エラー: {e2}。{MIC_HINT}'})
                sys.exit(1)
        else:
            log({'type': 'error', 'message': f'録音エラー: {e}。{MIC_HINT}'})
            sys.exit(1)


if __name__ == '__main__':
    main()
