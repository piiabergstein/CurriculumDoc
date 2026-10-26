import { publicSections, type ProfileContent, type Lang } from "../lib/profile";

/** Patsiendile nähtav kuju. Tühje jaotisi ei näidata. */
export default function ProfilePreview({ content, lang, photoUrl }: { content: ProfileContent; lang: Lang; photoUrl?: string | null }) {
  const secs = publicSections(content, lang);
  return (
    <article className="preview" lang={lang}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        {photoUrl && <img src={photoUrl} alt={`Foto: ${content.name}`} className="photo" style={{ width: 160 }} />}
        <div className="grow"><h2 style={{ marginTop: 0 }}>{content.name || "—"}</h2></div>
      </div>
      {secs.map((s) => (
        <section key={s.key}>
          <h3>{s.title}</h3>
          {s.paragraphs || s.lines.length === 1 ? s.lines.map((l, i) => <p key={i}>{l}</p>) : <ul>{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </section>
      ))}
    </article>
  );
}
