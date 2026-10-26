"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hash } from "@node-rs/argon2";
import crypto from "node:crypto";
import { requireStaff, logoutStaff } from "../../lib/auth";
import { db } from "../../lib/db";
import * as svc from "../../lib/service";
import { signUrlToken } from "../../lib/security";
import { PhotoStyle } from "../../lib/photo";
import { type CompletenessRules } from "../../lib/profile";

const back = (id: string) => revalidatePath(`/haldus/s/${id}`);

export async function createSpecialistAction(fd: FormData) {
  const u = await requireStaff();
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/haldus/uus?e=1");
  if (fd.get("verified") !== "on") redirect("/haldus/uus?e=verify");
  const s = await svc.createSpecialist({ name, contactEmail: email, group: String(fd.get("group") || "default"), responsibleId: u.id }, u.email);
  redirect(`/haldus/s/${s.id}`);
}

export async function createInviteAction(specialistId: string, purpose: "invite" | "review") {
  const u = await requireStaff();
  try {
  const sp = await db.specialist.findUniqueOrThrow({ where: { id: specialistId } });
  const { code, invite } = await svc.createInvite(specialistId, u.email, purpose);
  const appUrl = process.env.APP_URL || "";
  if (sp.workflowState === "DRAFT" || sp.workflowState === "PUBLISHED") await db.specialist.update({ where: { id: specialistId }, data: { workflowState: "DOCTOR_REVIEW" } });
  back(specialistId);
  return { ok: true as const, code, email: sp.contactEmail, text: svc.inviteEmailText(sp.name, code, sp.contactEmail, appUrl, purpose, invite.expiresAt), subject: purpose === "review" ? "Palun vaata üle oma profiil Meliva kodulehel" : "Sinu profiil Meliva kodulehel" };
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "invite_failed", specialistId, error: e instanceof Error ? e.message : String(e) }));
    return { ok: false as const, error: `Kutse loomine ebaõnnestus: ${e instanceof Error ? e.message : "tundmatu viga"}` };
  }
}

