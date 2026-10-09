import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { withRoute } from "@/lib/with-route";

// Never cache — auth state changes on every request.
export const dynamic = "force-dynamic";

const authHandlers = toNextJsHandler(auth);

// Wrapped for request lines only (Stage 30, OPEN-3): the wrapper never reads the body.
export const GET = withRoute("GET /api/auth/[...all]", authHandlers.GET);
export const POST = withRoute("POST /api/auth/[...all]", authHandlers.POST);
