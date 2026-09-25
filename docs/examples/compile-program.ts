import {
  compile,
  decodeCompactArguments,
  encodeCompactArguments,
} from "@eco-incorp/sauce/compiler";

const source = "function main(amount: Uint256): Uint256 { return amount + 1; }";
const artifact = compile({
  target: "evm",
  compactArgs: true,
  resolve: () => new TextEncoder().encode(source),
});
if (artifact.entryEncoding !== "compact-v1" || artifact.entrySchema === undefined) {
  throw new Error("Expected a compact entry schema");
}
const args = encodeCompactArguments(artifact.entrySchema, [42n]);
const program = new Uint8Array([...artifact.bytecode, ...args]);
const decoded = decodeCompactArguments(artifact.entrySchema, args);
if (!Array.isArray(decoded) || decoded[0] !== 42n) throw new Error("Argument round trip failed");
console.log("ISA:", artifact.isaRevision, "program bytes:", program.length);
