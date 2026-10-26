"use client";
import { useState } from "react";
import { createUserAction } from "../actions";

export default function NewUserForm() {
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  return (
    <form className="row" style={{ marginTop: 12, alignItems: "flex-end" }} onSubmit={async (e) => { e.preventDefault(); setCreated(await createUserAction(new FormData(e.currentTarget))); e.currentTarget.reset(); }}>
      <div className="grow"><label htmlFor="un">Nimi</label><input id="un" name="name" required /></div>
      <div className="grow"><label htmlFor="ue">E-post</label><input id="ue" name="email" type="email" required /></div>
      <div><label htmlFor="ur">Roll</label><select id="ur" name="role"><option value="MANAGER">haldur</option><option value="ADMIN">administraator</option></select></div>
      <button className="small">Lisa haldur</button>
      {created && <p className="notice ok" role="status" style={{ width: "100%" }}>Loodud {created.email}. Ajutine parool (näidatakse ainult üks kord): <code>{created.password}</code>. Edasta see turvaliselt; esimesel sisselogimisel tuleb seadistada 2FA.</p>}
    </form>
  );
}
