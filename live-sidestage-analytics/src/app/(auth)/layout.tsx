import { AnalyticsThemeShell } from "@/components/theme/AnalyticsThemeShell";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AnalyticsThemeShell variant="light">{children}</AnalyticsThemeShell>;
}
