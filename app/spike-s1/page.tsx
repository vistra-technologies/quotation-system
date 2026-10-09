// spike-diag: reverted before review.
import { spikeCall } from "./actions";

export const dynamic = "force-dynamic";

export default function SpikeS1() {
  return (
    <form action={spikeCall}>
      <button type="submit">go</button>
    </form>
  );
}
