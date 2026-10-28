import Link from "next/link";
import { requireStaff } from "../../lib/auth";
import { db } from "../../lib/db";
import { drain } from "../../lib/jobs";
import { getSetting } from "../../lib/service";
import { ProfileContent, evaluateCompleteness, isIncomplete, DEFAULT_RULES, type CompletenessRules } from "../../lib/profile";
import { WORKFLOW_LABELS, reviewDue } from "../../lib/versioning";
import StaffNav from "./StaffNav";
import ReviewScanButton from "./ReviewScanButton";
export const dynamic = "force-dynamic";

const QUEUES: Record<string, string> = {
  all: "Kõik",
  invite: "Kutsumist vajavad",
  doctor: "Arsti pooleli",
  marketing: "Turunduse ülevaatust ootavad",
  ready: "Avaldamisvalmis",
  review: "Ajakohasuse kinnitamist vajavad",
  tasks: "Avatud ülesanded",
};

export default async function StaffHome({ searchParams }: { searchParams: Promise<{ q?: string; queue?: string; state?: string }> }) {
  const u = await requireStaff();
  drain(3).catch(() => {});
  const { q = "", queue = "all", state = "" } = await searchParams;
  const [rules, months, list] = await Promise.all([
    getSetting<CompletenessRules>("completenessRules", DEFAULT_RULES),
    getSetting<number>("reviewMonths", 12),
    db.specialist.findMany({
      where: { archived: false, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { contactEmail: { contains: q, mode: "insensitive" } }] } : {}), ...(state ? { workflowState: state as never } : {}) },
      include: { draft: { select: { content: true, selectedPhotoId: true } }, responsible: { select: { name: true } }, invites: { orderBy: { createdAt: "desc" }, take: 1 }, tasks: { where: { doneAt: null } }, photos: { select: { id: true }, take: 1 }, publications: { orderBy: { publishedAt: "desc" }, take: 1 }, versions: { orderBy: { number: "desc" }, take: 1, select: { id: true, number: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const rows = list.map((s) => {
    const c = ProfileContent.parse(s.draft?.content ?? {});
    const findings = evaluateCompleteness(c, { hasPhoto: s.photos.length > 0, group: s.group, rules });
    const due = reviewDue(s.lastDoctorReviewAt, months);
    const pendingPublish = !!s.versions[0] && s.versions[0].id !== s.publications[0]?.versionId;
    return { s, c, findings, due, pendingPublish };
  });
  type Row = (typeof rows)[number];
  const inQueue = (r: Row, k: string): boolean => {
    switch (k) {
      case "invite": {
        // ainult need, kes ootavad arsti tegevust ja kellel pole kehtivat saadetud kutset
        if (!["DRAFT", "DOCTOR_REVIEW", "RETURNED"].includes(r.s.workflowState)) return r.s.tasks.some((t) => t.type === "REVIEW_REMINDER");
        const inv = r.s.invites[0];
        return !inv || !!inv.revokedAt || inv.expiresAt < new Date() || !inv.sentMarkedAt;
      }
      case "doctor": return r.s.workflowState === "DOCTOR_REVIEW" || r.s.workflowState === "RETURNED";
      case "marketing": return r.s.workflowState === "MARKETING_REVIEW" || r.s.workflowState === "DOCTOR_APPROVED";
      case "ready": return r.s.workflowState === "READY_TO_PUBLISH";
      case "review": return r.due !== "ok";
      case "tasks": return r.s.tasks.length > 0;
      default: return true;
    }
  };
  const shown = rows.filter((r) => inQueue(r, queue));
  const obs = (f: Row["findings"]) => f.filter((x) => x.level === "observation");
  return (
    <div>
      <StaffNav email={u.email} admin={u.role === "ADMIN"} />
      <h1>Spetsialistid</h1>
      <div className="row" role="navigation" aria-label="Tööjärjekorrad" style={{ marginBottom: 12 }}>
        {Object.entries(QUEUES).map(([k, l]) => (
          <Link key={k} href={`/haldus?queue=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`btn small ${queue === k ? "" : "secondary"}`} aria-current={queue === k ? "page" : undefined} style={{ padding: "4px 10px", fontSize: ".88rem" }}>
            {l} ({rows.filter((r) => inQueue(r, k)).length})
          </Link>
        ))}
      </div>
      <form className="row card" role="search">
        <input type="hidden" name="queue" value={queue} />
        <div className="grow"><label htmlFor="q">Otsi nime või e-posti järgi</label><input id="q" name="q" defaultValue={q} /></div>
        <div><label htmlFor="state">Töövoo seis</label><select id="state" name="state" defaultValue={state}><option value="">kõik</option>{Object.entries(WORKFLOW_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <button style={{ alignSelf: "flex-end" }}>Filtreeri</button>
      </form>
      <ReviewScanButton />
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Nimi</th><th>Ametinimetus</th><th>Seis</th><th>Põhiteave</th><th>Foto</th><th>Arsti ülevaatus</th><th>Kutse</th><th>Avaldamata muudatus</th><th>Vastutav</th><th>Avalik profiil</th></tr></thead>
          <tbody>
            {shown.map(({ s, c, findings, due, pendingPublish }) => (
              <tr key={s.id}>
                <td><Link href={`/haldus/s/${s.id}`}>{s.name}</Link>{s.tasks.length > 0 && <> <span className="badge warn">{s.tasks.length} ülesannet</span></>}</td>
                <td>{c.titles.join(", ") || <span className="muted">—</span>}</td>
                <td><span className="badge">{WORKFLOW_LABELS[s.workflowState]}</span></td>
                <td>
                  {isIncomplete(findings) ? <span className="badge err">{findings.filter((f) => f.level !== "observation").map((f) => f.reason).join("; ")}</span> : <span className="badge ok">korras</span>}
                  {obs(findings).length > 0 && <div className="hint">{obs(findings).map((f) => f.reason).join("; ")}</div>}
                </td>
                <td>{s.draft?.selectedPhotoId ? <span className="badge ok">valitud</span> : s.photos.length ? <span className="badge warn">valimata</span> : <span className="badge">puudub</span>}</td>
                <td>{s.lastDoctorReviewAt ? s.lastDoctorReviewAt.toLocaleDateString("et-EE") : "Kinnitamise aeg teadmata"}{due === "due" && <> <span className="badge warn">tähtaeg möödas</span></>}</td>
                <td>{s.invites[0] ? (s.invites[0].revokedAt ? "tühistatud" : s.invites[0].expiresAt < new Date() ? "aegunud" : s.invites[0].sentMarkedAt ? `saadetud ${s.invites[0].sentMarkedAt.toLocaleDateString("et-EE")}` : "loodud, saatmata") : "kutset pole"}</td>
                <td>{pendingPublish ? <span className="badge warn">v{s.versions[0].number} ootab</span> : "—"}</td>
                <td>{s.responsible?.name ?? "—"}</td>
                <td>{Object.entries((s.publicUrls ?? {}) as Record<string, string>).filter(([, v]) => v).map(([l, v]) => <a key={l} href={v} target="_blank" rel="noreferrer noopener">{l.toUpperCase()} </a>)}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={10} className="muted">Selles järjekorras pole kedagi.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">Avaliku veebi automaatne kontroll pole selles versioonis sisse lülitatud (rakendus ei ühendu meliva.ee-ga).</p>
    </div>
  );
}
