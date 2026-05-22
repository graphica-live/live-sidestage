#!/usr/bin/env python3
"""
Helsinki-NLP MarianMT translation server for TikEffect caption widget.
Reads JSON lines from stdin, writes translated JSON lines to stdout.

Install: pip install transformers sentencepiece torch
"""
import sys
import json

# Verified Helsinki-NLP model names (source-target pairs)
MODEL_MAP = {
    'ja-en': 'Helsinki-NLP/opus-mt-ja-en',
    'ja-zh': 'Helsinki-NLP/opus-mt-ja-zh',
    'ja-fr': 'Helsinki-NLP/opus-mt-ja-fr',
    'ja-de': 'Helsinki-NLP/opus-mt-ja-de',
    'en-ja': 'Helsinki-NLP/opus-mt-en-ja',
    'zh-en': 'Helsinki-NLP/opus-mt-zh-en',
    'ko-en': 'Helsinki-NLP/opus-mt-ko-en',
}

_cache = {}

def get_pipeline(src, tgt):
    key = f'{src}-{tgt}'
    if key in _cache:
        return _cache[key]

    model_name = MODEL_MAP.get(key)
    if not model_name:
        return None

    try:
        from transformers import pipeline
        pipe = pipeline('translation', model=model_name)
        _cache[key] = pipe
        return pipe
    except Exception as e:
        print(json.dumps({'type': 'error', 'message': f'モデル読み込み失敗 ({model_name}): {e}'}), flush=True)
        return None


def translate(text, src, tgt):
    pipe = get_pipeline(src, tgt)
    if pipe is None:
        return None
    result = pipe(text, max_length=512)
    if result and isinstance(result, list):
        return result[0].get('translation_text', '')
    return None


def main():
    # Pre-warm ja-en model (most common pair) so first request doesn't block
    print(json.dumps({'type': 'status', 'message': 'Helsinki モデル読み込み中...'}), flush=True)
    get_pipeline('ja', 'en')
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
