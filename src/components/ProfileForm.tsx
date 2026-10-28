"use client";
import { useState } from "react";
import type { ProfileContent, SectionStatus } from "../lib/profile";
import { validUrl } from "../lib/profile";

type TagSuggestResult = { ok: true; suggestions: { tag: string; basis: string }[] } | { ok: false; error: string };
type P = { value: ProfileContent; onChange: (v: ProfileContent) => void; provenance?: Record<string, { source: string; manual: boolean }>; errors?: Record<string, string>; onSuggestTags?: () => Promise<TagSuggestResult> };

const MAX_TAGS = 5;

/** AI pakub 3–4 tag'i olemasoleva info põhjal; arst lisab sobivad ükshaaval. */
function TagSuggest({ v, onSuggest, add }: { v: ProfileContent; onSuggest: () => Promise<TagSuggestResult>; add: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [list, setList] = useState<{ tag: string; basis: string }[] | null>(null);
  const full = v.tags.filter(Boolean).length >= MAX_TAGS;
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="secondary small" disabled={busy} onClick={async () => {
        setBusy(true); setErr("");
        const r = await onSuggest();
        setBusy(false);
        if (r.ok) setList(r.suggestions); else setErr(r.error);
      }}>{busy ? "AI mõtleb…" : list ? "Paku uued variandid" : "Täida olemasoleva info põhjal (AI)"}</button>
      {err && <p className="notice err" role="alert">{err}</p>}
      {list && (list.length === 0
        ? <p className="muted">Olemasoleva info põhjal ei leitud uusi teemasid. Lisa tag'id käsitsi või täienda tutvustust.</p>
        : <div aria-live="polite">
            <p className="hint">AI ettepanekud – ühtegi ei lisata ilma Sinu kinnituseta. Kontrolli, et teema kirjeldab Sinu tööd õigesti.</p>
            <ul>{list.map((s) => {
              const added = v.tags.some((t) => t.trim().toLowerCase() === s.tag.toLowerCase());
              return <li key={s.tag}><strong>{s.tag}</strong> <span className="muted">– alus: {s.basis}</span> {added ? <span className="badge ok">lisatud</span> : <button type="button" className="small" disabled={full} onClick={() => add(s.tag)}>Lisa</button>}</li>;
            })}</ul>
            {full && <p className="muted">Tag'e on juba {MAX_TAGS} – eemalda mõni, et uut lisada.</p>}
          </div>)}
    </div>
  );
}

const SRC: Record<string, string> = { FORM: "vorm", FREETEXT: "vabatekst", CV_FILE: "CV-fail", AI: "AI", MANAGER: "haldur" };
const LANGS = [["et", "eesti"], ["en", "inglise"], ["ru", "vene"], ["fi", "soome"], ["de", "saksa"], ["other", "muu"]] as const;

function Origin({ f, p }: { f: string; p?: P["provenance"] }) {
  const m = p?.[f];
  return m ? <span className="badge" title="Välja päritolu">{SRC[m.source] ?? m.source}{m.manual ? " · muudetud käsitsi" : ""}</span> : null;
}

function SectionChoice({ field, v, set }: { field: string; v: ProfileContent; set: (s: SectionStatus | undefined) => void }) {
  const cur = v.sections[field] ?? "";
  return (
    <div className="row" style={{ margin: "4px 0" }}>
      <label className="hint" htmlFor={`sec-${field}`} style={{ margin: 0 }}>Jaotise olek:</label>
      <select id={`sec-${field}`} value={cur} style={{ width: "auto" }} onChange={(e) => set((e.target.value || undefined) as SectionStatus | undefined)}>
        <option value="">sisestamata / täidan</option>
        <option value="not_applicable">ei kohaldu / puudub</option>
        <option value="no_publish">ei soovi avaldada</option>
      </select>
    </div>
  );
}

export default function ProfileForm({ value: v, onChange, provenance, errors = {}, onSuggestTags }: P) {
  const set = <K extends keyof ProfileContent>(k: K, val: ProfileContent[K]) => onChange({ ...v, [k]: val });
  const setSec = (f: string, s: SectionStatus | undefined) => {
    const sections = { ...v.sections };
    if (s) sections[f] = s; else delete sections[f];
    onChange({ ...v, sections });
  };
  const list = <K extends "education" | "experience" | "trainings" | "publications">(k: K) => ({
    add: (item: ProfileContent[K][number]) => set(k, [...(v[k] as unknown[]), item] as ProfileContent[K]),
    del: (i: number) => set(k, (v[k] as unknown[]).filter((_, j) => j !== i) as ProfileContent[K]),
    upd: (i: number, patch: object) => set(k, (v[k] as object[]).map((x, j) => (j === i ? { ...x, ...patch } : x)) as ProfileContent[K]),
  });
  const err = (f: string) => errors[f] ? <p className="notice err" id={`err-${f}`} role="alert">{errors[f]}</p> : null;
  const span = { from: "", to: "", ongoing: false, unknown: false };

  return (
    <div>
      <fieldset className="card"><legend><h3>Nimi <Origin f="name" p={provenance} /></h3></legend>
        <label htmlFor="f-name">Nimi</label>
        <input id="f-name" value={v.name} onChange={(e) => set("name", e.target.value)} aria-describedby={errors.name ? "err-name" : undefined} />{err("name")}
      </fieldset>

      <fieldset className="card"><legend><h3>Ametinimetus <Origin f="titles" p={provenance} /></h3></legend>
        <p className="hint">Vajadusel mitu. Kirjuta täpselt nii, nagu soovid seda avaldada.</p>
        {v.titles.map((t, i) => (
          <div className="row" key={i}>
            <input className="grow" aria-label={`Ametinimetus ${i + 1}`} value={t} onChange={(e) => set("titles", v.titles.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="secondary small" onClick={() => set("titles", v.titles.filter((_, j) => j !== i))}>Eemalda</button>
          </div>
        ))}
        <button type="button" className="secondary small" onClick={() => set("titles", [...v.titles, ""])}>+ Lisa ametinimetus</button>{err("titles")}
      </fieldset>

      <fieldset className="card"><legend><h3>Mis vanuses patsiente vastu võtate? <Origin f="age" p={provenance} /></h3></legend>
        <div className="row">
          {([["all", "igas vanuses"], ["from", "alates vanusest"], ["range", "vanusevahemik"]] as const).map(([m, l]) => (
            <label key={m} style={{ fontWeight: 400 }}><input type="radio" name="agemode" checked={v.age.mode === m} onChange={() => set("age", { ...v.age, mode: m })} /> {l}</label>
          ))}
        </div>
        {(v.age.mode === "from" || v.age.mode === "range") && (
          <div className="row">
            <div><label htmlFor="age-from">Alates (a)</label><input id="age-from" inputMode="numeric" value={v.age.from} onChange={(e) => set("age", { ...v.age, from: e.target.value })} /></div>
            {v.age.mode === "range" && <div><label htmlFor="age-to">Kuni (a)</label><input id="age-to" inputMode="numeric" value={v.age.to} onChange={(e) => set("age", { ...v.age, to: e.target.value })} /></div>}
          </div>
        )}
        <label htmlFor="age-note">Täpsustus (valikuline)</label>
        <input id="age-note" value={v.age.note} onChange={(e) => set("age", { ...v.age, note: e.target.value })} />
      </fieldset>

      <fieldset className="card"><legend><h3>Vastuvõtu keeled <Origin f="languages" p={provenance} /></h3></legend>
        <p className="hint">Märgi keeled, milles teed vastuvõttu. Profiili tõlkimine inglise või vene keelde ei tähenda, et vastuvõtt toimub neis keeltes.</p>
        <div className="row">
          {LANGS.map(([c, l]) => (
            <label key={c} style={{ fontWeight: 400 }}><input type="checkbox" checked={v.languages.list.includes(c)} onChange={(e) => set("languages", { ...v.languages, reviewed: true, list: e.target.checked ? [...v.languages.list, c] : v.languages.list.filter((x) => x !== c) })} /> {l}</label>
          ))}
        </div>
        {v.languages.list.includes("other") && <><label htmlFor="lang-other">Muu keel</label><input id="lang-other" value={v.languages.other} onChange={(e) => set("languages", { ...v.languages, other: e.target.value })} /></>}
      </fieldset>

      <fieldset className="card"><legend><h3>Vastuvõtu kirjeldus <Origin f="description" p={provenance} /></h3></legend>
        <p className="hint" id="desc-hint">Kirjelda lühidalt oma erialaseid huvisid, tugevusi ja kogemusi. Too välja teemad, millele oma töös keskendud, erioskused või spetsiifiline kogemus. See aitab patsiendil valida sobiva spetsialisti.</p>
        <textarea id="f-desc" maxLength={5000} aria-describedby="desc-hint" value={v.description} onChange={(e) => set("description", e.target.value)} />
        <label style={{ fontWeight: 400 }}><input type="checkbox" checked={v.wantsGeneratedIntro} onChange={(e) => set("wantsGeneratedIntro", e.target.checked)} /> Koosta minu sisestatud andmete põhjal tutvustav tekst</label>{err("description")}
      </fieldset>

      <fieldset className="card"><legend><h3>Haridus <Origin f="education" p={provenance} /></h3></legend>
        {v.education.map((e, i) => (
          <div className="entry" key={i}>
            <SpanInputs s={e} onChange={(p) => list("education").upd(i, p)} id={`edu${i}`} ongoingLabel="õpingud käivad" />
            <label htmlFor={`edu${i}-inst`}>Õppeasutus</label><input id={`edu${i}-inst`} value={e.institution} onChange={(x) => list("education").upd(i, { institution: x.target.value })} />
            <label htmlFor={`edu${i}-deg`}>Eriala / kraad</label><input id={`edu${i}-deg`} value={e.degree} onChange={(x) => list("education").upd(i, { degree: x.target.value })} />
            <button type="button" className="secondary small" onClick={() => list("education").del(i)}>Eemalda kirje</button>
          </div>
        ))}
        <button type="button" className="secondary small" onClick={() => list("education").add({ ...span, institution: "", degree: "" })}>+ Lisa hariduse kirje</button>{err("education")}
      </fieldset>

      <fieldset className="card"><legend><h3>Töökogemus <Origin f="experience" p={provenance} /></h3></legend>
        <p className="hint">Võid lisada mitu samaaegset töökohta. Kui alustad tööelu, märgi jaotis „ei kohaldu“.</p>
        <SectionChoice field="experience" v={v} set={(s) => setSec("experience", s)} />
        {v.experience.map((e, i) => (
          <div className="entry" key={i}>
            <SpanInputs s={e} onChange={(p) => list("experience").upd(i, p)} id={`exp${i}`} ongoingLabel="praeguseni" />
            <label htmlFor={`exp${i}-org`}>Organisatsioon</label><input id={`exp${i}-org`} value={e.organization} onChange={(x) => list("experience").upd(i, { organization: x.target.value })} />
            <label htmlFor={`exp${i}-pos`}>Ametikoht</label><input id={`exp${i}-pos`} value={e.position} onChange={(x) => list("experience").upd(i, { position: x.target.value })} />
            <button type="button" className="secondary small" onClick={() => list("experience").del(i)}>Eemalda kirje</button>
          </div>
        ))}
        <button type="button" className="secondary small" onClick={() => list("experience").add({ ...span, organization: "", position: "" })}>+ Lisa töökoht</button>
      </fieldset>

      <fieldset className="card"><legend><h3>Erialased koolitused <span className="muted">(valikuline)</span></h3></legend>
        <SectionChoice field="trainings" v={v} set={(s) => setSec("trainings", s)} />
        {v.trainings.map((e, i) => (
          <div className="entry row" key={i}>
            <div style={{ width: 90 }}><label htmlFor={`tr${i}-y`}>Aasta</label><input id={`tr${i}-y`} value={e.year} onChange={(x) => list("trainings").upd(i, { year: x.target.value })} /></div>
            <div className="grow"><label htmlFor={`tr${i}-t`}>Koolitus</label><input id={`tr${i}-t`} value={e.title} onChange={(x) => list("trainings").upd(i, { title: x.target.value })} /></div>
            <div className="grow"><label htmlFor={`tr${i}-o`}>Korraldaja</label><input id={`tr${i}-o`} value={e.organizer} onChange={(x) => list("trainings").upd(i, { organizer: x.target.value })} /></div>
            <button type="button" className="secondary small" onClick={() => list("trainings").del(i)}>Eemalda</button>
          </div>
        ))}
        <button type="button" className="secondary small" onClick={() => list("trainings").add({ year: "", title: "", organizer: "" })}>+ Lisa koolitus</button>
      </fieldset>

      <fieldset className="card"><legend><h3>Erialased organisatsioonid <span className="muted">(valikuline)</span></h3></legend>
        <SectionChoice field="memberships" v={v} set={(s) => setSec("memberships", s)} />
        {v.memberships.map((m, i) => (
          <div className="row" key={i}><input className="grow" aria-label={`Organisatsioon ${i + 1}`} value={m} onChange={(e) => set("memberships", v.memberships.map((x, j) => (j === i ? e.target.value : x)))} /><button type="button" className="secondary small" onClick={() => set("memberships", v.memberships.filter((_, j) => j !== i))}>Eemalda</button></div>
        ))}
        <button type="button" className="secondary small" onClick={() => set("memberships", [...v.memberships, ""])}>+ Lisa organisatsioon</button>
      </fieldset>

      <fieldset className="card"><legend><h3>Erialased tag'id <span className="muted">(valikuline, 2–5)</span></h3></legend>
        <p className="hint">Teemad, mille järgi patsient Sind leiab. Need ei ole ametlikud teenused ega kvalifikatsioonid.</p>
        <SectionChoice field="tags" v={v} set={(s) => setSec("tags", s)} />
        <label htmlFor="f-tags">Tag'id komaga eraldatult</label>
        <input id="f-tags" value={v.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((x) => x.trimStart()).slice(0, MAX_TAGS))} />
        {onSuggestTags && <TagSuggest v={v} onSuggest={onSuggestTags} add={(t) => set("tags", [...v.tags.map((x) => x.trim()).filter(Boolean), t].slice(0, MAX_TAGS))} />}
      </fieldset>

      <fieldset className="card"><legend><h3>Teadustööd, artiklid, meediakommentaarid <span className="muted">(valikuline)</span></h3></legend>
        <SectionChoice field="publications" v={v} set={(s) => setSec("publications", s)} />
        {v.publications.map((p, i) => (
          <div className="entry" key={i}>
            <label htmlFor={`pub${i}-k`}>Liik</label>
            <select id={`pub${i}-k`} value={p.kind} onChange={(x) => list("publications").upd(i, { kind: x.target.value })}><option value="research">teadustöö</option><option value="article">artikkel</option><option value="media">meediakommentaar</option></select>
            <label htmlFor={`pub${i}-t`}>Pealkiri</label><input id={`pub${i}-t`} value={p.title} onChange={(x) => list("publications").upd(i, { title: x.target.value })} />
            <label htmlFor={`pub${i}-u`}>Link</label><input id={`pub${i}-u`} type="url" value={p.url} onChange={(x) => list("publications").upd(i, { url: x.target.value })} aria-invalid={!!p.url && !validUrl(p.url)} />
            {p.url && !validUrl(p.url) && <p className="notice err">Link peab algama https:// või http://</p>}
            <div className="row"><div style={{ width: 100 }}><label htmlFor={`pub${i}-y`}>Aasta</label><input id={`pub${i}-y`} value={p.year} onChange={(x) => list("publications").upd(i, { year: x.target.value })} /></div>
              <div className="grow"><label htmlFor={`pub${i}-d`}>Kirjeldus</label><input id={`pub${i}-d`} value={p.description} onChange={(x) => list("publications").upd(i, { description: x.target.value })} /></div></div>
            <button type="button" className="secondary small" onClick={() => list("publications").del(i)}>Eemalda</button>
          </div>
        ))}
        <button type="button" className="secondary small" onClick={() => list("publications").add({ kind: "article", title: "", url: "", year: "", description: "" })}>+ Lisa</button>
      </fieldset>

      <fieldset className="card"><legend><h3>Täiendav teave <span className="muted">(valikuline)</span></h3></legend>
        <p className="hint">Kas soovid lisada teavet, mis aitab patsiendil saada enne visiiti parema ülevaate Sinu tööst ja lähenemisest? See kuvatakse profiili lõpus eraldi jaotisena „Täiendav teave“ – vaata eelvaadet.</p>
        <SectionChoice field="additionalInfo" v={v} set={(s) => setSec("additionalInfo", s)} />
        <textarea maxLength={5000} aria-label="Täiendav teave" value={v.additionalInfo} onChange={(e) => set("additionalInfo", e.target.value)} />
      </fieldset>
    </div>
  );
}

function SpanInputs({ s, onChange, id, ongoingLabel }: { s: { from: string; to: string; ongoing: boolean; unknown: boolean }; onChange: (p: object) => void; id: string; ongoingLabel: string }) {
  return (
    <div className="row">
      <div style={{ width: 100 }}><label htmlFor={`${id}-f`}>Algus</label><input id={`${id}-f`} inputMode="numeric" value={s.from} disabled={s.unknown} onChange={(e) => onChange({ from: e.target.value })} /></div>
      <div style={{ width: 100 }}><label htmlFor={`${id}-t`}>Lõpp</label><input id={`${id}-t`} inputMode="numeric" value={s.to} disabled={s.unknown || s.ongoing} onChange={(e) => onChange({ to: e.target.value })} /></div>
      <label style={{ fontWeight: 400 }}><input type="checkbox" checked={s.ongoing} onChange={(e) => onChange({ ongoing: e.target.checked })} /> {ongoingLabel}</label>
      <label style={{ fontWeight: 400 }}><input type="checkbox" checked={s.unknown} onChange={(e) => onChange({ unknown: e.target.checked })} /> aeg teadmata</label>
    </div>
  );
}
