import crypto from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.APP_MODE === "test" || process.env.NODE_ENV === "test") return "test-secret-test-secret-test-secret-xx";
    throw new Error("SESSION_SECRET puudub või on liiga lühike (vähemalt 32 märki)");
  }
  return s;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const hmac = (s: string) => crypto.createHmac("sha256", secret()).update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 6-kohaline kood, krüptograafiliselt juhuslik. */
export const sixDigitCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
export const inviteCodeHash = (specialistId: string, code: string) => hmac(`invite:${specialistId}:${code}`);

/** Lühiajaline allkirjastatud link (nt foto allalaadimine). */
export function signUrlToken(resource: string, ttlSeconds: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${exp}.${hmac(`dl:${resource}:${exp}`).slice(0, 32)}`;
}
export function verifyUrlToken(resource: string, token: string, now = Date.now()): boolean {
  const [expS, sig] = token.split(".");
  const exp = Number(expS);
  if (!exp || !sig || exp * 1000 < now) return false;
  return safeEqual(sig, hmac(`dl:${resource}:${exp}`).slice(0, 32));
}
