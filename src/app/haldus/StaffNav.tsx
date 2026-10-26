import { logoutStaffAction } from "./actions";
export default function StaffNav({ email, admin }: { email: string; admin: boolean }) {
  return (
    <nav className="top" aria-label="Haldus">
      <strong>Meliva profiilid · haldus</strong>
      <a href="/haldus">Spetsialistid</a>
      <a href="/haldus/uus">+ Uus spetsialist</a>
      <a href="/haldus/seaded">{admin ? "Seaded" : "Konto"}</a>
      <span className="muted" style={{ marginLeft: "auto" }}>{email}</span>
      <form action={logoutStaffAction}><button className="secondary small">Logi välja</button></form>
    </nav>
  );
}
