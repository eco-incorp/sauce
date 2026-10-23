import { compile } from "@eco-incorp/sauce/compiler";
import { bytesToHex, decodeAbiParameters, encodeAbiParameters, hexToBytes } from "viem";

const source = "function main(amount: Uint256): Uint256 { return amount + 1; }";
const artifact = compile({
  target: "evm",
  resolve: () => new TextEncoder().encode(source),
});
// This signature has no indirect fixed-size tuple parameters; ordinary ABI encoding suffices.
const args = hexToBytes(encodeAbiParameters(artifact.entryParams, [42n]));
const program = new Uint8Array([...artifact.bytecode, ...args]);
const decoded = decodeAbiParameters(artifact.entryParams, bytesToHex(args));
if (decoded[0] !== 42n) throw new Error("Argument round trip failed");
console.log("ISA:", artifact.isaRevision, "program bytes:", program.length);
