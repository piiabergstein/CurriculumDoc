// Fototöötlus: vaikimisi deterministlik (tausta eemaldus + sharp), generatiivne ainult tööriietuse muutmisel.
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import { isTestMode, ServiceNotConfigured, extractJson } from "./ai";

export const PhotoStyle = z.object({
  name: z.string().default("Vaikimisi"),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#D9DDE0"),
  brightness: z.number().min(0.7).max(1.3).default(1.03),
  saturation: z.number().min(0.5).max(1.5).default(0.95),
  warmth: z.number().min(-20).max(20).default(0), // + soojem
  aspect: z.enum(["4:5", "1:1", "3:4", "2:3"]).default("1:1"),
  width: z.number().int().min(300).max(3000).default(1200),
  headroom: z.number().min(0).max(0.3).default(0.08),
  maxRegenerations: z.number().int().min(0).max(20).default(5),
  clothingPrompt: z.string().default("tumesinine meditsiiniline tööriietus (scrubs), ilma logode, stetoskoobi ja muude lisadeta"),
  referenceNote: z.string().default("Vaikimisi väärtused põhinevad ühe referentsfoto (merili-prikk) vaatlusel 26.10.2026: ruudukujuline 600×600, hele külm hall ühtlane taust, pea ja õlad, pehme ühtlane valgus. See on tähelepanek, mitte ametlik Meliva brändireegel."),
});
export type PhotoStyle = z.infer<typeof PhotoStyle>;

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(["jpeg", "png", "webp", "heif"]);

export type Quality = { ok: boolean; problems: string[]; width: number; height: number; format: string };

/** Failitüüp tuvastatakse sisu, mitte laiendi järgi. */
export async function checkQuality(buf: Buffer): Promise<Quality> {
  const problems: string[] = [];
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, problems: ["Fail on liiga suur (üle 12 MB)."], width: 0, height: 0, format: "" };
  let meta: Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    return { ok: false, problems: ["Faili ei õnnestunud pildina avada. Kasuta JPG-, PNG- või HEIC-fotot."], width: 0, height: 0, format: "" };
  }
  const format = meta.format ?? "";
  if (!ALLOWED.has(format)) problems.push(`Failitüüp „${format}“ ei sobi. Kasuta JPG-, PNG- või HEIC-fotot.`);
  const w = meta.width ?? 0, h = meta.height ?? 0;
  if (Math.min(w, h) < 600) problems.push(`Pilt on liiga väikese resolutsiooniga (${w}×${h}). Vaja vähemalt 600 pikslit lühemal küljel.`);
  if (problems.length) return { ok: false, problems, width: w, height: h, format };
  const stats = await sharp(buf).greyscale().stats();
  const mean = stats.channels[0].mean;
  if (mean < 45) problems.push("Pilt on väga tume – proovi heledamas valguses.");
  if (mean > 225) problems.push("Pilt on üle valgustatud.");
  if (stats.sharpness < 0.6) problems.push("Pilt tundub udune – proovi teravamat fotot.");
  return { ok: problems.length === 0, problems, width: w, height: h, format };
}

/** Näo nähtavuse kontroll (Claude vision), kui teenus on seadistatud. Vastasel juhul ausalt: kontrollimata. */
export async function checkFace(buf: Buffer): Promise<{ checked: boolean; ok: boolean; reason: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { checked: false, ok: true, reason: "Näo nähtavust ei kontrollitud (teenus seadistamata)." };
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const small = await sharp(buf).rotate().resize(800, 800, { fit: "inside" }).jpeg().toBuffer();
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: 300,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } }, { type: "text", text: 'Kas see sobib profiilifoto töötluseks: üks inimene, nägu selgelt nähtav ja eestvaates, ei ole kaetud (päikeseprillid, käsi), pea ja õlad kaadris? Vasta AINULT JSON-iga {"ok": true/false, "reason": "lühike juhis arstile eesti keeles"}.' }] }],
  });
  const text = res.content.map((x) => (x.type === "text" ? x.text : "")).join("");
  const p = z.object({ ok: z.boolean(), reason: z.string() }).safeParse(extractJson(text));
  return p.success ? { checked: true, ...p.data } : { checked: false, ok: true, reason: "Näo kontrolli tulemus oli loetamatu." };
}

const ASPECTS: Record<PhotoStyle["aspect"], number> = { "4:5": 4 / 5, "1:1": 1, "3:4": 3 / 4, "2:3": 2 / 3 };

