/**
 * A word that is not a value of its type, EXECUTED: what the SauceScript reference
 * (`skills/sauce-script/references/builtins.md`) says a dirty `bool`, `address`, `bytesN` or
 * `function` does — a contract's answer (§13), an `abi.decode` field (§9), an argument of `main`
 * (§4) — and how `try` and `.catch()` meet one, run on the released gated engine (`gated-engine.ts`)
 * on a local anvil. Each `it` is one claim of the reference.
 *
 * The callee is ECHO, whose code answers its calldata after the selector: a method declared
 * `flag(uint256 w) returns (bool)` answers `w` as its `bool`, so a program asks it for any word. A
 * dirty top-level `Address` argument and a dirty element of an `Address[]` one are the settle
 * program's, executed by `verify-execution.e2e.test.ts` ("rejects a dirty recipient …" and the
 * `DIRTY_ADDRESS_WORD` traps), and are not repeated here.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  bytesToHex,
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  hexToBigInt,
  http,
  parseAbi,
  toFunctionSelector,
} from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { encodeEntryArguments, type EntryValue } from "../../src/routes/entry.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { startGatedEngine } from "./gated-engine.js";
import type { GatedEngine } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
      '"Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}

/** Anvil's first dev account: the harness's deployer, and the Pot's owner. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

const PORT = freePortSync();
const transport = http(`http://127.0.0.1:${PORT}`, {
  fetchOptions: { headers: { connection: "close" } },
});
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

let anvil: ChildProcess;
let sauce: GatedEngine;

/** Answers its calldata after the selector: CALLDATASIZE 4 SWAP1 SUB DUP1 4 0 CALLDATACOPY 0 RETURN. */
const ECHO = "0x00000000000000000000000000000000000000e1" as Address;
const ECHO_RUNTIME = "0x36600490038060045f375ff3" as Hex;
/** Reverts with no data: PUSH1 0 PUSH1 0 REVERT. */
const REVERTER = "0x00000000000000000000000000000000000000e2" as Address;
const REVERTER_RUNTIME = "0x60006000fd" as Hex;
/** Stops at once and answers nothing: too short for any declared output. */
const SILENT = "0x00000000000000000000000000000000000000e3" as Address;
const SILENT_RUNTIME = "0x00" as Hex;

/** ECHO's methods: each answers its inputs' words, laid out as the output it declares. */
const ECHO_ABI = [
  ...parseAbi([
    "struct Pair { uint256 n; address who; }",
    "function flag(uint256 w) view returns (bool)",
    "function who(uint256 w) view returns (address)",
    "function small(uint256 w) view returns (uint8)",
    "function sel(uint256 w) view returns (bytes4)",
    "function word(uint256 w) view returns (bytes32)",
    "function pair(uint256 n, uint256 w) view returns (uint256 n, address who)",
    "function st(uint256 n, uint256 w) view returns (Pair s)",
    "function whos(uint256 offset, uint256 len, uint256 a0, uint256 a1) view returns (address[])",
    "function flags(uint256 offset, uint256 len, uint256 b0, uint256 b1) view returns (bool[])",
  ]),
  // viem's human-readable ABI has no `function` type.
  {
    type: "function",
    name: "fn",
    stateMutability: "view",
    inputs: [{ name: "w", type: "uint256" }],
    outputs: [{ name: "", type: "function" }],
  },
] as Abi;

const BEEF = 0xbeefn;
/** `0xbeef` with bit 160 set: an address word with a bit above its low 160. */
const DIRTY = (1n << 160n) | BEEF;
const BEEF_ADDRESS = "0x000000000000000000000000000000000000beef";
/** The `bytes4` 0x1626ba7e as its word: left-aligned, nothing below it. */
const SELECTOR_WORD = 0x1626ba7en << 224n;

const words = (...values: bigint[]): Hex =>
  encodeAbiParameters(
    values.map(() => ({ type: "uint256" })),
    values,
  );

