// Serveripoolsed toimingud. Iga funktsioon eeldab, et kutsuja on õigusi juba kontrollinud
// (requireStaff / requireDoctor + assertOwnResource).
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { enqueue, registerJob } from "./jobs";
import { getTextAI, applyPolish, isTestMode } from "./ai";
import { lengthProblems, ProfileContent, emptyProfile, mergeImport, contentHash, applyRegeneratedTranslation, patientDataSuspicion, diffFields, type FieldMeta, type Translations } from "./profile";
import { buildApprovalSnapshot, managerEditNeedsApproval, ApprovalError, type ApprovalRequest } from "./versioning";
import { checkQuality, checkFace, stripForStorage, removeBackground, changeClothing, studioPortrait, checkSamePerson, geminiConfigured, finish, canvasSize, PhotoStyle } from "./photo";
import { inviteCodeHash, sixDigitCode } from "./security";
import { INVITE_TTL_DAYS } from "./auth";

const J = (v: unknown) => v as Prisma.InputJsonValue;
export class ConflictError extends Error {}

export async function log(specialistId: string | null, actor: string, action: string, details?: unknown) {
  await db.activityLog.create({ data: { specialistId, actor, action, details: details === undefined ? undefined : J(details) } });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.setting.findUnique({ where: { key } });
  return (s?.value as T) ?? fallback;
}
export async function photoStyleFor(group: string): Promise<PhotoStyle> {
  const styles = await getSetting<Record<string, unknown>>("photoStyles", {});
  const raw = { ...((styles[group] ?? styles.default ?? {}) as Record<string, unknown>) };
  // enne stuudiostiili salvestatud seaded: taust ja kadreering tulevad uutest vaikeväärtustest
  if (!("mode" in raw)) for (const k of ["background", "aspect", "width", "headroom", "brightness", "saturation", "referenceNote"]) delete raw[k];
  return PhotoStyle.parse(raw);
}

// ---------------- spetsialist ja kutse ----------------
export async function createSpecialist(input: { name: string; contactEmail: string; group?: string; responsibleId?: string }, actor: string) {
  const s = await db.specialist.create({
    data: { name: input.name.trim(), contactEmail: input.contactEmail.trim().toLowerCase(), contactVerified: true, group: input.group || "default", responsibleId: input.responsibleId || null, draft: { create: { content: J({ ...emptyProfile(), name: input.name.trim() }), fieldMeta: J({ name: { source: "MANAGER", manual: true } }) } } },
  });
  await log(s.id, actor, "specialist_created");
  return s;
}

/** Loob uue 6-kohalise koodi; varasemad aktiivsed koodid tühistatakse. Kood tagastatakse ainult ühe korra. */
export async function createInvite(specialistId: string, actor: string, purpose: "invite" | "review" = "invite") {
  const code = sixDigitCode();
  await db.inviteCode.updateMany({ where: { specialistId, revokedAt: null }, data: { revokedAt: new Date() } });
  const inv = await db.inviteCode.create({ data: { specialistId, codeHash: inviteCodeHash(specialistId, code), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000), createdBy: actor, purpose } });
  await log(specialistId, actor, "invite_created", { purpose });
  return { code, invite: inv };
}

export function inviteEmailText(name: string, code: string, email: string, appUrl: string, purpose: "invite" | "review", expires: Date) {
  const intro = purpose === "review" ? "palub Sul üle vaadata oma profiili Meliva kodulehel ja kinnitada, kas info on endiselt õige." : "palub Sul täiendada oma profiili Meliva kodulehe jaoks.";
  return `Tere, ${name}!

Meliva turundusmeeskond ${intro}

1. Ava ${appUrl}
2. Sisesta oma e-post: ${email}
3. Sisesta kood: ${code}

Kood kehtib kuni ${expires.toLocaleDateString("et-EE", { timeZone: "Europe/Tallinn" })}. Saad täitmise katkestada ja hiljem samal viisil jätkata.
Palun ära jaga koodi teistega.

Tervitades
Meliva turundus`;
}

