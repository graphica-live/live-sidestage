import { AnalyticsView } from "@/components/analytics/AnalyticsView";

export default function AdminRoomAnalyticsPage({ params }: { params: { roomId: string } }) {
  return <AnalyticsView apiBase={`/api/admin/rooms/${params.roomId}/analytics`} />;
}
