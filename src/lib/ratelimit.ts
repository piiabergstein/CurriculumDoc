import { db } from "./db";
/** Püsiv (andmebaasipõhine) päringupiirang – töötab ka taaskäivituste vahel. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const now = new Date();
  const row = await db.rateLimit.findUnique({ where: { key } });
  if (!row || row.resetAt < now) {
    await db.rateLimit.upsert({ where: { key }, create: { key, count: 1, resetAt: new Date(now.getTime() + windowSec * 1000) }, update: { count: 1, resetAt: new Date(now.getTime() + windowSec * 1000) } });
    return true;
  }
  if (row.count >= limit) return false;
  await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
  return true;
}
