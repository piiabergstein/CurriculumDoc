// Kasutus: npm run create-admin -- admin@meliva.ee "Nimi"
// Parool küsitakse keskkonnamuutujast ADMIN_PASSWORD (et see ei jääks käsuajalukku) või genereeritakse.
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import crypto from "node:crypto";

async function main() {
  const [email, name = "Administraator"] = process.argv.slice(2);
  if (!email) throw new Error("Kasutus: npm run create-admin -- email@meliva.ee \"Nimi\"");
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
  if (password.length < 12) throw new Error("Parool peab olema vähemalt 12 märki");
  const db = new PrismaClient();
  const u = await db.user.upsert({ where: { email: email.toLowerCase() }, create: { email: email.toLowerCase(), name, role: "ADMIN", passwordHash: await hash(password) }, update: { role: "ADMIN", passwordHash: await hash(password), active: true, totpEnabled: false, totpSecret: null, failedLogins: 0, lockedUntil: null } });
  console.log(`Administraator ${u.email} loodud/uuendatud.`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Ajutine parool: ${password}  (muuda pärast sisselogimist)`);
  console.log("Esimesel sisselogimisel tuleb seadistada kaheastmeline autentimine.");
  await db.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
