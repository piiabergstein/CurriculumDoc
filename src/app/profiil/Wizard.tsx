"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ProfileForm from "../../components/ProfileForm";
import ProfilePreview from "../../components/ProfilePreview";
import { APPROVAL_STATEMENT, FIELD_LABELS, type ProfileContent } from "../../lib/profile";
import * as A from "./actions";
import type { DoctorState } from "./actions";

const STEPS = ["Tutvustus", "Ülevaatus", "Täiendamine", "Foto", "AI-töötlus", "Eelvaade", "Kinnitus"];
const JOB_LABEL: Record<string, string> = { import: "Andmete lugemine", process: "Teksti korrastamine ja tõlkimine", photo: "Foto töötlus" };
const photoUrl = (id: string) => `/api/photo/${id}`;

export default function Wizard({ initial }: { initial: DoctorState }) {
  const [s, setS] = useState(initial);
  const [content, setContent] = useState<ProfileContent>(initial.draft.content);
  const [revision, setRevision] = useState(initial.draft.revision);
  const [step, setStepRaw] = useState(initial.draft.wizardStep);
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content), revRef = useRef(revision);
  contentRef.current = content; revRef.current = revision;

  const refresh = useCallback(async () => {
    const n = await A.loadState();
    setS(n);
    if (!dirty.current && n.draft.revision !== revRef.current) { setContent(n.draft.content); setRevision(n.draft.revision); }
    return n;
  }, []);

  const flush = useCallback(async () => {
    if (!dirty.current) return true;
    setSave("saving");
    const r = await A.saveDraftAction(contentRef.current, revRef.current);
    if (r.ok) { dirty.current = false; setRevision(r.revision); setSave("saved"); return true; }
    setSave("error");
    setMsg({ kind: "err", text: r.error });
    return false;
  }, []);

  const change = (v: ProfileContent) => {
    setContent(v); dirty.current = true; setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1200);
  };

  // jooksvate tööde ajal küsi olekut
  const active = s.jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [active, refresh]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const go = async (n: number) => {
    if (!(await flush())) return;
    setMsg(null); setStepRaw(n); A.saveStepAction(n); window.scrollTo(0, 0);
    document.getElementById("step-title")?.focus();
  };
  const act = async (p: Promise<{ ok: boolean; error?: string }>, okText?: string) => {
    const r = await p;
    setMsg(r.ok ? (okText ? { kind: "ok", text: okText } : null) : { kind: "err", text: r.error ?? "Viga" });
    await refresh();
    return r.ok;
  };

  const lastJob = (type: string) => s.jobs.find((j) => j.type === type);
  const originals = s.photos.filter((p) => p.kind === "ORIGINAL" || p.kind === "PROFESSIONAL");
  const processed = s.photos.filter((p) => p.kind === "PROCESSED");

  return (
    <div>
      <nav className="top" aria-label="Profiil">
        <strong>Meliva profiil · {s.specialist.name}</strong>
        <span className="save-state" aria-live="polite">{{ saved: "✓ Salvestatud", dirty: "Muudatused salvestamata…", saving: "Salvestan…", error: "⚠ Salvestamine ebaõnnestus" }[save]}</span>
        <form action={A.logoutAction} style={{ marginLeft: "auto" }}><button className="secondary small">Logi välja</button></form>
      </nav>
      <ol className="steps" aria-label="Edenemine">
        {STEPS.map((t, i) => <li key={t} aria-current={step === i + 1 ? "step" : undefined}><button type="button" onClick={() => go(i + 1)} style={{ all: "unset", cursor: "pointer" }}>{i + 1}. {t}</button></li>)}
      </ol>
      <h1 id="step-title" tabIndex={-1}>{step}. {STEPS[step - 1]}</h1>
      {msg && <p className={`notice ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</p>}
      <Jobs jobs={s.jobs} onRetry={(id) => act(A.retryJobAction(id))} />

      {step === 1 && (
        <div className="card">
          <p>Tere! Siin saad koostada või uuendada oma profiili Meliva kodulehe jaoks. Võid igal ajal katkestada – kõik salvestub automaatselt ja saad sama koodiga hiljem jätkata.</p>
          <ul>
            <li>Andmeid kasutatakse ainult Sinu avaliku profiili jaoks. Turunduse kontaktandmeid ei avaldata.</li>
            <li>Teksti korrastab ja tõlgib AI ainult Sinu esitatud faktide põhjal. Kõik muudatused on nähtavad.</li>
            <li>Midagi ei avaldata enne, kui oled sisu ja foto kinnitanud ning turundus selle käsitsi veebi lisab.</li>
            <li>Palun ära lisa patsientide andmeid.</li>
          </ul>
          {s.latestVersion && (
            <div className="notice">
              <p>Sinu viimane kinnitatud profiil (versioon {s.latestVersion.number}, {new Date(s.latestVersion.createdAt).toLocaleDateString("et-EE")}). Kui info on endiselt õige, saad seda kinnitada ilma muudatusteta.</p>
              <button type="button" className="secondary" onClick={() => act(A.stillValidAction(), "Aitäh! Kinnitasid, et info on endiselt õige.")}>Info on endiselt õige</button>
            </div>
          )}
          <p><button type="button" onClick={() => go(2)}>Alusta</button></p>
        </div>
      )}

      {step === 2 && (
        <div>
          <Conflicts s={s} act={act} />
          <div className="card"><p>Siin on seni olemas olev info. Vaata see üle – järgmises sammus saad täiendada või parandada üksikuid välju. Kogu CV-d ei pea uuesti sisestama.</p>
            <ProfilePreview content={content} lang="et" /></div>
          <Nav back={() => go(1)} next={() => go(3)} />
        </div>
      )}

      {step === 3 && (
        <div>
          <Conflicts s={s} act={act} />
          <Imports s={s} act={act} />
          <ProfileForm value={content} onChange={change} provenance={s.draft.fieldMeta} />
          <Nav back={() => go(2)} next={() => go(4)} />
        </div>
      )}

      {step === 4 && (
        <div>
          <div className="card">
            <p>Lae üles portreefoto, kus nägu on selgelt nähtav. Töötluse käigus ühtlustatakse taust, valgus ja kadreering. Näojooni ei muudeta.</p>
            <form onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const r = await A.uploadPhotoAction(fd); setMsg(r.ok ? { kind: "ok", text: `Foto laaditi üles, töötlus algas. ${r.note ?? ""}` } : { kind: "err", text: `${r.error} ${"problems" in r ? r.problems.join(" ") : ""}` }); refresh(); e.currentTarget.reset(); }}>
              <label htmlFor="photo">{originals.length ? "Asenda originaal" : "Vali foto"}</label>
              <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic" required />
              <p><button>Lae üles</button></p>
            </form>
          </div>
          {originals.map((o) => {
            const children = processed.filter((p) => p.parentId === o.id);
            return (
              <div className="card" key={o.id}>
                <div className="grid2">
                  <figure><img className="photo" src={photoUrl(o.id)} alt="Originaalfoto" /><figcaption>{o.kind === "PROFESSIONAL" ? "Professionaalne foto (haldurilt)" : "Originaal"}</figcaption></figure>
                  <div>
                    {children.length === 0 && <p className="muted">Töödeldud versiooni veel pole.</p>}
                    {children.map((p, i) => (
                      <figure key={p.id} style={{ margin: "0 0 12px" }}>
                        <img className="photo" src={photoUrl(p.id)} alt={`Töödeldud versioon ${i + 1}`} />
                        <figcaption className="row">
                          Versioon {i + 1}{(p.settings as { clothing?: boolean })?.clothing ? " · tööriietus muudetud (AI)" : ""}{(p.settings as { testMode?: boolean })?.testMode ? " · TESTREŽIIM" : ""}
                          {s.draft.selectedPhotoId === p.id ? <span className="badge ok">Valitud</span> : <button type="button" className="small" onClick={() => act(A.selectPhotoAction(p.id), "Foto valitud.")}>Vali see foto</button>}
                        </figcaption>
                      </figure>
                    ))}
                    {o.kind === "PROFESSIONAL" && (s.draft.selectedPhotoId === o.id ? <span className="badge ok">Valitud</span> : <button type="button" className="small" onClick={() => act(A.selectPhotoAction(o.id))}>Vali see foto</button>)}
                    {o.kind === "ORIGINAL" && <div className="row">
                      <button type="button" className="secondary small" disabled={children.length >= s.maxRegenerations} onClick={() => act(A.processPhotoAction(o.id, false))}>Genereeri uuesti</button>
                      <button type="button" className="secondary small" disabled={children.length >= s.maxRegenerations} onClick={() => confirm("Tööriietus muudetakse generatiivse AI abil. Näojooned peavad jääma samaks – kontrolli tulemust hoolikalt. Jätkan?") && act(A.processPhotoAction(o.id, true))}>Muuda tööriietus (AI)</button>
                      <span className="muted">{children.length}/{s.maxRegenerations} genereerimist</span>
                    </div>}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="card"><button type="button" className="secondary" onClick={() => { const n = prompt("Millist abi foto osas vajad?") ?? ""; act(A.photoHelpAction(n), "Haldur sai teate ja võtab ühendust."); }}>Palun halduri abi fotoga</button></div>
          <Nav back={() => go(3)} next={() => go(5)} />
        </div>
      )}

      {step === 5 && (
        <div>
          <div className="card">
            <p>AI korrastab eestikeelse teksti (kirjavead, vormistus, kordused{content.wantsGeneratedIntro ? ", tutvustus Sinu andmete põhjal" : ""}) ning loob inglise- ja venekeelse versiooni. Uusi fakte ei lisata.</p>
            <button type="button" disabled={active} onClick={async () => { if (await flush()) act(A.startProcessingAction()); }}>{s.draft.aiResult ? "Töötle uuesti" : "Alusta töötlust"}</button>
          </div>
          <AiResult r={s.draft.aiResult} />
          <Nav back={() => go(4)} next={() => go(6)} />
        </div>
      )}

      {step === 6 && <Languages s={s} content={content} act={act} />}
      {step === 6 && <Nav back={() => go(5)} next={() => go(7)} />}

      {step === 7 && <Approve s={s} content={content} act={act} back={() => go(6)} flush={flush} />}
    </div>
  );
}

type Act = (p: Promise<{ ok: boolean; error?: string }>, okText?: string) => Promise<boolean>;

function Nav({ back, next }: { back: () => void; next: () => void }) {
  return <div className="row" style={{ justifyContent: "space-between" }}><button type="button" className="secondary" onClick={back}>← Tagasi</button><button type="button" onClick={next}>Edasi →</button></div>;
}

function Jobs({ jobs, onRetry }: { jobs: DoctorState["jobs"]; onRetry: (id: string) => void }) {
  const shown = jobs.filter((j) => j.status !== "done" || Date.now() - new Date(j.createdAt).getTime() < 60_000).slice(0, 4);
  if (!shown.length) return null;
  return (
    <div aria-live="polite">
      {shown.map((j) => (
        <div key={j.id} className={`notice ${j.status === "failed" ? "err" : j.status === "done" ? "ok" : ""}`}>
          <strong>{JOB_LABEL[j.type] ?? j.type}:</strong>{" "}
          {j.status === "queued" && "ootab järjekorras"}
          {j.status === "running" && `käib – ${j.stage ?? "alustan"}`}
          {j.status === "done" && `valmis${j.durationMs ? ` (${(j.durationMs / 1000).toFixed(1)} s)` : ""}`}
          {j.status === "failed" && <> ebaõnnestus: {j.error} — Sinu sisestatud andmed on alles. <button type="button" className="small" onClick={() => onRetry(j.id)}>Proovi uuesti</button></>}
        </div>
      ))}
    </div>
  );
}

function Conflicts({ s, act }: { s: DoctorState; act: Act }) {
  if (!s.conflicts.length) return null;
  return (
    <div className="card" style={{ borderColor: "#e0b45c" }}>
      <h2>Vastuolulised väärtused</h2>
      <p>Imporditud info erineb olemasolevast. Midagi pole üle kirjutatud – vali, kumba kasutada.</p>
      {s.conflicts.map((c) => (
        <div className="entry" key={c.id}>
          <strong>{FIELD_LABELS[c.field] ?? c.field}</strong> <span className="muted">(allikas: {c.sourceRef}{c.excerpt ? ` – „${c.excerpt}“` : ""})</span>
          <div className="grid2"><div><p className="hint">Praegune</p><pre className="copy">{JSON.stringify(c.current, null, 1)}</pre></div><div><p className="hint">Imporditud</p><pre className="copy">{JSON.stringify(c.imported, null, 1)}</pre></div></div>
          <div className="row"><button type="button" className="secondary small" onClick={() => act(A.resolveConflictAction(c.id, "keep"))}>Jäta praegune</button><button type="button" className="small" onClick={() => act(A.resolveConflictAction(c.id, "take"))}>Kasuta imporditud</button></div>
        </div>
      ))}
    </div>
  );
}

function Imports({ s, act }: { s: DoctorState; act: Act }) {
  const [tab, setTab] = useState<"form" | "text" | "file">("form");
  const [text, setText] = useState(s.draft.freeText);
  return (
    <div className="card">
      <div className="tabs" role="tablist">
        {([["form", "Vorm"], ["text", "Kleebi tekst"], ["file", "Lae CV üles"]] as const).map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "form" && <p className="muted">Täida või paranda allolevaid välju. Muudatused salvestuvad automaatselt.</p>}
      {tab === "text" && <div>
        <label htmlFor="free">Kleebi CV või tutvustav tekst (eesti keeles)</label>
        <textarea id="free" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 200 }} />
        <p><button type="button" onClick={() => act(A.importTextAction(text), "Tekst saadeti töötlusse. Täidetakse ainult tühjad väljad; erinevused näidatakse kõrvuti.")}>Loe tekstist andmed välja</button></p>
      </div>}
      {tab === "file" && <form onSubmit={async (e) => { e.preventDefault(); await act(A.importFileAction(new FormData(e.currentTarget)), "CV saadeti töötlusse. Faili ennast ei säilitata – säilivad ainult väljaloetud andmed."); }}>
        <label htmlFor="cv">PDF, DOCX või skannitud CV (pilt), kuni 10 MB</label>
        <input id="cv" name="file" type="file" accept=".pdf,.docx,image/jpeg,image/png,image/webp" required />
        <p><button>Lae üles ja loe välja</button></p>
      </form>}
    </div>
  );
}

function AiResult({ r }: { r: Record<string, unknown> | null }) {
  if (!r) return null;
  const x = r as { changes?: { field: string; kind: string; note: string }[]; contradictions?: string[]; questions?: { field: string; question: string }[]; tagSuggestions?: { tag: string; basis: string }[]; introSkippedReason?: string; guardIssues?: string[]; keptManual?: string[]; model?: string; timings?: { polishMs: number; translateMs: number } };
  return (
    <div className="card">
      <h2>Töötluse tulemus</h2>
      <p className="muted">Teenus: {x.model}{x.timings ? ` · korrastamine ${(x.timings.polishMs / 1000).toFixed(1)} s, tõlkimine ${(x.timings.translateMs / 1000).toFixed(1)} s` : ""}</p>
      {!!x.guardIssues?.length && <div className="notice warn"><strong>AI pakkus fakte, mida sisendis polnud – need jäeti kõrvale:</strong><ul>{x.guardIssues.map((g) => <li key={g}>{g}</li>)}</ul></div>}
      {x.introSkippedReason && <p className="notice warn">Tutvustust ei koostatud: {x.introSkippedReason}</p>}
      {!!x.questions?.length && <><h3>Palun täpsusta</h3><ul>{x.questions.map((q, i) => <li key={i}><strong>{FIELD_LABELS[q.field] ?? q.field}:</strong> {q.question}</li>)}</ul></>}
      {!!x.contradictions?.length && <><h3>Tuvastatud vastuolud</h3><ul>{x.contradictions.map((c) => <li key={c}>{c}</li>)}</ul></>}
      {!!x.changes?.length && <><h3>Tehtud muudatused</h3><ul>{x.changes.map((c, i) => <li key={i}>{FIELD_LABELS[c.field] ?? c.field}: {c.note}</li>)}</ul></>}
      {!!x.tagSuggestions?.length && <><h3>Tag'ide ettepanekud</h3><p className="hint">Lisa sobivad ise sammus 3 – neid ei lisata automaatselt.</p><ul>{x.tagSuggestions.map((t) => <li key={t.tag}><strong>{t.tag}</strong> – alus: {t.basis}</li>)}</ul></>}
      {!!x.keptManual?.length && <p className="notice">Sinu käsitsi parandatud tõlkeid ({x.keptManual.join(", ")}) ei kirjutatud üle. Uus ettepanek on eelvaates eraldi nähtav.</p>}
    </div>
  );
}

function Languages({ s, content, act }: { s: DoctorState; content: ProfileContent; act: Act }) {
  const [tab, setTab] = useState<"et" | "en" | "ru" | "compare">("et");
  const [edit, setEdit] = useState<ProfileContent | null>(null);
  const tr = tab === "en" || tab === "ru" ? s.translations[tab] : null;
  const photo = s.draft.selectedPhotoId ? photoUrl(s.draft.selectedPhotoId) : null;
  return (
    <div className="card">
      <div className="tabs" role="tablist">
        {([["et", "Eesti"], ["en", "English"], ["ru", "Русский"], ["compare", "Kõrvuti"]] as const).map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => { setTab(k); setEdit(null); }}>{l}{(k === "en" || k === "ru") && s.translations[k]?.status === "stale" ? " ⚠" : ""}</button>)}
      </div>
      {tab === "et" && <ProfilePreview content={content} lang="et" photoUrl={photo} />}
      {(tab === "en" || tab === "ru") && (!tr ? <p className="notice warn">Tõlge puudub – käivita AI-töötlus sammus 5.</p> : <>
        {tr.status === "stale" && <p className="notice warn">Eestikeelset teksti on pärast tõlkimist muudetud – see tõlge on aegunud. Töötle uuesti sammus 5.</p>}
        {(tab === "en" ? s.translations.enProposal : s.translations.ruProposal) && <p className="notice">Uus AI tõlkeettepanek on olemas, kuid Sinu käsitsi parandusi ei kirjutatud üle. <button type="button" className="small" onClick={() => act(A.acceptProposalAction(tab))}>Võta uus ettepanek kasutusele</button></p>}
        {tr.helpRequested && <p className="notice">Tõlke kontrollimiseks on palutud halduri abi. See ei tähenda, et tõlge on kinnitatud.</p>}
        {edit ? <div>
          <p className="hint">Paranda tõlke tekste. Faktid (aastad, asutused) peavad vastama eestikeelsele versioonile.</p>
          <label htmlFor="tr-desc">Tutvustus</label><textarea id="tr-desc" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <label htmlFor="tr-titles">Ametinimetus(ed), üks rea kohta</label><textarea id="tr-titles" value={edit.titles.join("\n")} onChange={(e) => setEdit({ ...edit, titles: e.target.value.split("\n") })} />
          <label htmlFor="tr-add">Täiendav teave</label><textarea id="tr-add" value={edit.additionalInfo} onChange={(e) => setEdit({ ...edit, additionalInfo: e.target.value })} />
          <div className="row"><button type="button" onClick={async () => { if (await act(A.saveTranslationAction(tab, edit), "Tõlge salvestatud.")) setEdit(null); }}>Salvesta tõlge</button><button type="button" className="secondary" onClick={() => setEdit(null)}>Tühista</button></div>
        </div> : <>
          <ProfilePreview content={tr.content} lang={tab} photoUrl={photo} />
          <div className="row"><button type="button" className="secondary small" onClick={() => setEdit(tr.content)}>Paranda tõlget</button><button type="button" className="secondary small" onClick={() => act(A.translationHelpAction(tab), "Haldur sai teate tõlke kontrollimiseks.")}>Vajan tõlke kontrollimisel abi</button></div>
        </>}
      </>)}
      {tab === "compare" && <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        <ProfilePreview content={content} lang="et" />
        {s.translations.en && <ProfilePreview content={s.translations.en.content} lang="en" />}
        {s.translations.ru && <ProfilePreview content={s.translations.ru.content} lang="ru" />}
      </div>}
    </div>
  );
}

function Approve({ s, content, act, back, flush }: { s: DoctorState; content: ProfileContent; act: Act; back: () => void; flush: () => Promise<boolean> }) {
  const [langs, setLangs] = useState<Record<string, boolean>>({ et: false, en: false, ru: false });
  const [stmt, setStmt] = useState(false);
  const [photoOk, setPhotoOk] = useState(false);
  const [done, setDone] = useState(false);
  const photo = s.draft.selectedPhotoId;
  const missing = s.findings.filter((f) => f.level !== "observation");
  if (done) return <div className="card"><p className="notice ok">Aitäh! Profiil on kinnitatud ja edastatud turundusele ülevaatamiseks. Midagi ei avaldata automaatselt.</p></div>;
  return (
    <div>
      <p>Allpool on täpselt see sisu ja foto, mis lähevad avaldamiseks. Kinnita iga keel eraldi.</p>
      {missing.length > 0 && <div className="notice warn">Tähelepanu: {missing.map((f) => f.reason).join("; ")}.</div>}
      <div className="card">
        <h2>Foto</h2>
        {photo ? <><img className="photo" style={{ maxWidth: 260 }} src={photoUrl(photo)} alt="Avaldamiseks valitud foto" />
          <label style={{ fontWeight: 400 }}><input type="checkbox" checked={photoOk} onChange={(e) => setPhotoOk(e.target.checked)} /> Kinnitan selle foto avaldamiseks</label></> : <p className="muted">Fotot pole valitud – profiil kinnitatakse ilma fotota.</p>}
      </div>
      {(["et", "en", "ru"] as const).map((l) => {
        const c = l === "et" ? content : s.translations[l]?.content;
        const st = l === "et" ? "fresh" : s.translations[l]?.status ?? "missing";
        return (
          <div className="card" key={l}>
            <h2>{{ et: "Eesti keel", en: "Inglise keel", ru: "Vene keel" }[l]}</h2>
            {c ? <ProfilePreview content={c} lang={l} /> : null}
            {st === "fresh" ? <label style={{ fontWeight: 400 }}><input type="checkbox" checked={langs[l]} onChange={(e) => setLangs({ ...langs, [l]: e.target.checked })} /> Kinnitan {l.toUpperCase()} versiooni</label>
              : <p className="notice warn">{st === "stale" ? "Tõlge on aegunud – töötle uuesti." : "Tõlge puudub."} Seda keelt ei saa praegu kinnitada.</p>}
          </div>
        );
      })}
      <div className="card">
        <label style={{ fontWeight: 400 }}><input type="checkbox" checked={stmt} onChange={(e) => setStmt(e.target.checked)} /> {APPROVAL_STATEMENT}</label>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <button type="button" className="secondary" onClick={back}>← Tagasi</button>
          <button type="button" disabled={!stmt || !langs.et || (!!photo && !photoOk)} onClick={async () => {
            if (!(await flush())) return;
            const ok = await act(A.approveAction({ languages: (Object.keys(langs) as ("et" | "en" | "ru")[]).filter((k) => langs[k]), photoVersionId: photo && photoOk ? photo : null, statementChecked: stmt }));
            if (ok) setDone(true);
          }}>Kinnita ja saada turundusele</button>
        </div>
      </div>
    </div>
  );
}
