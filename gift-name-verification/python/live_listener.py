"""実LIVEに接続して GiftEvent を受信し、生データを NDJSON で追記する。

fetch_gift_info=True で接続し、client.gift_info もあわせて記録する。
"""
import asyncio
import json
import os
import sys
import time
from pathlib import Path

from TikTokLive import TikTokLiveClient
from TikTokLive.events import ConnectEvent, GiftEvent, DisconnectEvent

RAW_DIR = Path(__file__).resolve().parent.parent / "raw"
OUT_FILE = RAW_DIR / "python-gift-events.jsonl"
TARGET = os.environ.get("TARGET_UNIQUE_ID", "yu_ki_nojo")
DURATION_SEC = int(os.environ.get("LISTEN_DURATION_SEC", "900"))

client = TikTokLiveClient(unique_id=TARGET)
seen_gift_ids = set()


def to_plain(value):
    """betterproto系メッセージ/dataclassを可能な範囲でプレーンなdictへ変換する。"""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [to_plain(v) for v in value]
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        try:
            return to_dict()
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        return {k: to_plain(v) for k, v in vars(value).items() if not k.startswith("_")}
    return str(value)


@client.on(ConnectEvent)
async def on_connect(event: ConnectEvent):
    print(f"connected to @{TARGET} (room_id={event.room_id})")
    print(f"client.gift_info entries: {len(client.gift_info.get('gifts', [])) if client.gift_info else 'N/A'}")


@client.on(GiftEvent)
async def on_gift(event: GiftEvent):
    seen_gift_ids.add(event.gift_id)
    gift_obj = to_plain(event.gift)
    record = {
        "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "giftId": event.gift_id,
        "repeatCount": event.repeat_count,
        "repeatEnd": bool(event.repeat_end),
        "gift": gift_obj,
    }
    with OUT_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    gift_name = gift_obj.get("name") if isinstance(gift_obj, dict) else None
    print(f"[gift] id={event.gift_id} name={gift_name} x{event.repeat_count}")


@client.on(DisconnectEvent)
async def on_disconnect(_event: DisconnectEvent):
    print("[disconnected]")


async def main():
    OUT_FILE.touch(exist_ok=True)
    task = await client.start(fetch_gift_info=True, fetch_room_info=False)
    print(f"listening for {DURATION_SEC}s ...")
    try:
        await asyncio.wait_for(task, timeout=DURATION_SEC)
    except asyncio.TimeoutError:
        pass
    print(f"done. unique giftIds observed: {len(seen_gift_ids)}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
