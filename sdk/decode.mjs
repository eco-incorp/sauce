import fs from "node:fs";
import { getBase58Decoder } from "@solana/kit";

const file = process.argv[2];
const json = JSON.parse(fs.readFileSync(file, "utf8"));
const v = json.result.value;
console.log("owner", v.owner, "lamports", v.lamports, "executable", v.executable);
const data = Buffer.from(v.data[0], "base64");
console.log("len", data.length);

const b58 = getBase58Decoder();

function u64(off) {
  return data.readBigUInt64LE(off);
}
function pub(off) {
  const slice = data.subarray(off, off + 32);
  try {
    return b58.decode(slice);
  } catch {
    return "(invalid)";
  }
}

// Dump 32-byte-aligned chunks as pubkeys for the first N bytes, flag ones that
// look like plausible addresses (non-zero, not all-same-byte).
console.log("\n--- 32-byte-aligned pubkey scan ---");
for (let off = 0; off + 32 <= Math.min(data.length, 512); off += 8) {
  const slice = data.subarray(off, off + 32);
  if (slice.every((b) => b === 0)) continue;
  console.log(off, pub(off));
}

console.log("\n--- u64 words (offset: hex / dec) first 800 bytes ---");
for (let off = 0; off + 8 <= Math.min(data.length, 800); off += 8) {
  const val = u64(off);
  if (val === 0n) continue;
  console.log(off, "0x" + val.toString(16), val.toString());
}