const compile = (source: string, files: Record<string, string> = {}): CompiledSauceProgram =>
  compileSauceProgram("base", source, {
    contracts: { Echo: { abi: ECHO_ABI } },
    resolve: (path) => {
      const text = files[path.replace(/^\.\//, "")];
      return text === undefined ? undefined : new TextEncoder().encode(text);
    },
  });

/** The cook as an eth_call by the Pot's owner: the first word `main` returns, or "reverted". */
const cook = async (program: CompiledSauceProgram, args: Hex): Promise<bigint | "reverted"> => {
  const data = sauce.cookData(concatHex([bytesToHex(program.bytecode), args]));
  try {
    const { data: out } = await publicClient.call({ account: OWNER.address, data, to: sauce.pot });
    return hexToBigInt(out!.slice(0, 66) as Hex);
  } catch (error) {
    if (/revert/i.test(String((error as Error).message))) return "reverted";
    throw error;
  }
};

/** `main(...values)`. */
const run = (source: string, values: readonly EntryValue[]): Promise<bigint | "reverted"> => {
  const program = compile(source);
  return cook(program, bytesToHex(encodeEntryArguments(program, [...values])));
};

/**
 * `main(...values)` twice: as given, and with bit 160 set in the one argument word that holds
 * `BEEF_ADDRESS`, a word the SDK's encoder never writes.
 */
const cleanAndDirty = async (
  source: string,
  values: readonly EntryValue[],
  files?: Record<string, string>,
): Promise<[bigint | "reverted", bigint | "reverted"]> => {
  const program = compile(source, files);
  const args = bytesToHex(encodeEntryArguments(program, [...values]));
  const word = `000000000000000000000000${BEEF_ADDRESS.slice(2)}`;
  expect(args.split(word)).toHaveLength(2);
  const dirty = args.replace(word, `000000000000000000000001${BEEF_ADDRESS.slice(2)}`) as Hex;

  return [await cook(program, args), await cook(program, dirty)];
};

const ANSWER = (method: string): string =>
  `function main(t: Address, w: Uint256): Uint256 { return Echo.at(t).${method}(w); }`;
/** One call in a try, its answer read; 9 when the try catches. */
const ASSIGNED =
  "function main(t: Address, w: Uint256): Uint256 { let r = 5; try { r = Echo.at(t).flag(w); } catch { r = 9; } return r; }";

describeEvm("dirty bool, address, bytesN and function words, on the released engine", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    );
    await testClient.setCode({ address: ECHO, bytecode: ECHO_RUNTIME });
    await testClient.setCode({ address: REVERTER, bytecode: REVERTER_RUNTIME });
    await testClient.setCode({ address: SILENT, bytecode: SILENT_RUNTIME });
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  describe("§13: a contract's answer, read", () => {
    it("an integer must fit its width", async () => {
      expect(await run(ANSWER("small"), [ECHO, 255n])).toBe(255n);
      expect(await run(ANSWER("small"), [ECHO, 256n])).toBe("reverted");
    }, 60_000);

    it("a bool must be 0 or 1, and reads as the number 1 for true", async () => {
      expect(await run(ANSWER("flag"), [ECHO, 1n])).toBe(1n);
      expect(await run(ANSWER("flag"), [ECHO, 2n])).toBe("reverted");
    }, 60_000);

    it("an address must have no bit set above its low 160", async () => {
      expect(await run(ANSWER("who"), [ECHO, BEEF])).toBe(BEEF);
      expect(await run(ANSWER("who"), [ECHO, DIRTY])).toBe("reverted");
    }, 60_000);

    it("a bytesN must have no bit set below its top N bytes, and a clean one reads as them", async () => {
      expect(await run(ANSWER("sel"), [ECHO, SELECTOR_WORD])).toBe(0x1626ba7en);
      expect(await run(ANSWER("sel"), [ECHO, SELECTOR_WORD | 1n])).toBe("reverted");
    }, 60_000);

    it("a function must have no bit set below its top 24 bytes", async () => {
      expect(await run(ANSWER("fn"), [ECHO, BEEF << 64n])).toBe(BEEF);
      expect(await run(ANSWER("fn"), [ECHO, (BEEF << 64n) | 1n])).toBe("reverted");
    }, 60_000);

    it("a bytes32 fills its word and has nothing to check", async () => {
      const all = (1n << 256n) - 1n;
      expect(await run(ANSWER("word"), [ECHO, all])).toBe(all);
    }, 60_000);

    it("is checked through tuples, structs and arrays: reading one part checks all of it", async () => {
      const parts = [
        ["return Echo.at(t).pair(5, w).n;", BEEF, DIRTY, 5n],
        ["return Echo.at(t).st(5, w).n;", BEEF, DIRTY, 5n],
        ["return Echo.at(t).whos(32, 2, 1, w)[0];", BEEF, DIRTY, 1n],
        ["return Echo.at(t).flags(32, 2, 1, w)[0];", 0n, 2n, 1n],
      ] as const;
      for (const [body, clean, dirty, read] of parts) {
        const source = `function main(t: Address, w: Uint256): Uint256 { ${body} }`;
        expect(await run(source, [ECHO, clean])).toBe(read);
        expect(await run(source, [ECHO, dirty])).toBe("reverted");
      }
    }, 60_000);

    it("a bytesN beside another output is read through evm.call, slicing the returned bytes", async () => {
      // No binding of ECHO declares this method: it would answer `(bytes4 selector, uint256 value)`,
      // the shape a typed call refuses (§13), so the program makes the call raw and slices the two
      // words it returns.
      const source = `function main(t: Address, query: bytes): Uint256 {
  const answer = evm.call(t, 0, query);
  require(answer.length == 64, "two words");
  require(answer.slice(32, 64).toBe() == 5, "amount");
  return answer.slice(0, 4).toBe();
}`;
      const asked = concatHex([
        toFunctionSelector("selectorPair(uint256,uint256)"),
        words(SELECTOR_WORD, 5n),
      ]);
      expect(await run(source, [ECHO, asked])).toBe(0x1626ba7en);
    }, 60_000);

    it("an answer nothing reads is not decoded or checked", async () => {
      const unread =
        "function main(t: Address, w: Uint256): Uint256 { Echo.at(t).flag(w); return 7; }";
      expect(await run(unread, [ECHO, 2n])).toBe(7n);
    }, 60_000);
  });

  describe("§13: try and .catch()", () => {
    it("a .catch() fallback stands in only for a call that failed", async () => {
      const value =
        "function main(t: Address, w: Uint256): Uint256 { const f = Echo.at(t).flag(w).catch(() => { return 0; }); return f + 10; }";
      expect(await run(value, [ECHO, 1n])).toBe(11n);
      expect(await run(value, [REVERTER, 1n])).toBe(10n);
      expect(await run(value, [ECHO, 2n])).toBe("reverted");
      const truth =
        "function main(t: Address, w: Uint256): Uint256 { const f = Echo.at(t).flag(w).catch(() => { return true; }); return f; }";
      expect(await run(truth, [REVERTER, 0n])).toBe(1n);
    }, 60_000);

    it("a try whose body is one call catches that call's failure", async () => {
      expect(await run(ASSIGNED, [REVERTER, 1n])).toBe(9n);
      const statement =
        "function main(t: Address, w: Uint256): Uint256 { let r = 5; try { Echo.at(t).flag(w); } catch { r = 9; } return r; }";
      expect(await run(statement, [REVERTER, 1n])).toBe(9n);
    }, 60_000);

    it("where the body reads the call's answer, it catches the answer's decode and checks", async () => {
      expect(await run(ASSIGNED, [ECHO, 1n])).toBe(1n);
      expect(await run(ASSIGNED, [ECHO, 2n])).toBe(9n);
      expect(await run(ASSIGNED, [SILENT, 1n])).toBe(9n);
      const returned =
        "function main(t: Address, w: Uint256): Uint256 { try { return Echo.at(t).flag(w); } catch { return 9; } }";
      expect(await run(returned, [ECHO, 2n])).toBe(9n);
      const bytes4 =
        "function main(t: Address, w: Uint256): Uint256 { try { return Echo.at(t).sel(w); } catch { return 9; } }";
      expect(await run(bytes4, [ECHO, SELECTOR_WORD | 1n])).toBe(9n);
    }, 60_000);

    it("it does not catch the evaluation of the call's arguments, a dirty answer included", async () => {
      const argument =
        "function main(t: Address, w: Uint256): Uint256 { let r = 5; try { Echo.at(t).who(Echo.at(t).flag(w)); } catch { r = 9; } return r; }";
      expect(await run(argument, [ECHO, 2n])).toBe("reverted");
    }, 60_000);

    it("nor a read of an answer the call gave before the try", async () => {
      const before =
        "function main(t: Address, w: Uint256): Uint256 { let r = 5; const f = Echo.at(t).pair(1, w); try { r = f.n; r = r + 1; } catch { r = 9; } return r; }";
      expect(await run(before, [ECHO, DIRTY])).toBe("reverted");
    }, 60_000);

    it("a multi-statement block catches a checked read in it", async () => {
      const multi =
        "function main(t: Address, w: Uint256): Uint256 { let r = 5; try { r = Echo.at(t).flag(w); r = r + 1; } catch { r = 9; } return r; }";
      expect(await run(multi, [ECHO, 1n])).toBe(2n);
      expect(await run(multi, [ECHO, 2n])).toBe(9n);
    }, 60_000);
  });

  describe("§9: abi.decode", () => {
    it("a bool other than 0 or 1 reverts rather than reading as true", async () => {
      const source = `function main(data: bytes): Uint256 { const [b] = abi.decode(data, ["bool"]); return b ? 1 : 0; }`;
      expect(await run(source, [words(1n)])).toBe(1n);
      expect(await run(source, [words(2n)])).toBe("reverted");
    }, 60_000);

    it("an Address with a bit above its low 160 reverts rather than being cut to fit", async () => {
      const source = `function main(data: bytes): Uint256 { const [a] = abi.decode(data, ["Address"]); return a; }`;
      expect(await run(source, [words(BEEF)])).toBe(BEEF);
      expect(await run(source, [words(DIRTY)])).toBe("reverted");
    }, 60_000);

    it("a field of a record at any depth, and each element of a bool[] or Address[]", async () => {
      const nested = `function main(data: bytes): Uint256 { const [r] = abi.decode(data, ["{Uint256, {Address, Uint256}}"]); return r[0]; }`;
      expect(await run(nested, [words(5n, BEEF, 6n)])).toBe(5n);
      expect(await run(nested, [words(5n, DIRTY, 6n)])).toBe("reverted");
      const addresses = `function main(data: bytes): Uint256 { const [xs] = abi.decode(data, ["Address[]"]); return xs.length; }`;
      expect(await run(addresses, [words(32n, 2n, BEEF, BEEF)])).toBe(2n);
      expect(await run(addresses, [words(32n, 2n, BEEF, DIRTY)])).toBe("reverted");
      const bools = `function main(data: bytes): Uint256 { const [xs] = abi.decode(data, ["bool[]"]); return xs.length; }`;
      expect(await run(bools, [words(32n, 2n, 1n, 0n)])).toBe(2n);
      expect(await run(bools, [words(32n, 2n, 1n, 2n)])).toBe("reverted");
    }, 60_000);

    it("the whole value is checked where it is decoded, whether or not any part is read", async () => {
      const part = `function main(data: bytes): Uint256 { const t = abi.decode(data, ["Uint256", "Address"]); return t[0]; }`;
      expect(await run(part, [words(5n, BEEF)])).toBe(5n);
      expect(await run(part, [words(5n, DIRTY)])).toBe("reverted");
      const unused = `function main(data: bytes): Uint256 { const unused = abi.decode(data, ["Address"]); return 7; }`;
      expect(await run(unused, [words(BEEF)])).toBe(7n);
      expect(await run(unused, [words(DIRTY)])).toBe("reverted");
    }, 60_000);

    it("a try block that runs the decode catches the revert", async () => {
      const alone = `function main(data: bytes): Uint256 { let ok = 1; try { abi.decode(data, ["Address"]); } catch { ok = 0; } return ok; }`;
      expect(await run(alone, [words(BEEF)])).toBe(1n);
      expect(await run(alone, [words(DIRTY)])).toBe(0n);
      const multi = `function main(data: bytes): Uint256 { let ok = 1; try { const [a] = abi.decode(data, ["Address"]); ok = a + 1; } catch { ok = 0; } return ok; }`;
      expect(await run(multi, [words(BEEF)])).toBe(BEEF + 1n);
      expect(await run(multi, [words(DIRTY)])).toBe(0n);
    }, 60_000);

    it("a statement .catch() on a decode keeps only the call and decodes nothing", async () => {
      const source = `function main(t: Address, d: bytes): Uint256 { let caught = 0; abi.decode(evm.call(t, 0, d), ["Address"]).catch(() => { caught = 1; }); return caught; }`;
      const asked = concatHex([toFunctionSelector("who(uint256)"), words(DIRTY)]);
      expect(await run(source, [ECHO, asked])).toBe(0n);
      expect(await run(source, [REVERTER, asked])).toBe(1n);
    }, 60_000);
  });

  describe("§4: main's arguments", () => {
    it("a bool word other than 0 or 1 reverts before the body runs", async () => {
      const program = compile("function main(f: bool): Uint256 { return f ? 1 : 0; }");
      expect(await cook(program, words(1n))).toBe(1n);
      expect(await cook(program, words(2n))).toBe("reverted");
    }, 60_000);

    it("an Address word with a bit above its low 160 reverts, though the body never reads it", async () => {
      expect(
        await cleanAndDirty("function main(a: Address): Uint256 { return 7; }", [BEEF_ADDRESS]),
      ).toEqual([7n, "reverted"]);
    }, 60_000);

    it("so does an Account word", async () => {
      expect(
        await cleanAndDirty("function main(a: Account): Uint256 { return a; }", [BEEF_ADDRESS]),
      ).toEqual([BEEF, "reverted"]);
    }, 60_000);

    it("inside a record parameter, an array of records and an interface the module declares", async () => {
      const record = { a: BEEF_ADDRESS, n: 5n };
      expect(
        await cleanAndDirty(
          "function main(r: { a: Address, n: Uint256 }): Uint256 { return r.n; }",
          [record],
        ),
      ).toEqual([5n, "reverted"]);
      expect(
        await cleanAndDirty(
          "function main(rs: { a: Address, n: Uint256 }[]): Uint256 { return rs.length; }",
          [[record]],
        ),
      ).toEqual([1n, "reverted"]);
      expect(
        await cleanAndDirty(
          "interface P { who: Address; n: Uint256 }\nfunction main(p: P): Uint256 { return p.n; }",
          [{ who: BEEF_ADDRESS, n: 5n }],
        ),
      ).toEqual([5n, "reverted"]);
    }, 60_000);

    it("an Address field of an interface the module imports is not checked, and arrives whole", async () => {
      expect(
        await cleanAndDirty(
          'import { P } from "./types.ts";\nfunction main(p: P): Uint256 { return p.who; }',
          [{ who: BEEF_ADDRESS, n: 5n }],
          { "types.ts": "export interface P { who: Address; n: Uint256 }\n" },
        ),
      ).toEqual([BEEF, DIRTY]);
    }, 60_000);
  });
});
