"use client";

import { useEffect, useState } from "react";

export type OverlayParams = {
  /** overlayToken。空文字なら未指定 */
  token: string;
  /** ?preview=1。OBS ではなくブラウザ/管理画面の iframe で見ているとき true */
  previewMode: boolean;
  /** クエリを読み終えたか。false の間は何も描画しない(token 無し扱いと区別する) */
  ready: boolean;
};

/**
 * オーバーレイ共通のクエリ読み取り。
 *
 * **next/navigation の `useSearchParams` を使わないこと。**
 * あれは Suspense 境界が必須で、このアプリでは Suspense + 別クライアントコンポーネントの
 * 構成にすると本番でだけ再現する "Element type is invalid" ランタイムエラーを起こした。
 * `window.location.search` の直読みはその回避策で、オーバーレイを増やすときも
 * この窓口を通せば同じ地雷を踏まない。
 */
export function useOverlayParams(): OverlayParams {
  const [params, setParams] = useState<OverlayParams>({ token: "", previewMode: false, ready: false });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setParams({
      token: sp.get("token") || "",
      previewMode: sp.get("preview") === "1",
      ready: true,
    });
  }, []);

  return params;
}
