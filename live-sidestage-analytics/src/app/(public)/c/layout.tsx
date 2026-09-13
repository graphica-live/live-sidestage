import { AnalyticsThemeShell } from "@/components/theme/AnalyticsThemeShell";

export default function PublicContributionShareLayout({ children }: { children: React.ReactNode }) {
  return <AnalyticsThemeShell variant="dark">{children}</AnalyticsThemeShell>;
}
