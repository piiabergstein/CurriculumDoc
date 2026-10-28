"use client";
import { useState } from "react";
import ProfileForm from "../../../../components/ProfileForm";
import ProfilePreview from "../../../../components/ProfilePreview";
import { toPlainText, toCleanHtml, publicSections, diffFields, FIELD_LABELS, type ProfileContent, type Lang } from "../../../../lib/profile";
import * as A from "../../actions";

const LANG_NAME: Record<Lang, string> = { et: "eesti", en: "inglise", ru: "vene" };
const fmt = (s: string) => new Date(s).toLocaleString("et-EE", { timeZone: "Europe/Tallinn" });

/** Kopeerimine: lõikelaua API → execCommand varulahendus → käsitsi kopeerimise aken. */
async function copy(text: string, setMsg: (s: string) => void, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    setMsg(`Kopeeritud: ${label}`);
    return;
  } catch {}
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  if (ok) { setMsg(`Kopeeritud: ${label}`); return; }
  showManualCopy(text, label);
  setMsg("Brauser ei lubanud automaatset kopeerimist – tekst avati eraldi aknas, vajuta Ctrl+C.");
}

function showManualCopy(text: string, label: string) {
  document.getElementById("manual-copy")?.remove();
  const box = document.createElement("div");
  box.id = "manual-copy";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", `Kopeeri: ${label}`);
  box.style.cssText = "position:fixed;inset:10% 5% auto 5%;z-index:50;background:#fff;border:2px solid var(--accent);border-radius:12px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);max-width:800px;margin:0 auto";
  const h = document.createElement("p");
  h.textContent = `${label} – tekst on valitud, vajuta Ctrl+C (Macis Cmd+C).`;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.readOnly = true;
  ta.style.cssText = "width:100%;min-height:240px";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Sulge";
  close.onclick = () => box.remove();
  box.append(h, ta, close);
  document.body.appendChild(box);
  ta.focus();
  ta.select();
}

