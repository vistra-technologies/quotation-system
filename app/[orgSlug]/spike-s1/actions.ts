"use server";
// spike-diag: wrapped action that makes an internalFetch call to a wrapped route. Reverted before review.
import { internalFetch } from "@/lib/internal-fetch";
import { withAction } from "@/lib/with-route";

export const spikeCall = withAction("app/spike-s1/actions#spikeCall", async (): Promise<void> => {
  await internalFetch("/api/v1/orgs/e2e-testorg/me");
});
