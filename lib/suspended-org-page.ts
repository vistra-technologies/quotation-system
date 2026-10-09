import { ORG_SUSPENDED_MESSAGE } from "@/lib/org-suspended";

/**
 * Static HTML 403 page for a suspended org (Stage 29 S29-9), served by proxy.ts.
 *
 * Matches the signed-off mockup (design-docs/mockups/superadmin-org-workspace.html, ".blocked").
 * Deliberately has NO JavaScript, NO session read and NO org data: the proxy only knows the org is
 * suspended, so nothing about the org (name, slug, branding) may appear here.
 * The tokens below are copied from app/globals.css (Sage Ease).
 */
export const SUSPENDED_ORG_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Organization suspended</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#F7F8EF;color:#3A4038;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.45}
main{width:100%;max-width:460px;text-align:center;background:#FBFAF5;border:1px solid #E0E2D7;border-radius:14px;padding:40px 32px;box-shadow:0 1px 2px rgba(27,40,30,.05)}
.big{font-size:44px;font-weight:800;color:#B3261E;letter-spacing:.02em}
h1{margin-top:6px;font-size:18px;font-weight:700;color:#1B281E}
p{margin-top:12px;font-size:16px;color:#3A4038}
</style>
</head>
<body>
<main>
<div class="big" aria-hidden="true">403</div>
<h1>Organization suspended</h1>
<p>${ORG_SUSPENDED_MESSAGE}</p>
</main>
</body>
</html>
`;