// ---------------- mustand ----------------
export async function getDraft(specialistId: string) {
  return db.profileDraft.findUniqueOrThrow({ where: { specialistId } });
}

/** Salvestab mustandi optimistliku lukuga. Muutunud väljad saavad päritolu FORM ja märgitakse käsitsi muudetuks. */
export async function saveDraft(specialistId: string, next: unknown, expectedRevision: number, actor: string, source: "FORM" | "MANAGER" = "FORM") {
  const content = ProfileContent.parse(next);
  const tooLong = lengthProblems(content);
  if (tooLong.length) throw new Error(tooLong.join(" "));
  const cur = await getDraft(specialistId);
  if (cur.revision !== expectedRevision) throw new ConflictError("Profiili on vahepeal muudetud (nt teises aknas). Laadi leht uuesti – sinu sisestus on alles brauseris.");
  const before = ProfileContent.parse(cur.content);
  const changed = diffFields(before, content).map((d) => d.field);
  const meta = { ...(cur.fieldMeta as FieldMeta) };
  // päritolu kirje ainult siis, kui allikas muutub (mitte iga automaatse salvestusega)
  const newSource = changed.filter((f) => meta[f]?.source !== source || !meta[f]?.manual);
  for (const f of changed) meta[f] = { source, manual: true };
  const updated = await db.profileDraft.updateMany({ where: { specialistId, revision: expectedRevision }, data: { content: J(content), fieldMeta: J(meta), revision: { increment: 1 }, updatedBy: actor } });
  if (updated.count === 0) throw new ConflictError("Profiili on vahepeal muudetud. Laadi leht uuesti.");
  if (changed.length) {
    if (newSource.length) await db.factProvenance.createMany({ data: newSource.map((field) => ({ specialistId, field, source })) });
    const state = (await db.specialist.findUniqueOrThrow({ where: { id: specialistId } })).workflowState;
    if (actor === "arst" && (state === "DRAFT" || state === "PUBLISHED" || state === "READY_TO_PUBLISH" || state === "RETURNED")) {
      await db.specialist.update({ where: { id: specialistId }, data: { workflowState: "DOCTOR_REVIEW" } });
    }
  }
  return { revision: cur.revision + 1, changed };
}

export async function saveDraftMeta(specialistId: string, data: { wizardStep?: number; freeText?: string; selectedPhotoId?: string | null }) {
  await db.profileDraft.update({ where: { specialistId }, data });
}

// ---------------- import ----------------
export async function importFreeText(specialistId: string, text: string, actor: string) {
  const rec = await db.importRecord.create({ data: { specialistId, kind: "FREETEXT", extractedText: text.slice(0, 50_000) } });
  await saveDraftMeta(specialistId, { freeText: text });
  return enqueue("import", { importId: rec.id }, { specialistId, dedupeKey: `import:${rec.id}` });
}

const MAX_CV_BYTES = 10 * 1024 * 1024;
function sniff(buf: Buffer): "pdf" | "docx" | "jpeg" | "png" | "webp" | null {
  if (buf.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from("word/"))) return "docx";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  if (buf.subarray(1, 4).toString() === "PNG") return "png";
  if (buf.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}

