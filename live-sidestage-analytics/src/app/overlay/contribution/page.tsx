import { Suspense } from "react";
import OverlayClient from "./OverlayClient";

export const dynamic = "force-dynamic";

export default function ContributionOverlayPage() {
  return (
    <Suspense fallback={null}>
      <OverlayClient />
    </Suspense>
  );
}
