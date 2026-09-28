/**
 * ERC-20 writes that DECODE NOTHING — the USDT-safe lowering of `approve`/`transfer`.
 *
 * THE BUG THIS EXISTS FOR, established by execution rather than inference (see
 * `fix/settle-no-return-token`, which found the same thing in the settle sweep): compiler 2.3.0
 * lowers a call whose ABI declares an output to call-THEN-DECODE, even when the program discards
 * the result, and decoding a `bool` from EMPTY returndata reverts on this engine. The vendored
 * `IERC20` artifact declares `approve`/`transfer`/`transferFrom` as returning `bool`. USDT returns
 * nothing. So `IERC20.at(usdt).approve(portal, amount)` reverts — and, inside a route call, takes
 * the entire fulfilment with it. A mintable standard ERC20 never shows this, which is why it can
 * live in a green test suite indefinitely.
 *
 * THE FIX, and why it is this one. The calldata is built off-chain by the SAME viem encoder every
 * other ERC-20 call in this SDK goes through, cut at the words that are only known at run time, and
 * reassembled by the program with `.concat` — the identical mechanism `routes/template.ts` uses to
 * splice an intent. `evm.call` hands the callee raw bytes and is given no ABI, so there is no
 * declared output and nothing to decode. The alternative, an output-free `IERC20Unchecked` artifact,
 * is cleaner to read at the call site but arrives through `sync-engine-artifacts` — a generated
 * artifact, a CI file-count assertion and a CLAUDE.md line, all of which live on an unmerged branch.
 * This module needs none of that and lands alone.
 *
 * WHAT IS NOT GIVEN UP. Skipping the DECODE is not skipping the CHECK: `evm.call` still propagates a
 * callee revert, so a token that genuinely refuses the write still reverts the whole fulfilment.
 * That is asserted by execution in `routes-nest-dynamic.e2e.test.ts` against a fixture that refuses
 * a nonzero-to-nonzero allowance change, exactly as USDT does. What IS given up is the `false`
 * return that a well-behaved non-reverting token could signal — a shape no real token uses, and one
 * the previous code did not check either: it decoded the bool and threw it away.
 *
 * Not applied repo-wide on purpose. `token/evm.ts`'s `Token.transfer`/`Token.approve` statements and
 * `deposit/source.ts`'s approve emit the same `IERC20` shape and carry the same hazard; they are out
 * of this change's scope and flagged rather than silently altered.
 */
import { encodeFunctionData, getAbiItem, type AbiFunction, type Hex } from "viem";

import { ERC20ABI } from "../protocols/erc20/abis.js";

/** One ABI word: a build-time constant, or the name of a SauceScript local holding it. */
export type WordArg = { readonly literal: bigint } | { readonly local: string };

/** Distinctive values with no chance of being a real spender or amount, planted in the run-time
 *  positions so the cut points can be FOUND rather than assumed. Two of them because viem validates
 *  an `address` argument as 20 bytes and will not accept a full word there. */
const ADDRESS_SENTINEL = "0x5a0ce00000000000000000000000000000000ce5" as const;
const UINT_SENTINEL = (1n << 255n) + 0x5a0cen;

function isLocal(arg: WordArg): arg is { readonly local: string } {
  return "local" in arg;
}

/** The declared input types of `fn`, so an argument is encoded as whatever the ABI says it is
 *  rather than as whatever this file assumed. */
function inputTypes(fn: "approve" | "transfer"): readonly string[] {
  const item = getAbiItem({ abi: ERC20ABI, name: fn }) as AbiFunction | undefined;
  if (item === undefined) throw new Error(`token/unchecked: ERC20ABI declares no ${fn}`);

  return item.inputs.map((input) => input.type);
}

function encodeArg(type: string, arg: WordArg): unknown {
  if (type === "address") {
    return isLocal(arg)
      ? ADDRESS_SENTINEL
      : (`0x${arg.literal.toString(16).padStart(40, "0")}` as Hex);
  }

  return isLocal(arg) ? UINT_SENTINEL : arg.literal;
}

/** The 32-byte word `encodeArg`'s sentinel occupies, as lowercase hex without `0x`. */
function sentinelWord(type: string): string {
  return type === "address"
    ? ADDRESS_SENTINEL.slice(2).padStart(64, "0")
    : UINT_SENTINEL.toString(16).padStart(64, "0");
}

