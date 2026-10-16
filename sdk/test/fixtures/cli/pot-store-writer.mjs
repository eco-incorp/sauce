// One writer of `cli-pot-store.test.ts`'s concurrency check, in a process of its own: it waits
// until `go` exists (so every writer starts together), then saves the record in `record` (one line
// of JSON) and prints what the store said. Node strips the store's types itself: `pot-store.ts`
// imports nothing but Node's own modules.
import { existsSync, readFileSync } from "node:fs";

import { PotStore } from "../../../src/cli/pot-store.ts";

const [dir, go, file] = process.argv.slice(2);
while (!existsSync(go)) await new Promise((resolve) => setTimeout(resolve, 2));
process.stdout.write(new PotStore(dir).save(JSON.parse(readFileSync(file, "utf8"))));
