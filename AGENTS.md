<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## next-intl: client namespace wiring is invisible to build/lint/TypeScript

Every route layout that renders `NextIntlClientProvider` builds a `clientMessages` object by hand
(one key per namespace forwarded to client components). If a client component under that route calls
`useTranslations("someNamespace")` and that namespace isn't a key in `clientMessages`, next-intl throws
on hydrate — the component silently fails to mount, with no server-side error, no build failure, no
lint warning, no TypeScript error. This shipped to production once already (Stage 6: `add-selection-form.tsx`
called `useTranslations("selections")`, but `app/[orgSlug]/projects/layout.tsx`'s `clientMessages` never
forwarded that namespace — the whole "Add Component" form was inert in the browser until a real
browser/E2E pass caught it).

**Whenever you add or edit a client component that calls `useTranslations(ns)`,** verify `ns` is a key in
`clientMessages` in the nearest ancestor layout — grep the layout file, don't just trust the component
compiles. This is a check reviewers and testers must do explicitly; it will not surface on its own.
<!-- END:nextjs-agent-rules -->
