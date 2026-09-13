"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

export type AnalyticsThemeVariant = "light" | "dark";

const SHELL_CLASS: Record<AnalyticsThemeVariant, string> = {
  light: "analytics-theme-light min-h-screen bg-surface text-ink",
  dark: "analytics-theme-dark min-h-screen bg-surface text-ink",
};

const BODY_CLASS: Record<AnalyticsThemeVariant, string> = {
  light: "analytics-theme-light",
  dark: "analytics-theme-dark",
};

/**
 * Auth / Dashboard / Share Public のテーマ境界。OSやユーザー設定は見ない。
 * `document.body` へ portal する UI も同じ CSS 変数を使うため body にもクラスを付与する。
 */
export function AnalyticsThemeShell({
  variant,
  children,
  className,
}: {
  variant: AnalyticsThemeVariant;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const body = document.body;
    const next = BODY_CLASS[variant];
    body.classList.remove("analytics-theme-light", "analytics-theme-dark");
    body.classList.add(next);
    return () => {
      body.classList.remove(next);
    };
  }, [variant]);

  const shell = SHELL_CLASS[variant];
  const root = className ? `${shell} ${className}` : shell;
  return <div className={root}>{children}</div>;
}
