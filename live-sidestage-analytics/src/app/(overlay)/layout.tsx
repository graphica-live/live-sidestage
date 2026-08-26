import type { ReactNode } from "react";
import "./overlay.css";
import OverlayBodyClass from "./OverlayBodyClass";

// OBS ブラウザソース用ページの共通レイアウト。
//
// **これはルートグループなので URL には現れない。** `/overlay/contribution` は
// `src/app/(overlay)/overlay/contribution/page.tsx` へ移しても同じ URL のままで、
// 配信者が OBS に設定済みの URL を壊さない。新しい種類も同じ階層に置けば
// 背景・パラメータの扱いをここから受け取れる。

// body のクラス付けを hydration より前に済ませるための inline script。
// useEffect でしか付けないと、初回ロードと OBS の再接続のたびに
// globals.css の `body { background-color: #111111 }` が1フレーム見えてしまう
// (映像の上に黒い矩形が一瞬出る)。クリーンアップは OverlayBodyClass 側が担当する。
const APPLY_OVERLAY_BODY_CLASS = `(function(){try{
var b=document.body;if(!b)return;
b.classList.add("overlay-body");
if(new URLSearchParams(location.search).get("preview")==="1")b.classList.add("overlay-body-preview");
}catch(e){}})();`;

export default function OverlayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: APPLY_OVERLAY_BODY_CLASS }} />
      <OverlayBodyClass />
      {children}
    </>
  );
}
