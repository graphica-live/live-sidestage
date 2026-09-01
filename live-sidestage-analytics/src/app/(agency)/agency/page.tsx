import AgencyClient from "./AgencyClient";
import { canonicalOrigin } from "@/lib/canonical-origin";

export default function AgencyPage() {
  return <AgencyClient agencyOrigin={canonicalOrigin("agency")} />;
}
