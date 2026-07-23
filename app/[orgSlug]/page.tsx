import { redirect } from "next/navigation";

/**
 * Org subdomain root handler (Server Component).
 *
 * When an org subdomain is visited at its root (e.g. vistra.test.easeetool.com/),
 * the proxy rewrites the request to /vistra/ internally.  There is no meaningful
 * content to render at the bare org root — redirect to the login page, which
 * then redirects to the dashboard if the user is already authenticated.
 *
 * Stage 10 bug fix (bugs-2.md BUG-4): previously this route had no handler,
 * causing Next.js to return its generic 404 page.
 */
export default async function OrgRootPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/login`);
}
