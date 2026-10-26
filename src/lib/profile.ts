// Profiili andmemudel ja puhas äriloogika (testitav ilma andmebaasita).
import { z } from "zod";

export const SectionStatus = z.enum(["entered", "not_entered", "not_applicable", "no_publish"]);
export type SectionStatus = z.infer<typeof SectionStatus>;

const yearSpan = z.object({
  from: z.string().default(""), // "2015" | "" (teadmata)
  to: z.string().default(""), // "2019" | "" ; ongoing => "praeguseni"/"käimas"
  ongoing: z.boolean().default(false),
  unknown: z.boolean().default(false),
});

export const ProfileContent = z.object({
  name: z.string().default(""),
  titles: z.array(z.string()).default([]),
  age: z
    .object({
      mode: z.enum(["", "all", "from", "range"]).default(""),
      from: z.string().default(""),
      to: z.string().default(""),
      note: z.string().default(""),
    })
    .default({}),
  languages: z
    .object({ list: z.array(z.enum(["et", "en", "ru", "fi", "de", "other"])).default([]), other: z.string().default(""), reviewed: z.boolean().default(false) })
    .default({}),
  description: z.string().default(""),
  wantsGeneratedIntro: z.boolean().default(false),
  education: z.array(yearSpan.extend({ institution: z.string().default(""), degree: z.string().default("") })).default([]),
  experience: z.array(yearSpan.extend({ organization: z.string().default(""), position: z.string().default("") })).default([]),
  trainings: z.array(z.object({ year: z.string().default(""), title: z.string().default(""), organizer: z.string().default("") })).default([]),
  memberships: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  publications: z
    .array(z.object({ kind: z.enum(["research", "article", "media"]).default("article"), title: z.string().default(""), url: z.string().default(""), year: z.string().default(""), description: z.string().default("") }))
    .default([]),
  additionalInfo: z.string().default(""),
  sections: z.record(SectionStatus).default({}),
});
export type ProfileContent = z.infer<typeof ProfileContent>;

export const emptyProfile = (): ProfileContent => ProfileContent.parse({});

export const OPTIONAL_SECTIONS = ["trainings", "memberships", "tags", "publications", "additionalInfo"] as const;
export const LIST_FIELDS = ["titles", "education", "experience", "trainings", "memberships", "tags", "publications"] as const;

export const FIELD_LABELS: Record<string, string> = {
  name: "Nimi",
  titles: "Ametinimetus",
  age: "Patsientide vanus",
  languages: "Vastuvõtu keeled",
  description: "Vastuvõtu kirjeldus",
  education: "Haridus",
  experience: "Töökogemus",
  trainings: "Erialased koolitused",
  memberships: "Erialased organisatsioonid",
  tags: "Erialased tag'id",
  publications: "Teadustööd ja artiklid",
  additionalInfo: "Täiendav teave",
};

export const APPROVAL_STATEMENT = "Kinnitan, et andmed on õiged, avaldamiseks lubatud ega sisalda patsiendiandmeid.";
export const APPROVAL_STATEMENT_VERSION = "2026-10-v1";

// ---------- väärtuste abifunktsioonid ----------
export function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0 || v.every(isEmptyValue);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("mode" in o) return !o.mode;
    if ("list" in o) return (o.list as unknown[]).length === 0;
    return Object.values(o).every((x) => typeof x === "boolean" || isEmptyValue(x));
  }
  return false;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const sameValue = (a: unknown, b: unknown) => norm(JSON.stringify(a ?? null)) === norm(JSON.stringify(b ?? null));

