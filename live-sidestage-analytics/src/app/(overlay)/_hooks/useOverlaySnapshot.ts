"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { OVERLAY_KIND_META, type OverlayKind } from "@/lib/overlay/kinds";

const POLL_FALLBACK_INTERVAL_MS = 30_000;

/**
 * オーバーレイのデータ取得。socket.io の即時 push を主経路に、切断中は HTTP polling で補う。
 * 新しい種類を足すときは `useOverlaySnapshot<MySnapshot>("myKind", token)` を呼ぶだけでよい。
 *
 * `io()` を URL 無しで呼ぶのは**同一オリジン接続**を前提にしているため。
 * server.js の `io.use()` が `?token=` を overlayToken として検証し、
 * `overlay:{streamerId}` ルームへ join させる。
 */
export function useOverlaySnapshot<T>(kind: OverlayKind, token: string): T | null {
  const [snapshot, setSnapshot] = useState<T | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // 適用済みデータの世代。socket 受信でも進めるので、
  // 「先に投げた HTTP の応答が socket の新しい snapshot より後に着いた」ときに
  // 古い内容で上書きするのを防げる(放置すると次の polling まで最大30秒古い表示のままになる)。
  const seqRef = useRef(0);

  // 種類やトークンが変わったら前のデータを残さない
  useEffect(() => {
    seqRef.current += 1;
    setSnapshot(null);
  }, [kind, token]);

  const fetchSnapshot = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      // socket が生きている間は push が来るので取りに行かない。
      // このGETはその日のギフトを全件読んでJSで集計する重い処理なので、
      // 接続中も30秒ごとに叩くと表示1枚ごとにDB負荷が積み上がる。
      if (socketRef.current?.connected) return;

      const mySeq = ++seqRef.current;
      try {
        const res = await fetch(`/api/overlay/${kind}?token=${encodeURIComponent(token)}`, { signal });
        if (!res.ok) {
          console.error(`[overlay] ${kind} snapshot fetch failed: ${res.status}`);
          return;
        }
        const data = (await res.json()) as T;
        if (seqRef.current === mySeq) setSnapshot(data);
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          console.error(`[overlay] ${kind} snapshot fetch error:`, err);
        }
      }
    },
    [kind, token]
  );

  // 初回描画 + socket が切れている間の安全網polling
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

  // ギフト受信の即時反映用socket接続
  useEffect(() => {
    if (!token) return;
    const socket = io({ query: { token } });
    socketRef.current = socket;

    socket.on(OVERLAY_KIND_META[kind].snapshotEvent, (payload: T) => {
      seqRef.current += 1;
      setSnapshot(payload);
    });

    // 切れたら polling が主経路になる。次の30秒を待たずに1回取りに行く
    socket.on("disconnect", () => {
      void fetchSnapshot();
    });

    return () => {
      socketRef.current = null;
      socket.disconnect();
    };
  }, [token, kind, fetchSnapshot]);

  return snapshot;
}
