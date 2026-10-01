/**
 * `sauce globals`, `sauce inspect` and `sauce verify`, in process and offline — and the two SDK
 * pieces they stand on: `sourceGlobals` (held to the protocol-accessor rewrite it lists for, in both
 * directions) and `decodeEntryArguments` (held to `encodeEntryArguments`, strictly). Reading a
 * transaction back off a chain is `cli.e2e.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bytesToHex,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  keccak256,
  numberToHex,
  type Address,
  type Hex,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { v12Pot } from "../src/evm/engine.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { ERC20ABI } from "../src/protocols/erc20/abis.js";
import { NAMESPACE_KEYS, resolveNamespace } from "../src/routes/accessor-index.js";
import { chainDefines } from "../src/routes/ambient.js";
import { encodeRoute, hashIntent } from "../src/routes/encode.js";
import { decodeEntryArguments, encodeEntryArguments } from "../src/routes/entry.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import { predictIntentVault } from "../src/routes/portal.js";
import { rewriteProtocolAccessors } from "../src/routes/protocol-rewrite.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { sourceGlobals } from "../src/routes/source-globals.js";
import { SVM_TOKEN_REGISTRY, TOKEN_REGISTRY } from "../src/routes/token-registry.js";
import {
  SETTLE_PROGRAM,
  SETTLE_REJECTIONS,
  SETTLE_VECTORS,
  SETTLE_WIRE,
  settlePayload,
} from "../src/verify/index.js";

const OWNER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const CREATOR: Address = "0x3333333333333333333333333333333333333333";
const ENGINE = getAddress(v12EngineAddress());
const INTENT_FLAGS = ["--intent-deadline", "2000000000", "--intent-creator", CREATOR];

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };

  return { code: await runCli(argv, io), stdout, stderr };
}

const json = (run: Run): Record<string, unknown> => {
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);

  return JSON.parse(run.stdout) as Record<string, unknown>;
};

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-inspect-"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const file = (name: string, text: string): string => {
  const path = join(work, name);
  mkdirSync(work, { recursive: true });
  writeFileSync(path, text);

  return path;
};

// ---------------------------------------------------------------------------------------------

describe("sourceGlobals: the names a program on a chain may use", () => {
  it("lists exactly the namespaces and contracts the accessor rewrite resolves, at its addresses", () => {
    for (const slug of ["ethereum", "base", "arbitrum"]) {
      const chain = requireChain(slug);
      const listed = new Map<string, string>();
      for (const ns of sourceGlobals(chain).protocols) {
        for (const contract of ns.contracts) {
          listed.set(`${ns.namespace}.${contract.name}`, contract.address);
        }
      }
      expect(listed.size).toBeGreaterThan(0);
      for (const key of NAMESPACE_KEYS) {
        const ns = resolveNamespace(key)!;
        const names =
          ns.kind === "protocol" ? [...ns.contracts.keys()] : [...ns.contractOwners.keys()];
        for (const name of names) {
          const reference = `${key}.${name}`;
          let rewritten: string | undefined;
          try {
            rewritten = rewriteProtocolAccessors(
              `function main() { const a = ${reference}; }`,
              chain,
            ).source;
          } catch {
            rewritten = undefined;
          }
          const address = listed.get(reference);
          // Listed if and only if a program may write it, and at the address it compiles to.
          expect([reference, rewritten !== undefined]).toEqual([reference, address !== undefined]);
          if (address !== undefined) expect(rewritten).toContain(`${BigInt(address)}n`);
        }
      }
    }
  });

  it("lists the chain's registry tokens, its defines verbatim, and the ambient functions", () => {
    const base = requireChain("base");
    const globals = sourceGlobals(base);
    expect(globals.tokens).toEqual(
      [...TOKEN_REGISTRY[8453]!]
        .map(({ symbol, address, decimals, stock }) => ({
          symbol,
          address,
          decimals,
          ...(stock === undefined ? {} : { stock }),
        }))
        .sort((a, b) => (a.symbol < b.symbol ? -1 : 1)),
    );
    expect(globals.defines).toEqual(chainDefines(base));
    expect(globals.chains.map((chain) => chain.key)).toEqual(
      expect.arrayContaining(["Base", "Arbitrum", "Solana"]),
    );
    expect(globals.modules).toEqual([
      {
        specifier: "@sauce/token",
        functions: expect.arrayContaining([
          "transfer(token: Address, to: Address, amount: Uint256): void",
          "balanceOf(token: Address, account: Account): Uint256",
        ]),
      },
    ]);
    // Solana: its mints as 32-byte keys, no EVM contracts, the SVM arm's functions.
    const solana = sourceGlobals("solana");
    expect(solana.tokens).toEqual(
      SVM_TOKEN_REGISTRY["mainnet-beta"].map(({ symbol, address, decimals, mint }) => ({
        symbol,
        address,
        decimals,
        mint,
      })),
    );
    expect(solana.protocols).toEqual([]);
    expect(solana.modules[0]!.functions).toContain(
      "transfer(token: Address, tokenProgram: Account, source: Account, dest: Account, authority: Account, amount: Uint256): void",
    );
  });

  it("names every method's parameters, struct fields included", () => {
    const v3 = sourceGlobals("base").protocols.find((ns) => ns.namespace === "UniswapV3")!;
    const router = v3.contracts.find((contract) => contract.name === "SwapRouter02")!;
    expect(router.methods.find((m) => m.name === "exactInputSingle")).toMatchObject({
      signature: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      declaration:
        "exactInputSingle(params: { tokenIn: address, tokenOut: address, fee: uint24, recipient: " +
        "address, amountIn: uint256, amountOutMinimum: uint256, sqrtPriceLimitX96: uint160 }): " +
        "(amountOut: uint256)",
      stateMutability: "payable",
    });
  });
});

describe("sauce globals", () => {
  it("prints the chain's tokens, namespaces, chains and functions, and filters them", async () => {
    const all = await sauce("globals", "--chain", "base");
    expect(all.code).toBe(0);
    expect(all.stdout).toMatch(
      /^ {2}USDC {2}0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 {2}6 decimals$/m,
    );
    // A stock token in its own list, with what it is, so a search for the company finds it.
    expect(all.stdout).toMatch(
      /^ {4}SPCXc +0xb2000000000000000000007b9fcbd005511aCBd5 {2}8 decimals {2}Space Exploration Technologies Corp\. \(Coinbase\)$/m,
    );
    expect(all.stdout).toMatch(/^ {2}UniswapV4 {2}\(Uniswap V4\)$/m);
    expect(all.stdout).toContain("transfer(token: Address, to: Address, amount: Uint256): void");
    const tokens = json(await sauce("globals", "--chain", "base", "--tokens", "--json"));
    expect(Object.keys(tokens)).toEqual(["chain", "tokens"]);
    const one = json(
      await sauce("globals", "--chain", "8453", "--protocol", "uniswap-v4", "--json"),
    );
    expect(Object.keys(one)).toEqual(["chain", "protocol"]);
    expect((one.protocol as { namespace: string }).namespace).toBe("UniswapV4");
    const full = json(await sauce("globals", "--chain", "base", "--json"));
    expect((full.defines as Record<string, unknown>).chainId).toBe("8453");
    expect((full.defines as Record<string, unknown>).USDC).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
  });

  it("prints Solana's mints, base58 and as the key a program holds, and devnet's", async () => {
    const usdc = SVM_TOKEN_REGISTRY["mainnet-beta"].find((row) => row.symbol === "USDC")!;
    const devnet = SVM_TOKEN_REGISTRY.devnet.find((row) => row.symbol === "USDC")!;
    const run = await sauce("globals", "--chain", "solana", "--tokens");
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain("none by symbol");
    expect(run.stdout).toMatch(
      new RegExp(`^ {2}USDC {2}${usdc.mint} {2}${usdc.address} {2}6 decimals$`, "m"),
    );
    expect(run.stdout).toMatch(
      new RegExp(`^ {4}USDC {2}${devnet.mint} {2}${devnet.address} {2}6 decimals$`, "m"),
    );
    const out = json(await sauce("globals", "--chain", "solana", "--json"));
    expect(out.tokens).toContainEqual({
      symbol: "USDC",
      address: usdc.address,
      decimals: 6,
      mint: usdc.mint,
    });
    expect(out.devnetTokens).toContainEqual(devnet);
    expect((out.defines as Record<string, unknown>).USDC).toBe(usdc.address);
  });

  it("lists the interfaces a program binds to its own address, and their methods", async () => {
    const all = await sauce("globals", "--chain", "base");
    expect(all.stdout).toMatch(/^Interfaces \(\d+\): an ABI with no fixed address/m);
    expect(all.stdout).toMatch(/^ {2}Erc4626\.Vault {2}\(.+\)$/m);
    // Asked for by name, the methods, as every namespace's are; JSON gives the same.
    const one = await sauce("globals", "--chain", "base", "--protocol", "Erc4626");
    expect(one.code).toBe(0);
    expect(one.stdout).toMatch(
      /^Erc4626\.Vault\.at\(<address>\) {2}interface \(.+\): no fixed address$/m,
    );
    expect(one.stdout).toMatch(/^ {2}totalAssets\(\): \(.+\) {2}view$/m);
    const out = json(await sauce("globals", "--chain", "base", "--protocol", "erc4626", "--json"));
    expect(Object.keys(out)).toEqual(["chain", "interfaces"]);
    expect(out.interfaces).toEqual([
      expect.objectContaining({ namespace: "Erc4626", name: "Vault", protocol: "erc4626" }),
    ]);
    // Every one listed binds and compiles as listed.
    const vault = sourceGlobals("base").interfaces.find((bound) => bound.namespace === "Erc4626")!;
    expect(vault.methods.map((m) => m.name)).toContain("totalAssets");
    const program = file(
      "vault.sauce.ts",
      "function main(vault: Address): Uint256 {\n  return Erc4626.Vault.at(vault).totalAssets();\n}\n",
    );
    expect((await sauce("compile", program, "--chain", "base")).code).toBe(0);
    // None on Solana: interfaces are EVM ABIs.
    expect(sourceGlobals("solana").interfaces).toEqual([]);
  });

  it("names a namespace the chain does not have, and what it does have", async () => {
    const run = await sauce("globals", "--chain", "base", "--protocol", "Nope");
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(
      /'Nope' is not a namespace a program can use here; the chain has .*UniswapV4/,
    );
    expect((await sauce("globals")).stderr).toMatch(/missing --chain/);
  });
});

// ---------------------------------------------------------------------------------------------

const SPLIT = [
  "function main(token: Address, recipients: Address[], amount: Uint256, note: { tag: Uint256, ok: bool }) {",
  "  for (let i = 0; i < recipients.length; i = i + 1) {",
  "    transfer(token, recipients[i], amount);",
  "  }",
  "  require(note.ok);",
  "}",
  "",
].join("\n");
const FIXED = [
  "// @chain ethereum",
  "Base(() => {",
  "  USDC.transfer(RECIPIENT, 1000n);",
  "}).reward({ tokens: [{ token: USDC, amount: 2000n }] });",
  "",
].join("\n");
const MEASURED = [
  "// @chain ethereum",
  "function main(recipient: Address) {",
  "  const amount = USDC.balanceOf(ctx.self());",
  "  Base(() => {",
  "    USDC.transfer(recipient, amount);",
  "  }).reward({ tokens: [{ token: USDC, amount: amount }] });",
  "}",
  "",
].join("\n");
const TOKEN: Address = "0x1111111111111111111111111111111111111111";

/** What a transaction-printing command printed on stdout; its advice goes to stderr. */
const printed = (run: Run): Record<string, unknown> => {
  expect([run.code, run.stderr]).toEqual([0, expect.not.stringMatching(/^sauce /)]);

  return JSON.parse(run.stdout) as Record<string, unknown>;
};

