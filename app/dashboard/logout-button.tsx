"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * Client Component logout button.  Calls authClient.signOut() then navigates
 * to /login (which is the correct per-org login page on the current subdomain).
 */
export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-lg border border-zinc-200 bg-white px-5 py-2 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
    >
      Sign out
    </button>
  );
}
