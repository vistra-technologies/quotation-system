import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LoginForm } from "./login-form";

// Always render live — reads DB for org name.
export const dynamic = "force-dynamic";

/**
 * Per-org login page (Server Component shell).
 *
 * orgSlug comes from the dynamic route segment — no header read required.
 * The proxy already returns 404 for unknown slugs before this page renders,
 * so the DB check below is a defensive last-resort guard only.
 * Passes orgSlug down to the LoginForm Client Component so the form can
 * construct the synthetic email via toAuthEmail().
 */
export default async function LoginPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { name: true },
  });

  if (!org) {
    // Defensive guard — proxy should have returned 404 before reaching here.
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
