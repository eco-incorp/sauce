// The raw compiler: one reusable program, ABI-v1 arguments encoded separately, the
// SDK's own modules served from memory, and the one `ready()` a browser needs.
import { compile, ready, resolveSdkModule, resolveSdkPackage } from "@eco-incorp/sauce/compiler";
import { bytesToHex, decodeAbiParameters, encodeAbiParameters, hexToBytes } from "viem";

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

// ABI-v1 (default): append abi.encode of main's parameters; there is no selector.
const abi = compile({ target: "evm", entry: "main.ts", resolve });
const abiArgs = hexToBytes(
  encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }], [[25n, 75n], 100n]),
);
const abiPayload = new Uint8Array([...abi.bytecode, ...abiArgs]); // the `program` of Pot.cook

// Every entry uses ABI-v1. This signature has no indirect top-level tuple parameters.
const back = decodeAbiParameters(abi.entryParams, bytesToHex(abiArgs));
check(Array.isArray(back[0]) && back[0][0] === 25n && back[1] === 100n, "ABI round trip");

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

console.log(
  `isa ${abi.isaRevision}; ABI payload ${abiPayload.length} bytes; arguments ${abiArgs.length} bytes`,
);
console.log(`@sauce/token balanceOf program ${bytesToHex(tokenRead.bytecode).slice(0, 18)}…`);
