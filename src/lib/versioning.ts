// Kinnituste ja versioonide puhas loogika.
import { ProfileContent, translationStatus, isSubstantiveChange, type Translations, APPROVAL_STATEMENT, APPROVAL_STATEMENT_VERSION } from "./profile";

export type ApprovalRequest = { languages: ("et" | "en" | "ru")[]; photoVersionId: string | null; statementChecked: boolean };
export type Snapshot = { et: ProfileContent; en: ProfileContent | null; ru: ProfileContent | null; photoVersionId: string | null; statement: string; statementVersion: string };

export class ApprovalError extends Error {}

/** Loob muutumatu koopia täpselt sellest sisust, mida arst kinnitab. */
export function buildApprovalSnapshot(draft: { content: unknown; translations: unknown }, req: ApprovalRequest, approvedPhotoIds: string[]): Snapshot {
  if (!req.statementChecked) throw new ApprovalError("Kinnituse märkeruut peab olema teadlikult märgitud.");
  if (!req.languages.includes("et")) throw new ApprovalError("Eestikeelne versioon tuleb kinnitada.");
  const et = ProfileContent.parse(draft.content);
  const tr = (draft.translations ?? {}) as Translations;
  const pick = (l: "en" | "ru") => {
    if (!req.languages.includes(l)) return null;
    const t = tr[l];
    const st = translationStatus(t, et);
    if (st !== "fresh") throw new ApprovalError(`${l.toUpperCase()} tõlge on ${st === "stale" ? "aegunud" : "puudu"} – genereeri või paranda see enne kinnitamist.`);
    return structuredClone(t!.content);
  };
  if (req.photoVersionId && !approvedPhotoIds.includes(req.photoVersionId)) throw new ApprovalError("Kinnitada saab ainult valitud ja üle vaadatud fotoversiooni.");
  return { et: structuredClone(et), en: pick("en"), ru: pick("ru"), photoVersionId: req.photoVersionId, statement: APPROVAL_STATEMENT, statementVersion: APPROVAL_STATEMENT_VERSION };
}

/** Halduri muudatus: kas vajab uut arsti kinnitust? */
export function managerEditNeedsApproval(approved: { et: unknown; en: unknown; ru: unknown; photoVersionId: string | null }, next: { et: unknown; en: unknown; ru: unknown; photoVersionId: string | null }): boolean {
  if (approved.photoVersionId !== next.photoVersionId) return true;
  return (["et", "en", "ru"] as const).some((l) => isSubstantiveChange(approved[l], next[l]));
}

export const WORKFLOW_LABELS: Record<string, string> = {
  DRAFT: "Mustand",
  DOCTOR_REVIEW: "Arsti ülevaatusel",
  DOCTOR_APPROVED: "Arsti kinnitatud",
  MARKETING_REVIEW: "Turunduse ülevaatusel",
  RETURNED: "Arstile parandamiseks tagastatud",
  READY_TO_PUBLISH: "Valmis käsitsi avaldamiseks",
  PUBLISHED: "Veebis avaldatuks märgitud",
};

export const REVIEW_INTERVAL_MONTHS_DEFAULT = 12;
export function reviewDue(lastDoctorReviewAt: Date | null, months = REVIEW_INTERVAL_MONTHS_DEFAULT, now = new Date()): "unknown" | "due" | "ok" {
  if (!lastDoctorReviewAt) return "unknown"; // "Kinnitamise aeg teadmata" – ei tuletata muust
  const d = new Date(lastDoctorReviewAt);
  d.setMonth(d.getMonth() + months);
  return d <= now ? "due" : "ok";
}
