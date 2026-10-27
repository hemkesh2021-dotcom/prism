import type { ActionStatus, DecisionStatus, Finding, FindingCategory, IdentityCharacteristic } from "./types";

const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("en", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatInt = (value: number) => integer.format(value);

/** Word share is stored unrounded; it is rounded only here, for display. */
export const formatShare = (share: number | null) => (share === null ? "n/a" : percent.format(share));

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${formatInt(count)} ${count === 1 ? singular : plural}`;

const CHARACTERISTIC_ADJECTIVE: Record<IdentityCharacteristic, string> = {
  age: "age-based",
  gender: "gender-based",
  race_or_ethnicity: "race- or ethnicity-based",
  nationality_or_origin: "nationality- or origin-based",
  religion: "religion-based",
  caste: "caste-based",
  disability: "disability-based",
  sexual_orientation: "sexual-orientation-based",
  other: "identity-based",
};

export const CHARACTERISTIC_NOUN: Record<IdentityCharacteristic, string> = {
  age: "age",
  gender: "gender",
  race_or_ethnicity: "race or ethnicity",
  nationality_or_origin: "nationality or origin",
  religion: "religion",
  caste: "caste",
  disability: "disability",
  sexual_orientation: "sexual orientation",
  other: "another identity characteristic",
};

export function isIdentityCategory(category: FindingCategory): boolean {
  return category !== "personal_attack";
}

/** "Potential age-based dismissal", "Potential identity-based stereotyping", ... */
export function findingTitle(finding: Pick<Finding, "category" | "identity_characteristic">): string {
  if (finding.category === "personal_attack") return "Potential personal attack or dismissive remark";
  const adjective = CHARACTERISTIC_ADJECTIVE[finding.identity_characteristic ?? "other"];
  return finding.category === "identity_dismissal" ? `Potential ${adjective} dismissal` : `Potential ${adjective} stereotyping`;
}

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  identity_stereotyping: "Identity-based stereotyping",
  identity_dismissal: "Identity-based dismissal",
  personal_attack: "Personal attack or dismissive communication",
};

export const GROUP_LABEL = {
  identity: "Identity-related",
  personal: "Personal attacks and dismissive remarks",
} as const;

export const DECISION_LABEL: Record<DecisionStatus, string> = { agreed: "Agreed", proposed: "Proposed" };
export const ACTION_LABEL: Record<ActionStatus, string> = { committed: "Committed", suggested: "Suggested" };

export const NOT_SPECIFIED = "Not specified";

export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())} (UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`
  );
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "meeting"
  );
}
