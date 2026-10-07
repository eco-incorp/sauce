/**
 * Shared harness for the `swap-*.mainnet.test.ts` suites, which EXECUTE `@sauce/router` on captured
 * chain state through the released engine, Kitchen, Pot and Router. NOT a `.test.ts`.
 *
 * Each venue is called two ways from the same snapshot with the same funding, so the outputs can
 * be compared exactly and the gas and program bytes attributed:
 *
 *   - `library`: a Sauce program calling the `@sauce/router` function with literal arguments;
 *   - `runtime`: the same function called with every pool, token and amount a `main` argument, the
 *     shape a program that chooses its venue while it runs has;
 *
 * and once more through the action that lowers to it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  keccak256,
  pad,
  parseAbi,
  toBytes,
  toHex,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

import { compile, resolveSdkModule, resolveSdkPackage } from "../../sdk/dist/compiler.js";
import { compileSauceRoute } from "../../sdk/dist/routes/sauce-route.js";
import { compileProgram } from "../src/index.js";
import type { Action } from "../src/types.js";
import { REPO_ROOT, type Anvil } from "./anvil.js";

export const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
]);

export const balanceOf = (env: Anvil, token: string, owner: string): Promise<bigint> =>
  env.publicClient.readContract({
    address: token as Address,
    abi: erc20,
    functionName: "balanceOf",
    args: [owner as Address],
  }) as Promise<bigint>;

export const allowance = (env: Anvil, token: string, owner: string, spender: string) =>
  env.publicClient.readContract({
    address: token as Address,
    abi: erc20,
    functionName: "allowance",
    args: [owner as Address, spender as Address],
  }) as Promise<bigint>;

/** Where a token keeps `balanceOf[holder]`: its mapping's slot, and the language's key order. */
export interface BalanceSlot {
  readonly slot: bigint;
  /** Vyper hashes `slot ++ key`; Solidity `key ++ slot`. */
  readonly vyper?: boolean;
}

/** Writes `amount` as `holder`'s balance of `token`, and checks the token reads it back. */
export async function setBalance(
  env: Anvil,
  token: string,
  where: BalanceSlot,
  holder: string,
  amount: bigint,
): Promise<void> {
  const key = where.vyper
    ? encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }],
        [where.slot, holder as Address],
      )
    : encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [holder as Address, where.slot],
      );
  await env.testClient.setStorageAt({
    address: token as Address,
    index: keccak256(key),
    value: pad(toHex(amount)),
  });
  assert.equal(
    await balanceOf(env, token, holder),
    amount,
    `${token}'s balance slot is not ${where.slot}`,
  );
}

/** Writes `holder`'s allowance for `spender` — a Solidity `allowance[owner][spender]` at `slot`. */
export async function setAllowance(
  env: Anvil,
  token: string,
  slot: bigint,
  owner: string,
  spender: string,
  amount: bigint,
): Promise<void> {
  const inner = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner as Address, slot]),
  );
  const index = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender as Address, inner]),
  );
  await env.testClient.setStorageAt({
    address: token as Address,
    index,
    value: pad(toHex(amount)),
  });
  assert.equal(
    await allowance(env, token, owner, spender),
    amount,
    `${token}'s allowance slot is not ${slot}`,
  );
}

/** A SauceScript argument: an address or a number as a literal word, a bool as itself. */
export type Arg = string | bigint | number | boolean;

function literal(arg: Arg): string {
  if (typeof arg === "boolean") return String(arg);
  if (arg === "self") return "ctx.self()";
  return `${BigInt(arg)}n`;
}

/** `name(args)` as a SauceScript call, with every argument a literal. */
export function call(name: string, args: readonly Arg[]): string {
  return `${name}(${args.map(literal).join(", ")})`;
}

/**
 * A program that runs `calls` (expressions or statements) in order, importing what it names from
 * `@sauce/router`. Each call is an expression statement: what it returned is not kept.
 */
