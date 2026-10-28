// Fototöötlus: vaikimisi stuudioportree (Gemini kadreerib ja jätkab õlad) → tausta eemaldus → ühtne gradienttaust (sharp).
// Režiim "deterministic" jätab generatiivse sammu vahele (ainult tausta eemaldus + sharp).
import sharp, { type Metadata, type OverlayOptions } from "sharp";
import { z } from "zod";
import { isTestMode, ServiceNotConfigured, extractJson } from "./ai";

export const PhotoStyle = z.object({
  name: z.string().default("Vaikimisi"),
  mode: z.enum(["studio_ai", "deterministic"]).default("studio_ai"),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#C9CED5"), // gradiendi hele keskosa (pea taga)
  backgroundEdge: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#959EA9"), // gradiendi tumedam serv
  brightness: z.number().min(0.7).max(1.3).default(1.02),
  saturation: z.number().min(0.5).max(1.5).default(0.97),
  warmth: z.number().min(-20).max(20).default(0), // + soojem
  aspect: z.enum(["3:2", "4:5", "1:1", "3:4", "2:3"]).default("3:2"),
  width: z.number().int().min(300).max(3000).default(1536),
  headroom: z.number().min(0).max(0.3).default(0.09), // pealae kaugus ülaservast (osa kõrgusest)
  subjectWidth: z.number().min(0.3).max(1).default(0.62), // õlgade laius (osa kaadri laiusest)
  maxRegenerations: z.number().int().min(0).max(20).default(5),
  clothingPrompt: z.string().default("tumesinine meditsiiniline tööriietus (scrubs), ilma logode, stetoskoobi ja muude lisadeta"),
  referenceNote: z.string().default("Vaikimisi väärtused põhinevad Meliva näidispaaril (sisend → väljund) 28.10.2026: horisontaalne 3:2 kaader, inimene keskel eestvaates, pea, õlad ja rindkere ülaosa, sile hall-sinakas stuudiogradient (heledam pea taga, servades tumedam), pehme ühtlane valgus, kerge retušš. See on tähelepanek, mitte ametlik Meliva brändireegel."),
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

const ASPECTS: Record<PhotoStyle["aspect"], number> = { "3:2": 3 / 2, "4:5": 4 / 5, "1:1": 1, "3:4": 3 / 4, "2:3": 2 / 3 };

export function canvasSize(style: PhotoStyle) {
  return { W: style.width, H: Math.round(style.width / ASPECTS[style.aspect]) };
}

/** Sile radiaalne stuudiogradient: heledam pea taga, servades tumedam. */
async function backdrop(W: number, H: number, style: PhotoStyle): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="50%" cy="38%" r="72%"><stop offset="0" stop-color="${style.background}"/><stop offset="1" stop-color="${style.backgroundEdge}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Deterministlik viimistlus: väljalõigatud inimene (alfakanaliga) paigutatakse gradienttaustale –
 * pea horisontaalselt keskele, pealagi `headroom` kaugusele ülaservast, kaader lõikab rindkere juurest.
 * Metaandmed eemaldatakse (sharp ei kopeeri neid vaikimisi).
 */
export async function finish(cutout: Buffer, style: PhotoStyle): Promise<{ data: Buffer; edgeClipped: boolean }> {
  const { W, H } = canvasSize(style);
  const norm = await sharp(cutout).rotate().ensureAlpha().png().toBuffer();
  const { data: alpha, info } = await sharp(norm).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 24) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const layers: OverlayOptions[] = [];
  let edgeClipped = false;
  if (x1 >= 0) {
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // pea keskpunkt: läbipaistmatute pikslite keskmine x ülemises 15%-s
    let sx = 0, n = 0;
    for (let y = y0; y < y0 + Math.max(1, Math.round(bh * 0.15)); y++) for (let x = x0; x <= x1; x++) if (alpha[y * w + x] > 24) { sx += x; n++; }
    const headCx = (n ? sx / n : (x0 + x1) / 2) - x0;
    const top = Math.round(H * style.headroom);
    const s = Math.max((style.subjectWidth * W) / bw, (H - top) / bh);
    const sw = Math.max(1, Math.round(bw * s)), sh = Math.max(1, Math.round(bh * s));
    const left = Math.round(W / 2 - headCx * s);
    const ix = Math.max(0, -left), iw = Math.min(sw - ix, W - Math.max(0, left)), ih = Math.min(sh, H - top);
    // originaalis külgedelt äralõigatud inimene jätab kaadrisse kõva vertikaalse serva
    edgeClipped = (x0 <= 1 && left > 0) || (x1 >= w - 2 && left + sw < W);
    if (iw > 0 && ih > 0) {
      const subject = await sharp(norm).extract({ left: x0, top: y0, width: bw, height: bh }).resize(sw, sh).png().toBuffer();
      const visible = await sharp(subject).extract({ left: ix, top: 0, width: iw, height: ih }).png().toBuffer();
      layers.push({ input: visible, left: Math.max(0, left), top });
    }
  }
  const composed = await sharp(await backdrop(W, H, style)).composite(layers).png().toBuffer();
  let img = sharp(composed).modulate({ brightness: style.brightness, saturation: style.saturation });
  if (style.warmth) img = img.tint({ r: 255, g: 255 - Math.max(0, style.warmth) * 0.6, b: 255 - Math.max(0, style.warmth) * 1.5 });
  return { data: await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer(), edgeClipped };
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

async function geminiEdit(buf: Buffer, prompt: string, aspect?: string): Promise<Buffer> {
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const jpg = await sharp(buf).rotate().resize(1600, 1600, { fit: "inside" }).jpeg().toBuffer();
  const generationConfig = { responseModalities: ["IMAGE"], ...(aspect ? { imageConfig: { aspectRatio: aspect } } : {}) };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: jpg.toString("base64") } }] }], generationConfig }),
  });
  const j = (await r.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string }; inline_data?: { data: string } }[] } }[]; error?: { message: string } };
  if (!r.ok) throw new Error(`Pilditeenuse viga: ${j.error?.message ?? r.status}`);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  const data = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!data) throw new Error("Pilditeenus ei tagastanud pilti");
  return Buffer.from(data, "base64");
}

