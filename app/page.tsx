import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <main className="w-full max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Quotation System
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Multi-organization portal for glass-partitioning manufacturers.
        </p>

        <nav className="mt-8 flex flex-col gap-3">
          <Link
            href="/organizations"
            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-5 py-4 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Organizations
            <span className="text-zinc-400">→</span>
          </Link>
          <a
            href="/api/health"
            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-5 py-4 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Health check
            <span className="font-mono text-xs text-zinc-400">/api/health</span>
          </a>
        </nav>
      </main>
    </div>
  );
}
