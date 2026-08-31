import OverlaysPageClient from "./OverlaysPageClient";
import { canonicalOrigin } from "@/lib/canonical-origin";

export default function OverlaysPage() {
  return <OverlaysPageClient origin={canonicalOrigin("overlays")} />;
}
