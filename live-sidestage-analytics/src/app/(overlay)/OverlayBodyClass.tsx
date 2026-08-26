"use client";

import { useEffect } from "react";

// body のクラスを外す担当。付ける方は layout.tsx の inline script が
// hydration 前に済ませているので、ここでの add は「script が動かなかった場合の保険」。
//
// OBS のブラウザソースはページを離れないので cleanup は事実上使われないが、
// 開発中に SPA 遷移でオーバーレイから他ページへ移ると背景が透過のまま残るため必要。
export default function OverlayBodyClass() {
  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get("preview") === "1";
    document.body.classList.add("overlay-body");
    if (preview) document.body.classList.add("overlay-body-preview");

    return () => {
      document.body.classList.remove("overlay-body", "overlay-body-preview");
    };
  }, []);

  return null;
}
