import fs from "node:fs";
import { getBase58Decoder } from "@solana/kit";

const file = process.argv[2];
const json = JSON.parse(fs.readFileSync(file, "utf8"));
const v = json.result.value;
const data = Buffer.from(v.data[0], "base64");
const b58 = getBase58Decoder();

function hexrow(off, len) {
  return data.subarray(off, off + len).toString("hex");
}

console.log("total len", data.length);
console.log("\n--- 16-byte rows with offset ---");
for (let off = 0; off < Math.min(data.length, 200); off += 16) {
  console.log(String(off).padStart(4), hexrow(off, 16));
}

console.log("\n--- candidate 32-byte pubkey fields (non-overlapping from offset 16) ---");
for (let off = 16; off + 32 <= 300; off += 32) {
  const slice = data.subarray(off, off + 32);
  console.log(off, b58.decode(slice), slice.every((b) => b === 0) ? "(zero)" : "");
}