/** Isomorfne (brauser + server) räsi sisu võrdlemiseks; mitte turvaotstarbeks. */
export function contentHash(c: unknown): string {
  const str = JSON.stringify(c);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ ch, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ---------- import ilma vaikse ülekirjutamiseta ----------
export type FieldMeta = Record<string, { source: string; manual: boolean }>;
export type MergeResult = {
  content: ProfileContent;
  fieldMeta: FieldMeta;
  filled: string[];
  conflicts: { field: string; current: unknown; imported: unknown }[];
};

/** Täidab ainult tühjad väljad. Erinev olemasolev väärtus => vastuolu, mida kasutaja lahendab. */
export function mergeImport(current: ProfileContent, meta: FieldMeta, imported: Partial<ProfileContent>, source: string): MergeResult {
  const content = structuredClone(current) as ProfileContent;
  const fieldMeta = { ...meta };
  const filled: string[] = [];
  const conflicts: MergeResult["conflicts"] = [];
  for (const [field, value] of Object.entries(imported)) {
    if (field === "sections" || field === "wantsGeneratedIntro" || isEmptyValue(value)) continue;
    const cur = (content as Record<string, unknown>)[field];
    if (isEmptyValue(cur)) {
      (content as Record<string, unknown>)[field] = value;
      fieldMeta[field] = { source, manual: false };
      filled.push(field);
    } else if (!sameValue(cur, value)) {
      conflicts.push({ field, current: cur, imported: value });
    }
  }
  return { content, fieldMeta, filled, conflicts };
}

// ---------- tõlked ----------
export type Translation = {
  content: ProfileContent;
  sourceHash: string; // eestikeelse sisu räsi, mille põhjal tõlgiti
  manuallyEdited: boolean;
  helpRequested: boolean;
  reviewedBy?: string;
  generatedAt: string;
};
export type Translations = Partial<Record<"en" | "ru", Translation>>;

export function translationStatus(t: Translation | undefined, et: ProfileContent): "missing" | "fresh" | "stale" {
  if (!t) return "missing";
  return t.sourceHash === contentHash(et) ? "fresh" : "stale";
}

/** Uus genereerimine ei kaota käsitsi parandatud tõlget vaikselt: see tuleb eraldi üle kinnitada. */
export function applyRegeneratedTranslation(existing: Translation | undefined, fresh: Translation, force: boolean): { result: Translation; keptManual: boolean } {
  if (existing?.manuallyEdited && !force) return { result: existing, keptManual: true };
  return { result: fresh, keptManual: false };
}

// ---------- täielikkus ----------
export type CompletenessRules = {
  required: string[]; // põhiväljad
  observations: string[]; // eraldi tähelepanekud
  requiredByGroup?: Record<string, string[]>;
};
export const DEFAULT_RULES: CompletenessRules = {
  required: ["name", "titles", "description", "education"],
  observations: ["photo", "experience", "languages", "age"],
};

const PLACEHOLDERS = ["-", "–", "—", "lisamisel", "tulekul", "täiendamisel", "n/a", "puudub", "..."];
export function isPlaceholder(s: string): boolean {
  const t = norm(s).replace(/[.!]+$/, "");
  return t === "" || PLACEHOLDERS.includes(t);
}

export type Finding = { field: string; level: "missing" | "observation" | "suspect"; reason: string };

export function evaluateCompleteness(c: ProfileContent, opts: { hasPhoto: boolean; group?: string; rules?: CompletenessRules }): Finding[] {
  const rules = opts.rules ?? DEFAULT_RULES;
  const required = [...rules.required, ...(rules.requiredByGroup?.[opts.group ?? ""] ?? [])];
  const out: Finding[] = [];
  const status = (f: string) => c.sections?.[f];
  const check = (field: string, level: Finding["level"]) => {
    if (field === "photo") {
      if (!opts.hasPhoto) out.push({ field, level, reason: "Foto puudub" });
      return;
    }
    const st = status(field);
    if (st === "not_applicable" || st === "no_publish") return; // teadlik valik
    const v = (c as Record<string, unknown>)[field];
    if (isEmptyValue(v)) out.push({ field, level, reason: `${FIELD_LABELS[field] ?? field} puudub` });
  };
  required.forEach((f) => check(f, "missing"));
  rules.observations.filter((f) => !required.includes(f)).forEach((f) => check(f, "observation"));
  // sisutühjad väärtused
  if (c.description && isPlaceholder(c.description)) out.push({ field: "description", level: "suspect", reason: `Kirjeldus on sisutühi („${c.description.trim()}“)` });
  else if (c.description && c.titles.some((t) => norm(t) === norm(c.description))) out.push({ field: "description", level: "suspect", reason: "Kirjeldus kordab ainult ametinimetust" });
  if (c.name && isPlaceholder(c.name)) out.push({ field: "name", level: "suspect", reason: "Nimi on sisutühi" });
  // valikulised jaotised ei tekita kunagi hoiatust
  return out.filter((f) => !(OPTIONAL_SECTIONS as readonly string[]).includes(f.field));
}

export const isIncomplete = (f: Finding[]) => f.some((x) => x.level === "missing" || x.level === "suspect");

// ---------- URL ----------
export function validUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
}

// ---------- kahtlus patsiendiandmetele (ei leia kõiki juhtumeid) ----------
const PATIENT_PATTERNS = [/\b[3-6]\d{2}[01]\d[0-3]\d{5}\b/, /\bpatsient(?:i|il|ile)?\s+[A-ZÕÄÖÜ][a-zõäöü]+\s+[A-ZÕÄÖÜ]/, /\bhaiguslugu\b/i, /\bdiagnoos\w*\s*:\s*\w/i];
export function patientDataSuspicion(text: string): string[] {
  return PATIENT_PATTERNS.filter((r) => r.test(text)).map((r) => `Muster ${r.source.slice(0, 30)}…`);
}

