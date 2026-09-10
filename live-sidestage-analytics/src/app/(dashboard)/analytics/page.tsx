import { AnalyticsView } from "@/components/analytics/AnalyticsView";

export default function AnalyticsPage() {
  return <AnalyticsView apiBase="/api/analytics" persistBattleFilter />;
}
