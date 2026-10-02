/**
 * ERC-20 writes with OpenZeppelin `SafeERC20` semantics, in SauceScript.
 *
 * WHY NOT THE OBVIOUS THING. The vendored `IERC20` declares `transfer`/`approve` as returning
 * `bool`, and compiler 2.3.0 lowers a declared output to call-THEN-DECODE even when the program
 * discards it. Decoding from empty returndata reverts on this engine, so `IERC20.at(usdt).approve(…)`
 * reverts on any token that returns nothing — USDT among them.
 *
 * The first fix here skipped the decode entirely. That cured the revert and bought two silent
 * failures with it, both of which `SafeERC20` exists to prevent:
 *
 *  - a token that returns `false` instead of reverting was treated as success — value lost, quietly;
 *  - a call to an address with no code "succeeded", because a call to an EOA always does.
 *
 * WHAT THIS EMITS is `SafeERC20`'s check: issue the call as raw bytes so nothing is decoded on the
 * way out, then look at what came back. Empty returndata is accepted only if the target HAS code;
 * anything else must be an ABI word equal to `1`. A callee that reverts still reverts, because
 * `evm.call` bubbles it.
 *
 * ```
 * const r = evm.call(token, 0n, calldata);
 * if (r.length == 0) { require(ctx.codeSize(token) > 0); }
 * else { const [rok] = abi.decode(r, ["Uint256"]); require(rok == 1n); }
 * ```
 *
 * The decode is load-bearing, not ceremony. It refuses fewer than 32 bytes and reads only the first
 * word of a longer return, which is what OpenZeppelin does. `r.toBe()`, the obvious alternative,
 * zero-pads a 1- or 31-byte return into a `1` and accepts it, and refuses a 64-byte return whose
 * first word is `1` — wrong in both directions, and exactly what this file emitted until the
 * execution matrix in `test/std/token/evm.e2e.test.ts` ran it beside OpenZeppelin.
 *
 * APPROVE ALSO HANDLES USDT'S RULE, which is `forceApprove`'s job. USDT reverts when a non-zero
 * allowance is changed to another non-zero value, and that is not a theoretical hazard here: every
 * intent on a chain shares ONE Executor-owned Pot, so a residual allowance left by an earlier
 * fulfilment breaks the next one. OZ tries the approve and falls back on catching the revert; a
 * reverting `evm.call` cannot be caught in a Sauce program, so this READS the allowance first — a
 * `uint256`, always safe to decode — and emits a reset to zero only when it is non-zero. Same end
 * state, decided before the call instead of after, at the cost of one STATICCALL.
 *
 * The calldata itself is built off-chain by the same viem encoder every other ERC-20 call in this
 * SDK goes through, cut at the words only known at run time, and reassembled by the program with
 * `.concat` — the mechanism `routes/template.ts` uses to splice an intent.
 *
 * `@sauce/token`'s EVM writes have the same semantics, as library functions. This file does not call
 * them, and stays INLINE on purpose: the settle recipe is compiled by partners whose resolver serves
 * only `./artifacts/IERC20.json`, so an emitted program cannot assume the library resolves.
 * `test/std/token/evm.e2e.test.ts` holds the two to one behaviour, running both — and OpenZeppelin's
 * own `SafeERC20` — over the same matrix of tokens.
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
function inputTypes(fn: "approve" | "transfer" | "allowance"): readonly string[] {
  const item = getAbiItem({ abi: ERC20ABI, name: fn }) as AbiFunction | undefined;
  if (item === undefined) throw new Error(`token/safe: ERC20ABI declares no ${fn}`);

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
function chunksFor(
  fn: "approve" | "transfer" | "allowance",
  args: readonly WordArg[],
): readonly Hex[] {
  const types = inputTypes(fn);
  if (types.length !== args.length) {
    throw new Error(
      `token/safe: ERC20ABI declares ${fn} with ${types.length} argument(s), got ${args.length}`,
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
        `token/safe: ${fn} argument ${index} did not encode to word ${index} — the ERC20 ABI's ` +
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
  const resultVar = `${prefix}${fn === "approve" ? "ar" : "tr"}`;
  statements.push(`const ${resultVar} = evm.call(${token}, 0, ${expr});`);
  statements.push(optionalReturnCheck(resultVar, token));

  // Drop the byte-run consts that were skipped above, so the program declares nothing unused. Only
  // the `hex` chunks are candidates: the result const is named in the check below the call, not in
  // the concat expression, and filtering on that would delete the call itself.
  const unused = new Set(names.filter((name) => name !== names[0] && !expr.includes(name)));

  return statements.filter((line) => {
    const declared = /^const (\w+) = hex`/.exec(line);
    return declared === null || !unused.has(declared[1]!);
  });
}

/**
 * The `SafeERC20` check over the result of a write already issued into `resultVar`: empty
 * returndata is success only from an address that has code, and anything else must decode as a
 * word equal to 1 — see the header for why it is a decode and not `toBe()`.
 */
