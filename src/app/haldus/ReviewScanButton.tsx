"use client";
import { useState } from "react";
import { runReviewScanAction } from "./actions";
export default function ReviewScanButton() {
  const [n, setN] = useState<number | null>(null);
  return (
    <p className="row">
      <button type="button" className="secondary small" onClick={async () => setN(await runReviewScanAction())}>Loo ülevaatuse meeldetuletuse ülesanded</button>
      {n !== null && <span role="status">{n} uut ülesannet. Kirju ei saadeta automaatselt – saada kutse spetsialisti lehelt.</span>}
    </p>
  );
}
