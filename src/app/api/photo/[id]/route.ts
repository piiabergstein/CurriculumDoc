import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { currentDoctor, currentStaff } from "../../../../lib/auth";
import { verifyUrlToken } from "../../../../lib/security";

/** Foto väljastamine ainult serveris kontrollitud õigusega: arst (oma foto), töötaja või lühiajaline allkirjastatud link. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await db.photoVersion.findUnique({ where: { id }, include: { specialist: { select: { name: true } } } });
  if (!p) return new NextResponse("Ei leitud", { status: 404 });
  const token = req.nextUrl.searchParams.get("t");
  const staff = await currentStaff();
  const doctor = staff ? null : await currentDoctor();
  const allowed = (token && verifyUrlToken(`photo:${id}`, token)) || (staff && staff.totpEnabled) || doctor?.specialistId === p.specialistId;
  if (!allowed) return new NextResponse("Ligipääs keelatud", { status: 403 });
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