/** CV-faili ennast ei säilitata: tekst loetakse välja kohe; skanni korral jääb fail ainult töö sisendiks kuni töötluse lõpuni. */
export async function importCvFile(specialistId: string, filename: string, buf: Buffer, actor: string) {
  if (buf.length > MAX_CV_BYTES) throw new Error("Fail on liiga suur (üle 10 MB).");
  const kind = sniff(buf);
  if (!kind) throw new Error("Failitüüp ei sobi. Lae üles PDF, DOCX või pilt (JPG/PNG).");
  let text = "";
  if (kind === "docx") text = (await mammoth.extractRawText({ buffer: buf })).value;
  if (kind === "pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try { text = (await parser.getText({ first: 20 })).text; } finally { await parser.destroy(); }
  }
  const scanned = kind !== "docx" && text.replace(/\s/g, "").length < 200;
  const rec = await db.importRecord.create({ data: { specialistId, kind: "CV_FILE", filename: filename.slice(0, 200), mimeType: kind, extractedText: text.slice(0, 50_000) } });
  await log(specialistId, actor, "cv_uploaded", { filename, kind, scanned });
  // Skanni puhul antakse failisisu töö sisendisse ja kustutatakse pärast töötlust (vt handler).
  return enqueue("import", { importId: rec.id, ...(scanned ? { scanBase64: buf.toString("base64"), scanKind: kind } : {}) }, { specialistId, dedupeKey: `import:${rec.id}` });
}

registerJob("import", async (job, stage) => {
  const { importId, scanBase64, scanKind } = job.payload as { importId: string; scanBase64?: string; scanKind?: string };
  const rec = await db.importRecord.findUniqueOrThrow({ where: { id: importId } });
  const ai = getTextAI();
  await stage(scanBase64 ? "Skannitud dokumendi tekstituvastus" : "Andmete väljalugemine");
  const out = scanBase64
    ? await ai.extract(scanKind === "pdf" ? { kind: "pdf", base64: scanBase64 } : { kind: "image", base64: scanBase64, mediaType: scanKind === "png" ? "image/png" : scanKind === "webp" ? "image/webp" : "image/jpeg" })
    : await ai.extract({ kind: "text", text: rec.extractedText });
  // eemalda skanni sisu töö kirjelt (faili ei säilitata)
  if (scanBase64) await db.job.update({ where: { id: job.id }, data: { payload: J({ importId }) } });
  await stage("Ühendamine olemasolevate andmetega");
  const draft = await getDraft(rec.specialistId);
  const source = rec.kind === "CV_FILE" ? "CV_FILE" : "FREETEXT";
  const merged = mergeImport(ProfileContent.parse(draft.content), draft.fieldMeta as FieldMeta, out.profile, source);
  await db.profileDraft.update({ where: { specialistId: rec.specialistId }, data: { content: J(merged.content), fieldMeta: J(merged.fieldMeta), revision: { increment: 1 } } });
  const excerpt = (f: string) => out.excerpts.find((e) => e.field === f)?.excerpt ?? null;
  if (merged.filled.length) await db.factProvenance.createMany({ data: merged.filled.map((field) => ({ specialistId: rec.specialistId, field, source, sourceRef: rec.filename, excerpt: excerpt(field) })) });
  if (merged.conflicts.length) await db.importConflict.createMany({ data: merged.conflicts.map((c) => ({ specialistId: rec.specialistId, field: c.field, currentValue: J(c.current), importedValue: J(c.imported), sourceRef: rec.filename ?? "vabatekst", excerpt: excerpt(c.field) })) });
  const suspicion = patientDataSuspicion(rec.extractedText);
  if (out.patientDataSuspected || suspicion.length) {
    await db.managerTask.upsert({ where: { dedupeKey: `patient:${rec.id}` }, create: { specialistId: rec.specialistId, type: "PATIENT_DATA", dedupeKey: `patient:${rec.id}`, details: J({ importId: rec.id, suspicion }) }, update: {} });
  }
  return { filled: merged.filled, conflicts: merged.conflicts.length };
});

export async function resolveConflict(specialistId: string, conflictId: string, choice: "keep" | "take", actor: string) {
  const c = await db.importConflict.findUniqueOrThrow({ where: { id: conflictId } });
  if (c.specialistId !== specialistId) throw new Error("Ligipääs keelatud");
  if (choice === "take") {
    const d = await getDraft(specialistId);
    const content = { ...ProfileContent.parse(d.content), [c.field]: c.importedValue };
    await saveDraft(specialistId, content, d.revision, actor);
    await db.factProvenance.create({ data: { specialistId, field: c.field, source: "CV_FILE", sourceRef: c.sourceRef, excerpt: c.excerpt } });
  }
  await db.importConflict.update({ where: { id: conflictId }, data: { resolvedAt: new Date(), resolution: choice } });
}

