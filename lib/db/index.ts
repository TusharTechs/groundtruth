import { MemoryStore } from "@/lib/db/memory-store";
import { PostgresStore } from "@/lib/db/postgres-store";
import type { GroundTruthStore } from "@/lib/db/store";

/**
 * Store factory. When DATABASE_URL is set, PostgreSQL (Drizzle) is used;
 * otherwise the in-memory store keeps local demos and tests dependency-free.
 * The active backend is reported in /api/settings and the audit log so the
 * operator always knows where data lives.
 *
 * Both stores are imported statically. An earlier lazy require() kept "pg"
 * out of memory-mode processes, but the bundler rewrote it and broke the
 * Postgres path in production builds; "pg" is declared as a server-external
 * package instead, which achieves the same thing without the hazard.
 */

let store: GroundTruthStore | null = null;
let backend: "memory" | "postgres" = "memory";

export function getStore(): GroundTruthStore {
  if (store) return store;
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && databaseUrl.startsWith("postgres")) {
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
