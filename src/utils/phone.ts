// Normalizes Kenyan numbers (0712..., 0112..., 254712..., +254712...) to +254XXXXXXXXX.
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, "");
  const m = /^(?:\+?254|0)([17]\d{8})$/.exec(digits);
  return m ? `+254${m[1]}` : null;
}