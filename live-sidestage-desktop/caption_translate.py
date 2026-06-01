#!/usr/bin/env python3
"""
Helsinki-NLP MarianMT translation server for TikEffect caption widget.
Reads JSON lines from stdin, writes translated JSON lines to stdout.

Backends:
  transformers  - HuggingFace Transformers + PyTorch (default)
  ctranslate2   - CTranslate2 (fast CPU, ~5x faster)

Install (transformers):  pip install transformers sentencepiece sacremoses torch
Install (ctranslate2):   pip install ctranslate2 transformers sentencepiece
"""
import sys
import json
import os
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--backend', choices=['transformers', 'ctranslate2'], default='transformers')
parser.add_argument('--device', choices=['cpu', 'cuda', 'auto'], default='auto')
args = parser.parse_args()

BACKEND = args.backend
DEVICE = args.device

MODEL_MAP = {
    'ja-en': 'Helsinki-NLP/opus-mt-ja-en',
    'ja-zh': 'Helsinki-NLP/opus-mt-ja-zh',
    'ja-fr': 'Helsinki-NLP/opus-mt-ja-fr',
    'ja-de': 'Helsinki-NLP/opus-mt-ja-de',
    'en-ja': 'Helsinki-NLP/opus-mt-en-ja',
    'zh-en': 'Helsinki-NLP/opus-mt-zh-en',
    'ko-en': 'Helsinki-NLP/opus-mt-ko-en',
}

_pipe_cache = {}
_ct2_cache = {}


def _resolve_device():
    if DEVICE == 'auto':
        try:
            import torch
            return 0 if torch.cuda.is_available() else -1
        except Exception:
            return -1
    return 0 if DEVICE == 'cuda' else -1


def get_transformers_pipeline(src, tgt):
    key = f'{src}-{tgt}'
    if key in _pipe_cache:
        return _pipe_cache[key]
    model_name = MODEL_MAP.get(key)
    if not model_name:
        return None
    try:
        from transformers import pipeline
        pipe = pipeline('translation', model=model_name, device=_resolve_device())
        _pipe_cache[key] = pipe
        return pipe
    except Exception as e:
        print(json.dumps({'type': 'error', 'message': f'モデル読み込み失敗 ({model_name}): {e}'}), flush=True)
        return None


def translate_transformers(text, src, tgt):
    pipe = get_transformers_pipeline(src, tgt)
    if pipe is None:
        return None
    result = pipe(text, max_length=512)
    return result[0].get('translation_text', '') if result and isinstance(result, list) else None


CT2_CACHE_DIR = os.path.join(os.path.expanduser('~'), '.cache', 'ct2-opus-mt')


def get_ct2_pipeline(src, tgt):
    key = f'{src}-{tgt}'
    if key in _ct2_cache:
        return _ct2_cache[key]
    model_name = MODEL_MAP.get(key)
    if not model_name:
        return None
    try:
        import ctranslate2
        from transformers import MarianTokenizer
        model_dir = os.path.join(CT2_CACHE_DIR, key)
        if not os.path.exists(os.path.join(model_dir, 'model.bin')):
            print(json.dumps({'type': 'status', 'message': f'CTranslate2 モデル変換中 ({key})...'}), flush=True)
            os.makedirs(CT2_CACHE_DIR, exist_ok=True)
            from ctranslate2.converters import TransformersConverter
            converter = TransformersConverter(model_name)
            converter.convert(model_dir, quantization='int8', force=True)
        translator = ctranslate2.Translator(model_dir, device='cpu', inter_threads=2, intra_threads=4)
        tokenizer = MarianTokenizer.from_pretrained(model_name)
        _ct2_cache[key] = (translator, tokenizer)
        return _ct2_cache[key]
    except Exception as e:
        print(json.dumps({'type': 'error', 'message': f'CT2 モデル読み込み失敗: {e}'}), flush=True)
        return None


def translate_ct2(text, src, tgt):
    result = get_ct2_pipeline(src, tgt)
    if result is None:
        return None
    translator, tokenizer = result
    encoded = tokenizer([text], return_tensors=None, padding=True)
    input_tokens = [tokenizer.convert_ids_to_tokens(ids) for ids in encoded['input_ids']]
    results = translator.translate_batch(input_tokens)
    output = results[0].hypotheses[0]
    return tokenizer.decode(tokenizer.convert_tokens_to_ids(output), skip_special_tokens=True)


def translate(text, src, tgt):
    if BACKEND == 'ctranslate2':
        return translate_ct2(text, src, tgt)
    return translate_transformers(text, src, tgt)


def main():
    label = 'CTranslate2' if BACKEND == 'ctranslate2' else ('Helsinki-CUDA' if DEVICE == 'cuda' else 'Helsinki')
    print(json.dumps({'type': 'status', 'message': f'{label} 起動完了 (初回翻訳でモデル自動DL)'}), flush=True)
    print(json.dumps({'type': 'ready'}), flush=True)

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        req_id = ''
        try:
            req = json.loads(raw)
            req_id = req.get('id', '')
            text = req.get('text', '').strip()
            src = req.get('src', 'ja')
            tgt = req.get('tgt', 'en')
            if not text:
                print(json.dumps({'id': req_id, 'text': ''}), flush=True)
                continue
            result = translate(text, src, tgt)
            print(json.dumps({'id': req_id, 'text': result or ''}), flush=True)
        except Exception as e:
            print(json.dumps({'id': req_id, 'error': str(e)}), flush=True)


if __name__ == '__main__':
    main()
