import { AnalyticsThemeShell } from "@/components/theme/AnalyticsThemeShell";

export default function PublicBattleShareLayout({ children }: { children: React.ReactNode }) {
  return <AnalyticsThemeShell variant="dark">{children}</AnalyticsThemeShell>;
}
