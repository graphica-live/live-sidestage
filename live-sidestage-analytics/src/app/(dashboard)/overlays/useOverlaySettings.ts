"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OverlayHeadingBackground, OverlaySettingsPayload } from "@/lib/overlay/contracts";

const SETTINGS_ENDPOINT = "/api/streamer/overlay-settings";
const SAVE_DEBOUNCE_MS = 500;

export type OverlaySettingsPatch = {
  nav?: "prev" | "next" | "today";
  threshold?: number;
  goalCount?: number;
  visibleRows?: number;
  nameMaxWidth?: number;
  align?: "left" | "right";
  headingBackground?: OverlayHeadingBackground;
  displaySpeed?: number;
};

export type OverlaySettingsController = {
  settings: OverlaySettingsPayload | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** 画面を即座に更新し、変更をまとめて保存する。immediate=true なら debounce しない */
  update: (patch: OverlaySettingsPatch, immediate?: boolean) => void;
};

/**
 * オーバーレイ設定の読み書き。
 *
 * **未送信の変更は項目別ではなく1つの patch へマージする。**
 * 旧実装(DashboardHeader のドロップダウン)は数値4項目で debounce タイマーを1本共有していて、
 * 閾値を変えた 500ms 以内に目標人数を変えると閾値の PATCH が clearTimeout で消え、
 * 「画面には出ているのに保存されていない」状態になっていた。項目が見やすく並ぶ専用ページでは
 * 連続操作が当たり前になるので、まとめて1リクエストで送る形にしてある。
 *
 * PATCH は直列化する。並行送信すると応答の到着順が入れ替わり、古い応答で画面が巻き戻る。
 */
export function useOverlaySettings(): OverlaySettingsController {
  const [settings, setSettings] = useState<OverlaySettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingRef = useRef<OverlaySettingsPatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightRef = useRef(0);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(SETTINGS_ENDPOINT);
      if (!res.ok) {
        setError(
          res.status === 404
            ? "配信者情報が見つかりません。先に設定画面でTikTok IDを登録してください。"
            : `設定の読み込みに失敗しました (${res.status})`
        );
        return;
      }
      setSettings((await res.json()) as OverlaySettingsPayload);
      setError(null);
    } catch {
      setError("設定の読み込みに失敗しました。通信を確認してください。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sendPatch = useCallback(
    async (patch: OverlaySettingsPatch) => {
      try {
        const res = await fetch(SETTINGS_ENDPOINT, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body?.error ?? `保存に失敗しました (${res.status})`);
          // 画面の値だけ先に進んでいるので、サーバーの実状態へ戻す
          await reload();
          return;
        }

        const saved = (await res.json()) as OverlaySettingsPayload;
        setError(null);
        // 数値項目まで上書きすると、応答を待つ間に動かしたスライダーが巻き戻る。
        // サーバーが計算する項目(日付ナビの結果とトークン)だけ取り込む。
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                overlayToken: saved.overlayToken,
                displayDate: saved.displayDate,
                isToday: saved.isToday,
              }
            : saved
        );
      } catch {
        setError("保存に失敗しました。通信を確認してください。");
        await reload();
      }
    },
    [reload]
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
    (patch: OverlaySettingsPatch, immediate = false) => {
      // nav の結果(移動後の日付)はサーバーが決めるので楽観更新しない
      if (patch.nav === undefined) {
        setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
      }
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

  // 離脱時に未送信の変更を取りこぼさない。アンマウント後なので state は触らない。
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const patch = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(patch).length === 0) return;
      void fetch(SETTINGS_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  return { settings, loading, saving, error, update };
}
