import { redirect } from "next/navigation";
import { currentDoctor, doctorLogin, clientIp } from "../lib/auth";
import { rateLimit } from "../lib/ratelimit";

async function login(formData: FormData) {
  "use server";
  const ip = await clientIp();
  const email = String(formData.get("email") ?? "");
  if (!(await rateLimit(`doclogin:ip:${ip}`, 20, 900)) || !(await rateLimit(`doclogin:email:${email.toLowerCase()}`, 10, 900))) redirect("/?e=rate");
  const r = await doctorLogin(email, String(formData.get("code") ?? "").replace(/\s/g, ""));
  redirect(r.ok ? "/profiil" : "/?e=bad");
}

export default async function Home({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await currentDoctor()) redirect("/profiil");
  const { e } = await searchParams;
  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1>Sinu profiil Meliva kodulehel</h1>
      <div className="card">
        <p>Sisesta e-post, millele said kutse, ja kirjas olnud 6-kohaline kood. Parooli pole vaja.</p>
        {e === "bad" && <p className="notice err" role="alert">E-post või kood ei sobi, kood on aegunud või tühistatud. Küsi vajadusel turundusest uus kood.</p>}
        {e === "rate" && <p className="notice err" role="alert">Liiga palju katseid. Proovi 15 minuti pärast uuesti.</p>}
        <form action={login}>
          <label htmlFor="email">E-post</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="code">Kood</label>
          <input id="code" name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required />
          <p style={{ marginTop: 16 }}><button type="submit">Jätka</button></p>
        </form>
      </div>
      <details className="card">
        <summary>Kuidas Sinu andmeid kasutatakse?</summary>
        <p>Sisestatud andmeid kasutatakse ainult Sinu avaliku spetsialistiprofiili koostamiseks Meliva kodulehel. Teksti korrastamiseks ja tõlkimiseks ning foto töötlemiseks kasutatakse AI-teenuseid. Midagi ei avaldata enne, kui oled sisu ja foto ise kinnitanud ning turundus selle käsitsi veebi lisab. Ära lisa patsientide andmeid.</p>
      </details>
      <p className="muted"><a href="/haldus/login">Töötaja sisselogimine</a></p>
    </div>
  );
}
