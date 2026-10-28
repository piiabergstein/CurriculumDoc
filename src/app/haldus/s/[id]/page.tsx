import { notFound } from "next/navigation";
import { requireStaff } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { getSetting } from "../../../../lib/service";
import { ProfileContent, evaluateCompleteness, diffFields, translationStatus, FIELD_LABELS, DEFAULT_RULES, type CompletenessRules, type Translations } from "../../../../lib/profile";
import { WORKFLOW_LABELS, reviewDue } from "../../../../lib/versioning";
import ProfilePreview from "../../../../components/ProfilePreview";
import StaffNav from "../../StaffNav";
import * as A from "../../actions";
import { InvitePanel, PublishDesk, ProPhotoUpload, DraftEditor } from "./client";
export const dynamic = "force-dynamic";

const TASK_LABELS: Record<string, string> = { INVITE: "Kutse saatmine", REVIEW_REMINDER: "Ülevaatuse meeldetuletus", TRANSLATION_HELP: "Tõlke kontrollimise abi", PHOTO_HELP: "Fotoabi", PATIENT_DATA: "Võimalikud patsiendiandmed – vaata üle ja eemalda" };
const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString("et-EE") : "—");

export default async function SpecialistDetail({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireStaff();
  const { id } = await params;
  const s = await db.specialist.findUnique({
    where: { id },
    include: {
      draft: true, responsible: true,
      invites: { orderBy: { createdAt: "desc" }, take: 5 },
      provenance: { orderBy: { createdAt: "desc" }, take: 60 },
      conflicts: { where: { resolvedAt: null } },
      versions: { orderBy: { number: "desc" }, include: { approvals: { orderBy: { createdAt: "desc" } }, publications: true } },
      photos: { select: { id: true, kind: true, parentId: true, approvedAt: true, createdAt: true, createdBy: true, settings: true, width: true, height: true }, orderBy: { createdAt: "desc" } },
      publications: { orderBy: { publishedAt: "desc" }, include: { version: { select: { number: true } } } },
      notes: { orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
      tasks: { where: { doneAt: null } },
      imports: { orderBy: { createdAt: "desc" }, select: { id: true, kind: true, filename: true, createdAt: true } },
      jobs: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!s || !s.draft) notFound();
  const users = await db.user.findMany({ where: { active: true }, select: { id: true, name: true } });
  const rules = await getSetting<CompletenessRules>("completenessRules", DEFAULT_RULES);
  const months = await getSetting<number>("reviewMonths", 12);
  const draft = ProfileContent.parse(s.draft.content);
  const tr = s.draft.translations as Translations;
  const findings = evaluateCompleteness(draft, { hasPhoto: s.photos.length > 0, group: s.group, rules });
  const latest = s.versions[0];
  const lastPublished = s.publications[0];
  const lastPublishedVersion = lastPublished ? s.versions.find((v) => v.id === lastPublished.versionId) : null;
  const latestApproved = s.versions.find((v) => v.approvals.some((a) => a.kind === "APPROVE") || v.formattingOnlyFromId);
  const draftChangedSinceApproval = latestApproved ? diffFields(ProfileContent.parse(latestApproved.contentEt), draft) : [];
  const toC = (x: unknown) => (x ? ProfileContent.parse(x) : null);

  return (
    <div>
      <StaffNav email={u.email} admin={u.role === "ADMIN"} />
      <p><a href="/haldus">← Spetsialistid</a></p>
      <h1>{s.name} <span className="badge">{WORKFLOW_LABELS[s.workflowState]}</span></h1>

      {s.tasks.length > 0 && <div className="card" style={{ borderColor: "#e0b45c" }}>
        <h2 style={{ marginTop: 0 }}>Avatud ülesanded</h2>
        <ul>{s.tasks.map((t) => <li key={t.id}>{TASK_LABELS[t.type] ?? t.type} {t.details ? <span className="muted">{JSON.stringify(t.details)}</span> : null} <form action={A.taskDoneAction.bind(null, t.id)} style={{ display: "inline" }}><button className="small secondary">Lahendatud</button></form></li>)}</ul>
      </div>}

      {draftChangedSinceApproval.length > 0 && latestApproved && <div className="notice warn"><strong>Arst on profiili muutnud</strong> pärast versiooni {latestApproved.number} kinnitamist. Muudetud väljad: {draftChangedSinceApproval.map((d) => FIELD_LABELS[d.field]).join(", ")}.</div>}

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Andmed</h2>
          <form action={A.updateSpecialistAction.bind(null, s.id)}>
            <label htmlFor="n">Nimi</label><input id="n" name="name" defaultValue={s.name} />
            <label htmlFor="e">E-post (kontrollitud, ei avaldata)</label><input id="e" name="email" type="email" defaultValue={s.contactEmail} />
            <label htmlFor="g">Spetsialistirühm</label><input id="g" name="group" defaultValue={s.group} />
            <label htmlFor="r">Vastutav haldur</label><select id="r" name="responsible" defaultValue={s.responsibleId ?? ""}><option value="">—</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <label style={{ fontWeight: 400 }}><input type="checkbox" name="archived" defaultChecked={s.archived} /> Arhiveeritud</label>
            <p><button className="small">Salvesta</button></p>
          </form>
          <p>Viimane arsti ülevaatus: <strong>{s.lastDoctorReviewAt ? fmt(s.lastDoctorReviewAt) : "Kinnitamise aeg teadmata"}</strong> {reviewDue(s.lastDoctorReviewAt, months) === "due" && <span className="badge warn">ülevaatus tähtaja ületanud ({months} kuud)</span>}</p>
          <h3>Täielikkus</h3>
          {findings.length ? <ul>{findings.map((f, i) => <li key={i}><span className={`badge ${f.level === "observation" ? "" : "err"}`}>{f.level === "missing" ? "puudu" : f.level === "suspect" ? "kahtlane" : "tähelepanek"}</span> {f.reason}</li>)}</ul> : <p className="badge ok">Põhiväljad olemas</p>}
          <p className="hint">Reeglid hindavad ainult sisu olemasolu, mitte kvalifikatsiooni ega väidete õigsust.</p>
        </div>
        <InvitePanel specialistId={s.id} invites={s.invites.map((i) => ({ id: i.id, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString(), revokedAt: i.revokedAt?.toISOString() ?? null, sentMarkedAt: i.sentMarkedAt?.toISOString() ?? null, lastUsedAt: i.lastUsedAt?.toISOString() ?? null, lockedAt: i.lockedAt?.toISOString() ?? null, purpose: i.purpose }))} />
      </div>

      <PublishDesk
        specialistId={s.id}
        workflowState={s.workflowState}
        publicUrls={s.publicUrls as Record<string, string>}
        versions={s.versions.map((v) => ({
          id: v.id, number: v.number, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy, formattingOnly: !!v.formattingOnlyFromId,
          et: ProfileContent.parse(v.contentEt), en: toC(v.contentEn), ru: toC(v.contentRu), photoVersionId: v.photoVersionId,
          approvals: v.approvals.map((a) => ({ kind: a.kind, approverName: a.approverName, approverRole: a.approverRole, createdAt: a.createdAt.toISOString(), languages: a.languages, statement: a.statement, statementVersion: a.statementVersion, photoVersionId: a.photoVersionId })),
          published: v.publications.map((p) => ({ at: p.publishedAt.toISOString(), by: p.publishedBy })),
        }))}
        lastPublished={lastPublishedVersion ? { number: lastPublishedVersion.number, et: ProfileContent.parse(lastPublishedVersion.contentEt), en: toC(lastPublishedVersion.contentEn), ru: toC(lastPublishedVersion.contentRu), photoVersionId: lastPublishedVersion.photoVersionId } : null}
      />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Töökoopia (mustand)</h2>
        <p className="hint">Mustandi muutmine ei mõjuta kinnitatud ega avaldatud versioone. Halduri sisuline muudatus vajab arsti uut kinnitust.</p>
        <div className="row">
          {(["en", "ru"] as const).map((l) => <span key={l} className={`badge ${translationStatus(tr[l], draft) === "fresh" ? "ok" : "warn"}`}>{l.toUpperCase()}: {{ fresh: "ajakohane", stale: "aegunud", missing: "puudub" }[translationStatus(tr[l], draft)]}{tr[l]?.manuallyEdited ? " · käsitsi parandatud" : ""}{tr[l]?.helpRequested ? " · abi palutud" : ""}</span>)}
        </div>
        <div className="grid2">
          <ProfilePreview content={draft} lang="et" photoUrl={s.draft.selectedPhotoId ? `/api/photo/${s.draft.selectedPhotoId}` : null} />
          <div>
            <h3>Väljade päritolu</h3>
            <table><thead><tr><th>Väli</th><th>Allikas</th><th>Väljavõte</th><th>Aeg</th></tr></thead>
              <tbody>{s.provenance.map((p) => <tr key={p.id}><td>{FIELD_LABELS[p.field] ?? p.field}</td><td>{p.source}{p.sourceRef ? ` (${p.sourceRef})` : ""}</td><td>{p.excerpt ?? ""}</td><td>{fmt(p.createdAt)}</td></tr>)}</tbody></table>
            <h3>Impordid</h3>
            <ul>{s.imports.map((i) => <li key={i.id}>{i.kind === "CV_FILE" ? `CV-fail ${i.filename}` : "Vabatekst"} – {fmt(i.createdAt)} <span className="muted">(faili ei säilitata)</span></li>)}</ul>
            {s.conflicts.length > 0 && <p className="notice warn">{s.conflicts.length} lahendamata impordi vastuolu (arst lahendab oma vaates).</p>}
          </div>
        </div>
        <DraftEditor specialistId={s.id} initial={draft} revision={s.draft.revision} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Fotod</h2>
        <div className="row" style={{ alignItems: "flex-start" }}>
          {s.photos.map((p) => (
            <figure key={p.id} style={{ width: 170, margin: 0 }}>
              <img className="photo" src={`/api/photo/${p.id}?w=340`} alt={`${p.kind} foto`} loading="lazy" />
              <figcaption className="hint">{p.kind === "ORIGINAL" ? "Originaal" : p.kind === "PROFESSIONAL" ? "Professionaalne" : "Töödeldud"} · {p.width}×{p.height}<br />{fmt(p.createdAt)}{p.approvedAt && <><br /><span className="badge ok">arsti kinnitatud</span></>}{s.draft!.selectedPhotoId === p.id && <> <span className="badge">valitud</span></>}{(p.settings as { testMode?: boolean })?.testMode && <> <span className="badge warn">TESTREŽIIM</span></>}</figcaption>
            </figure>
          ))}
          {!s.photos.length && <p className="muted">Fotot pole.</p>}
        </div>
        <ProPhotoUpload specialistId={s.id} />
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Sisemised märkused</h2>
          <form action={A.addNoteAction.bind(null, s.id)}><label htmlFor="note">Uus märkus (arstile ei näidata)</label><textarea id="note" name="text" /><p><button className="small">Lisa</button></p></form>
          <ul>{s.notes.map((n) => <li key={n.id}><span className="muted">{fmt(n.createdAt)} · {n.author}:</span> {n.text}</li>)}</ul>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Tegevuste ajalugu</h2>
          <ul style={{ maxHeight: 320, overflow: "auto" }}>{s.activities.map((a) => <li key={a.id}><span className="muted">{fmt(a.createdAt)}</span> {a.actor}: {a.action}</li>)}</ul>
          <h3>Taustatööd</h3>
          <ul>{s.jobs.map((j) => <li key={j.id}>{j.type}: {j.status}{j.stage ? ` (${j.stage})` : ""}{j.durationMs ? ` · ${(j.durationMs / 1000).toFixed(1)} s` : ""}{j.error ? <span className="badge err">{j.error}</span> : null}</li>)}</ul>
        </div>
      </div>
      <p className="hint">Avaliku veebi kontroll: pole selles versioonis seadistatud.</p>
    </div>
  );
}
