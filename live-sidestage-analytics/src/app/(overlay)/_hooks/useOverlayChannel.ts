"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { OVERLAY_KIND_META, type OverlayKind } from "@/lib/overlay/kinds";

const POLL_FALLBACK_INTERVAL_MS = 30_000;
const EVENT_QUEUE_MAX = 20;

/**
 * useOverlaySnapshot に、throttleを経由しないad-hocイベント購読(overlay:<kind>:event)を
 * 足したもの。like-contribution/timerのように「現在状態のsnapshot」と「+1分ポップアップ・
 * マイルストーン通知のような単発演出」の両方が要るページ専用。
 *
 * **socket接続は1本だけ張る**(snapshot用とevent用で2本張らない — server.jsのio.use()は
 * 接続ごとにDB照会するため、1ページ1接続に保つ)。
 */
export function useOverlayChannel<TSnapshot, TEvent>(
  kind: OverlayKind,
  token: string,
  eventName: string
): { snapshot: TSnapshot | null; events: TEvent[]; dequeueEvent: () => void } {
  const [snapshot, setSnapshot] = useState<TSnapshot | null>(null);
  const [events, setEvents] = useState<TEvent[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    seqRef.current += 1;
    setSnapshot(null);
    setEvents([]);
  }, [kind, token]);

  const fetchSnapshot = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      if (socketRef.current?.connected) return;

      const mySeq = ++seqRef.current;
      try {
        const res = await fetch(`/api/overlay/${kind}?token=${encodeURIComponent(token)}`, { signal });
        if (!res.ok) {
          console.error(`[overlay] ${kind} snapshot fetch failed: ${res.status}`);
          return;
        }
        const data = (await res.json()) as TSnapshot;
        if (seqRef.current === mySeq) setSnapshot(data);
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          console.error(`[overlay] ${kind} snapshot fetch error:`, err);
        }
      }
    },
    [kind, token]
  );

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void fetchSnapshot(controller.signal);
    const interval = setInterval(() => void fetchSnapshot(controller.signal), POLL_FALLBACK_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [token, fetchSnapshot]);

  useEffect(() => {
    if (!token) return;
    const socket = io({ query: { token } });
    socketRef.current = socket;

    socket.on(OVERLAY_KIND_META[kind].snapshotEvent, (payload: TSnapshot) => {
      seqRef.current += 1;
      setSnapshot(payload);
    });

    socket.on(eventName, (payload: TEvent) => {
      setEvents((prev) => {
        const next = [...prev, payload];
        return next.length > EVENT_QUEUE_MAX ? next.slice(next.length - EVENT_QUEUE_MAX) : next;
      });
    });

    socket.on("disconnect", () => {
      void fetchSnapshot();
    });

    return () => {
      socketRef.current = null;
      socket.disconnect();
    };
  }, [token, kind, eventName, fetchSnapshot]);

  const dequeueEvent = useCallback(() => {
    setEvents((prev) => prev.slice(1));
  }, []);

  return { snapshot, events, dequeueEvent };
}