/** The cook `sauce tx` prints for `argv` (whose `--args`, if any, comes last). */
const cookOf = async (file: string, ...argv: string[]): Promise<Hex> =>
  printed(await sauce("tx", file, "--owner", OWNER, "--value", "0", ...argv)).data as Hex;

describe("sauce inspect", () => {
  it("decodes a cook's arguments against the program's source", async () => {
    const split = file("split.sauce.ts", SPLIT);
    const args = [TOKEN, JSON.stringify([RECIPIENT, CREATOR]), "5", '{"tag":7,"ok":true}'];
    const data = await cookOf(split, "--chain", "base", "--args", ...args);
    const inspected = json(
      await sauce("inspect", data, "--source", split, "--chain", "base", "--json"),
    );
    expect(inspected).toMatchObject({
      call: "Pot.cook",
      engine: { address: ENGINE, released: true },
      program: {
        source: {
          file: split,
          matches: true,
          arguments: [
            { name: "token", type: "Address", value: TOKEN },
            { name: "recipients", type: "Address[]", value: [RECIPIENT, CREATOR] },
            { name: "amount", type: "Uint256", value: "5" },
            { name: "note", type: "{ tag: Uint256, ok: bool }", value: { tag: "7", ok: true } },
          ],
        },
        intents: [],
      },
    });
    const text = await sauce("inspect", data, "--source", split, "--chain", "base");
    expect(text.stdout).toMatch(/^ {6}recipients: Address\[\] = \["0x6666/m);
    // Without the source the program is a size and a hash, and nothing is claimed about the rest.
    const bare = json(await sauce("inspect", data, "--json"));
    expect(bare.program).toEqual({
      size: expect.any(Number),
      keccak256: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      intents: [],
    });
    // Another file's program is not this one.
    const another = file("another.sauce.ts", "function main(x: Uint256) {\n  require(x > 0);\n}\n");
    const other = json(
      await sauce("inspect", data, "--source", another, "--chain", "base", "--json"),
    );
    expect((other.program as { source: unknown }).source).toEqual({
      file: another,
      matches: false,
    });
  });

  it("reads a fixed intent out of the program that opens it, hash and all", async () => {
    const fixed = file("fixed.sauce.ts", FIXED);
    const [lowered] = compileSauceProgram("ethereum", FIXED, {
      defines: { RECIPIENT: BigInt(RECIPIENT) },
      intents: { deadline: 2_000_000_000n, creator: CREATOR },
    }).intents;
    const { intentHash } = hashIntent(lowered!.intent);
    const defines = ["--define", `RECIPIENT=${RECIPIENT}`, ...INTENT_FLAGS];
    // From the file: the compile's own intent.
    const fromFile = json(await sauce("inspect", fixed, ...defines, "--json"));
    expect(fromFile.intents).toEqual([expect.objectContaining({ intentHash })]);
    // From the cook's bytes alone, on the chain that publishes it: the same intent.
    const data = await cookOf(fixed, ...defines);
    const fromBytes = json(await sauce("inspect", data, "--chain", "ethereum", "--json"));
    const [intent] = (fromBytes.program as { intents: Array<Record<string, unknown>> }).intents;
    expect(intent).toMatchObject({
      destination: { id: "8453", chain: "base" },
      intentHash,
      // The program pays the vault the Portal derives, so that is the one shown: the registry's.
      vault: predictIntentVault(lowered!.intent, { portal: ecoRoutesPortal("ethereum") }),
      fundVia: "transfer",
      reward: { creator: CREATOR, tokens: [{ amount: "2000" }] },
      route: {
        calls: [{ function: "transfer", args: { to: RECIPIENT, amount: "1000" } }],
      },
    });
    expect(fromFile.intents).toEqual([expect.objectContaining({ fundVia: "transfer" })]);
    // Opted out, the program approves and calls publishAndFund, and says so.
    const optedOut = await cookOf(fixed, ...defines, "--intent-fund-via", "publishAndFund");
    const [approved] = (
      json(await sauce("inspect", optedOut, "--chain", "ethereum", "--json")).program as {
        intents: Array<Record<string, unknown>>;
      }
    ).intents;
    expect(approved).toMatchObject({ intentHash, fundVia: "publishAndFund" });
    // With no --chain there is no source chain to hash it for, and it says no more than it knows.
    const unhashed = json(await sauce("inspect", data, "--json"));
    expect((unhashed.program as { intents: object[] }).intents[0]).not.toHaveProperty("intentHash");
  });

  it("names the values an intent measures at run time, and says the bytes alone cannot", async () => {
    const measured = file("measured.sauce.ts", MEASURED);
    const fromFile = await sauce("inspect", measured, ...INTENT_FLAGS);
    expect(fromFile.code).toBe(0);
    expect(fromFile.stdout).toMatch(/reward: <amount> of 0x/);
    expect(fromFile.stdout).toMatch(/\.transfer\(<recipient>, <amount>\)/);
    const data = await cookOf(measured, ...INTENT_FLAGS, "--args", RECIPIENT);
    const fromBytes = json(await sauce("inspect", data, "--chain", "ethereum", "--json"));
    expect((fromBytes.program as { intents: unknown[] }).intents).toEqual([
      { destination: { id: "8453", chain: "base" }, measured: true, fundVia: "transfer" },
    ]);
    expect((await sauce("inspect", data, "--chain", "ethereum")).stdout).toContain(
      "funded: the program pays the reward into the intent's vault, then calls Portal.publish",
    );
    // Given the source, the cook's intents are the compile's, named.
    const sourced = await sauce("inspect", data, "--source", measured, ...INTENT_FLAGS);
    expect(sourced.stdout).toMatch(/recipient: Address = 0x6666/);
    expect(sourced.stdout).toMatch(/reward: <amount> of 0x/);
  });

  it("reads a Kitchen.deployPot, a transfer to a vault and the Portal publish after it", async () => {
    const pot = printed(
      await sauce("pot", "--chain", "base", "--owner", OWNER, "--salt", "treasury"),
    );
    expect(json(await sauce("inspect", pot.data as string, "--json"))).toEqual({
      call: "Kitchen.deployPot",
      owner: OWNER,
      salt: potSalt("treasury"),
      pot: v12PredictPot(OWNER, potSalt("treasury")),
    });
    const fixed = file("fixed.sauce.ts", FIXED);
    const publishing = (...flags: string[]) =>
      sauce(
        ...["intent", "publish", fixed, "--define", `RECIPIENT=${RECIPIENT}`, ...INTENT_FLAGS],
        ...["--format", "json", ...flags],
      );
    type Printed = {
      intents: Array<{ intentHash: string; vault: Hex; transactions: Array<{ data: Hex }> }>;
    };
    const published = printed(await publishing()) as Printed;
    const [{ intentHash, vault, transactions }] = published.intents as [Printed["intents"][number]];
    const [transfer, publish] = transactions.map((tx) => tx.data);
    // The transfer pays the vault the publish below names: the address inspect derives for it.
    expect(json(await sauce("inspect", transfer!, "--json"))).toMatchObject({
      call: "ERC20.transfer",
      args: { to: vault, amount: "2000" },
    });
    const text = await sauce("inspect", publish!, "--chain", "ethereum");
    expect(text.stdout).toContain(`vault: ${vault}, funded once it holds the reward`);
    expect(json(await sauce("inspect", publish!, "--chain", "ethereum", "--json"))).toMatchObject({
      call: "Portal.publish",
      intent: { intentHash, vault, destination: { chain: "base" } },
    });

    // Opted out: an approve to the Portal, then publishAndFund of the same intent.
    const optedOut = printed(await publishing("--intent-fund-via", "publishAndFund")) as Printed;
    const [approve, publishAndFund] = optedOut.intents[0]!.transactions.map((tx) => tx.data);
    expect(json(await sauce("inspect", approve!, "--json"))).toMatchObject({
      call: "ERC20.approve",
      args: { amount: "2000" },
    });
    expect(
      json(await sauce("inspect", publishAndFund!, "--chain", "ethereum", "--json")),
    ).toMatchObject({
      call: "Portal.publishAndFund",
      intent: { intentHash, vault, destination: { chain: "base" } },
    });
  });

  it("asks for an endpoint for a transaction hash, and reads a non-hex operand as a file", async () => {
    const hash = await sauce("inspect", `0x${"ab".repeat(32)}`);
    expect(hash.code).toBe(2);
    expect(hash.stderr).toMatch(/32 bytes of hex is a transaction hash: give --rpc-url/);
    const missing = await sauce("inspect", join(work, "nope.sauce.ts"), "--chain", "base");
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/nope\.sauce\.ts: no such file/);
    expect((await sauce("inspect", "0xabc")).stderr).toMatch(/is not 0x-prefixed hex bytes/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("sauce verify", () => {
  it("accepts every conformance vector, as a payload and as a cook on the released engine", async () => {
    for (const vector of SETTLE_VECTORS) {
      const payload = settlePayload(vector.args);
      const expected = {
        valid: true,
        tokens: vector.tokens.map((token) => token.toLowerCase()),
        floorToken: vector.tokens[0]!.toLowerCase(),
        minOut: vector.minOut.toString(),
        recipient: vector.recipient.toLowerCase(),
        programHash: SETTLE_WIRE.PROGRAM_HASH,
      };
      expect(json(await sauce("verify", payload, "--json"))).toEqual(expected);
      expect(json(await sauce("verify", v12Pot.encodeCook(ENGINE, payload), "--json"))).toEqual({
        ...expected,
        engine: ENGINE,
      });
    }
    const text = await sauce("verify", settlePayload(SETTLE_VECTORS[0]!.args));
    expect(text.stdout).toMatch(/^valid: the audited settle program\n {2}tokens {5}0x833589/);
  });

  it("rejects every non-canonical payload with the SDK's code, exiting 1", async () => {
    for (const rejection of SETTLE_REJECTIONS) {
      const run = await sauce("verify", settlePayload(rejection.args), "--json");
      expect([rejection.name, run.code]).toEqual([rejection.name, 1]);
      expect(JSON.parse(run.stdout)).toMatchObject({ valid: false, code: rejection.code });
    }
    const short = await sauce("verify", "0x1234");
    expect([short.code, short.stdout]).toEqual([
      1,
      expect.stringMatching(/^rejected \(PROGRAM_TRUNCATED\)/),
    ]);
  });

  it("refuses a settle on another engine unless --engine names it", async () => {
    const payload = settlePayload(SETTLE_VECTORS[0]!.args);
    const elsewhere = v12Pot.encodeCook(TOKEN, payload);
    const refused = await sauce("verify", elsewhere, "--json");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ valid: false, code: "UNKNOWN_ENGINE" });
    expect(json(await sauce("verify", elsewhere, "--engine", TOKEN, "--json"))).toMatchObject({
      valid: true,
      engine: getAddress(TOKEN),
    });
  });

  it("accepts a historical program only with its --pin", async () => {
    // A different 435-byte program: the same length, one byte changed.
    const program = hexToBytes(SETTLE_PROGRAM);
    program[200] = program[200]! ^ 0xff;
    const older = `${bytesToHex(program)}${SETTLE_VECTORS[0]!.args.slice(2)}` as Hex;
    const refused = await sauce("verify", older, "--json");
    expect(JSON.parse(refused.stdout)).toMatchObject({ valid: false, code: "PROGRAM_HASH" });
    const pinned = json(
      await sauce("verify", older, "--pin", `${keccak256(program)}:435`, "--json"),
    );
    expect(pinned).toMatchObject({ valid: true, programHash: keccak256(program) });
    expect((await sauce("verify", older, "--pin", "0x12")).stderr).toMatch(/is not <hash>:<bytes>/);
  });

  it("finds the settle cook among an intent's route calls, or says there is none", async () => {
    const pot = v12PredictPot(OWNER);
    const call = (target: Address, data: Hex) => ({
      target: toUniversalAddress(target),
      data,
      value: 0n,
    });
    const route = (calls: ReturnType<typeof call>[]) =>
      encodeRoute(
        {
          salt: `0x${"00".repeat(32)}`,
          deadline: 2_000_000_000n,
          portal: toUniversalAddress(CREATOR),
          nativeAmount: 0n,
          tokens: [],
          calls,
        },
        "evm",
      );
    const reward = {
      deadline: 2_000_000_000n,
      creator: CREATOR,
      prover: CREATOR,
      nativeAmount: 0n,
      tokens: [],
    };
    const publish = (routeBytes: Hex) =>
      encodeFunctionData({
        abi: PortalABI,
        functionName: "publishAndFund",
        args: [8453n, routeBytes, reward, false],
      });
    const transfer = call(
      TOKEN,
      encodeFunctionData({ abi: ERC20ABI, functionName: "transfer", args: [RECIPIENT, 1n] }),
    );
    const settle = call(
      pot as Address,
      v12Pot.encodeCook(ENGINE, settlePayload(SETTLE_VECTORS[0]!.args)),
    );
    expect(json(await sauce("verify", publish(route([transfer, settle])), "--json"))).toMatchObject(
      {
        valid: true,
        callIndex: 1,
        target: pot,
        engine: ENGINE,
      },
    );
    const none = await sauce("verify", publish(route([transfer])), "--json");
    expect(none.code).toBe(1);
    expect(JSON.parse(none.stdout)).toMatchObject({ valid: false, code: "NO_SETTLE" });
  });
});

// ---------------------------------------------------------------------------------------------

describe("a transaction read by hash: what its receipt says", () => {
  // A JSON-RPC endpoint on loopback serving one Base transaction — a settle cook — with whichever
  // receipt a test sets: mined, reverted, not yet mined, or an error reading it.
  const HASH = `0x${"ab".repeat(32)}` as Hex;
  const BLOCK = `0x${"cd".repeat(32)}`;
  let receipt: "success" | "reverted" | "none" | "error" = "success";
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const input = v12Pot.encodeCook(ENGINE, settlePayload(SETTLE_VECTORS[0]!.args));
    const pot = v12PredictPot(OWNER);
    const answer = (method: string): { result?: unknown; error?: unknown } => {
      switch (method) {
        case "eth_chainId":
          return { result: "0x2105" };
        case "eth_getTransactionByHash":
          return {
            result: {
              hash: HASH,
              nonce: "0x1",
              blockHash: BLOCK,
              blockNumber: "0x10",
              transactionIndex: "0x0",
              from: OWNER.toLowerCase(),
              to: pot.toLowerCase(),
              value: "0x0",
              gas: "0x100000",
              gasPrice: "0x1",
              input,
              type: "0x0",
              chainId: "0x2105",
              v: "0x1b",
              r: "0x1",
              s: "0x1",
            },
          };
        case "eth_getTransactionReceipt":
          if (receipt === "error") return { error: { code: -32000, message: "header not found" } };
          if (receipt === "none") return { result: null };

          return {
            result: {
              transactionHash: HASH,
              transactionIndex: "0x0",
              blockHash: BLOCK,
              blockNumber: "0x10",
              from: OWNER.toLowerCase(),
              to: pot.toLowerCase(),
              cumulativeGasUsed: "0x5208",
              gasUsed: "0x5208",
              contractAddress: null,
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              status: receipt === "success" ? "0x1" : "0x0",
              effectiveGasPrice: "0x1",
              type: "0x0",
            },
          };
      }

      return { error: { code: -32601, message: `no ${method}` } };
    };
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const { id, method } = JSON.parse(body) as { id: number; method: string };
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id, ...answer(method) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("`inspect` says pending only when there is no receipt, and reports a failure to read one", async () => {
    receipt = "none";
    const pending = json(await sauce("inspect", HASH, "--rpc-url", url, "--json"));
    expect(pending).toMatchObject({ status: "pending", call: "Pot.cook" });
    receipt = "error";
    const failed = await sauce("inspect", HASH, "--rpc-url", url);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toMatch(/reading the transaction's receipt failed/);
    receipt = "success";
    expect(json(await sauce("inspect", HASH, "--rpc-url", url, "--json"))).toMatchObject({
      status: "success",
    });
  });

  it("`verify` accepts a mined settle, and rejects one that reverted or is not mined", async () => {
    receipt = "success";
    expect(json(await sauce("verify", HASH, "--rpc-url", url, "--json"))).toMatchObject({
      valid: true,
      hash: HASH,
      engine: ENGINE,
    });
    for (const [state, code] of [
      ["reverted", "TX_FAILED"],
      ["none", "TX_PENDING"],
    ] as const) {
      receipt = state;
      const run = await sauce("verify", HASH, "--rpc-url", url, "--json");
      expect(run.code).toBe(1);
      expect(JSON.parse(run.stdout)).toMatchObject({ valid: false, code });
    }
  });
});

describe("decodeEntryArguments: encodeEntryArguments, inverted", () => {
  const params = [
    { name: "who", type: "Address" },
    { name: "amounts", type: "Uint256[]" },
    { name: "memo", type: "bytes" },
    { name: "label", type: "string" },
    { name: "pair", type: "{ a: Uint256, b: bool }" },
  ];
  const values = [RECIPIENT, [1n, 2n ** 200n], "0xdeadbeef", "hello", { a: 9n, b: true }];

  it("reads back exactly what was encoded, ABI-v1 and compact-v1", () => {
    const abi = { entryEncoding: "abi-v1" as const, entryParams: params };
    expect(decodeEntryArguments(abi, encodeEntryArguments(abi, values))).toEqual(values);
    const compiled = compileSauceProgram(
      "base",
      "function main(who: Address, amounts: Uint256[], memo: bytes, label: string, pair: { a: Uint256, b: bool }) { require(pair.b); }",
      { compactArgs: true },
    );
    expect(compiled.entryEncoding).toBe("compact-v1");
    expect(decodeEntryArguments(compiled, encodeEntryArguments(compiled, values))).toEqual(values);
  });

  it("refuses bytes that are not the one canonical encoding", () => {
    const abi = { entryEncoding: "abi-v1" as const, entryParams: params };
    const encoded = encodeEntryArguments(abi, values);
    expect(() => decodeEntryArguments(abi, new Uint8Array([...encoded, 0]))).toThrow(
      /not the canonical encoding/,
    );
    const word = {
      entryEncoding: "abi-v1" as const,
      entryParams: [{ name: "who", type: "Address" }],
    };
    // An address word with dirty upper bytes decodes, but is not what an address encodes to.
    const dirty = hexToBytes(numberToHex((1n << 200n) | BigInt(RECIPIENT), { size: 32 }));
    expect(() => decodeEntryArguments(word, dirty)).toThrow();
  });
});
