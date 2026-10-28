export default function NotFound() {
  return (
    <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>Lehte ei leitud</h1>
      <p>Seda lehte pole olemas või on see eemaldatud.</p>
      <div className="row"><a className="btn" href="/">Spetsialisti sisselogimine</a><a className="btn secondary" href="/haldus">Haldusvaade</a></div>
    </div>
  );
}
