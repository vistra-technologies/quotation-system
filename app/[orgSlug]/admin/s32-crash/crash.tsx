"use client";

// TEMPORARY (Stage 32 Batch 2 manual check) - never merged. Renders fine on the server, throws on the client during hydration.
export function Crash() {
  if (typeof window !== "undefined") throw new Error("s32 forced client-only crash");
  return <p>s32 crash page (server render)</p>;
}
