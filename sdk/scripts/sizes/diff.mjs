// Compares two sizes.json files: `node diff.mjs base.json candidate.json`. Prints every bytecode
// that grew (program [0], then each recorded body an older tree reported), and exits 1 when one did.
import { readFileSync } from "node:fs";

const [base, candidate] = process.argv
  .slice(2)
  .map((path) => JSON.parse(readFileSync(path, "utf8")));
const grew = [];
let same = 0;
let shrank = 0;
for (const [key, sizes] of Object.entries(base)) {
  const next = candidate[key];
  if (next === undefined) {
    console.log(`only in base: ${key}`);
    continue;
  }
  sizes.forEach((size, i) => {
    if (next[i] > size) grew.push(`${key}[${i}] ${size} -> ${next[i]} (+${next[i] - size})`);
    else if (next[i] < size) shrank++;
    else same++;
  });
}
for (const key of Object.keys(candidate))
  if (base[key] === undefined) console.log(`only in candidate: ${key}`);
console.log(`same ${same}, smaller ${shrank}, larger ${grew.length}`);
for (const line of grew) console.log(`  ${line}`);
process.exitCode = grew.length > 0 ? 1 : 0;
