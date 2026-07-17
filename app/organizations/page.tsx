import Link from "next/link";
import { listOrganizations } from "@/lib/data/admin";

// Always read fresh from the DB so newly seeded/created orgs show up immediately.
export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const organizations = await listOrganizations();

  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-3xl">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Home
        </Link>

        <div className="mt-4 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Organizations
          </h1>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {organizations.length}{" "}
            {organizations.length === 1 ? "tenant" : "tenants"}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Fetched live from Postgres via Prisma.
        </p>

        {organizations.length === 0 ? (
          <p className="mt-10 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No organizations yet. Run{" "}
            <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">
              npx prisma db seed
            </code>
            .
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {organizations.map((org) => (
              <li
                key={org.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                    {org.name}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    /{org.slug}
                  </p>
                </div>
                <time
                  dateTime={org.createdAt.toISOString()}
                  className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500"
                >
                  {dateFmt.format(org.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
