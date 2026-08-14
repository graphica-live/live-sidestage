import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const ADMIN_EMAIL = "graphicatestlive@gmail.com";

export function isAdminEmail(email?: string | null): boolean {
  return email === ADMIN_EMAIL;
}

export async function getAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session || !isAdminEmail(session.user.email)) return null;
  return session;
}
