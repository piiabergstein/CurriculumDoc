"use server";
import { redirect } from "next/navigation";
import { requireDoctor, logoutDoctor } from "../../lib/auth";
import { db } from "../../lib/db";
import { drain, retryJob } from "../../lib/jobs";
import * as svc from "../../lib/service";
import { ApprovalError } from "../../lib/versioning";
import { ServiceNotConfigured } from "../../lib/ai";
import { ProfileContent, translationStatus, evaluateCompleteness, type Translations } from "../../lib/profile";
import { rateLimit } from "../../lib/ratelimit";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean };
const fail = (e: unknown): { ok: false; error: string; conflict?: boolean } => ({ ok: false, error: e instanceof Error ? e.message : "Tundmatu viga", conflict: e instanceof svc.ConflictError });

async function me() {
  return (await requireDoctor()).specialistId;
}

/** Kogu arsti vaate olek. Kutsub ka järjekorra töötlejat (Renderi Free-plaanil uinunud teenuse jaoks). */
export async function loadState() {
  const id = await me();
  drain(3).catch(() => {});
  const [sp, draft, photos, conflicts, jobs, versions] = await Promise.all([
    db.specialist.findUniqueOrThrow({ where: { id }, select: { name: true, workflowState: true, lastDoctorReviewAt: true, group: true } }),
    svc.getDraft(id),
    db.photoVersion.findMany({ where: { specialistId: id }, select: { id: true, kind: true, parentId: true, width: true, height: true, settings: true, qualityNotes: true, approvedAt: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.importConflict.findMany({ where: { specialistId: id, resolvedAt: null } }),
    db.job.findMany({ where: { specialistId: id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, type: true, status: true, stage: true, error: true, durationMs: true, createdAt: true, attempts: true } }),
    db.profileVersion.findMany({ where: { specialistId: id }, orderBy: { number: "desc" }, take: 1, select: { id: true, number: true, createdAt: true } }),
  ]);
  const style = await svc.photoStyleFor(sp.group);
  const returnNote = sp.workflowState === "RETURNED" ? (await db.internalNote.findFirst({ where: { specialistId: id, text: { startsWith: "Tagastatud arstile:" } }, orderBy: { createdAt: "desc" } }))?.text.replace("Tagastatud arstile:", "").trim() ?? "" : "";
  const et = ProfileContent.parse(draft.content);
  const tr = draft.translations as Translations & Record<string, unknown>;
  return {
    specialist: sp,
    draft: { content: et, revision: draft.revision, wizardStep: draft.wizardStep, freeText: draft.freeText, selectedPhotoId: draft.selectedPhotoId, aiResult: draft.aiResult as Record<string, unknown> | null, fieldMeta: draft.fieldMeta as Record<string, { source: string; manual: boolean }> },
    translations: {
      en: tr.en ? { ...tr.en, status: translationStatus(tr.en, et) } : null,
      ru: tr.ru ? { ...tr.ru, status: translationStatus(tr.ru, et) } : null,
      enProposal: !!tr.en_proposal,
      ruProposal: !!tr.ru_proposal,
    },
    photos: photos.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), approvedAt: p.approvedAt?.toISOString() ?? null })),
    maxRegenerations: style.maxRegenerations,
    conflicts: conflicts.map((c) => ({ id: c.id, field: c.field, current: c.currentValue, imported: c.importedValue, sourceRef: c.sourceRef, excerpt: c.excerpt })),
    jobs: jobs.map((j) => ({ ...j, createdAt: j.createdAt.toISOString() })),
    findings: evaluateCompleteness(et, { hasPhoto: photos.length > 0, group: sp.group }),
    returnNote,
    latestVersion: versions[0] ? { ...versions[0], createdAt: versions[0].createdAt.toISOString() } : null,
  };
}
export type DoctorState = Awaited<ReturnType<typeof loadState>>;

