import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProfileContent, emptyProfile, mergeImport, evaluateCompleteness, isIncomplete, translationStatus, applyRegeneratedTranslation, contentHash, toPlainText, toCleanHtml, isSubstantiveChange, validUrl, patientDataSuspicion, type Translation } from "../src/lib/profile";
import { buildApprovalSnapshot, managerEditNeedsApproval, ApprovalError, reviewDue } from "../src/lib/versioning";
import { factGuard, applyPolish, PolishOutput, ExtractOutput, MockAI } from "../src/lib/ai";
import { inviteCodeHash, signUrlToken, verifyUrlToken, sixDigitCode } from "../src/lib/security";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../src/lib/db", () => ({ db: {} }));
(process.env as Record<string, string>).NODE_ENV = "test";

const base = (): ProfileContent => ({ ...emptyProfile(), name: "Test Arst", titles: ["Perearst"], description: "Keskendun laste allergiatele ja astmale, mul on 10 aastat kogemust.", education: [{ from: "2005", to: "2011", ongoing: false, unknown: false, institution: "Tartu Ülikool", degree: "arstiteadus" }] });

describe("arsti ligipääs ja kutsekood", async () => {
  const { checkInvite, assertOwnResource, MAX_CODE_ATTEMPTS } = await import("../src/lib/auth");
  const inv = (o: object = {}) => ({ specialistId: "A", codeHash: inviteCodeHash("A", "123456"), expiresAt: new Date(Date.now() + 86400_000), revokedAt: null, lockedAt: null, failedAttempts: 0, ...o });

  it("õige kood töötab, vale ei tööta", () => {
    expect(checkInvite(inv(), "123456")).toBe("ok");
    expect(checkInvite(inv(), "654321")).toBe("wrong");
  });
  it("teise arsti kood ei avata seda profiili (kood seotud spetsialistiga)", () => {
    expect(checkInvite(inv({ specialistId: "B" }), "123456")).toBe("wrong");
  });
  it("aegunud ja tühistatud kood ei tööta", () => {
    expect(checkInvite(inv({ expiresAt: new Date(Date.now() - 1000) }), "123456")).toBe("expired");
    expect(checkInvite(inv({ revokedAt: new Date() }), "123456")).toBe("revoked");
  });
  it("liiga palju valesid katseid lukustab koodi", () => {
    expect(checkInvite(inv({ failedAttempts: MAX_CODE_ATTEMPTS }), "123456")).toBe("locked");
  });
  it("arst ei pääse teise arsti ressursile", () => {
    expect(() => assertOwnResource("A", "B")).toThrow();
    expect(() => assertOwnResource("A", "A")).not.toThrow();
  });
  it("kood on 6 numbrit ja seda ei hoita lihttekstina", () => {
    const c = sixDigitCode();
    expect(c).toMatch(/^\d{6}$/);
    expect(inviteCodeHash("A", c)).not.toContain(c);
  });
  it("e-posti skanneri GET ei tarbi koodi: kood on mitmekordne kuni aegumiseni", () => {
    const i = inv();
    expect(checkInvite(i, "123456")).toBe("ok");
    expect(checkInvite(i, "123456")).toBe("ok");
  });
});

describe("allkirjastatud allalaadimislink", () => {
  it("kehtib lühiajaliselt ja ainult oma ressursile", () => {
    const t = signUrlToken("photo:1", 60);
    expect(verifyUrlToken("photo:1", t)).toBe(true);
    expect(verifyUrlToken("photo:2", t)).toBe(false);
    expect(verifyUrlToken("photo:1", t, Date.now() + 120_000)).toBe(false);
  });
});

describe("import ei kirjuta vaikselt üle", () => {
  it("täidab tühjad väljad ja teeb erinevustest vastuolud", () => {
    const cur = { ...emptyProfile(), name: "Mari Mets", description: "Arsti käsitsi parandatud tekst." };
    const r = mergeImport(cur, { description: { source: "FORM", manual: true } }, { name: "Mari Mets", description: "CV vana tekst", titles: ["Kardioloog"] }, "CV_FILE");
    expect(r.content.description).toBe("Arsti käsitsi parandatud tekst.");
    expect(r.content.titles).toEqual(["Kardioloog"]);
    expect(r.filled).toEqual(["titles"]);
    expect(r.conflicts.map((c) => c.field)).toEqual(["description"]);
  });
});