// ---------------- AI töötlus ----------------
/** Topeltklõps ei tekita teist tööd, kuid valminud töö järel saab alati uuesti töödelda. */
export async function startProcessing(specialistId: string, revision: number) {
  const active = await db.job.findFirst({ where: { specialistId, type: "process", status: { in: ["queued", "running"] } } });
  if (active) return active;
  return enqueue("process", { specialistId, revision }, { specialistId });
}

registerJob("process", async (job, stage) => {
  const { specialistId } = job.payload as { specialistId: string };
  const ai = getTextAI();
  const draft = await getDraft(specialistId);
  const input = ProfileContent.parse(draft.content);
  const sources = (await db.importRecord.findMany({ where: { specialistId }, select: { extractedText: true } })).map((r) => r.extractedText).join("\n");
  await stage("Eestikeelse teksti korrastamine");
  const t0 = Date.now();
  const out = await ai.polish(input, input.wantsGeneratedIntro);
  const { content, guardIssues } = applyPolish(input, out, sources + " " + draft.freeText);
  const polishMs = Date.now() - t0;
  // salvesta korrastatud ET (optimistlik lukk: kui arst vahepeal muutis, ei kirjutata üle)
  const r = await db.profileDraft.updateMany({ where: { specialistId, revision: draft.revision }, data: { content: J(content), revision: { increment: 1 } } });
  if (r.count === 0) throw new Error("Profiili muudeti töötluse ajal – käivita töötlus uuesti.");
  await stage("Tõlkimine inglise ja vene keelde");
  const t1 = Date.now();
  const glossary = await db.glossaryTerm.findMany();
  const tr = { ...(draft.translations as Translations) };
  const keptManual: string[] = [];
  for (const lang of ["en", "ru"] as const) {
    const translated = await ai.translate(content, lang, glossary);
    const fresh = { content: translated, sourceHash: contentHash(content), manuallyEdited: false, helpRequested: false, generatedAt: new Date().toISOString() };
    const res = applyRegeneratedTranslation(tr[lang], fresh, false);
    if (res.keptManual) {
      keptManual.push(lang);
      (tr as Record<string, unknown>)[`${lang}_proposal`] = fresh; // uus ettepanek kõrvale, käsitsi parandus jääb alles
    } else tr[lang] = res.result;
  }
  const result = { ...out, guardIssues, keptManual, model: ai.label, timings: { polishMs, translateMs: Date.now() - t1 } };
  await db.profileDraft.update({ where: { specialistId }, data: { translations: J(tr), aiResult: J(result) } });
  await log(specialistId, "süsteem", "ai_processed", { model: ai.label, polishMs, translateMs: result.timings.translateMs, guardIssues });
  return { timings: result.timings };
});

export async function saveTranslation(specialistId: string, lang: "en" | "ru", content: unknown, actor: string) {
  const d = await getDraft(specialistId);
  const tr = { ...(d.translations as Translations) };
  const et = ProfileContent.parse(d.content);
  tr[lang] = { content: ProfileContent.parse(content), sourceHash: contentHash(et), manuallyEdited: true, helpRequested: tr[lang]?.helpRequested ?? false, reviewedBy: actor, generatedAt: tr[lang]?.generatedAt ?? new Date().toISOString() };
  await db.profileDraft.update({ where: { specialistId }, data: { translations: J(tr), revision: { increment: 1 } } });
  await log(specialistId, actor, "translation_edited", { lang });
}

export async function acceptTranslationProposal(specialistId: string, lang: "en" | "ru", actor: string) {
  const d = await getDraft(specialistId);
  const tr = { ...(d.translations as Record<string, unknown>) };
  if (!tr[`${lang}_proposal`]) return;
  tr[lang] = tr[`${lang}_proposal`];
  delete tr[`${lang}_proposal`];
  await db.profileDraft.update({ where: { specialistId }, data: { translations: J(tr) } });
  await log(specialistId, actor, "translation_proposal_accepted", { lang });
}

