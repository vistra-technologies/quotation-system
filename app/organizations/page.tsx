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
    <div className="min-h-screen bg-bg-page px-6 py-16">
      <main className="mx-auto w-full max-w-3xl">
        <Link
          href="/"
          className="text-sm text-text-muted hover:text-text-body"
        >
          ← Home
        </Link>

        <div className="mt-4 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-text-heading">
            Organizations
          </h1>
          <span className="text-sm text-text-muted">
            {organizations.length}{" "}
            {organizations.length === 1 ? "tenant" : "tenants"}
          </span>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Fetched live from Postgres via Prisma.
        </p>

        {organizations.length === 0 ? (
          <p className="mt-10 rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
            No organizations yet. Run{" "}
            <code className="rounded border border-border bg-bg-card px-1.5 py-0.5 font-mono text-xs">
              npx prisma db seed
            </code>
            .
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-card">
            {organizations.map((org) => (
              <li
                key={org.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-heading">
                    {org.name}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-text-muted">
                    /{org.slug}
                  </p>
                </div>
                <time
                  dateTime={org.createdAt.toISOString()}
                  className="shrink-0 text-xs text-text-muted"
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