export async function markInviteSentAction(specialistId: string) {
  const u = await requireStaff();
  const inv = await db.inviteCode.findFirst({ where: { specialistId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  if (inv) await db.inviteCode.update({ where: { id: inv.id }, data: { sentMarkedAt: new Date(), sentMarkedBy: u.email } });
  await db.managerTask.updateMany({ where: { specialistId, type: { in: ["INVITE", "REVIEW_REMINDER"] }, doneAt: null }, data: { doneAt: new Date() } });
  await svc.log(specialistId, u.email, "invite_marked_sent");
  back(specialistId);
}

export async function revokeInvitesAction(specialistId: string) {
  const u = await requireStaff();
  await db.inviteCode.updateMany({ where: { specialistId, revokedAt: null }, data: { revokedAt: new Date() } });
  await db.doctorSession.deleteMany({ where: { specialistId } });
  await svc.log(specialistId, u.email, "invites_revoked");
  back(specialistId);
}

export async function addNoteAction(specialistId: string, fd: FormData) {
  const u = await requireStaff();
  const text = String(fd.get("text") ?? "").trim();
  if (text) await db.internalNote.create({ data: { specialistId, author: u.email, text } });
  back(specialistId);
}

export async function returnAction(specialistId: string, fd: FormData) {
  const u = await requireStaff();
  await svc.returnToDoctor(specialistId, String(fd.get("note") ?? ""), u.email);
  back(specialistId);
}

export async function readyAction(specialistId: string) {
  const u = await requireStaff();
  await svc.markReady(specialistId, u.email);
  back(specialistId);
}

export async function publishAction(specialistId: string, versionId: string, fd: FormData) {
  const u = await requireStaff();
  await svc.markPublished(specialistId, versionId, { et: String(fd.get("et") ?? ""), en: String(fd.get("en") ?? ""), ru: String(fd.get("ru") ?? "") }, u.email);
  back(specialistId);
}

export async function managerEditAction(specialistId: string, versionId: string, next: { et: unknown; en: unknown; ru: unknown }) {
  const u = await requireStaff();
  const r = await svc.managerEditVersion(specialistId, versionId, next, u.email);
  back(specialistId);
  return { needsApproval: r.needsApproval };
}

export async function signedPhotoLinkAction(photoId: string) {
  await requireStaff();
  return `/api/photo/${photoId}?download=1&t=${signUrlToken(`photo:${photoId}`, 300)}`;
}

export async function uploadProfessionalPhotoAction(specialistId: string, fd: FormData) {
  const u = await requireStaff();
  const f = fd.get("photo");
  if (!(f instanceof File) || !f.size) return { ok: false, error: "Vali foto" };
  const r = await svc.uploadOriginalPhoto(specialistId, Buffer.from(await f.arrayBuffer()), u.email, "PROFESSIONAL");
  back(specialistId);
  return r.ok ? { ok: true } : { ok: false, error: r.problems.join(" ") };
}

export async function taskDoneAction(taskId: string) {
  const u = await requireStaff();
  const t = await db.managerTask.update({ where: { id: taskId }, data: { doneAt: new Date() } });
  await svc.log(t.specialistId, u.email, "task_done", { type: t.type });
  back(t.specialistId);
}

export async function updateSpecialistAction(specialistId: string, fd: FormData) {
  const u = await requireStaff();
  await db.specialist.update({ where: { id: specialistId }, data: { name: String(fd.get("name")), contactEmail: String(fd.get("email")).toLowerCase(), group: String(fd.get("group") || "default"), responsibleId: String(fd.get("responsible") || "") || null, archived: fd.get("archived") === "on" } });
  await svc.log(specialistId, u.email, "specialist_updated");
  back(specialistId);
}

export async function managerDraftEditAction(specialistId: string, content: unknown, revision: number) {
  const u = await requireStaff();
  try {
    const r = await svc.saveDraft(specialistId, content, revision, u.email, "MANAGER");
    back(specialistId);
    return { ok: true, revision: r.revision };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Viga" };
  }
}

export async function runReviewScanAction() {
  await requireStaff();
  const months = await svc.getSetting<number>("reviewMonths", 12);
  const n = await svc.createReviewTasks(months);
  revalidatePath("/haldus");
  return n;
}

// ---------- admin ----------
export async function createUserAction(fd: FormData) {
  const u = await requireStaff("ADMIN");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const pw = crypto.randomBytes(12).toString("base64url");
  await db.user.create({ data: { email, name: String(fd.get("name") ?? email), role: fd.get("role") === "ADMIN" ? "ADMIN" : "MANAGER", passwordHash: await hash(pw) } });
  await svc.log(null, u.email, "user_created", { email });
  revalidatePath("/haldus/seaded");
  return { email, password: pw };
}
export async function toggleUserAction(userId: string) {
  const u = await requireStaff("ADMIN");
  if (userId === u.id) return;
  const t = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await db.user.update({ where: { id: userId }, data: { active: !t.active } });
  if (t.active) await db.staffSession.deleteMany({ where: { userId } });
  revalidatePath("/haldus/seaded");
}
export async function saveSettingsAction(fd: FormData) {
  const u = await requireStaff("ADMIN");
  const parse = (k: string) => JSON.parse(String(fd.get(k) ?? "{}"));
  const styles = parse("photoStyles") as Record<string, unknown>;
  for (const k of Object.keys(styles)) styles[k] = PhotoStyle.parse(styles[k]);
  const rules = parse("rules") as CompletenessRules;
  if (!Array.isArray(rules.required) || !Array.isArray(rules.observations)) throw new Error("Reeglid vigased");
  const months = Math.max(1, Number(fd.get("reviewMonths") ?? 12));
  for (const [key, value] of Object.entries({ photoStyles: styles, completenessRules: rules, reviewMonths: months })) await db.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  await svc.log(null, u.email, "settings_saved");
  revalidatePath("/haldus/seaded");
}
export async function addGlossaryAction(fd: FormData) {
  await requireStaff("ADMIN");
  await db.glossaryTerm.create({ data: { et: String(fd.get("et")), en: String(fd.get("en")), ru: String(fd.get("ru")) } });
  revalidatePath("/haldus/seaded");
}
export async function deleteGlossaryAction(id: string) {
  await requireStaff("ADMIN");
  await db.glossaryTerm.delete({ where: { id } });
  revalidatePath("/haldus/seaded");
}
export async function changePasswordAction(fd: FormData) {
  const u = await requireStaff();
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 12) redirect("/haldus/seaded?e=pw");
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hash(pw) } });
  redirect("/haldus/seaded?ok=pw");
}
export async function logoutStaffAction() {
  await logoutStaff();
  redirect("/haldus/login");
}

