// The raw compiler: one reusable program, arguments encoded separately (ABI-v1 or compact-v1), the
// SDK's own modules served from memory, and the one `ready()` a browser needs.
import {
  compile,
  decodeCompactArguments,
  encodeCompactArguments,
  ready,
  resolveSdkModule,
  resolveSdkPackage,
} from "@eco-incorp/sauce/compiler";
import { bytesToHex, encodeAbiParameters, hexToBytes } from "viem";

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

// compact-v1: pair the bytecode with ITS schema, never another artifact's.
const compact = compile({ target: "evm", entry: "main.ts", resolve, compactArgs: true });
if (compact.entryEncoding !== "compact-v1" || compact.entrySchema === undefined)
  throw new Error("no schema");
const schema = compact.entrySchema;
const small = encodeCompactArguments(schema, [[25n, 75n], 100n]);
check(small.length < abiArgs.length, "compact is smaller");
// A fixed scalar width makes the payload length value-independent, so a number can be spliced later.
const w1 = encodeCompactArguments(schema, [[1n, 2n], 3n], { scalarWidth: 32 });
const w2 = encodeCompactArguments(schema, [[10n ** 30n, 2n], 3n], { scalarWidth: 32 });
check(w1.length === w2.length, "scalarWidth fixes offsets");
const back = decodeCompactArguments(schema, w2, { scalarWidth: 32 });
check(Array.isArray(back) && Array.isArray(back[0]) && back[0][0] === 10n ** 30n, "round trip");

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
  `isa ${abi.isaRevision}; abi payload ${abiPayload.length} bytes; compact args ${small.length} vs ${abiArgs.length}`,
);
console.log(`@sauce/token balanceOf program ${bytesToHex(tokenRead.bytecode).slice(0, 18)}…`);
