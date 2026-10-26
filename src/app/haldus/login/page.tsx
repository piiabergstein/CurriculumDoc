import { redirect } from "next/navigation";
import { verify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import { db } from "../../../lib/db";
import { createStaffSession, clientIp } from "../../../lib/auth";
import { rateLimit } from "../../../lib/ratelimit";

async function login(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const ip = await clientIp();
  if (!(await rateLimit(`stafflogin:${ip}`, 20, 900))) redirect("/haldus/login?e=rate");
  const u = await db.user.findUnique({ where: { email } });
  const bad = () => redirect("/haldus/login?e=bad");
  if (!u || !u.active || (u.lockedUntil && u.lockedUntil > new Date())) return bad();
  const okPw = await verify(u.passwordHash, String(fd.get("password") ?? "")).catch(() => false);
  const okTotp = !u.totpEnabled || (u.totpSecret && authenticator.check(String(fd.get("totp") ?? "").replace(/\s/g, ""), u.totpSecret));
  if (!okPw || !okTotp) {
    const n = u.failedLogins + 1;
    await db.user.update({ where: { id: u.id }, data: { failedLogins: n, lockedUntil: n >= 8 ? new Date(Date.now() + 30 * 60_000) : null } });
    return bad();
  }
  await db.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });
  await createStaffSession(u.id);
  redirect(u.totpEnabled ? "/haldus" : "/haldus/2fa");
}

export default async function StaffLogin({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div style={{ maxWidth: 440, margin: "0 auto" }}>
      <h1>Töötaja sisselogimine</h1>
      <form action={login} className="card">
        {e === "bad" && <p className="notice err" role="alert">Vale e-post, parool või autentimiskood.</p>}
        {e === "rate" && <p className="notice err" role="alert">Liiga palju katseid. Proovi hiljem.</p>}
        <label htmlFor="email">E-post</label><input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Parool</label><input id="password" name="password" type="password" autoComplete="current-password" required />
        <label htmlFor="totp">Autentimisrakenduse kood <span className="hint">(kui 2FA on seadistatud)</span></label><input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" />
        <p><button>Logi sisse</button></p>
      </form>
    </div>
  );
}
