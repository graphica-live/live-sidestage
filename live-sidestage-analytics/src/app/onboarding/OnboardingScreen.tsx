"use client";

import { signOut } from "next-auth/react";
import { TiktokHandleSetupForm } from "@/components/TiktokHandleSetupForm";

export function OnboardingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-2">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-ghost text-xs"
          >
            ログアウト
          </button>
        </div>
        <TiktokHandleSetupForm />
      </div>
    </div>
  );
}
