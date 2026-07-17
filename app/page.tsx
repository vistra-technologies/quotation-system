import Link from "next/link";
import { listOrganizationsForSelector } from "@/lib/data/admin";

// Always render live — reads DB for org list.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Apex — render the organization selector.
  const orgs = await listOrganizationsForSelector();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <main className="w-full max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Quotation System
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Select your organization to sign in.
        </p>

        <nav className="mt-8 flex flex-col gap-3">
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/${org.slug}/login`}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-5 py-4 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {org.name}
              <span className="font-mono text-xs text-zinc-400">{org.slug}</span>
            </Link>
          ))}
        </nav>

        {/* Diagnostic links — Stage 1 artifacts kept for dev convenience */}
        <div className="mt-8 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Dev tools
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href="/organizations"
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              /organizations
            </Link>
            <Link
              href="/api/health"
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              /api/health
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
