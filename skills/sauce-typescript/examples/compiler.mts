// The raw compiler: one reusable program, its arguments ABI-encoded separately, the SDK's own
// modules served from memory, and the one `ready()` a browser needs.
import { compile, ready, resolveSdkModule, resolveSdkPackage } from "@eco-incorp/sauce/compiler";
import { bytesToHex, encodeAbiParameters, hexToBigInt, hexToBytes } from "viem";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

await ready(); // resolves at once in Node; required once before the first compile in a browser

const source = new TextEncoder().encode(`
function main(amounts: Uint256[], minimum: Uint256): Uint256 {
  let total = 0n;
  for (let i = 0n; i < amounts.length; i++) {
    total += amounts[i];
  }
  require(total >= minimum);
  return total;
}
`);
const resolve = (path: string) => (path === "main.ts" ? source : undefined);

// Append abi.encode of main's parameters; there is no selector.
const abi = compile({ target: "evm", entry: "main.ts", resolve });
const abiArgs = hexToBytes(
  encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }], [[25n, 75n], 100n]),
);
const abiPayload = new Uint8Array([...abi.bytecode, ...abiArgs]); // the `program` of Pot.cook
// Each parameter has one head word at a fixed offset, whatever its value: `minimum` is the second
// word after the bytecode, so a number measured later can be written over it.
const minimumAt = abi.bytecode.length + 32;
check(hexToBigInt(bytesToHex(abiPayload.slice(minimumAt, minimumAt + 32))) === 100n, "offset");

// `@sauce/token` and every protocol ABI twin are served by the SDK: fall back to its resolvers.
const withToken = new TextEncoder().encode(`
import { balanceOf } from "@sauce/token";
function main(token: Address): Uint256 {
  return balanceOf(token, ctx.self());
}
`);
const tokenRead = compile({
  target: "evm",
  entry: "main.ts",
  resolve: (path) => (path === "main.ts" ? withToken : resolveSdkModule(path)),
  resolvePackage: resolveSdkPackage,
});

console.log(`isa ${abi.isaRevision}; abi payload ${abiPayload.length} bytes`);
console.log(`@sauce/token balanceOf program ${bytesToHex(tokenRead.bytecode).slice(0, 18)}…`);
