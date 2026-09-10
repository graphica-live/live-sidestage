"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type BattleFilterSettingsPayload = {
  hideLowDiamondEnabled: boolean;
  threshold: number;
};

export type BattleFilterSettings = BattleFilterSettingsPayload & {
  error: string | null;
};

const SETTINGS_ENDPOINT = "/api/streamer/battle-filter-settings";
const DEFAULT_SETTINGS: BattleFilterSettingsPayload = {
  hideLowDiamondEnabled: false,
  threshold: 100,
};

/**
 * バトル履歴フィルタ設定の読み書き。
 *
 * `enabled === false` のときは GET/PATCH を一切呼ばず、ローカル state のみで動作する。
 * `enabled === true` のときは、マウント時に GET し、`setHideLowDiamond`/`commitThreshold` 呼び出し時に PATCH する。
 *
 * 初期 GET は発行番号 ref で管理し、ユーザー操作後に遅れて返った GET で画面 state を上書きしない。
 * PATCH は chainRef で直列化し、応答到着順の逆転で古い値が最後に書かれるのを防ぐ。
 * 失敗時は直前保存値へ戻す。
 */
export function useBattleFilterSettings({ enabled }: { enabled: boolean }): BattleFilterSettings & {
  setHideLowDiamond: (v: boolean) => void;
  commitThreshold: (n: number) => void;
} {
  const [hideLowDiamondEnabled, setHideLowDiamondEnabled] = useState(false);
  const [threshold, setThreshold] = useState(100);
  const [error, setError] = useState<string | null>(null);

  // 直前保存値（PATCH 失敗時の復元用）
  const savedThresholdRef = useRef(100);
  const savedHideLowDiamondRef = useRef(false);

  // マウント時の GET が、後続のユーザー操作で上書きしないようにする
  const loadSeqRef = useRef(0);
  const dirtyRef = useRef(false);

  // PATCH を直列化する
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  // 初期ロード
  useEffect(() => {
    if (!enabled) return;

    const seq = ++loadSeqRef.current;
    void (async () => {
      try {
        const res = await fetch(SETTINGS_ENDPOINT);
        if (!res.ok) {
          // 失敗してもエラーバナーだけ表示し、画面をブロックしない
          setError(
            res.status === 404
              ? "配信者情報が見つかりません。"
              : `設定の読み込みに失敗しました (${res.status})`
          );
          return;
        }
        const payload = (await res.json()) as BattleFilterSettingsPayload;

        // 遅れて返った GET でユーザー操作後の state を上書きしない
        if (loadSeqRef.current !== seq || dirtyRef.current) return;

        setHideLowDiamondEnabled(payload.hideLowDiamondEnabled);
        setThreshold(payload.threshold);
        savedHideLowDiamondRef.current = payload.hideLowDiamondEnabled;
        savedThresholdRef.current = payload.threshold;
        setError(null);
      } catch {
        setError("設定の読み込みに失敗しました。通信を確認してください。");
      }
    })();
  }, [enabled]);

  const sendPatch = useCallback(
    async (patch: Partial<BattleFilterSettingsPayload>) => {
      try {
        const res = await fetch(SETTINGS_ENDPOINT, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body?.error ?? `設定の保存に失敗しました (${res.status})`);
          // 画面の値を直前保存値へ戻す
          setThreshold(savedThresholdRef.current);
          setHideLowDiamondEnabled(savedHideLowDiamondRef.current);
          return;
        }

        const saved = (await res.json()) as BattleFilterSettingsPayload;
        setError(null);
        // 送ったフィールドだけをサーバー応答で同期する。PATCH は直列化されているので、
        // 先行 PATCH の応答に含まれる「まだ送っていない後続フィールドの旧値」で
        // 画面 state を巻き戻さない。
        if (patch.hideLowDiamondEnabled !== undefined) {
          setHideLowDiamondEnabled(saved.hideLowDiamondEnabled);
          savedHideLowDiamondRef.current = saved.hideLowDiamondEnabled;
        }
        if (patch.threshold !== undefined) {
          setThreshold(saved.threshold);
          savedThresholdRef.current = saved.threshold;
        }
      } catch {
        setError("設定の保存に失敗しました。通信を確認してください。");
        // 通信エラーも直前保存値へ戻す
        setThreshold(savedThresholdRef.current);
        setHideLowDiamondEnabled(savedHideLowDiamondRef.current);
      }
    },
    []
  );

  const setHideLowDiamond = useCallback(
    (v: boolean) => {
      dirtyRef.current = true;

      // 即座に state を更新(保存済み値の更新は PATCH 成功時。失敗時に戻す先を壊さない)
      setHideLowDiamondEnabled(v);

      if (!enabled) {
        savedHideLowDiamondRef.current = v;
        return;
      }

      // PATCH を送る
      chainRef.current = chainRef.current.then(async () => {
        await sendPatch({ hideLowDiamondEnabled: v });
      });
    },
    [enabled, sendPatch]
  );

  const commitThreshold = useCallback(
    (n: number) => {
      // 現在値と同じなら PATCH しない
      if (n === threshold) return;

      dirtyRef.current = true;

      // 即座に state を更新(保存済み値の更新は PATCH 成功時。失敗時に戻す先を壊さない)
      setThreshold(n);

      if (!enabled) {
        savedThresholdRef.current = n;
        return;
      }

      // PATCH を送る
      chainRef.current = chainRef.current.then(async () => {
        await sendPatch({ threshold: n });
      });
    },
    [enabled, threshold, sendPatch]
  );

  return {
    hideLowDiamondEnabled,
    threshold,
    error,
    setHideLowDiamond,
    commitThreshold,
  };
}
