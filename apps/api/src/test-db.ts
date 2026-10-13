// In-process Postgres (PGlite) with the real migrations, one per test file. Tests only.
import { PGlite } from "@electric-sql/pglite";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, MIGRATIONS } from "./db.js";
import * as schema from "./schema.js";

let shared: Promise<Db> | undefined;

/** A migrated database with every table emptied. */
export async function testDb(): Promise<Db> {
  shared ??= (async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db as unknown as Db;
  })();
  const db = await shared;
  const tables = Object.values(schema)
    .filter((t) => is(t, PgTable))
    .map((t) => `"${getTableName(t)}"`);
  await db.execute(sql.raw(`TRUNCATE ${tables.join(", ")}`));
  return db;
}
