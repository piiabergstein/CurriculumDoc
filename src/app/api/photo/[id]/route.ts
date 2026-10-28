import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { currentDoctor, currentStaff } from "../../../../lib/auth";
import { verifyUrlToken } from "../../../../lib/security";

/** Foto väljastamine ainult serveris kontrollitud õigusega: arst (oma foto), töötaja või lühiajaline allkirjastatud link. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("t");
  const staff = await currentStaff();
  const doctor = staff ? null : await currentDoctor();
  const tokenOk = !!token && verifyUrlToken(`photo:${id}`, token);
  // Õigused enne andmebaasi päringut – sisselogimata kasutaja ei saa teada, kas foto on olemas.
  if (!tokenOk && !(staff && staff.totpEnabled) && !doctor) return new NextResponse("Ligipääs keelatud", { status: 403 });
  const p = await db.photoVersion.findUnique({ where: { id }, include: { specialist: { select: { name: true } } } });
  // Teise arsti foto puhul sama vastus kui olematu foto puhul.
  if (!p || (!tokenOk && !staff && doctor?.specialistId !== p.specialistId)) return new NextResponse("Ei leitud", { status: 404 });
  const w = Number(req.nextUrl.searchParams.get("w"));
  if (w >= 100 && w <= 1200 && req.nextUrl.searchParams.get("download") !== "1") {
    const sharp = (await import("sharp")).default;
    const thumb = await sharp(Buffer.from(p.data)).resize(w, w, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
    return new NextResponse(new Uint8Array(thumb), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" } });
  }
  const download = req.nextUrl.searchParams.get("download") === "1";
  const slug = p.specialist.name.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return new NextResponse(new Uint8Array(p.data), {
    headers: {
      "Content-Type": p.mimeType,
      "Cache-Control": "private, no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="${slug}-${p.kind.toLowerCase()}-${p.id.slice(-6)}.jpg"` } : {}),
    },
  });
}
