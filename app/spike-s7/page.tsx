// spike-diag: throws during RSC render so S7 can observe onRequestError. Reverted before review.
export const dynamic = "force-dynamic";

export default function SpikeS7() {
  throw new Error("spike-s7 render error");
}