export async function suggestTags(specialistId: string, actor: string) {
  const d = await getDraft(specialistId);
  const content = ProfileContent.parse(d.content);
  const suggestions = await getTextAI().suggestTags(content);
  await log(specialistId, actor, "tags_suggested", { count: suggestions.length });
  return suggestions;
}

export async function requestTranslationHelp(specialistId: string, lang: "en" | "ru") {
  const d = await getDraft(specialistId);
  const tr = { ...(d.translations as Translations) };
  if (tr[lang]) tr[lang] = { ...tr[lang]!, helpRequested: true };
  await db.profileDraft.update({ where: { specialistId }, data: { translations: J(tr) } });
  await db.managerTask.upsert({ where: { dedupeKey: `trhelp:${specialistId}:${lang}:${d.revision}` }, create: { specialistId, type: "TRANSLATION_HELP", dedupeKey: `trhelp:${specialistId}:${lang}:${d.revision}`, details: J({ lang }) }, update: {} });
  await log(specialistId, "arst", "translation_help_requested", { lang });
}

// ---------------- foto ----------------
export async function uploadOriginalPhoto(specialistId: string, buf: Buffer, actor: string, kind: "ORIGINAL" | "PROFESSIONAL" = "ORIGINAL") {
  const q = await checkQuality(buf);
  if (!q.ok) return { ok: false as const, problems: q.problems };
  const face = kind === "ORIGINAL" ? await checkFace(buf).catch(() => ({ checked: false, ok: true, reason: "Näo kontroll ebaõnnestus." })) : { checked: false, ok: true, reason: "" };
  if (!face.ok) return { ok: false as const, problems: [face.reason] };
  const s = await stripForStorage(buf);
  const p = await db.photoVersion.create({ data: { specialistId, kind, data: new Uint8Array(s.data), mimeType: "image/jpeg", width: s.width, height: s.height, createdBy: actor, qualityNotes: J({ face }) } });
  await log(specialistId, actor, kind === "PROFESSIONAL" ? "professional_photo_added" : "photo_uploaded");
  if (kind === "PROFESSIONAL") await db.profileDraft.update({ where: { specialistId }, data: { selectedPhotoId: p.id } });
  return { ok: true as const, id: p.id, faceNote: face.reason };
}

export type PhotoOptions = { clothing?: boolean; plain?: boolean };

export async function requestPhotoProcessing(specialistId: string, originalId: string, opts: PhotoOptions = {}) {
  const sp = await db.specialist.findUniqueOrThrow({ where: { id: specialistId } });
  const style = await photoStyleFor(sp.group);
  const count = await db.photoVersion.count({ where: { specialistId, parentId: originalId, kind: "PROCESSED" } });
  if (count >= style.maxRegenerations) throw new Error(`Uuesti genereerimise piir (${style.maxRegenerations}) on täis. Palu abi haldurilt.`);
  // topeltkäivitus on välistatud ootava/käiva töö kaudu; ebaõnnestunud katse järel saab alati uuesti proovida
  const active = await db.job.findFirst({ where: { specialistId, type: "photo", status: { in: ["queued", "running"] } } });
  if (active) return active;
  const clothing = Boolean(opts.clothing), plain = Boolean(opts.plain);
  return enqueue("photo", { specialistId, originalId, clothing, plain, n: count + 1 }, { specialistId });
}