/** Deterministlik viimistlus: taust, valgus, toon, kadreering, mõõdud. Metaandmed eemaldatakse (sharp ei kopeeri neid vaikimisi). */
export async function finish(cutoutOrPhoto: Buffer, style: PhotoStyle): Promise<Buffer> {
  const width = style.width, height = Math.round(width / ASPECTS[style.aspect]);
  const img = sharp(cutoutOrPhoto).rotate();
  const meta = await img.metadata();
  let base = img.flatten({ background: style.background });
  base = base.modulate({ brightness: style.brightness, saturation: style.saturation });
  if (style.warmth) base = base.tint({ r: 255, g: 255 - Math.max(0, style.warmth) * 0.6, b: 255 - Math.max(0, style.warmth) * 1.5 });
  // kadreering: säilita pea üleval (headroom) – lõika laiust/kõrgust nii, et ülemine osa jääb
  const w0 = meta.width ?? width, h0 = meta.height ?? height;
  const target = ASPECTS[style.aspect];
  let cw = w0, ch = Math.round(w0 / target);
  if (ch > h0) { ch = h0; cw = Math.round(h0 * target); }
  const left = Math.round((w0 - cw) / 2);
  // portree: kärbi peamiselt alt, ülevalt jäta ainult headroom'i osa liigsest kõrgusest
  const top = Math.round((h0 - ch) * style.headroom);
  return base.extract({ left, top, width: cw, height: ch }).resize(width, height).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

async function fetchReplicateOutput(url: string): Promise<Buffer> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !/(^|\.)replicate\.delivery$/.test(u.hostname)) throw new Error("Ootamatu väljundi aadress");
  const r = await fetch(u, { redirect: "error" });
  if (!r.ok) throw new Error(`Väljundi allalaadimine ebaõnnestus (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

export async function removeBackground(buf: Buffer): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    if (isTestMode()) return buf; // testrežiim: tausta ei eemaldata
    throw new ServiceNotConfigured("tausta eemaldus (REPLICATE_API_TOKEN)");
  }
  // REPLICATE_BG_MODEL: "omanik/mudel" (kasutatakse viimast versiooni) või "omanik/mudel:versioon"
  const [model, pinned] = (process.env.REPLICATE_BG_MODEL || "851-labs/background-remover").split(":");
  const auth = { Authorization: `Bearer ${token}` };
  let version = pinned;
  if (!version) {
    const m = await fetch(`https://api.replicate.com/v1/models/${model}`, { headers: auth });
    const mj = (await m.json().catch(() => ({}))) as { latest_version?: { id: string }; detail?: string };
    if (!m.ok || !mj.latest_version?.id) throw new Error(`Tausta eemalduse mudelit „${model}“ ei leitud (${m.status} ${mj.detail ?? ""})`.trim());
    version = mj.latest_version.id;
  }
  const jpg = await sharp(buf).rotate().resize(2000, 2000, { fit: "inside" }).jpeg().toBuffer();
  type Pred = { status?: string; output?: unknown; error?: string; detail?: string; urls?: { get: string } };
  const r = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ version, input: { image: `data:image/jpeg;base64,${jpg.toString("base64")}` } }),
  });
  let p = (await r.json().catch(() => ({}))) as Pred;
  if (!r.ok) throw new Error(`Tausta eemaldus ebaõnnestus (${r.status}): ${p.detail ?? p.error ?? "tundmatu viga"}`);
  for (let i = 0; p.status !== "succeeded" && i < 45; i++) {
    if (p.status === "failed" || p.status === "canceled") throw new Error(`Tausta eemaldus ebaõnnestus: ${p.error ?? p.status}`);
    if (!p.urls?.get) break;
    await new Promise((res) => setTimeout(res, 2000));
    p = (await (await fetch(p.urls.get, { headers: auth })).json()) as Pred;
  }
  if (p.status !== "succeeded") throw new Error("Tausta eemaldus ei lõppenud õigeaegselt – proovi uuesti");
  const out = p.output;
  const url = typeof out === "string" ? out : Array.isArray(out) ? out[0] : (out as { url?: string } | null)?.url;
  if (typeof url !== "string") throw new Error("Tausta eemaldus ei tagastanud pilti");
  return fetchReplicateOutput(url);
}

/** Generatiivne tööriietuse muutus (Gemini). Kasutatakse ainult siis, kui see on selgelt valitud. */
export async function changeClothing(buf: Buffer, style: PhotoStyle): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    if (isTestMode()) return buf;
    throw new ServiceNotConfigured("tööriietuse muutmine (GEMINI_API_KEY)");
  }
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const jpg = await sharp(buf).rotate().resize(1600, 1600, { fit: "inside" }).jpeg().toBuffer();
  const prompt = `Edit this portrait photo: change ONLY the clothing to ${style.clothingPrompt}. Keep the person's face, facial features, skin, hair, expression, age, body shape and pose exactly unchanged and recognisable. Do not add a stethoscope, logos, name badges, text or any medical accessories. Keep a natural look.`;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: jpg.toString("base64") } }] }] }),
  });
  const j = (await r.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string }; inline_data?: { data: string } }[] } }[]; error?: { message: string } };
  if (!r.ok) throw new Error(`Tööriietuse muutmine ebaõnnestus: ${j.error?.message ?? r.status}`);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  const data = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!data) throw new Error("Pilditeenus ei tagastanud pilti");
  return Buffer.from(data, "base64");
}

export async function stripForStorage(buf: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  // originaal: pööra õigeks ja eemalda EXIF (GPS jms); kvaliteet säilib
  const data = await sharp(buf).rotate().jpeg({ quality: 95 }).toBuffer();
  const m = await sharp(data).metadata();
  return { data, width: m.width ?? 0, height: m.height ?? 0 };
}
