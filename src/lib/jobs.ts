// Püsiv taustatööde järjekord Postgresis: piiratud korduskatsed, dubleerimise vältimine (dedupeKey),
// katkestuse järel jätkamine (aegunud lukk => töö võetakse uuesti).
import { db } from "./db";
import type { Job, Prisma } from "@prisma/client";

export type JobHandler = (job: Job, setStage: (s: string) => Promise<void>) => Promise<unknown>;
const handlers = new Map<string, JobHandler>();
export const registerJob = (type: string, h: JobHandler) => handlers.set(type, h);

export async function enqueue(type: string, payload: Prisma.InputJsonValue, opts: { specialistId?: string; dedupeKey?: string; maxAttempts?: number } = {}) {
  if (opts.dedupeKey) {
    const existing = await db.job.findUnique({ where: { dedupeKey: opts.dedupeKey } });
    if (existing) return existing; // sama sündmus ei tekita teist tööd
  }
  try {
    return await db.job.create({ data: { type, payload, specialistId: opts.specialistId, dedupeKey: opts.dedupeKey, maxAttempts: opts.maxAttempts ?? 3 } });
  } catch (e) {
    if (opts.dedupeKey) return db.job.findUniqueOrThrow({ where: { dedupeKey: opts.dedupeKey } });
    throw e;
  }
}

/** Võtab ühe töö (SKIP LOCKED) ja käivitab selle. Tagastab false, kui järjekord on tühi. */
export async function runOne(): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status = 'running', attempts = attempts + 1, "lockedUntil" = now() + interval '5 minutes', "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE (status = 'queued' AND "runAfter" <= now()) OR (status = 'running' AND "lockedUntil" < now())
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING id`;
  if (!rows.length) return false;
  const job = await db.job.findUniqueOrThrow({ where: { id: rows[0].id } });
  const h = handlers.get(job.type);
  const t0 = Date.now();
  try {
    if (!h) throw new Error(`Tundmatu töö tüüp ${job.type}`);
    const result = await h(job, async (stage) => { await db.job.update({ where: { id: job.id }, data: { stage } }); });
    await db.job.update({ where: { id: job.id }, data: { status: "done", stage: "Valmis", result: (result ?? null) as Prisma.InputJsonValue, error: null, durationMs: Date.now() - t0, lockedUntil: null } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const permanent = msg.startsWith("Teenus seadistamata") || job.attempts >= job.maxAttempts;
    await db.job.update({
      where: { id: job.id },
      data: permanent
        ? { status: "failed", error: msg, durationMs: Date.now() - t0, lockedUntil: null }
        : { status: "queued", error: msg, runAfter: new Date(Date.now() + 2 ** job.attempts * 5000), lockedUntil: null },
    });
    console.error(JSON.stringify({ level: "error", event: "job_failed", jobId: job.id, type: job.type, attempt: job.attempts, permanent, error: msg }));
  }
  return true;
}

let running = false;
/** Töötleja jookseb veebiteenuse sees. Free-plaanil kutsutakse seda ka päringute ajal (kick). */
export async function drain(max = 5) {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < max && (await runOne()); i++);
  } finally {
    running = false;
  }
}

export function startWorker() {
  const g = globalThis as unknown as { __worker?: NodeJS.Timeout };
  if (g.__worker) return;
  g.__worker = setInterval(() => drain().catch((e) => console.error("worker", e)), 3000);
}

/** Uuesti proovimine: ainult ebaõnnestunud töö, sisend säilib. */
export async function retryJob(id: string) {
  await db.job.update({ where: { id }, data: { status: "queued", attempts: 0, runAfter: new Date(), error: null } });
}
