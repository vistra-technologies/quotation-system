import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { LoginForm } from "./login-form";

// Always render live — reads proxy headers and DB for org name.
export const dynamic = "force-dynamic";

/**
 * Per-org login page (Server Component shell).
 *
 * The proxy attaches x-org-slug when the request arrives on a subdomain
 * (e.g. acme-glass.localhost:3000).  If accessed on apex (no header), redirect
 * to the org selector.  Passes orgSlug down to the LoginForm Client Component
 * so the form can construct the synthetic email via toAuthEmail().
 */
export default async function LoginPage() {
  const headersList = await headers();
  const orgSlug = headersList.get("x-org-slug");

  if (!orgSlug) {
    // Accessed on the apex domain — redirect to org selector.
    redirect("/");
  }

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { name: true },
  });

  if (!org) {
    // Proxy matched a slug that no longer exists in the DB.
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <main className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sign in to {org.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter your username and password.
        </p>

        <LoginForm orgSlug={orgSlug} />
      </main>
    </div>
  );
}
