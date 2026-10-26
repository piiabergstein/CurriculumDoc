import { requireDoctor } from "../../lib/auth";
import { loadState } from "./actions";
import Wizard from "./Wizard";
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  await requireDoctor();
  return <Wizard initial={await loadState()} />;
}