describe("AI väljundi skeem ja puuduvad faktid", () => {
  it("skeemivälist väljundit ei aktsepteerita", () => {
    expect(PolishOutput.safeParse({ profile: { titles: "pole massiiv" } }).success).toBe(false);
    expect(ExtractOutput.safeParse({ profile: {}, excerpts: [{ field: 1 }] }).success).toBe(false);
  });
  it("AI ei tohi lisada aastaarvu, kirjeid, tiitlit, keelt ega vanusepiiri", () => {
    const input = { ...base(), education: [{ from: "", to: "", ongoing: false, unknown: true, institution: "Tartu Ülikool", degree: "arstiteadus" }] };
    const issues = factGuard(input, { education: [{ from: "2011", to: "", ongoing: false, unknown: false, institution: "Tartu Ülikool", degree: "arstiteadus" }, { from: "", to: "", ongoing: false, unknown: false, institution: "Harvard", degree: "MD" }], titles: ["dr Perearst"], languages: { list: ["et", "en"], other: "", reviewed: false }, age: { mode: "all", from: "", to: "", note: "" } });
    expect(issues.join("|")).toMatch(/2011/);
    expect(issues.join("|")).toMatch(/kirjeid/);
    expect(issues.join("|")).toMatch(/tiitli/);
    expect(issues.join("|")).toMatch(/keele/);
    expect(issues.join("|")).toMatch(/vanusepiiri/);
  });
  it("valvuri leiu korral jäävad sisendi faktid alles", () => {
    const input = base();
    const out = PolishOutput.parse({ profile: { ...input, education: [...input.education, { from: "2015", to: "2016", ongoing: false, unknown: false, institution: "Väljamõeldud", degree: "PhD" }], description: "Parandatud." } });
    const r = applyPolish(input, out);
    expect(r.guardIssues.length).toBeGreaterThan(0);
    expect(r.content.education).toEqual(input.education);
  });
  it("vähese sisuga tutvustust ei koostata, küsitakse täpsustust", async () => {
    const r = await new MockAI().polish({ ...emptyProfile(), name: "X", description: "Arst." }, true);
    expect(r.introSkippedReason).not.toBe("");
    expect(r.questions.length).toBeGreaterThan(0);
  });
});

describe("täielikkus", () => {
  it("valikulised tühjad jaotised ei tekita hoiatust", () => {
    const f = evaluateCompleteness(base(), { hasPhoto: true });
    expect(f.filter((x) => ["trainings", "memberships", "tags", "publications", "additionalInfo"].includes(x.field))).toEqual([]);
    expect(isIncomplete(f)).toBe(false);
  });
  it("puuduv põhiväli ja sisutühi väärtus tuvastatakse", () => {
    expect(isIncomplete(evaluateCompleteness({ ...base(), description: "–" }, { hasPhoto: true }))).toBe(true);
    expect(isIncomplete(evaluateCompleteness({ ...base(), description: "Perearst" }, { hasPhoto: true }))).toBe(true);
    expect(isIncomplete(evaluateCompleteness({ ...base(), education: [] }, { hasPhoto: true }))).toBe(true);
  });
  it("„ei kohaldu“ töökogemus ei ole puudus", () => {
    const f = evaluateCompleteness({ ...base(), sections: { experience: "not_applicable" } }, { hasPhoto: true });
    expect(f.find((x) => x.field === "experience")).toBeUndefined();
  });
  it("kinnitamise aeg teadmata, kui kinnitust pole", () => {
    expect(reviewDue(null)).toBe("unknown");
    expect(reviewDue(new Date(Date.now() - 400 * 86400_000))).toBe("due");
  });
});

