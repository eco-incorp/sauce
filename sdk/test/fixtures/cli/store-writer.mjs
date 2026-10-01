// One writer of `cli-store.test.ts`'s concurrency checks, in a process of its own: it waits until
// `go` exists (so every writer starts together), then either saves the record in `record` (one
// line of JSON) or appends `count` events, each recording which writer and which line it is.
// Node strips the store's types itself: `store.ts` imports nothing but Node's own modules.
import { existsSync, readFileSync } from "node:fs";

import { IntentStore } from "../../../src/cli/store.ts";

const [dir, mode, go, name, arg] = process.argv.slice(2);
while (!existsSync(go)) await new Promise((resolve) => setTimeout(resolve, 2));
const store = new IntentStore(dir);
if (mode === "save") {
  process.stdout.write(store.save(JSON.parse(readFileSync(arg, "utf8"))));
} else {
  const record = JSON.parse(readFileSync(`${dir}/record.json`, "utf8"));
  for (let index = 0; index < Number(arg); index++) {
    store.append(record.intentHash, {
      event: "proving",
      chain: name,
      chainId: index,
      time: new Date().toISOString(),
      message: `0x${index.toString(16).padStart(64, "0")}`,
    });
  }
  process.stdout.write("appended");
}
