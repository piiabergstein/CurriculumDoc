import { requireStaff } from "../../../lib/auth";
import { createSpecialistAction } from "../actions";
import StaffNav from "../StaffNav";

export default async function NewSpecialist({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const u = await requireStaff();
  const { e } = await searchParams;
  return (
    <div>
      <StaffNav email={u.email} admin={u.role === "ADMIN"} />
      <h1>Uus spetsialist</h1>
      <form action={createSpecialistAction} className="card" style={{ maxWidth: 560 }}>
        {e === "1" && <p className="notice err" role="alert">Kontrolli nime ja e-posti.</p>}
        {e === "verify" && <p className="notice err" role="alert">Kinnita, et oled e-posti aadressi kontrollinud.</p>}
        <label htmlFor="name">Nimi</label><input id="name" name="name" required />
        <label htmlFor="email">E-post (haldamiseks, ei avaldata)</label>
        <p className="hint">Kasuta ainult kontrollitud aadressi. Ära tuleta aadressi nime põhjal.</p>
        <input id="email" name="email" type="email" required />
        <label htmlFor="group">Spetsialistirühm</label>
        <input id="group" name="group" defaultValue="default" />
        <label style={{ fontWeight: 400 }}><input type="checkbox" name="verified" /> Olen kontrollinud, et e-post kuulub sellele spetsialistile</label>
        <p><button>Loo spetsialist</button></p>
      </form>
    </div>
  );
}
