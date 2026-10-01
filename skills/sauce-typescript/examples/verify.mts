// Settlement verification: is this payload THE settle program, and with what parameters? It does
// not say the surrounding intent is safe; the Pot, engine, chain and every other call stay yours.
//
//   node verify.mts --recipient <address>
import { compile, resolveSdkModule } from "@eco-incorp/sauce/compiler";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { settleSource } from "@eco-incorp/sauce/recipes";
import { svmSettleSource } from "@eco-incorp/sauce/svm";
import { verifySvmSettleProgram } from "@eco-incorp/sauce/svm/verify";
import {
  SETTLE_PROGRAM,
  SETTLE_WIRE,
  SettleDecodeError,
  decodeSettleCall,
  encodeSettleProgram,
  validateSettleProgram,
  type ProgramPin,
} from "@eco-incorp/sauce/verify";
import { routes } from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { bytesToHex, getAddress, toHex } from "viem";

type Address = `0x${string}`;
function address(name: string): Address {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value === undefined || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`pass --${name} <address>`);
  return getAddress(value);
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const RECIPIENT = address("recipient");
const ENGINE = getAddress(v12EngineAddress()); // the released engine a cook names
const baseUsdc = routes.registryTokenAddress(routes.chain("base").chain, "USDC");
if (baseUsdc === undefined) throw new Error("no USDC on Base");
const USDC = toHex(baseUsdc, { size: 20 });

// 1. Build and validate a canonical payload (program hash + strict ABI-v1 tail).
const payload = encodeSettleProgram([USDC], 1_000_000n, RECIPIENT, SETTLE_PROGRAM);
const settle = validateSettleProgram(payload);
check(
  settle.recipient === RECIPIENT.toLowerCase() && settle.minOut === 1_000_000n,
  "decoded params",
);

// 2. The same check on cook calldata. The ENGINE is reported, not trusted: compare it to your list.
const call = decodeSettleCall(v12Pot.encodeCook(ENGINE, payload));
check(call !== null && call.engine === ENGINE.toLowerCase(), "cook unwrapped; engine reported");

// 3. A payload whose PROGRAM bytes differ is rejected with a machine-readable code. (Changing only
//    the argument tail would decode fine: it is a valid settlement with other parameters.)
const at = 2 + 2 * 20; // a hex offset inside the program, ahead of its arguments
const flipped = (parseInt(payload.slice(at, at + 2), 16) ^ 0xff).toString(16).padStart(2, "0");
const tampered = `${payload.slice(0, at)}${flipped}${payload.slice(at + 2)}` as `0x${string}`;
try {
  validateSettleProgram(tampered);
  throw new Error("expected rejection");
} catch (error) {
  if (!(error instanceof SettleDecodeError)) throw error;
  console.log(`tampered payload rejected: ${error.code}`);
}

// 4. Accepting an older compiler's program is an explicit decision. An explicit list REPLACES the
//    default pin, so always include the current one.
const accepted: ProgramPin[] = [
  { hash: SETTLE_WIRE.PROGRAM_HASH, bytes: SETTLE_WIRE.PROGRAM_BYTES },
  // A settle program an earlier compiler produced, accepted deliberately (hash and length).
  { hash: "0xf9fffd262b32ad0cb07f2748f813626363497e09e4f4da134bed1b8da0c5d5fe", bytes: 356 },
];
validateSettleProgram(payload, accepted);

// 5. Reproduce the pinned program from the shipped source with the pinned compiler.
const source = new TextEncoder().encode(settleSource());
const { bytecode } = compile({
  target: "evm",
  entry: "settle.sauce.ts",
  resolve: (path) => (path === "settle.sauce.ts" ? source : resolveSdkModule(path)),
});
check(bytesToHex(bytecode) === SETTLE_PROGRAM.toLowerCase(), "settle program reproduces");

// 6. SVM: parameters are compiled in, so verification recompiles with the values you expect.
const svm = compile({
  target: "svm",
  resolve: (path) =>
    path === "main.js" ? new TextEncoder().encode(svmSettleSource(1)) : undefined,
  defines: [
    ["SETTLE_MIN_OUT", "1000000"],
    ["SETTLE_SPL_COUNT", "1"],
  ],
});
if (svm.manifest === undefined) throw new Error("expected an SVM manifest");
const svmResult = verifySvmSettleProgram(svm.bytecode, svm.manifest, {
  minOut: 1_000_000n,
  splCount: 1n,
});
check(svmResult.genuine, "SVM settle reproduces");

console.log(`settle ${SETTLE_WIRE.PROGRAM_BYTES} bytes, compiler ${SETTLE_WIRE.PROGRAM_COMPILER}`);
console.log(
  `validated: tokens ${settle.tokens.join(",")} minOut ${settle.minOut} -> ${settle.recipient}`,
);
