import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
export const dynamic = "force-dynamic";

/** Renderi tervisekontroll: 200, kui andmebaas vastab; 503, kui mitte. Saladusi ega detaile ei avaldata. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "ok" });
  } catch {
    return NextResponse.json({ ok: false, db: "unreachable" }, { status: 503 });
  }
}
