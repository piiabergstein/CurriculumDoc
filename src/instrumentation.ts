export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DATABASE_URL) {
    await import("./lib/service"); // registreerib tööde käsitlejad
    const { bootstrapAdmin } = await import("./lib/bootstrap");
    await bootstrapAdmin().catch((e) => console.error("bootstrap", e));
    const { startWorker } = await import("./lib/jobs");
    startWorker();
  }
}
