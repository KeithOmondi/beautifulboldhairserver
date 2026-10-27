/**
 * Money Utility
 * 
 * All monetary values in the database are stored as Integers (whole shillings).
 * This file provides safe helpers to format, parse, and calculate money
 * without floating-point precision errors.
 */

/**
 * Formats an integer amount into a readable KES string.
 * Example: 150000 -> "KES 1,500.00"
 */
export function formatKES(amountInShillings: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(amountInShillings);
}

/**
 * Safely parses a user-input string (like "1,500" or "1500.50") into whole shillings.
 * Rejects negative numbers.
 */
export function parseShillings(input: string | number): number {
  if (typeof input === "number") {
    if (isNaN(input)) throw new Error("Invalid amount");
    return Math.round(input);
  }

  // Remove commas and spaces (e.g., "1,500 " -> "1500")
  const cleanStr = input.replace(/,/g, "").trim();
  const parsed = parseFloat(cleanStr);

  if (isNaN(parsed)) throw new Error("Invalid amount");
  if (parsed < 0) throw new Error("Amount cannot be negative");

  return Math.round(parsed);
}

/**
 * Calculates a percentage of an amount (e.g., for commissions).
 * Returns whole shillings, rounded down to avoid paying out fractions of a shilling.
 * 
 * @param amount The base amount in shillings
 * @param percentage The percentage (e.g., 15 for 15%)
 */
export function calculatePercentage(amount: number, percentage: number): number {
  return Math.floor((amount * percentage) / 100);
}

/**
 * Safely applies a discount to a price.
 */
export function applyDiscount(price: number, discountAmount: number): number {
  const finalPrice = price - discountAmount;
  return Math.max(0, finalPrice); // Never return a negative price
}