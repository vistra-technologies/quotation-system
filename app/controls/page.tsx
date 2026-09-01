import { redirect } from "next/navigation";

// Entry point for the bare /controls path — always redirect to /controls/login.
// The login page will redirect to /controls/orgs if a valid session is present.
export default function ControlsRootPage() {
  redirect("/controls/login");
}