export async function saveDraftAction(content: unknown, revision: number): Promise<R<{ revision: number }>> {
  try {
    const r = await svc.saveDraft(await me(), content, revision, "arst");
    return { ok: true, revision: r.revision };
  } catch (e) { return fail(e); }
}
export async function saveStepAction(step: number) {
  await svc.saveDraftMeta(await me(), { wizardStep: Math.max(1, Math.min(7, step)) });
}
export async function importTextAction(text: string): Promise<R> {
  try {
    const id = await me();
    if (!(await rateLimit(`ai:${id}`, 30, 3600))) return { ok: false, error: "Liiga palju töötlusi tunni jooksul. Proovi hiljem." };
    if (!text.trim()) return { ok: false, error: "Tekst on tühi." };
    await svc.importFreeText(id, text, "arst");
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function importFileAction(fd: FormData): Promise<R> {
  try {
    const id = await me();
    if (!(await rateLimit(`ai:${id}`, 30, 3600))) return { ok: false, error: "Liiga palju töötlusi tunni jooksul. Proovi hiljem." };
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) return { ok: false, error: "Vali fail." };
    await svc.importCvFile(id, f.name, Buffer.from(await f.arrayBuffer()), "arst");
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function resolveConflictAction(conflictId: string, choice: "keep" | "take"): Promise<R> {
  try { await svc.resolveConflict(await me(), conflictId, choice, "arst"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function uploadPhotoAction(fd: FormData): Promise<R<{ note?: string }> | { ok: false; error: string; problems: string[] }> {
  try {
    const id = await me();
    if (!(await rateLimit(`photo:${id}`, 20, 3600))) return { ok: false, error: "Liiga palju üleslaadimisi.", problems: [] };
    const f = fd.get("photo");
    if (!(f instanceof File) || !f.size) return { ok: false, error: "Vali foto.", problems: [] };
    const r = await svc.uploadOriginalPhoto(id, Buffer.from(await f.arrayBuffer()), "arst");
    if (!r.ok) return { ok: false, error: "Foto ei sobi töötluseks.", problems: r.problems };
    await svc.requestPhotoProcessing(id, r.id);
    return { ok: true, note: r.faceNote };
  } catch (e) { return fail(e); }
}
export async function processPhotoAction(originalId: string, opts: svc.PhotoOptions = {}): Promise<R> {
  try {
    const id = await me();
    const p = await db.photoVersion.findUniqueOrThrow({ where: { id: originalId } });
    if (p.specialistId !== id) throw new Error("Ligipääs keelatud");
    await svc.requestPhotoProcessing(id, originalId, { clothing: Boolean(opts.clothing), plain: Boolean(opts.plain) });
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function selectPhotoAction(photoId: string | null): Promise<R> {
  try {
    const id = await me();
    if (photoId) {
      const p = await db.photoVersion.findUniqueOrThrow({ where: { id: photoId } });
      if (p.specialistId !== id) throw new Error("Ligipääs keelatud");
    }
    await svc.saveDraftMeta(id, { selectedPhotoId: photoId });
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function photoHelpAction(note: string): Promise<R> {
  const id = await me();
  await db.managerTask.upsert({ where: { dedupeKey: `photohelp:${id}:${new Date().toISOString().slice(0, 10)}` }, create: { specialistId: id, type: "PHOTO_HELP", dedupeKey: `photohelp:${id}:${new Date().toISOString().slice(0, 10)}`, details: { note } }, update: { details: { note } } });
  await svc.log(id, "arst", "photo_help_requested");
  return { ok: true };
}
export async function startProcessingAction(): Promise<R> {
  try {
    const id = await me();
    if (!(await rateLimit(`ai:${id}`, 30, 3600))) return { ok: false, error: "Liiga palju töötlusi tunni jooksul. Proovi hiljem." };
    const d = await svc.getDraft(id);
    await svc.startProcessing(id, d.revision);
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function retryJobAction(jobId: string): Promise<R> {
  const id = await me();
  const j = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (j.specialistId !== id || j.status !== "failed") return { ok: false, error: "Ei saa korrata" };
  await retryJob(jobId);
  return { ok: true };
}
export async function saveTranslationAction(lang: "en" | "ru", content: unknown): Promise<R> {
  try { await svc.saveTranslation(await me(), lang, content, "arst"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function acceptProposalAction(lang: "en" | "ru"): Promise<R> {
  await svc.acceptTranslationProposal(await me(), lang, "arst");
  return { ok: true };
}
export async function translationHelpAction(lang: "en" | "ru"): Promise<R> {
  await svc.requestTranslationHelp(await me(), lang);
  return { ok: true };
}
export async function approveAction(req: { languages: ("et" | "en" | "ru")[]; photoVersionId: string | null; statementChecked: boolean }): Promise<R> {
  try {
    const id = await me();
    const sp = await db.specialist.findUniqueOrThrow({ where: { id } });
    await svc.approveByDoctor(id, req, sp.name);
    return { ok: true };
  } catch (e) {
    if (e instanceof ApprovalError || e instanceof ServiceNotConfigured) return { ok: false, error: e.message };
    return fail(e);
  }
}
export async function stillValidAction(): Promise<R> {
  try {
    const id = await me();
    const sp = await db.specialist.findUniqueOrThrow({ where: { id } });
    await svc.confirmStillValid(id, sp.name);
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function logoutAction() {
  await logoutDoctor();
  redirect("/");
}
