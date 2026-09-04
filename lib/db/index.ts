import { MemoryStore } from "@/lib/db/memory-store";
import type { GroundTruthStore } from "@/lib/db/store";

/**
 * Store factory. When DATABASE_URL is set, PostgreSQL (Drizzle) is used;
 * otherwise the in-memory store keeps local demos and tests dependency-free.
 * The active backend is reported in /api/settings and the audit log so the
 * operator always knows where data lives.
 *
 * PostgresStore is imported lazily so "pg" is only loaded in database mode.
 */

let store: GroundTruthStore | null = null;
let backend: "memory" | "postgres" = "memory";

export function getStore(): GroundTruthStore {
  if (store) return store;
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && databaseUrl.startsWith("postgres")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostgresStore } = require("@/lib/db/postgres-store") as {
      PostgresStore: new (url: string) => GroundTruthStore;
    };
    store = new PostgresStore(databaseUrl);
    backend = "postgres";
  } else {
    store = new MemoryStore();
    backend = "memory";
  }
  return store;
}

export function getStoreBackend(): "memory" | "postgres" {
  getStore();
  return backend;
}

/** Test hook: inject a store instance (used by the integration suite). */
export function __setStoreForTests(s: GroundTruthStore): void {
  store = s;
  backend = "memory";
}
