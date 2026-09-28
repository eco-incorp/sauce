/**
 * Writes `actions/action-program.schema.json` from `src/schema.ts`. Run after changing an action's
 * fields (`src/spec.ts`); `program.unit.test.ts` fails while the committed file is stale.
 *
 *   pnpm --filter './actions' gen-schema
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

import { programSchema } from "../src/schema.js";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../action-program.schema.json");
// Formatted as the repository's `format:check` expects, so the output is committed as written.
const options = { ...(await resolveConfig(out)), filepath: out };
writeFileSync(out, await format(JSON.stringify(programSchema()), options));
console.log(`wrote ${out}`);
