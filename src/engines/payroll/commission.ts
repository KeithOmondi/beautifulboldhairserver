/**
 * Commission maths in one place so payroll and the dashboard can never disagree.
 * Percentages are basis points (1500 = 15.00%); money is whole shillings and rounds down.
 */
export function commissionFor(price: number, discount: number, pctBasisPoints: number): number {
  const net = Math.max(0, price - discount);
  return Math.floor((net * pctBasisPoints) / 10_000);
}

/** A per-service override beats the staff member's default rate (including an override of 0%). */
export function effectiveRate(defaultPct: number | null | undefined, overridePct: number | null | undefined): number {
  return overridePct ?? defaultPct ?? 0;
}
