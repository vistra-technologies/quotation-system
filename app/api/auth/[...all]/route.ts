import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Never cache — auth state changes on every request.
export const dynamic = "force-dynamic";

export const { GET, POST } = toNextJsHandler(auth);
