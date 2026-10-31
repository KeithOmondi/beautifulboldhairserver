/** The two sides of the business. Every service belongs to one of these (or to a custom group). */
export const LASHES = "Lashes";
export const HAIR_WIGS = "Hair & Wigs";

/**
 * Keeps categories tidy: "lash", "Lashes " and "LASH EXTENSIONS" all become "Lashes"; "wigs", "hair" and
 * "braids" become "Hair & Wigs". Anything else is kept as typed, trimmed and capitalised.
 */
export function normalizeCategory(input: string | null | undefined): string | null {
  const t = input?.trim().replace(/\s+/g, " ");
  if (!t) return null;
  const l = t.toLowerCase();
  if (l.includes("lash")) return LASHES;
  if (/(wig|hair|braid|weave|silk|press|style|styling)/.test(l)) return HAIR_WIGS;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
