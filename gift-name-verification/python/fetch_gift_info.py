"""TikTokLive (isaackogan) の gift/list 取得を locale/region の組み合わせで比較する。

client.web.fetch_gift_list() は未接続でも呼べる(fetch_gift_list.py が
self._web.get() を叩くだけで room_id も署名も要求しない実装であることを実読で確認済み)。
"""
import asyncio
import json
import re
import sys
from pathlib import Path

from TikTokLive import TikTokLiveClient

RAW_DIR = Path(__file__).resolve().parent.parent / "raw"
TARGET = "yu_ki_nojo"

JAPANESE_RE = re.compile(r"[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]")


def looks_japanese(s):
    return isinstance(s, str) and bool(JAPANESE_RE.search(s))


MATRIX = [
    {"key": "default", "params": {}},
    {"key": "webcast_language-ja", "params": {"webcast_language": "ja"}},
    {"key": "webcast_language-ja-JP", "params": {"webcast_language": "ja-JP"}},
    {"key": "app_language-ja-JP", "params": {"app_language": "ja-JP"}},
    {"key": "region-JP", "params": {"region": "JP", "priority_region": "JP"}},
]


def pick_fields(item):
    found = {}
    for key in ("name", "title", "displayName", "giftName", "describe", "description"):
        if key in item:
            found[key] = item[key]
    return found


async def fetch_one(entry):
    client = TikTokLiveClient(unique_id=TARGET)
    if entry["params"]:
        client.web.params.update(entry["params"])
    try:
        data = await client.web.fetch_gift_list()
        gifts = data.get("gifts", []) if isinstance(data, dict) else []
        (RAW_DIR / f"python-giftlist-{entry['key']}.json").write_text(
            json.dumps(gifts, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        ja_count = sum(1 for g in gifts if looks_japanese(g.get("name")))
        fields = set()
        for g in gifts:
            fields.update(pick_fields(g).keys())
        return {
            "key": entry["key"],
            "ok": True,
            "count": len(gifts),
            "japaneseNameCount": ja_count,
            "fieldsPresent": sorted(fields),
            "sample": [{"id": g.get("id"), **pick_fields(g)} for g in gifts[:3]],
        }
    except Exception as e:  # noqa: BLE001 - 検証スクリプトなので握りつぶして記録する
        return {"key": entry["key"], "ok": False, "error": str(e)}
    finally:
        await client.web.close()


async def main():
    summary = {"library": "TikTokLive", "libraryVersion": "7.0.0", "target": TARGET, "results": []}
    for entry in MATRIX:
        print(f"fetching {entry['key']} ... ", end="", flush=True)
        result = await fetch_one(entry)
        if result["ok"]:
            print(f"OK count={result['count']} ja={result['japaneseNameCount']}")
        else:
            print(f"FAIL {result['error']}")
        summary["results"].append(result)
    (RAW_DIR / "python-giftlist-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("\n=== summary written to raw/python-giftlist-summary.json ===")


if __name__ == "__main__":
    asyncio.run(main())