export function routerProgram(
  calls: readonly string[],
  extraImports: readonly string[] = [],
): string {
  const names = [
    ...new Set(
      calls.flatMap((c) =>
        [
          ...c.matchAll(
            /\b(try[A-Z]\w*|uniswapV[234]|curve|balancerV2|dodoV2|traderJoeLB|woofi|maverickV2|infinityCL|infinityBin)\(/g,
          ),
        ].map((m) => m[1]!),
      ),
    ),
  ].sort();

  return [
    `import { ${names.join(", ")} } from "@sauce/router";`,
    ...extraImports,
    "",
    "function main() {",
    ...calls.map(
      (c) => `  ${c.trimEnd().endsWith(";") || c.trimEnd().endsWith("}") ? c : `${c};`}`,
    ),
    "}",
    "",
  ].join("\n");
}

/**
 * A program compiled for `chain` the way a route compiles it: `compileSauceRoute`, nothing else.
 * `contracts` binds ABIs by name, for a hand-written contrast program that calls a pool itself.
 */
export function compileSource(
  env: Anvil,
  chain: string,
  source: string,
  contracts?: Record<string, { abi: unknown[] }>,
): Uint8Array {
  return compileSauceRoute(
    chain,
    source,
    { pot: env.pot, engine: env.engine },
    contracts ? { contracts: contracts as never } : {},
  ).compiled.bytecode[0]!;
}

/** One of `@sauce/router`'s own pool ABIs, as a `contracts` entry. */
export function libraryAbi(file: string): { abi: unknown[] } {
  const text = new TextDecoder().decode(resolveSdkModule(`/@eco-incorp/sauce/std/router/${file}`)!);

  return { abi: (JSON.parse(text) as { abi: unknown[] }).abi };
}

/** The library call `name(args)` alone, compiled with literal arguments. */
export function libraryCall(
  env: Anvil,
  chain: string,
  name: string,
  args: readonly Arg[],
): Uint8Array {
  return compileSource(env, chain, routerProgram([call(name, args)]));
}

/** The native coin, as `@sauce/router` names it: the zero address. */
export const NATIVE = "0x0000000000000000000000000000000000000000";

/** `token`'s balance of `holder`, the native coin's for the zero address. */
export const held = (env: Anvil, token: string, holder: string): Promise<bigint> =>
  token === NATIVE
    ? env.publicClient.getBalance({ address: holder as Address })
    : balanceOf(env, token, holder);

/** Every `[token, holder]` balance, in order. */
export const balances = (
  env: Anvil,
  watch: ReadonlyArray<readonly [string, string]>,
): Promise<bigint[]> => Promise.all(watch.map(([token, holder]) => held(env, token, holder)));

/** `name(args)` in a program that requires it to return `expected`, so a landed cook proves it. */
export function returning(name: string, args: readonly Arg[], expected: bigint): string {
  return routerProgram([`const out = ${call(name, args)};`, `require(out == ${expected}n);`]);
}

/**
 * A `try` form skipping: `name(args)` returns 0, the cook lands, and every balance in `watch` — the
 * Pot's and the pool's — is what it was. Returns the cook's receipt.
 */
export async function assertSkips(
  env: Anvil,
  chain: string,
  name: string,
  args: readonly Arg[],
  watch: ReadonlyArray<readonly [string, string]>,
): Promise<TransactionReceipt> {
  const before = await balances(env, watch);
  const receipt = await env.cook(compileSource(env, chain, returning(name, args, 0n)));
  assert.equal(receipt.status, "success", `${name} did not land returning 0`);
  assert.deepEqual(await balances(env, watch), before, `${name} moved something`);

  return receipt;
}

/** `name(args)` reverts the whole cook, and every balance in `watch` is what it was. */
export async function assertReverts(
  env: Anvil,
  chain: string,
  name: string,
  args: readonly Arg[],
  watch: ReadonlyArray<readonly [string, string]>,
): Promise<void> {
  const before = await balances(env, watch);
  const receipt = await env.cook(compileSource(env, chain, routerProgram([call(name, args)])));
  assert.equal(receipt.status, "reverted", `${name} landed`);
  assert.deepEqual(await balances(env, watch), before, `${name} moved something`);
}

/** How a `main` parameter is declared and ABI-encoded. */
const PARAM: Readonly<Record<string, { sauce: string; abi: AbiParameter }>> = {
  address: { sauce: "Address", abi: { type: "address" } },
  uint256: { sauce: "Uint256", abi: { type: "uint256" } },
  bool: { sauce: "bool", abi: { type: "bool" } },
};

/**
 * A standalone program with typed `main` parameters, compiled the way a partner compiles one: the
 * raw compiler, falling back to the SDK's own modules (`@sauce/router`, `@sauce/token`, the ABIs).
 * A route body takes no arguments, so this is not `compileSauceRoute`.
 */
export function compileStandalone(source: string): Uint8Array {
  const entry = new TextEncoder().encode(source);

  return compile({
    target: "evm",
    resolve: (path) => (path === "main.js" ? entry : resolveSdkModule(path)),
    resolvePackage: (specifier) => resolveSdkPackage(specifier),
  }).bytecode;
}

/**
 * The library call `name(args)` with every argument but `ctx.self()` a `main` parameter, compiled
 * once and given its values as ABI-v1 arguments appended to the bytecode — so no pool, token or
 * amount is known to the compiler.
 */
export function runtimeCall(
  name: string,
  args: readonly { readonly type: "address" | "uint256" | "bool"; readonly value: Arg }[],
): Uint8Array {
  const params = args.map(
    (a, i) => `${a.value === "self" ? "" : `p${i}: ${PARAM[a.type]!.sauce}`}`,
  );
  const declared = params.filter((p) => p !== "");
  const passed = args.map((a, i) => (a.value === "self" ? "ctx.self()" : `p${i}`));
  const source = [
    `import { ${name} } from "@sauce/router";`,
    "",
    `function main(${declared.join(", ")}): void {`,
    `  ${name}(${passed.join(", ")});`,
    "}",
    "",
  ].join("\n");
  const bytecode = compileStandalone(source);
  const values = args.filter((a) => a.value !== "self");
  const encoded = encodeAbiParameters(
    values.map((a) => PARAM[a.type]!.abi),
    values.map((a) =>
      a.type === "bool"
        ? a.value
        : a.type === "address"
          ? (a.value as Address)
          : BigInt(a.value as bigint),
    ),
  );

  return toBytes(concat([toHex(bytecode), encoded]));
}

/** `actions` compiled standalone on `chainId`, as `compileProgram` does. */
export function actionProgram(chainId: number, actions: Action[]): Uint8Array {
  return compileProgram({ version: 1, chainId, actions }).bytecode;
}

/** One measured cook. */
export interface Measurement {
  readonly venue: string;
  readonly path: "library" | "runtime" | "action";
  readonly bytes: number;
  readonly gas: bigint;
  readonly out: bigint;
}

export const MEASUREMENTS: Measurement[] = [];

/** Cooks `program` and records it; the receipt must succeed. `out` is read by the caller. */
export async function measure(
  env: Anvil,
  venue: string,
  path: Measurement["path"],
  program: Uint8Array,
  delivered: () => Promise<bigint>,
): Promise<{ receipt: TransactionReceipt; out: bigint }> {
  const receipt = await env.cook(program);
  assert.equal(receipt.status, "success", `${venue} ${path} reverted`);
  const out = await delivered();
  MEASUREMENTS.push({ venue, path, bytes: program.length, gas: receipt.gasUsed, out });

  return { receipt, out };
}

/** The measurements as a table: venue, then bytes · gasUsed for each path that ran. */
export function printMeasurements(chain: string): void {
  const venues = [...new Set(MEASUREMENTS.map((m) => m.venue))];
  const paths = ["library", "runtime", "action"] as const;
  const rows = venues.map((venue) => {
    const cells = paths.map((path) => {
      const m = MEASUREMENTS.find((x) => x.venue === venue && x.path === path);
      return m === undefined ? "—" : `${m.bytes} B · ${m.gas}`;
    });
    const out = MEASUREMENTS.find((m) => m.venue === venue)?.out;
    return `| ${venue} | ${cells.join(" | ")} | ${out} |`;
  });
  console.log(
    [
      `\n${chain}: program bytes · cook gasUsed`,
      "| venue | @sauce/router, literal args | @sauce/router, run-time args | action | delivered |",
      "|---|---|---|---|---|",
      ...rows,
    ].join("\n"),
  );
}

/** A misbehaving-token fixture from `sdk/test/std/token/fixtures`, deployed and minted to `to`. */
export async function deployToken(
  env: Anvil,
  name: "FalseReturnERC20" | "NoReturnERC20",
  to: string,
  amount: bigint,
): Promise<Address> {
  const fixture = JSON.parse(
    readFileSync(resolve(REPO_ROOT, `sdk/test/std/token/fixtures/${name}.json`), "utf8"),
  ) as { abi: Abi; creationCode: Hex };
  const args =
    name === "NoReturnERC20"
      ? encodeAbiParameters(
          [{ type: "string" }, { type: "string" }, { type: "uint8" }],
          ["No Return", "NRT", 18],
        )
      : "0x";
  const nonce = await env.publicClient.getTransactionCount({ address: env.account.address });
  const receipt = await env.send({
    to: undefined as unknown as Address,
    data: `${fixture.creationCode}${args.slice(2)}` as Hex,
  });
  assert.equal(receipt.status, "success");
  const address =
    receipt.contractAddress ??
    getContractAddress({ from: env.account.address, nonce: BigInt(nonce) });
  const minted = await env.walletClient.writeContract({
    address,
    abi: erc20,
    functionName: "mint",
    args: [to as Address, amount],
    account: env.account,
    chain: env.chain,
  });
  await env.publicClient.waitForTransactionReceipt({ hash: minted });

  return address;
}

/** Runtime that reverts every call: a Router that has none of the pay-first venues, or none at all. */
export const REVERTING_CODE = "0x5f5ffd" as Hex;