registerJob("photo", async (job, stage) => {
  const { specialistId, originalId, clothing, plain } = job.payload as { specialistId: string; originalId: string; clothing: boolean; plain?: boolean };
  const orig = await db.photoVersion.findUniqueOrThrow({ where: { id: originalId } });
  if (orig.specialistId !== specialistId) throw new Error("Vale omanik");
  const sp = await db.specialist.findUniqueOrThrow({ where: { id: specialistId } });
  const style = await photoStyleFor(sp.group);
  const original: Buffer = Buffer.from(orig.data);
  let img = original;
  const notes: Record<string, unknown> = {};
  let pipeline: "studio_ai" | "deterministic" = !plain && style.mode === "studio_ai" ? "studio_ai" : "deterministic";
  if (pipeline === "studio_ai" && !geminiConfigured() && !isTestMode()) {
    pipeline = "deterministic";
    notes.fallback = "AI stuudiotöötlus pole seadistatud (GEMINI_API_KEY) – kasutati lihttöötlust.";
  }
  if (pipeline === "studio_ai") {
    await stage(clothing ? "Stuudioportree ja tööriietus (generatiivne AI)" : "Stuudioportree koostamine (generatiivne AI)");
    try {
      img = await studioPortrait(img, style, clothing);
    } catch (e) {
      // pilditeenuse viga (nt kvoot) ei tohi arsti takistada: tee lihttöötlus ja jäta märkus
      if (clothing) throw e;
      pipeline = "deterministic";
      notes.fallback = `AI stuudiotöötlus ei õnnestunud (${e instanceof Error ? e.message.slice(0, 160) : "tundmatu viga"}) – kasutati lihttöötlust.`;
      console.error(JSON.stringify({ level: "error", event: "studio_portrait_failed", specialistId, error: e instanceof Error ? e.message : String(e) }));
    }
  } else if (clothing) {
    await stage("Tööriietuse muutmine (generatiivne AI)");
    img = await changeClothing(img, style);
  }
  await stage("Tausta eemaldamine");
  let out: { data: Buffer; edgeClipped: boolean };
  try {
    const cut = await removeBackground(img);
    await stage("Stuudiotaust ja kadreering");
    out = await finish(cut, style);
  } catch (e) {
    // AI stuudioportreel on juba hall taust: tausta eemalduse vea korral kasuta seda, ainult mõõdud ühtlustatakse
    if (pipeline !== "studio_ai") throw e;
    notes.backgroundNote = `Tausta ei ühtlustatud (${e instanceof Error ? e.message.slice(0, 120) : "viga"}) – kasutati AI portree enda tausta.`;
    const { W, H } = canvasSize(style);
    out = { data: await (await import("sharp")).default(img).rotate().resize(W, H, { fit: "cover", position: "top" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer(), edgeClipped: false };
  }
  if (pipeline === "studio_ai" || clothing) {
    await stage("Isikusarnasuse kontroll");
    notes.identity = await checkSamePerson(original, out.data).catch(() => ({ checked: false, ok: true, reason: "Isikusarnasuse kontroll ebaõnnestus." }));
  }
  if (out.edgeClipped && pipeline === "deterministic") notes.edgeClipped = true;
  const meta = await (await import("sharp")).default(out.data).metadata();
  const testMode = !process.env.REPLICATE_API_TOKEN;
  const p = await db.photoVersion.create({ data: { specialistId, kind: "PROCESSED", parentId: originalId, data: new Uint8Array(out.data), mimeType: "image/jpeg", width: meta.width ?? 0, height: meta.height ?? 0, settings: J({ style, clothing, pipeline, testMode }), qualityNotes: J(notes), createdBy: "süsteem" } });
  return { photoId: p.id };
});

// ---------------- kinnitus ----------------
export async function approveByDoctor(specialistId: string, req: ApprovalRequest, approverName: string) {
  const d = await getDraft(specialistId);
  const photoIds = req.photoVersionId ? (await db.photoVersion.findMany({ where: { specialistId, id: req.photoVersionId }, select: { id: true } })).map((p) => p.id) : [];
  const snap = buildApprovalSnapshot(d, req, photoIds);
  return db.$transaction(async (tx) => {
    const last = await tx.profileVersion.findFirst({ where: { specialistId }, orderBy: { number: "desc" } });
    const v = await tx.profileVersion.create({ data: { specialistId, number: (last?.number ?? 0) + 1, contentEt: J(snap.et), contentEn: snap.en ? J(snap.en) : undefined, contentRu: snap.ru ? J(snap.ru) : undefined, photoVersionId: snap.photoVersionId, createdBy: "arst" } });
    if (snap.photoVersionId) await tx.photoVersion.update({ where: { id: snap.photoVersionId }, data: { approvedAt: new Date() } });
    await tx.approval.create({ data: { specialistId, versionId: v.id, approverType: "DOCTOR", approverName, approverRole: "arst/spetsialist", statement: snap.statement, statementVersion: snap.statementVersion, languages: req.languages, photoVersionId: snap.photoVersionId, snapshot: J(snap) } });
    await tx.specialist.update({ where: { id: specialistId }, data: { workflowState: "MARKETING_REVIEW", lastDoctorReviewAt: new Date() } });
    await tx.profileDraft.update({ where: { specialistId }, data: { basedOnVersionId: v.id } });
    await tx.managerTask.updateMany({ where: { specialistId, type: { in: ["INVITE", "REVIEW_REMINDER"] }, doneAt: null }, data: { doneAt: new Date() } });
    await tx.activityLog.create({ data: { specialistId, actor: "arst", action: "doctor_approved", details: J({ version: v.number, languages: req.languages }) } });
    return v;
  });
}

/** "Info on endiselt õige" – uuendab ülevaatuse aega ilma uue sisuta. */
export async function confirmStillValid(specialistId: string, approverName: string) {
  const v = await db.profileVersion.findFirst({ where: { specialistId }, orderBy: { number: "desc" } });
  if (!v) throw new ApprovalError("Kinnitatud versiooni veel pole – vaata profiil üle ja kinnita see.");
  await db.approval.create({ data: { specialistId, versionId: v.id, approverType: "DOCTOR", approverName, approverRole: "arst/spetsialist", statement: "Kinnitan, et profiili info on endiselt õige.", statementVersion: "still-valid-v1", languages: [v.contentEn ? "en" : "", v.contentRu ? "ru" : "", "et"].filter(Boolean), photoVersionId: v.photoVersionId, snapshot: J({ versionId: v.id }), kind: "STILL_VALID" } });
  await db.specialist.update({ where: { id: specialistId }, data: { lastDoctorReviewAt: new Date() } });
  await db.managerTask.updateMany({ where: { specialistId, type: "REVIEW_REMINDER", doneAt: null }, data: { doneAt: new Date() } });
  await log(specialistId, "arst", "still_valid_confirmed", { version: v.number });
}

// ---------------- turundus ----------------
export async function returnToDoctor(specialistId: string, note: string, actor: string) {
  await db.specialist.update({ where: { id: specialistId }, data: { workflowState: "RETURNED" } });
  await db.internalNote.create({ data: { specialistId, author: actor, text: `Tagastatud arstile: ${note}` } });
  await log(specialistId, actor, "returned_to_doctor", { note });
}

export async function markReady(specialistId: string, actor: string) {
  await db.specialist.update({ where: { id: specialistId }, data: { workflowState: "READY_TO_PUBLISH" } });
  await log(specialistId, actor, "marked_ready");
}

/** Halduri muudatus kinnitatud versioonis: sisuline => uus arsti kinnitus; vormistuslik => uus versioon ajalukku. */
export async function managerEditVersion(specialistId: string, versionId: string, next: { et: unknown; en: unknown; ru: unknown }, actor: string) {
  const v = await db.profileVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (v.specialistId !== specialistId) throw new Error("Vale versioon");
  const approved = { et: v.contentEt, en: v.contentEn, ru: v.contentRu, photoVersionId: v.photoVersionId };
  const nextFull = { et: ProfileContent.parse(next.et), en: next.en ? ProfileContent.parse(next.en) : null, ru: next.ru ? ProfileContent.parse(next.ru) : null, photoVersionId: v.photoVersionId };
  if (managerEditNeedsApproval(approved, nextFull)) {
    const d = await getDraft(specialistId);
    const tr: Translations = {};
    const h = contentHash(nextFull.et);
    if (nextFull.en) tr.en = { content: nextFull.en, sourceHash: h, manuallyEdited: true, helpRequested: false, reviewedBy: actor, generatedAt: new Date().toISOString() };
    if (nextFull.ru) tr.ru = { content: nextFull.ru, sourceHash: h, manuallyEdited: true, helpRequested: false, reviewedBy: actor, generatedAt: new Date().toISOString() };
    await db.profileDraft.update({ where: { specialistId }, data: { content: J(nextFull.et), translations: J(tr), revision: d.revision + 1, updatedBy: actor } });
    await db.specialist.update({ where: { id: specialistId }, data: { workflowState: "DOCTOR_REVIEW" } });
    await log(specialistId, actor, "manager_substantive_edit", { fromVersion: v.number });
    return { needsApproval: true as const };
  }
  const last = await db.profileVersion.findFirst({ where: { specialistId }, orderBy: { number: "desc" } });
  const nv = await db.profileVersion.create({ data: { specialistId, number: (last?.number ?? 0) + 1, contentEt: J(nextFull.et), contentEn: nextFull.en ? J(nextFull.en) : undefined, contentRu: nextFull.ru ? J(nextFull.ru) : undefined, photoVersionId: v.photoVersionId, formattingOnlyFromId: v.id, createdBy: actor } });
  await log(specialistId, actor, "manager_formatting_edit", { fromVersion: v.number, toVersion: nv.number });
  return { needsApproval: false as const, version: nv };
}

/** Publitseeritava versiooni sisu on kinnitatud (või kinnitatud versioonist vormistuslikult tuletatud). */
export async function isPublishable(versionId: string): Promise<boolean> {
  let v = await db.profileVersion.findUnique({ where: { id: versionId }, include: { approvals: true } });
  for (let i = 0; v && i < 20; i++) {
    if (v.approvals.some((a) => a.kind === "APPROVE")) return true;
    if (!v.formattingOnlyFromId) return false;
    v = await db.profileVersion.findUnique({ where: { id: v.formattingOnlyFromId }, include: { approvals: true } });
  }
  return false;
}

export async function markPublished(specialistId: string, versionId: string, urls: Record<string, string>, actor: string) {
  const v = await db.profileVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (v.specialistId !== specialistId) throw new Error("Vale versioon");
  if (!(await isPublishable(versionId))) throw new Error("Seda versiooni pole arst kinnitanud.");
  await db.publicationMark.create({ data: { specialistId, versionId, publishedBy: actor, urls: J(urls) } });
  const sp = await db.specialist.findUniqueOrThrow({ where: { id: specialistId } });
  await db.specialist.update({ where: { id: specialistId }, data: { workflowState: "PUBLISHED", publicUrls: J({ ...(sp.publicUrls as object), ...Object.fromEntries(Object.entries(urls).filter(([, u]) => u)) }) } });
  await log(specialistId, actor, "marked_published", { version: v.number });
}

// ---------------- meeldetuletused (manuaalne režiim) ----------------
/** Loob ainult HALDURI tööülesanded. Kirju ei saadeta – e-posti integratsiooni pole. */
export async function createReviewTasks(months: number, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  const due = await db.specialist.findMany({ where: { archived: false, OR: [{ lastDoctorReviewAt: { lt: cutoff } }] }, select: { id: true, lastDoctorReviewAt: true } });
  let created = 0;
  for (const s of due) {
    const key = `review:${s.id}:${s.lastDoctorReviewAt?.toISOString().slice(0, 10)}`;
    const r = await db.managerTask.upsert({ where: { dedupeKey: key }, create: { specialistId: s.id, type: "REVIEW_REMINDER", dedupeKey: key }, update: {} });
    if (r.createdAt.getTime() > now.getTime() - 5000) created++;
  }
  return created;
}
