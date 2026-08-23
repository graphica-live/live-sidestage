import type { Metadata } from "next";
import GoogleLoginPanel from "../../GoogleLoginPanel";

// ルート layout.tsx の "LIVE Sidestage Analytics" / "TikTok Live gift analytics" を
// 両方とも上書きする(metadata はフィールド単位の浅いマージ)。
export const metadata: Metadata = {
  title: "LIVE Sidestage Event",
  description: "TikTok Live イベント運営",
};

// イベント主催者のログイン画面。セッション Cookie は analytics と共有だが、
// 表向きは別サービスなので画面と戻り先を分けてある。
//
// パス名に注意: /events/login にすると events/[id] の動的ルートと衝突する。
export default function EventLoginPage() {
  return (
    <GoogleLoginPanel
      brandSuffix="Event"
      tagline="TikTok Live イベント運営"
      defaultCallbackUrl="/events"
      restrictPrefix="/events"
    />
  );
}
