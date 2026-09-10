import type { Metadata } from "next";
import GoogleLoginPanel from "../../GoogleLoginPanel";
import { canonicalOrigin } from "@/lib/canonical-origin";

// ルート layout.tsx の "LIVE Sidestage Analytics" / "TikTok Live gift analytics" を
// 両方とも上書きする(metadata はフィールド単位の浅いマージ)。
export const metadata: Metadata = {
  title: "LIVE Sidestage Overlays",
  description: "OBSオーバーレイ設定",
};

// cookies()等の動的要因が無く放っておくと静的プリレンダリングされ、
// canonicalOrigin("overlays")がビルド時(*_ORIGIN未設定)の値のまま焼き込まれる。
// 実行時のRailway env varを読ませるため強制的に動的レンダリングにする。
export const dynamic = "force-dynamic";

// 配信者本人のオーバーレイ設定画面のログイン画面。セッション Cookie は analytics と
// 共有だが、表向きは別サービスなので画面と戻り先を分けてある(/event/login と同じパターン)。
export default function OverlaysLoginPage() {
  return (
    <GoogleLoginPanel
      brandSuffix="Overlays"
      tagline="OBSオーバーレイ設定"
      defaultCallbackUrl="/overlays"
      restrictPrefix="/overlays"
      origin={canonicalOrigin("overlays")}
    />
  );
}