describe("versioonid ja tõlked", () => {
  const tr = (et: ProfileContent, manual = false): Translation => ({ content: { ...et, description: "EN text" }, sourceHash: contentHash(et), manuallyEdited: manual, helpRequested: false, generatedAt: "" });

  it("alusinfo muutmine muudab tõlke aegunuks", () => {
    const et = base();
    const t = tr(et);
    expect(translationStatus(t, et)).toBe("fresh");
    expect(translationStatus(t, { ...et, description: "Muudetud" })).toBe("stale");
  });
  it("uus genereerimine ei kaota käsitsi parandatud tõlget", () => {
    const et = base();
    const r = applyRegeneratedTranslation(tr(et, true), tr({ ...et, name: "x" }), false);
    expect(r.keptManual).toBe(true);
    expect(r.result.manuallyEdited).toBe(true);
  });
  it("kinnitatud koopia ei muutu, kui mustandit hiljem muudetakse", () => {
    const draft = { content: base(), translations: { en: tr(base()) } };
    const snap = buildApprovalSnapshot(draft, { languages: ["et", "en"], photoVersionId: "p1", statementChecked: true }, ["p1"]);
    draft.content.description = "UUS MUSTAND";
    expect(snap.et.description).not.toBe("UUS MUSTAND");
    expect(snap.en?.description).toBe("EN text");
  });
  it("kinnitus seotakse õige foto ja keeltega; aegunud tõlget ega valimata fotot ei saa kinnitada", () => {
    const draft = { content: base(), translations: { en: tr({ ...base(), name: "vana" }) } };
    expect(() => buildApprovalSnapshot(draft, { languages: ["et", "en"], photoVersionId: null, statementChecked: true }, [])).toThrow(ApprovalError);
    expect(() => buildApprovalSnapshot({ content: base(), translations: {} }, { languages: ["et"], photoVersionId: "teise-arsti-foto", statementChecked: true }, [])).toThrow(ApprovalError);
    const s = buildApprovalSnapshot({ content: base(), translations: {} }, { languages: ["et"], photoVersionId: "p9", statementChecked: true }, ["p9"]);
    expect(s.photoVersionId).toBe("p9");
    expect(s.en).toBeNull();
  });
  it("kinnitus ei ole eelmärgitud", () => {
    expect(() => buildApprovalSnapshot({ content: base(), translations: {} }, { languages: ["et"], photoVersionId: null, statementChecked: false }, [])).toThrow(ApprovalError);
  });
  it("turunduse sisuline muudatus vajab uut kinnitust, vormistus mitte", () => {
    const a = { et: base(), en: null, ru: null, photoVersionId: "p" };
    expect(managerEditNeedsApproval(a, { ...a, et: { ...base(), description: base().description + " Teen ka operatsioone." } })).toBe(true);
    expect(managerEditNeedsApproval(a, { ...a, et: { ...base(), description: "  " + base().description.replace(",", " ,") } })).toBe(false);
    expect(managerEditNeedsApproval(a, { ...a, photoVersionId: "p2" })).toBe(true);
    expect(isSubstantiveChange("Tere maailm.", "tere  maailm")).toBe(false);
  });
});

describe("kopeerimine", () => {
  it("lihttekst ja HTML ei sisalda tühje pealkirju ega varjatud jaotisi", () => {
    const c = { ...base(), additionalInfo: "Salajane", sections: { additionalInfo: "no_publish" as const } };
    const t = toPlainText(c, "et");
    expect(t).toContain("Haridus");
    expect(t).not.toContain("Erialased koolitused");
    expect(t).not.toContain("Salajane");
    const h = toCleanHtml({ ...c, description: "<script>x</script>" }, "et");
    expect(h).not.toContain("<script>");
    expect(h).toContain("<h3>Haridus</h3>");
  });
  it("URL-i vorming kontrollitakse", () => {
    expect(validUrl("https://ee.ee/a")).toBe(true);
    expect(validUrl("javascript:alert(1)")).toBe(false);
  });
  it("patsiendiandmete kahtlus (isikukood)", () => {
    expect(patientDataSuspicion("Patsient isikukoodiga 49001011234")).not.toEqual([]);
  });
});

describe("taustatööd: korduskatse ei dubleeri", () => {
  let store: Record<string, { id: string; dedupeKey?: string }>;
  beforeEach(() => { store = {}; });
  it("sama dedupeKey tagastab olemasoleva töö", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/db", () => ({
      db: { job: {
        findUnique: async ({ where }: { where: { dedupeKey: string } }) => Object.values(store).find((j) => j.dedupeKey === where.dedupeKey) ?? null,
        create: async ({ data }: { data: { dedupeKey?: string } }) => { const id = `j${Object.keys(store).length + 1}`; store[id] = { id, ...data }; return store[id]; },
      } },
    }));
    const { enqueue } = await import("../src/lib/jobs");
    const a = await enqueue("process", {}, { dedupeKey: "process:A:3" });
    const b = await enqueue("process", {}, { dedupeKey: "process:A:3" });
    expect(a.id).toBe(b.id);
    expect(Object.keys(store)).toHaveLength(1);
  });
});

describe("manuaalne režiim: e-posti saatmist pole", () => {
  it("koodis puudub e-posti saatmise teenus", async () => {
    const fs = await import("node:fs");
    const src = ["service.ts", "jobs.ts"].map((f) => fs.readFileSync(`src/lib/${f}`, "utf8")).join("\n");
    expect(src).not.toMatch(/nodemailer|sendMail|smtp/i);
  });
});
