import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which branch (side of the business) a public request is about.
 * Set once per request from the `branch` query parameter or `x-branch` header, so every public
 * service can ask for "the branch" without each handler passing it along.
 */
const store = new AsyncLocalStorage<{ slug: string | null }>();

export const runWithBranchSlug = <T>(slug: string | null, fn: () => T): T => store.run({ slug }, fn);
export const currentBranchSlug = (): string | null => store.getStore()?.slug ?? null;