function optionalReturnCheck(resultVar: string, token: string): string {
  return (
    `if (${resultVar}.length == 0) { require(ctx.codeSize(${token}) > 0); } ` +
    `else { const [${resultVar}ok] = abi.decode(${resultVar}, ["Uint256"]); ` +
    `require(${resultVar}ok == 1); }`
  );
}

/** `transfer(to, amount)`, checked the way `SafeERC20.safeTransfer` checks it. */
export function safeTransferStatements(
  prefix: string,
  token: string,
  to: WordArg,
  amount: WordArg,
): readonly string[] {
  return statementsFor("transfer", prefix, token, [to, amount]);
}

/**
 * `approve(spender, amount)`, checked like `SafeERC20` and reset like `forceApprove`.
 *
 * Emits, in order: read the current allowance from this contract to `spender`; if it is non-zero,
 * `approve(spender, 0)` and check that; then `approve(spender, amount)` and check that. A token
 * that refuses either call still reverts the whole execution.
 */
export function safeApproveStatements(
  prefix: string,
  token: string,
  spender: WordArg,
  amount: WordArg,
): readonly string[] {
  const selfVar = `${prefix}self`;
  const allowanceVar = `${prefix}cur`;
  const statements: string[] = [`const ${selfVar} = ctx.self();`];

  // `allowance(owner, spender)` — a `uint256` return, so this one is safe to decode normally. The
  // owner is the executing contract, which is only known at run time, so it is spliced like any
  // other run-time word.
  const query = chunksFor("allowance", [{ local: selfVar }, spender]);
  const queryVars = query.map((chunk, i) => {
    statements.push(`const ${prefix}q${i} = hex\`${chunk.slice(2)}\`;`);
    return `${prefix}q${i}`;
  });
  let queryExpr = `${queryVars[0]!}.concat(${selfVar}.toBytesBe(32))`;
  if (query[1] !== "0x") queryExpr += `.concat(${queryVars[1]!})`;
  if (isLocal(spender)) {
    queryExpr += `.concat(${spender.local}.toBytesBe(32))`;
    if (query[2] !== undefined && query[2] !== "0x") queryExpr += `.concat(${queryVars[2]!})`;
  }
  statements.push(
    `const ${prefix}qd = ${queryExpr};`,
    `const ${prefix}qr = evm.static(${token}, ${prefix}qd);`,
    `const [${allowanceVar}] = abi.decode(${prefix}qr, ["Uint256"]);`,
  );

  // The reset, only when there is something to reset. USDT refuses a non-zero -> non-zero change,
  // and a shared Pot is exactly where a stale allowance is waiting.
  const reset = statementsFor("approve", `${prefix}z`, token, [spender, { literal: 0n }]);
  statements.push(`if (${allowanceVar} > 0) {`, ...reset.map((line) => `  ${line}`), `}`);
  statements.push(...statementsFor("approve", prefix, token, [spender, amount]));

  return statements;
}