type Invite = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; sentMarkedAt: string | null; lastUsedAt: string | null; lockedAt: string | null; purpose: string };
export function InvitePanel({ specialistId, invites }: { specialistId: string; invites: Invite[] }) {
  const [mail, setMail] = useState<{ code: string; email: string; text: string; subject: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const cur = invites.find((i) => !i.revokedAt);
  const create = async (purpose: "invite" | "review") => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await A.createInviteAction(specialistId, purpose);
      if (r.ok) setMail(r); else setErr(r.error);
    } catch (e) {
      setErr(`Kutse loomine ebaõnnestus: ${e instanceof Error ? e.message : "ühenduse viga"}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Kutse ja meeldetuletus</h2>
      <p className="hint">Manuaalne režiim: süsteem ei saada kirju. Loo kood, kopeeri kiri ja saada see oma e-postist kontrollitud aadressile.</p>
      {cur && <p>Aktiivne kood loodud {fmt(cur.createdAt)}, kehtib kuni {fmt(cur.expiresAt)}. {cur.sentMarkedAt ? `Märgitud saadetuks ${fmt(cur.sentMarkedAt)}.` : <span className="badge warn">saatmata</span>} {cur.lastUsedAt && `Viimati kasutatud ${fmt(cur.lastUsedAt)}.`} {cur.lockedAt && <span className="badge err">lukus (liiga palju valesid katseid)</span>}</p>}
      <div className="row">
        <button type="button" className="small" disabled={busy} onClick={() => create("invite")}>{cur ? "Loo uus kood (vana tühistub)" : "Loo kutse"}</button>
        <button type="button" className="small secondary" disabled={busy} onClick={() => create("review")}>„Vaata profiil üle“ kutse</button>
        {cur && <button type="button" className="small danger" onClick={() => confirm("Tühistada kood ja lõpetada arsti sessioonid?") && A.revokeInvitesAction(specialistId)}>Tühista kood</button>}
      </div>
      {busy && <p role="status" className="muted">Loon koodi…</p>}
      {err && <p role="alert" className="notice err">{err}</p>}
      {mail && (
        <div className="notice" style={{ marginTop: 12 }}>
          <p><strong>Kood: {mail.code}</strong> – näidatakse ainult praegu. Adressaat: <strong>{mail.email}</strong> (kontrolli enne saatmist).</p>
          <p>Teema: {mail.subject} <button type="button" className="small secondary" onClick={() => copy(mail.subject, setMsg, "teema")}>Kopeeri teema</button></p>
          <pre className="copy">{mail.text}</pre>
          <div className="row">
            <button type="button" className="small" onClick={() => copy(mail.text, setMsg, "kirja tekst")}>Kopeeri kiri</button>
            <a className="btn small secondary" href={`mailto:${encodeURIComponent(mail.email)}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.text)}`}>Ava e-posti programmis</a>
            <button type="button" className="small secondary" onClick={async () => { await A.markInviteSentAction(specialistId); setMsg("Märgitud saadetuks."); }}>Märgi saadetuks</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className="notice ok">{msg}</p>}
      {invites.length > 1 && <details><summary>Varasemad koodid</summary><ul>{invites.map((i) => <li key={i.id}>{fmt(i.createdAt)} · {i.purpose} · {i.revokedAt ? "tühistatud" : "aktiivne"}{i.sentMarkedAt ? " · saadetud" : ""}</li>)}</ul></details>}
    </div>
  );
}

type V = { id: string; number: number; createdAt: string; createdBy: string; formattingOnly: boolean; et: ProfileContent; en: ProfileContent | null; ru: ProfileContent | null; photoVersionId: string | null; approvals: { kind: string; approverName: string; approverRole: string; createdAt: string; languages: string[]; statement: string; statementVersion: string; photoVersionId: string | null }[]; published: { at: string; by: string }[] };

export function PublishDesk({ specialistId, workflowState, versions, lastPublished, publicUrls }: { specialistId: string; workflowState: string; versions: V[]; lastPublished: { number: number; et: ProfileContent; en: ProfileContent | null; ru: ProfileContent | null; photoVersionId: string | null } | null; publicUrls: Record<string, string> }) {
  const approved = versions.filter((v) => v.approvals.some((a) => a.kind === "APPROVE") || v.formattingOnly);
  const [vid, setVid] = useState(approved[0]?.id ?? "");
  const [lang, setLang] = useState<Lang>("et");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const v = approved.find((x) => x.id === vid);
  if (!v) return <div className="card"><h2 style={{ marginTop: 0 }}>Avaldamistöölaud</h2><p className="muted">Arsti kinnitatud versiooni veel pole.</p></div>;
  const content = v[lang];
  const approval = v.approvals.find((a) => a.kind === "APPROVE");
  const label = `${LANG_NAME[lang]} keel, versioon ${v.number}`;
  const diff = lastPublished && content ? diffFields(lastPublished[lang], content) : null;
  return (
    <div className="card" style={{ borderColor: "var(--accent)" }}>
      <h2 style={{ marginTop: 0 }}>Avaldamistöölaud</h2>
      <div className="row">
        <label htmlFor="ver" style={{ margin: 0 }}>Versioon</label>
        <select id="ver" value={vid} onChange={(e) => setVid(e.target.value)} style={{ width: "auto" }}>{approved.map((x) => <option key={x.id} value={x.id}>v{x.number} · {fmt(x.createdAt)}{x.formattingOnly ? " · vormistusparandus" : ""}{x.published.length ? " · avaldatud" : ""}</option>)}</select>
        {approval && <span className="hint">Arst kinnitas {fmt(approval.createdAt)} ({approval.approverName}, {approval.approverRole}); keeled: {approval.languages.join(", ").toUpperCase()}; sõnastus {approval.statementVersion}</span>}
      </div>
      <div className="tabs" role="tablist" style={{ marginTop: 12 }}>
        {(["et", "en", "ru"] as const).map((l) => <button key={l} role="tab" type="button" aria-selected={lang === l} onClick={() => setLang(l)}>{LANG_NAME[l]}{!v[l] ? " (kinnitamata)" : ""}</button>)}
      </div>
      {!content ? <p className="notice warn">Seda keelt arst selles versioonis ei kinnitanud – kopeerida ei saa.</p> : (
        <div className="grid2">
          <ProfilePreview content={content} lang={lang} photoUrl={v.photoVersionId ? `/api/photo/${v.photoVersionId}` : null} />
          <div>
            <h3>Kopeeri – {label}</h3>
            <div className="row">
              <button type="button" className="small" onClick={() => copy(toPlainText(content, lang), setMsg, `kogu profiil, lihttekst (${label})`)}>Kogu profiil · lihttekst</button>
              <button type="button" className="small" onClick={() => copy(toCleanHtml(content, lang), setMsg, `kogu profiil, HTML (${label})`)}>Kogu profiil · HTML</button>
              <button type="button" className="small secondary" onClick={() => copy(content.name, setMsg, `nimi (${label})`)}>Nimi</button>
            </div>
            <h3>Jaotised</h3>
            {publicSections(content, lang).map((sec) => (
              <div key={sec.key} className="row" style={{ marginBottom: 6 }}>
                <span className="grow">{sec.title}</span>
                <button type="button" className="small secondary" onClick={() => copy(toPlainText(content, lang, sec.key).replace(/^.*\n/, ""), setMsg, `${sec.title} (${label})`)}>Tekst</button>
                <button type="button" className="small secondary" onClick={() => copy(toCleanHtml(content, lang, sec.key).replace(/^<h3>.*<\/h3>\n/, ""), setMsg, `${sec.title} HTML (${label})`)}>HTML</button>
              </div>
            ))}
            <h3>Foto</h3>
            {v.photoVersionId ? <button type="button" className="small" onClick={async () => { window.location.href = await A.signedPhotoLinkAction(v.photoVersionId!); }}>Laadi alla kinnitatud foto (v{v.number})</button> : <p className="muted">Selles versioonis kinnitatud fotot pole.</p>}
            {msg && <p role="status" className="notice ok">{msg}</p>}
          </div>
        </div>
      )}
      <h3>Erinevus viimati avaldatud versiooniga</h3>
      {!lastPublished ? <p className="muted">Varem avaldatuks märgitud versiooni pole.</p> : !diff ? null : diff.length === 0 ? <p>Sisu ({LANG_NAME[lang]}) on sama mis avaldatud versioonis v{lastPublished.number}.</p> : (
        <table><thead><tr><th>Väli</th><th>Avaldatud v{lastPublished.number}</th><th>See versioon</th></tr></thead>
          <tbody>{diff.map((d) => <tr key={d.field}><td>{FIELD_LABELS[d.field]}</td><td className="diff-del">{render(d.before)}</td><td className="diff-add">{render(d.after)}</td></tr>)}</tbody></table>
      )}
      {lastPublished && lastPublished.photoVersionId !== v.photoVersionId && <p className="notice warn">Foto erineb avaldatud versioonist.</p>}

      <h3>Toimingud</h3>
      <div className="row">
        {workflowState === "MARKETING_REVIEW" && <button type="button" className="small" onClick={() => A.readyAction(specialistId)}>Märgi valmis käsitsi avaldamiseks</button>}
        <button type="button" className="small secondary" onClick={() => setEditing(!editing)}>{editing ? "Sulge parandamine" : "Paranda teksti"}</button>
      </div>
      {editing && <VersionEditor specialistId={specialistId} v={v} onDone={(t) => { setMsg(t); setEditing(false); }} />}
      <form action={A.returnAction.bind(null, specialistId)} className="entry">
        <label htmlFor="ret">Tagasta arstile parandamiseks (põhjus)</label><textarea id="ret" name="note" required style={{ minHeight: 60 }} />
        <button className="small secondary">Tagasta</button>
      </form>
      <form action={A.publishAction.bind(null, specialistId, v.id)} className="entry">
        <p><strong>Märgi versioon v{v.number} veebis avaldatuks</strong> (tee seda pärast käsitsi avaldamist). Lisa avalikud URL-id:</p>
        {(["et", "en", "ru"] as const).map((l) => <div key={l}><label htmlFor={`url-${l}`}>URL ({LANG_NAME[l]})</label><input id={`url-${l}`} name={l} type="url" defaultValue={publicUrls?.[l] ?? ""} /></div>)}
        <p><button className="small">Märgi avaldatuks</button></p>
      </form>
      <details><summary>Kinnituste ja avaldamiste ajalugu</summary>
        <ul>{versions.map((x) => <li key={x.id}>v{x.number} ({fmt(x.createdAt)}, {x.createdBy}){x.formattingOnly ? " – halduri vormistusparandus" : ""}: {x.approvals.map((a) => `${a.kind === "STILL_VALID" ? "„endiselt õige“" : "kinnitus"} ${fmt(a.createdAt)} ${a.approverName}`).join("; ") || "kinnitamata"}{x.published.map((p) => `; avaldatuks märgitud ${fmt(p.at)} (${p.by})`).join("")}</li>)}</ul>
      </details>
    </div>
  );
}

const render = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));

function VersionEditor({ specialistId, v, onDone }: { specialistId: string; v: V; onDone: (msg: string) => void }) {
  const [et, setEt] = useState(v.et);
  const [en, setEn] = useState(v.en);
  const [ru, setRu] = useState(v.ru);
  return (
    <div className="entry">
      <p className="hint">Puhas vormistusparandus (tühikud, kirjavahemärgid, suurtähed) luuakse uue versioonina ilma uue kinnituseta. Sisuline muudatus saadab profiili arstile uuesti kinnitamiseks.</p>
      {([["et", et, setEt], ["en", en, setEn], ["ru", ru, setRu]] as const).map(([l, c, set]) => c && (
        <div key={l}>
          <label htmlFor={`ve-${l}`}>Tutvustus ({LANG_NAME[l]})</label>
          <textarea id={`ve-${l}`} value={c.description} onChange={(e) => (set as (x: ProfileContent) => void)({ ...c, description: e.target.value })} />
          <label htmlFor={`vt-${l}`}>Tag'id ({LANG_NAME[l]}), komaga</label>
          <input id={`vt-${l}`} value={c.tags.join(", ")} onChange={(e) => (set as (x: ProfileContent) => void)({ ...c, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
        </div>
      ))}
      <button type="button" className="small" onClick={async () => { const r = await A.managerEditAction(specialistId, v.id, { et, en, ru }); onDone(r.needsApproval ? "Sisuline muudatus – profiil saadeti arstile uuesti kinnitamiseks. Saada arstile kutse." : "Vormistusparandus salvestati uue versioonina."); }}>Salvesta parandus</button>
    </div>
  );
}

export function ProPhotoUpload({ specialistId }: { specialistId: string }) {
  const [msg, setMsg] = useState("");
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await A.uploadProfessionalPhotoAction(specialistId, new FormData(e.currentTarget)); setMsg(r.ok ? "Professionaalne foto lisatud. Arst peab selle kinnitama." : r.error ?? "Viga"); }}>
      <label htmlFor="pro">Lisa professionaalselt töödeldud foto</label>
      <input id="pro" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required />
      <p><button className="small secondary">Lae üles</button> {msg && <span role="status">{msg}</span>}</p>
    </form>
  );
}

export function DraftEditor({ specialistId, initial, revision }: { specialistId: string; initial: ProfileContent; revision: number }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState(initial);
  const [rev, setRev] = useState(revision);
  const [msg, setMsg] = useState("");
  if (!open) return <button type="button" className="small secondary" onClick={() => setOpen(true)}>Muuda mustandit (nt tag'ide ühtlustamine)</button>;
  return (
    <div>
      <ProfileForm value={c} onChange={setC} />
      <button type="button" onClick={async () => { const r = await A.managerDraftEditAction(specialistId, c, rev); if (r.ok) { setRev(r.revision!); setMsg(r.needsApproval ? "Salvestatud. Sisuline muudatus – profiil suunati arstile uuesti kinnitamiseks; saada arstile kutse." : "Muudatusi polnud."); } else setMsg(r.error!); }}>Salvesta mustand</button>
      {msg && <p role="status" className="notice">{msg}</p>}
    </div>
  );
}
