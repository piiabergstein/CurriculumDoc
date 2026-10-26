import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { randomToken, sha256, inviteCodeHash, safeEqual } from "./security";
import type { InviteCode, Role } from "@prisma/client";

const STAFF_COOKIE = "mp_staff";
const DOCTOR_COOKIE = "mp_doc";
const STAFF_TTL_H = 10;
const DOCTOR_TTL_H = 24 * 7;
export const MAX_CODE_ATTEMPTS = 5;
export const INVITE_TTL_DAYS = 30;

async function setCookie(name: string, value: string, hours: number) {
  (await cookies()).set(name, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: hours * 3600 });
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

// ---------------- personal ----------------
export async function createStaffSession(userId: string) {
  const token = randomToken();
  await db.staffSession.create({ data: { id: sha256(token), userId, expiresAt: new Date(Date.now() + STAFF_TTL_H * 3600_000) } });
  await setCookie(STAFF_COOKIE, token, STAFF_TTL_H);
}

export async function currentStaff() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) return null;
  const s = await db.staffSession.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || !s.user.active) return null;
  return s.user;
}

/** Kõik haldusvaate lehed ja toimingud kutsuvad seda serveris. */
export async function requireStaff(role?: Role) {
  const u = await currentStaff();
  if (!u) redirect("/haldus/login");
  if (!u.totpEnabled) redirect("/haldus/2fa");
  if (role === "ADMIN" && u.role !== "ADMIN") throw new Error("Ligipääs keelatud");
  return u;
}

export async function logoutStaff() {
  const c = await cookies();
  const token = c.get(STAFF_COOKIE)?.value;
  if (token) await db.staffSession.deleteMany({ where: { id: sha256(token) } });
  c.delete(STAFF_COOKIE);
}

// ---------------- arst ----------------
export type InviteCheck = "ok" | "expired" | "revoked" | "locked" | "wrong";

/** Puhas kontroll ühe kutse kohta (testitav). */
export function checkInvite(inv: Pick<InviteCode, "specialistId" | "codeHash" | "expiresAt" | "revokedAt" | "lockedAt" | "failedAttempts">, code: string, now = new Date()): InviteCheck {
  if (inv.revokedAt) return "revoked";
  if (inv.lockedAt || inv.failedAttempts >= MAX_CODE_ATTEMPTS) return "locked";
  if (inv.expiresAt < now) return "expired";
  return safeEqual(inv.codeHash, inviteCodeHash(inv.specialistId, code)) ? "ok" : "wrong";
}

/** E-post + 6-kohaline kood. Tagastab üldise vea, et mitte paljastada, kas e-post on olemas. */
export async function doctorLogin(email: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const generic = { ok: false as const, error: "E-post või kood ei sobi, kood on aegunud või tühistatud. Küsi vajadusel haldurilt uus kood." };
  if (!/^\d{6}$/.test(code)) return generic;
  const specialists = await db.specialist.findMany({ where: { contactEmail: { equals: email.trim(), mode: "insensitive" }, archived: false }, select: { id: true } });
  if (!specialists.length) return generic;
  const invites = await db.inviteCode.findMany({ where: { specialistId: { in: specialists.map((s) => s.id) }, revokedAt: null, lockedAt: null }, orderBy: { createdAt: "desc" } });
  for (const inv of invites) {
    const r = checkInvite(inv, code);
    if (r === "ok") {
      await db.inviteCode.update({ where: { id: inv.id }, data: { lastUsedAt: new Date(), failedAttempts: 0 } });
      const token = randomToken();
      await db.doctorSession.create({ data: { id: sha256(token), specialistId: inv.specialistId, inviteId: inv.id, expiresAt: new Date(Date.now() + DOCTOR_TTL_H * 3600_000) } });
      await setCookie(DOCTOR_COOKIE, token, DOCTOR_TTL_H);
      await db.activityLog.create({ data: { specialistId: inv.specialistId, actor: "arst", action: "doctor_login" } });
      return { ok: true };
    }
  }
  // vale kood: suurenda katseid kõigil selle e-posti aktiivsetel kutsetel
  for (const inv of invites) {
    const n = inv.failedAttempts + 1;
    await db.inviteCode.update({ where: { id: inv.id }, data: { failedAttempts: n, lockedAt: n >= MAX_CODE_ATTEMPTS ? new Date() : null } });
  }
  return generic;
}

export async function currentDoctor() {
  const token = (await cookies()).get(DOCTOR_COOKIE)?.value;
  if (!token) return null;
  const s = await db.doctorSession.findUnique({ where: { id: sha256(token) } });
  if (!s || s.expiresAt < new Date()) return null;
  // tühistatud või aegunud kutse lõpetab ka sessiooni
  const inv = await db.inviteCode.findUnique({ where: { id: s.inviteId } });
  if (!inv || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return { specialistId: s.specialistId };
}

export async function requireDoctor() {
  const d = await currentDoctor();
  if (!d) redirect("/");
  return d;
}

/** Arst tohib puutuda ainult oma profiili ressursse. */
export function assertOwnResource(sessionSpecialistId: string, resourceSpecialistId: string) {
  if (sessionSpecialistId !== resourceSpecialistId) throw new Error("Ligipääs keelatud");
}

export async function logoutDoctor() {
  const c = await cookies();
  const token = c.get(DOCTOR_COOKIE)?.value;
  if (token) await db.doctorSession.deleteMany({ where: { id: sha256(token) } });
  c.delete(DOCTOR_COOKIE);
}