const KEEP_IDENTITY = "Keep the person's face, facial features, eye colour, skin, hair, facial hair, expression, age and body shape exactly unchanged and clearly recognisable. Do not beautify, slim, smooth the skin or add makeup. Do not add a stethoscope, logos, name badges, text or any accessories.";

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Generatiivne tööriietuse muutus (Gemini). Kasutatakse ainult siis, kui see on selgelt valitud. */
export async function changeClothing(buf: Buffer, style: PhotoStyle): Promise<Buffer> {
  if (!geminiConfigured()) {
    if (isTestMode()) return buf;
    throw new ServiceNotConfigured("tööriietuse muutmine (GEMINI_API_KEY)");
  }
  return geminiEdit(buf, `Edit this portrait photo: change ONLY the clothing to ${style.clothingPrompt}. ${KEEP_IDENTITY} Keep a natural look.`);
}

/**
 * Stuudioportree (Gemini): sama inimene eestvaates keskele, pea-õlad-rindkere ülaosa, horisontaalne kaader;
 * originaalis äralõigatud õlad ja käed jätkatakse loomulikult. Taust asendatakse hiljem deterministlikult.
 */
export async function studioPortrait(buf: Buffer, style: PhotoStyle, clothing: boolean): Promise<Buffer> {
  if (!geminiConfigured()) {
    if (isTestMode()) return buf;
    throw new ServiceNotConfigured("stuudioportree (GEMINI_API_KEY)");
  }
  const clothes = clothing ? `Change ONLY the clothing to ${style.clothingPrompt}.` : "Keep the clothing exactly as it is (same garment, colour, collar and accessories such as a tie or bow tie).";
  const prompt = `Turn this photo into a professional corporate studio portrait of the SAME person. ${KEEP_IDENTITY} ${clothes}
Remove the original surroundings (walls, doors, panels, furniture) completely and place the person in front of a smooth seamless plain light grey studio backdrop with no texture or objects.
Framing: ${style.aspect} landscape image, the person centred and facing the camera, head, shoulders and upper chest visible, top of the head about ${Math.round(style.headroom * 100)}% below the top edge, the frame ends at mid-chest. The shoulders take up roughly ${Math.round(style.subjectWidth * 100)}% of the image width. Where shoulders or arms are cut off or hidden in the original, extend them naturally and symmetrically.
Lighting: soft, even, flattering studio light, natural skin tones, sharp focus on the eyes, only subtle retouching.`;
  return geminiEdit(buf, prompt, style.aspect);
}

/** Isikusarnasuse kontroll (Claude vision): kas generatiivne tulemus kujutab sama inimest. */
export async function checkSamePerson(original: Buffer, result: Buffer): Promise<{ checked: boolean; ok: boolean; reason: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { checked: false, ok: true, reason: "Isikusarnasust ei kontrollitud (teenus seadistamata)." };
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const small = async (b: Buffer) => (await sharp(b).rotate().resize(800, 800, { fit: "inside" }).jpeg().toBuffer()).toString("base64");
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: 300,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await small(original) } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await small(result) } },
      { type: "text", text: 'Esimene pilt on originaal, teine AI-ga töödeldud profiilifoto. Kas teisel pildil on selgelt sama inimene ning näojooned, juuksed, habe, silmad ja kehakuju pole märgatavalt muutunud? Taust, valgus ja kadreering võivad erineda. Vasta AINULT JSON-iga {"ok": true/false, "reason": "lühike selgitus eesti keeles"}.' },
    ] }],
  });
  const text = res.content.map((x) => (x.type === "text" ? x.text : "")).join("");
  const p = z.object({ ok: z.boolean(), reason: z.string() }).safeParse(extractJson(text));
  return p.success ? { checked: true, ...p.data } : { checked: false, ok: true, reason: "Isikusarnasuse kontrolli tulemus oli loetamatu." };
}

export async function stripForStorage(buf: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  // originaal: pööra õigeks ja eemalda EXIF (GPS jms); kvaliteet säilib
  const data = await sharp(buf).rotate().jpeg({ quality: 95 }).toBuffer();
  const m = await sharp(data).metadata();
  return { data, width: m.width ?? 0, height: m.height ?? 0 };
}
