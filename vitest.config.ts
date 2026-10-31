import { defineConfig } from "vitest/config";

// Integration tests share one database and the "first active salon", so files must run one at a time.
export default defineConfig({ test: { fileParallelism: false } });