// ---------- väljundi kujundamine (kopeerimine) ----------
export type Lang = "et" | "en" | "ru";
const LABELS: Record<Lang, Record<string, string>> = {
  et: { titles: "Ametinimetus", age: "Patsientide vanus", languages: "Vastuvõtu keeled", description: "Tutvustus", education: "Haridus", experience: "Töökogemus", trainings: "Erialased koolitused", memberships: "Erialased organisatsioonid", tags: "Teemad", publications: "Teadustööd ja artiklid", additionalInfo: "Täiendav teave", all: "igas vanuses", fromAge: "alates", now: "praeguseni", media: "meediakommentaar", et: "eesti", en: "inglise", ru: "vene", fi: "soome", de: "saksa" },
  en: { titles: "Position", age: "Patient age", languages: "Consultation languages", description: "About", education: "Education", experience: "Work experience", trainings: "Professional training", memberships: "Professional memberships", tags: "Topics", publications: "Research and articles", additionalInfo: "Additional information", all: "all ages", fromAge: "from", now: "present", media: "media comment", et: "Estonian", en: "English", ru: "Russian", fi: "Finnish", de: "German" },
  ru: { titles: "Должность", age: "Возраст пациентов", languages: "Языки приёма", description: "О специалисте", education: "Образование", experience: "Опыт работы", trainings: "Профессиональное обучение", memberships: "Профессиональные организации", tags: "Темы", publications: "Научные работы и статьи", additionalInfo: "Дополнительная информация", all: "любого возраста", fromAge: "с", now: "по настоящее время", media: "комментарий в СМИ", et: "эстонский", en: "английский", ru: "русский", fi: "финский", de: "немецкий" },
};

function span(s: { from: string; to: string; ongoing: boolean; unknown: boolean }, l: Lang) {
  if (s.unknown || (!s.from && !s.to && !s.ongoing)) return "";
  const to = s.ongoing ? LABELS[l].now : s.to;
  return s.from && to && s.from !== to ? `${s.from}–${to}` : s.from || to;
}

export type Section = { key: string; title: string; lines: string[]; paragraphs?: boolean };

/** Ainult avaldatav sisu: pole sisemisi märkusi, kontakte ega tühje pealkirju. */
export function publicSections(c: ProfileContent, l: Lang): Section[] {
  const L = LABELS[l];
  const hidden = (k: string) => c.sections?.[k] === "no_publish" || c.sections?.[k] === "not_applicable";
  const s: Section[] = [];
  const add = (key: string, lines: string[], paragraphs = false) => {
    const clean = lines.map((x) => x.trim()).filter(Boolean);
    if (!hidden(key) && clean.length) s.push({ key, title: L[key], lines: clean, paragraphs });
  };
  add("titles", c.titles);
  add("description", c.description.split(/\n{2,}/), true);
  if (c.age.mode) add("age", [[c.age.mode === "all" ? L.all : c.age.mode === "from" ? `${L.fromAge} ${c.age.from}` : `${c.age.from}–${c.age.to}`, c.age.note].filter(Boolean).join(", ")]);
  add("languages", [[...c.languages.list.filter((x) => x !== "other").map((x) => L[x]), c.languages.list.includes("other") ? c.languages.other : ""].filter(Boolean).join(", ")]);
  add("education", c.education.map((e) => [span(e, l), e.institution, e.degree].filter(Boolean).join(" | ")));
  add("experience", c.experience.map((e) => [span(e, l), e.organization, e.position].filter(Boolean).join(" | ")));
  add("trainings", c.trainings.map((e) => [e.year, e.title, e.organizer].filter(Boolean).join(" | ")));
  add("memberships", c.memberships);
  add("tags", c.tags.length ? [c.tags.join(", ")] : []);
  add("publications", c.publications.map((p) => [p.year, p.title, p.kind === "media" ? `(${L.media})` : "", p.url].filter(Boolean).join(" ")));
  add("additionalInfo", c.additionalInfo.split(/\n{2,}/), true);
  return s;
}

export function toPlainText(c: ProfileContent, l: Lang, only?: string): string {
  const secs = publicSections(c, l).filter((x) => !only || x.key === only);
  const head = only ? [] : [c.name];
  return [...head, ...secs.map((x) => `${x.title}\n${x.lines.join(x.paragraphs ? "\n\n" : "\n")}`)].join("\n\n").trim();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function toCleanHtml(c: ProfileContent, l: Lang, only?: string): string {
  const secs = publicSections(c, l).filter((x) => !only || x.key === only);
  return secs
    .map((x) => {
      const body = x.paragraphs || x.lines.length === 1 ? x.lines.map((p) => `<p>${esc(p)}</p>`).join("\n") : `<ul>\n${x.lines.map((p) => `  <li>${esc(p)}</li>`).join("\n")}\n</ul>`;
      return `<h3>${esc(x.title)}</h3>\n${body}`;
    })
    .join("\n");
}

// ---------- diff ----------
export function diffFields(a: ProfileContent | null, b: ProfileContent): { field: string; before: unknown; after: unknown }[] {
  const keys = Object.keys(FIELD_LABELS);
  return keys
    .filter((k) => !sameValue((a as Record<string, unknown> | null)?.[k], (b as Record<string, unknown>)[k]))
    .map((k) => ({ field: k, before: (a as Record<string, unknown> | null)?.[k], after: (b as Record<string, unknown>)[k] }));
}

/** Kas muudatus on sisuline (vajab uut arsti kinnitust) või puhas vormistus (tühikud, suurtähed, kirjavahemärgid). */
export function isSubstantiveChange(a: unknown, b: unknown): boolean {
  const f = (x: unknown) => JSON.stringify(x ?? null).toLowerCase().replace(/[\s.,;:!?"'„“”«»()\-–—]+/g, "");
  return f(a) !== f(b);
}
