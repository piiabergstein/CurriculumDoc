"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="card" style={{ maxWidth: 560, margin: "40px auto" }} role="alert">
      <h1>Midagi läks valesti</h1>
      <p>Teenus ei vastanud ootuspäraselt. Sinu varem salvestatud andmed on alles. Proovi mõne hetke pärast uuesti.</p>
      {error.digest && <p className="hint">Vea viide: {error.digest}</p>}
      <div className="row"><button type="button" onClick={reset}>Proovi uuesti</button><a className="btn secondary" href="/">Avalehele</a></div>
    </div>
  );
}
