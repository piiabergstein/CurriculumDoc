import { requireStaff } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { getSetting } from "../../../lib/service";
import { DEFAULT_RULES } from "../../../lib/profile";
import { PhotoStyle } from "../../../lib/photo";
import StaffNav from "../StaffNav";
import * as A from "../actions";
import NewUserForm from "./NewUserForm";
export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireStaff();
  const { e, ok } = await searchParams;
  const settingsMsg = e === "styles" ? "Fotostiilide JSON on vigane või sisaldab lubamatuid väärtusi – seadeid ei salvestatud." : e === "rules" ? "Täielikkuse reeglite JSON on vigane (vaja on massiive required ja observations) – seadeid ei salvestatud." : ok === "settings" ? "Seaded salvestatud." : "";
  const admin = u.role === "ADMIN";
  const services = [
    ["Tekstitöötlus, tõlge, CV/OCR (Claude)", !!process.env.ANTHROPIC_API_KEY],
    ["Tausta eemaldus (Replicate)", !!process.env.REPLICATE_API_TOKEN],
    ["Tööriietuse muutmine (Gemini)", !!process.env.GEMINI_API_KEY],
    ["E-post", false],
    ["Avaliku veebi kontroll", false],
  ] as const;
  return (
    <div>
      <StaffNav email={u.email} admin={admin} />
      <h1>{admin ? "Seaded" : "Konto"}</h1>
      <form action={A.changePasswordAction} className="card" style={{ maxWidth: 480 }}>
        <h2 style={{ marginTop: 0 }}>Muuda parooli</h2>
        {e === "pw" && <p className="notice err" role="alert">Parool peab olema vähemalt 12 märki.</p>}
        {ok === "pw" && <p className="notice ok">Parool muudetud.</p>}
        <label htmlFor="pw">Uus parool</label><input id="pw" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <p><button className="small">Salvesta</button></p>
      </form>
      {settingsMsg && <p id="seaded" className={`notice ${ok ? "ok" : "err"}`} role={ok ? "status" : "alert"}>{settingsMsg}</p>}
      {admin && <AdminSettings services={services} />}
    </div>
  );
}

async function AdminSettings({ services }: { services: readonly (readonly [string, boolean])[] }) {
  const [users, styles, rules, months, glossary] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    getSetting<Record<string, unknown>>("photoStyles", { default: PhotoStyle.parse({}) }),
    getSetting("completenessRules", DEFAULT_RULES),
    getSetting<number>("reviewMonths", 12),
    db.glossaryTerm.findMany({ orderBy: { et: "asc" } }),
  ]);
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Teenused</h2>
        <ul>{services.map(([n, on]) => <li key={n}>{n}: {on ? <span className="badge ok">seadistatud</span> : <span className="badge warn">Teenus seadistamata</span>}</li>)}</ul>
        <p className="hint">Režiim: {process.env.APP_MODE === "test" ? "TEST (märgistatud mock-teenused lubatud)" : "tootmine"}. Meeldetuletused: manuaalne režiim (automaatne saatmine pole saadaval, kuna e-posti integratsiooni pole).</p>
      </div>
      <div className="card" id="kasutajad">
        <h2 style={{ marginTop: 0 }}>Haldurid</h2>
        <table><thead><tr><th>Nimi</th><th>E-post</th><th>Roll</th><th>2FA</th><th>Olek</th><th></th></tr></thead>
          <tbody>{users.map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.email}</td><td>{x.role}</td><td>{x.totpEnabled ? "jah" : "seadistamata"}</td><td>{x.active ? "aktiivne" : "peatatud"}</td><td><form action={A.toggleUserAction.bind(null, x.id)}><button className="small secondary">{x.active ? "Peata" : "Aktiveeri"}</button></form></td></tr>)}</tbody></table>
        <NewUserForm />
      </div>
      <form action={A.saveSettingsAction} className="card">
        <h2 style={{ marginTop: 0 }}>Reeglid ja fotostiil</h2>
        <label htmlFor="months">Arsti ülevaatuse tähtaeg (kuud viimasest kinnitusest)</label>
        <input id="months" name="reviewMonths" type="number" min={1} defaultValue={months} style={{ maxWidth: 120 }} />
        <label htmlFor="rules">Täielikkuse reeglid (JSON)</label>
        <p className="hint">required = kohustuslikud põhiväljad; observations = eraldi tähelepanekud (photo, experience, languages, age); requiredByGroup = rühmapõhised lisanõuded. Valikulised jaotised ei tekita kunagi hoiatust.</p>
        <textarea id="rules" name="rules" defaultValue={JSON.stringify(rules, null, 2)} style={{ fontFamily: "monospace", minHeight: 160 }} />
        <label htmlFor="styles">Fotostiilid rühmade kaupa (JSON)</label>
        <p className="hint">Võtmed: mode (studio_ai – AI stuudioportree, vajab GEMINI_API_KEY; deterministic – ainult tausta eemaldus), background (gradiendi keskosa), backgroundEdge (gradiendi serv), brightness, saturation, warmth, aspect (3:2, 4:5, 1:1, 3:4, 2:3), width, headroom, subjectWidth, maxRegenerations, clothingPrompt, referenceNote. Need on seadistatavad väärtused, mitte ametlikud Meliva brändireeglid.</p>
        <textarea id="styles" name="photoStyles" defaultValue={JSON.stringify(styles, null, 2)} style={{ fontFamily: "monospace", minHeight: 260 }} />
        <p><button>Salvesta seaded</button></p>
      </form>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Terminisõnastik (tõlked)</h2>
        <table><thead><tr><th>ET</th><th>EN</th><th>RU</th><th></th></tr></thead>
          <tbody>{glossary.map((g) => <tr key={g.id}><td>{g.et}</td><td>{g.en}</td><td>{g.ru}</td><td><form action={A.deleteGlossaryAction.bind(null, g.id)}><button className="small secondary">Kustuta</button></form></td></tr>)}</tbody></table>
        <form action={A.addGlossaryAction} className="row" style={{ marginTop: 8 }}>
          <input name="et" aria-label="Eesti" placeholder="eesti" required style={{ flex: 1 }} /><input name="en" aria-label="Inglise" placeholder="english" required style={{ flex: 1 }} /><input name="ru" aria-label="Vene" placeholder="русский" required style={{ flex: 1 }} />
          <button className="small">Lisa</button>
        </form>
      </div>
    </>
  );
}