/**
 * `<fn>(<args>)` calldata with every LITERAL argument already encoded, returned as the byte runs
 * either side of the run-time words.
 *
 * Built by encoding the real call through viem with a sentinel in each run-time position and then
 * cutting there, rather than by concatenating a hand-written selector with hand-padded words: the
 * selector and the padding are then the encoder's, not this file's, and cannot drift from the ABI
 * the rest of the SDK calls with. The sentinel is checked to land where expected, so a change in
 * argument order fails here instead of shipping a mis-ordered call.
 */
function chunksFor(fn: "approve" | "transfer", args: readonly WordArg[]): readonly Hex[] {
  const types = inputTypes(fn);
  if (types.length !== args.length) {
    throw new Error(
      `token/unchecked: ERC20ABI declares ${fn} with ${types.length} argument(s), got ${args.length}`,
    );
  }
  const encoded = encodeFunctionData({
    abi: ERC20ABI,
    functionName: fn,
    args: args.map((arg, i) => encodeArg(types[i]!, arg)) as never,
  }).toLowerCase() as Hex;
  const body = encoded.slice(10); // strip the 4-byte selector

  const chunks: Hex[] = [];
  let cursor = 0;
  for (const [index, arg] of args.entries()) {
    if (!isLocal(arg)) continue;
    const at = body.indexOf(sentinelWord(types[index]!), cursor);
    if (at === -1 || at % 64 !== 0 || at / 64 !== index) {
      throw new Error(
        `token/unchecked: ${fn} argument ${index} did not encode to word ${index} — the ERC20 ABI's ` +
          "argument order has moved and this lowering would emit a mis-ordered call.",
      );
    }
    chunks.push(`0x${body.slice(cursor, at)}` as Hex);
    cursor = at + 64;
  }
  chunks.push(`0x${body.slice(cursor)}` as Hex);

  // Only the FIRST run carries the selector; every later one is a pure byte run, and the run BETWEEN
  // two adjacent run-time words is legitimately empty (`transfer(local, local)` has one).
  chunks[0] = `0x${encoded.slice(2, 10)}${chunks[0]!.slice(2)}` as Hex;

  return chunks;
}

/**
 * The statements that issue one ERC-20 write with no output decode.
 *
 * `prefix` namespaces the locals this introduces, the same discipline `nest.ts` and
 * `nest-dynamic.ts` already use so several of these merge into one program scope. Each literal byte
 * run is bound to its own `const` before `.concat` is called on it — a method call directly on a
 * `hex` literal is outside the compiler's M1 subset.
 */
function statementsFor(
  fn: "approve" | "transfer",
  prefix: string,
  token: string,
  args: readonly WordArg[],
): readonly string[] {
  const chunks = chunksFor(fn, args);
  const statements: string[] = [];
  const names = chunks.map((chunk, i) => {
    const name = `${prefix}${fn === "approve" ? "ap" : "tr"}${i}`;
    statements.push(`const ${name} = hex\`${chunk.slice(2)}\`;`);
    return name;
  });

  let expr = names[0]!;
  let chunkIndex = 1;
  for (const arg of args) {
    if (!isLocal(arg)) continue;
    expr += `.concat(${arg.local}.toBytesBe(32))`;
    // The trailing run after the LAST run-time word is empty whenever that word is last; binding and
    // concatenating it would cost bytecode for nothing.
    if (chunks[chunkIndex] !== "0x") expr += `.concat(${names[chunkIndex]!})`;
    chunkIndex++;
  }
  statements.push(`evm.call(${token}, 0n, ${expr});`);

  // Drop the consts for the runs that were skipped above, so the program declares nothing unused.
  return statements.filter((s) => {
    const declared = /^const (\w+) =/.exec(s);
    return declared === null || expr.includes(declared[1]!) || names[0] === declared[1];
  });
}

/** `approve(spender, amount)` with no output decode. */
export function uncheckedApproveStatements(
  prefix: string,
  token: string,
  spender: WordArg,
  amount: WordArg,
): readonly string[] {
  return statementsFor("approve", prefix, token, [spender, amount]);
}

/** `transfer(to, amount)` with no output decode. */
export function uncheckedTransferStatements(
  prefix: string,
  token: string,
  to: WordArg,
  amount: WordArg,
): readonly string[] {
  return statementsFor("transfer", prefix, token, [to, amount]);
}
