import { redirect } from "next/navigation";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { db } from "../../../lib/db";
import { currentStaff } from "../../../lib/auth";

async function enable(fd: FormData) {
  "use server";
  const u = await currentStaff();
  if (!u || !u.totpSecret) redirect("/haldus/login");
  if (!authenticator.check(String(fd.get("code") ?? "").replace(/\s/g, ""), u.totpSecret)) redirect("/haldus/2fa?e=1");
  await db.user.update({ where: { id: u.id }, data: { totpEnabled: true } });
  await db.activityLog.create({ data: { actor: u.email, action: "totp_enabled" } });
  redirect("/haldus");
}

export default async function TwoFA({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const u = await currentStaff();
  if (!u) redirect("/haldus/login");
  if (u.totpEnabled) redirect("/haldus");
  let secret = u.totpSecret;
  if (!secret) {
    secret = authenticator.generateSecret();
    await db.user.update({ where: { id: u.id }, data: { totpSecret: secret } });
  }
  const qr = await QRCode.toDataURL(authenticator.keyuri(u.email, "Meliva profiilid", secret));
  const { e } = await searchParams;
  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1>Seadista kaheastmeline autentimine</h1>
      <div className="card">
        <p>Haldusvaade nõuab autentimisrakendust (nt Google Authenticator, Microsoft Authenticator). Skaneeri QR-kood ja sisesta rakenduse näidatud kood.</p>
        <img src={qr} alt="QR-kood autentimisrakenduse jaoks" width={200} height={200} />
        <p className="hint">Käsitsi sisestamiseks: <code>{secret}</code></p>
        {e && <p className="notice err" role="alert">Kood ei sobinud. Proovi uuesti.</p>}
        <form action={enable}><label htmlFor="code">Kood</label><input id="code" name="code" inputMode="numeric" required /><p><button>Kinnita</button></p></form>
      </div>
    </div>
  );
}
