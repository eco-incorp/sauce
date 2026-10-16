import { routes } from "@eco-incorp/sauce";
import { compile } from "@eco-incorp/sauce/compiler";

const source = "function main(amount: Uint256): Uint256 { return amount + 1; }";
const artifact = compile({
  target: "evm",
  resolve: () => new TextEncoder().encode(source),
});
// main's arguments, ABI-encoded and appended to the bytecode: the program a cook runs.
const entry = { entryParams: [{ name: "amount", type: "Uint256" }] };
const args = routes.encodeEntryArguments(entry, [42n]);
const program = new Uint8Array([...artifact.bytecode, ...args]);
const [decoded] = routes.decodeEntryArguments(entry, args);
if (decoded !== 42n) throw new Error("Argument round trip failed");
console.log("ISA:", artifact.isaRevision, "program bytes:", program.length);
