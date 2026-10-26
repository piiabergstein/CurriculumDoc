import { hash } from "@node-rs/argon2";
import { db } from "./db";

/** Esimene administraator keskkonnamuutujatest – ainult siis, kui ühtegi kasutajat veel pole. */
export async function bootstrapAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if ((await db.user.count()) > 0) return;
  if (password.length < 12) {
    console.error("BOOTSTRAP_ADMIN_PASSWORD peab olema vähemalt 12 märki");
    return;
  }
  await db.user.create({ data: { email, name: "Administraator", role: "ADMIN", passwordHash: await hash(password) } });
  console.log(JSON.stringify({ level: "info", event: "bootstrap_admin_created", email }));
}
