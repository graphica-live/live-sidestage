"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OverlayKind } from "@/lib/overlay/kinds";

const SAVE_DEBOUNCE_MS = 500;

export type OverlayKindSettingsController<TPayload extends Record<string, unknown>> = {
  settings: TPayload | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  update: (patch: Partial<TPayload>, immediate?: boolean) => void;
};

/**
 * useOverlaySettings.ts(contribution専用)と同じdebounce・直列PATCHチェーン・
 * 離脱時flushのパターンを、新規5kind分でも使えるようkindパラメータ化した汎用版。
 * エンドポイントは `/api/streamer/overlay-settings/${kind}` に固定される。
 * 既存のuseOverlaySettings.tsはcontribution専用のまま変更しない。
 */
export function useOverlayKindSettings<TPayload extends Record<string, unknown>>(
  kind: Exclude<OverlayKind, "contribution">
): OverlayKindSettingsController<TPayload> {
  const endpoint = `/api/streamer/overlay-settings/${kind}`;
  const [settings, setSettings] = useState<TPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingRef = useRef<Partial<TPayload>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightRef = useRef(0);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        setError(
          res.status === 404
            ? "配信者情報が見つかりません。先に設定画面でTikTok IDを登録してください。"
            : `設定の読み込みに失敗しました (${res.status})`
        );
        return;
      }
      setSettings((await res.json()) as TPayload);
      setError(null);
    } catch {
      setError("設定の読み込みに失敗しました。通信を確認してください。");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const sendPatch = useCallback(
    async (patch: Partial<TPayload>) => {
      try {
        const res = await fetch(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body?.error ?? `保存に失敗しました (${res.status})`);
          await reload();
          return;
        }
        const saved = (await res.json()) as TPayload;
        setError(null);
        setSettings(saved);
      } catch {
        setError("保存に失敗しました。通信を確認してください。");
        await reload();
      }
    },
    [endpoint, reload]
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length === 0) return;

    inFlightRef.current += 1;
    setSaving(true);
    chainRef.current = chainRef.current.then(async () => {
      await sendPatch(patch);
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0) setSaving(false);
    });
  }, [sendPatch]);

  const update = useCallback(
    (patch: Partial<TPayload>, immediate = false) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
      pendingRef.current = { ...pendingRef.current, ...patch };

      if (timerRef.current) clearTimeout(timerRef.current);
      if (immediate) {
        flush();
        return;
      }
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const patch = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(patch).length === 0) return;
      void fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive: true,
      }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  return { settings, loading, saving, error, update };
}
