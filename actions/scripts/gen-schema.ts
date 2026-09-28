/**
 * Writes `actions/action-program.schema.json` from `src/schema.ts`. Run after changing an action's
 * fields (`src/spec.ts`); `program.unit.test.ts` fails while the committed file is stale.
 *
 *   pnpm --filter './actions' gen-schema
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { actionProgramJsonSchema } from "../src/schema.js";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../action-program.schema.json");
writeFileSync(out, `${JSON.stringify(actionProgramJsonSchema(), null, 2)}\n`);
console.log(`wrote ${out}`);
