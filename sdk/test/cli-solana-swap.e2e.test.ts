/**
 * `sauce simulate` and `sauce run --chain solana` of programs that call `jupiterSwap` and
 * `ecoSwap`, executed: the route asked of an API the test serves, bound into the program, and
 * cooked through the released Kitchen and engine in LiteSVM behind the JSON-RPC shim
 * (`svm/rpc-shim.ts`). Jupiter's aggregator is `svm/fixtures/mock-jupiter` — its
 * `shared_accounts_route` as far as a Sauce program drives it, deployed at Jupiter's program id so
 * the SDK's route checks run unchanged (its source is in that directory; the binary is
 * `mock_jupiter.so.gz`, its digest pinned below). The same program stands in for eco-swap's merge
 * program, whose instruction the SDK's contract lets name any program and put its amount and floor
 * anywhere in its data. The route's accounts ride as the cook's remaining accounts, with a lookup
 * table the route names; the Pot signs the route as its transfer authority through the Kitchen;
 * the cook creates the Pot's account for the output. No cluster, no network.
 *
 * CPI DEPTH. The bank runs without SIMD-0268 (`raise_cpi_nesting_limit_to_8`), as mainnet does
 * today, so the invoke stack holds 5: the Kitchen's instruction (1), the engine (2), the
 * aggregator (3), and the token program it pays through (4). A real Jupiter route adds the pool's
 * program between the aggregator and the token program: 5, the whole stack. A pool that calls
 * another program in turn (a Token-2022 transfer hook, a pool routing through another pool) does
 * not fit until SIMD-0268 is active, when the stack holds 9. The test reads the depth off the
 * cook's logs.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  address,
  getAddressDecoder,
  getBase58Decoder,
  getProgramDerivedAddress,
  lamports,
  type Address,
} from "@solana/kit";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { derivePotPda } from "../src/svm/index.js";
import { svmTokenAccount } from "../src/svm/token-accounts.js";
import { JUPITER_AGGREGATOR_PROGRAM_ID } from "../src/svm/venues/jupiter-aggregator/index.js";
import {
  describeSvm,
  ENGINE_SO,
  fabricateAlt,
  randomAddress,
  setMint,
  setTokenAccount,
  SIMD_0268_CPI_NESTING,
  startEngine,
  TOKEN_PROGRAM,
  tokenAmount,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const RPC_URL = "http://127.0.0.1:65532/";
const JUPITER_API = "https://jupiter.test";
const ECO_API = "https://eco.test";
const KITCHEN = address(v12SvmKitchenProgramId());
const JUPITER = address(JUPITER_AGGREGATOR_PROGRAM_ID);
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WSOL = address("So11111111111111111111111111111111111111112");
const MOCK = join(process.cwd(), "test", "svm", "fixtures", "mock-jupiter", "mock_jupiter.so.gz");
const MOCK_SHA256 = "361365b891dfa48728d9add59a74cd7792945c3ef43a04e39a5ab35549a787dd";

/** 100 USDC for at least `minOut` wrapped SOL, the Pot's to keep. */
const JUPITER_SWAP = `function main(minOut: Uint256): Uint256 {
  return jupiterSwap(USDC, WSOL, 100000000, minOut);
}
`;

/** An amount and a floor the program computes as it runs, which only eco-swap takes. */
const ECO_SWAP = `function main(amount: Uint256, minOut: Uint256): Uint256 {
  return ecoSwap(USDC, WSOL, amount / 2, minOut);
}
`;

/** `shared_accounts_route` with an empty route plan, then its tail: `in_amount`,
 *  `quoted_out_amount`, `slippage_bps`, `platform_fee_bps`. */
function routeData(inAmount: bigint, quotedOut: bigint, slippageBps: number): string {
  const data = new Uint8Array(8 + 1 + 4 + 19);
  data.set([0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81]);
  const view = new DataView(data.buffer);
  view.setBigUint64(13, inAmount, true);
  view.setBigUint64(21, quotedOut, true);
  view.setUint16(29, slippageBps, true);

  return Buffer.from(data).toString("base64");
}

describeSvm("sauce on Solana: jupiterSwap and ecoSwap through the Kitchen", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let keypair: string;
  let jupiterSwap: string;
  let ecoSwap: string;
  let pot: Address;
  let potUsdc: Address;
  let potWsol: Address;
  let authority: Address;
  let config: Address;
  let table: Address;
  const vaultIn = randomAddress();
  const vaultOut = randomAddress();
  const asked: URL[] = [];
  /** The tolerance eco-swap's instruction carries past the floor the program writes. */
  let ecoSlippageBps = 0;

  /** Jupiter's two calls, answered for the bank's accounts: a quote, then its instruction; and
   *  eco-swap's embed, the same instruction with its amount and floor left for the program. */
  const swapApis = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    asked.push(url);
    if (url.pathname === "/swap/v1/quote") {
      return new Response(
        JSON.stringify({
          inputMint: USDC,
          outputMint: WSOL,
          inAmount: "100000000",
          outAmount: "834568839",
          slippageBps: 50,
          routePlan: [],
        }),
      );
    }
    const meta = (pubkey: Address, isWritable = false, isSigner = false) => ({
      pubkey,
      isSigner,
      isWritable,
    });

    const accounts = [
      meta(address(TOKEN_PROGRAM)),
      meta(authority),
      meta(pot, false, true),
      meta(potUsdc, true),
      meta(vaultIn, true),
      meta(vaultOut, true),
      meta(potWsol, true),
      meta(USDC),
      meta(WSOL),
      meta(JUPITER),
      meta(JUPITER),
      meta(config),
      meta(JUPITER),
    ];
    if (url.origin === ECO_API) {
      return new Response(
        JSON.stringify({
          embed: {
            version: 1,
            kind: "instruction",
            chainId: 1399811149,
            tokenIn: USDC,
            tokenOut: WSOL,
            programId: JUPITER,
            accounts,
            data: routeData(0n, 0n, ecoSlippageBps),
            offsets: { amountIn: 13, minOut: 21 },
            lookupTables: [table],
          },
        }),
      );
    }

    return new Response(
      JSON.stringify({
        swapInstruction: {
          programId: JUPITER,
          accounts,
          data: routeData(100000000n, 834568839n, 50),
        },
        addressLookupTableAddresses: [table],
      }),
    );
  }) as typeof fetch;

  async function sauce(...argv: string[]) {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      confirm: async () => undefined,
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
      swapApis: { jupiter: JUPITER_API, eco: ECO_API, fetch: swapApis },
    };

    return { code: await runCli(argv, io), stdout, stderr };
  }

  /** What the mock pays out: the first eight bytes of its config account. */
  const pays = (amount: bigint) => {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, amount, true);
    harness.svm.setAccount({
      address: config,
      data,
      executable: false,
      lamports: lamports(harness.svm.minimumBalanceForRentExemption(8n)),
      programAddress: JUPITER,
      space: 8n,
    });
  };

  beforeAll(async () => {
    harness = await startEngine(
      1_700_000_000n,
      ENGINE_SO as string,
      address(v12SvmEngineProgramId()),
      [SIMD_0268_CPI_NESTING],
    );
    const mock = gunzipSync(readFileSync(MOCK));
    expect(createHash("sha256").update(mock).digest("hex")).toBe(MOCK_SHA256);
    harness.svm.addProgram(JUPITER, new Uint8Array(mock));
    setMint(harness, USDC, 6);
    setMint(harness, WSOL, 9);

    work = mkdtempSync(join(tmpdir(), "sauce-solana-swap-"));
    // A throwaway keypair, the owner of the Pot the cook runs on.
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    keypair = join(work, "owner.json");
    writeFileSync(keypair, JSON.stringify([...seed, ...pub]));
    const owner = address(getAddressDecoder().decode(new Uint8Array(pub)));
    harness.svm.airdrop(owner, lamports(5_000_000_000n));
    pot = (await derivePotPda(KITCHEN, owner, new Uint8Array(32))).address;
    potUsdc = await svmTokenAccount({ mint: USDC, tokenProgram: address(TOKEN_PROGRAM) }, pot);
    potWsol = await svmTokenAccount({ mint: WSOL, tokenProgram: address(TOKEN_PROGRAM) }, pot);
    [authority] = await getProgramDerivedAddress({
      programAddress: JUPITER,
      seeds: [new TextEncoder().encode("authority")],
    });
    config = randomAddress();
    // The aggregator's own accounts, in a lookup table the route names.
    [table] = Object.keys(
      fabricateAlt(harness, [address(TOKEN_PROGRAM), authority, vaultIn, vaultOut, USDC, WSOL]),
    ) as [Address];

    jupiterSwap = join(work, "jupiter.sauce.ts");
    writeFileSync(jupiterSwap, JUPITER_SWAP);
    ecoSwap = join(work, "eco.sauce.ts");
    writeFileSync(ecoSwap, ECO_SWAP);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
    const deployed = await sauce(
      ...["pot", "--deploy", "--chain", "solana", "--rpc-url", RPC_URL, "--keypair", keypair],
    );
    expect(deployed.code).toBe(0);
  }, 120_000);

  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  const sauceOf =
    (command: "simulate" | "run") =>
    (program: string, ...args: bigint[]) =>
      sauce(
        ...[command, program, "--chain", "solana", "--rpc-url", RPC_URL, "--keypair", keypair],
        ...["--json", "--args", ...args.map(String)],
      );
  const simulate = sauceOf("simulate");
  const run = sauceOf("run");

  /** Funds the swap: the Pot's 100 USDC, and the aggregator's wrapped SOL to pay from. */
  const fund = () => {
    setTokenAccount(harness, potUsdc, USDC, pot, 100000000n);
    setTokenAccount(harness, vaultIn, USDC, authority, 0n);
    setTokenAccount(harness, vaultOut, WSOL, authority, 10_000_000_000n);
  };
  /** The Pot's wrapped SOL, none before its account exists. */
  const potHolds = () =>
    harness.svm.getAccount(potWsol).exists ? tokenAmount(harness, potWsol) : 0n;

  it("swaps with the Pot as Jupiter's authority, into a Pot account the cook creates", async () => {
    fund();
    pays(834000000n);
    expect(harness.svm.getAccount(potWsol).exists).toBe(false);
    // Rehearsed first: what `main` returns, the amount that reached the Pot.
    const rehearsed = await simulate(jupiterSwap, 830000000n);
    expect(rehearsed.stderr).toBe("");
    expect(JSON.parse(rehearsed.stdout)).toMatchObject({ returned: "834000000" });
    asked.length = 0;
    const before = shim.sent.length;

    const done = await run(jupiterSwap, 830000000n);
    expect(done.stderr).not.toMatch(/error/i);
    expect(done.code).toBe(0);
    // Asked for the amount the program swaps, built for the Pot.
    expect(asked.map((url) => url.pathname)).toEqual([
      "/swap/v1/quote",
      "/swap/v1/swap-instructions",
    ]);
    expect(asked[0]!.searchParams.get("amount")).toBe("100000000");
    expect(tokenAmount(harness, potUsdc)).toBe(0n);
    expect(tokenAmount(harness, vaultIn)).toBe(100000000n);
    expect(tokenAmount(harness, potWsol)).toBe(834000000n);
    expect(JSON.parse(done.stdout)).toMatchObject({ pot, cook: { status: "success" } });

    // The cook's logs: the aggregator was handed the route's 13 accounts, and the deepest
    // instruction ran 4 deep — the Kitchen, the engine, the aggregator, the token program.
    const cook = shim.sent.slice(before).at(-1)!;
    const logs = shim.logsOf(getBase58Decoder().decode(Object.values(cook.signatures)[0]!))!;
    expect(logs).toContain("Program log: mock-jupiter: 13 accounts");
    const depths = logs.flatMap((line) => {
      const invoked = /^Program \w+ invoke \[(\d+)\]$/.exec(line);
      return invoked === null ? [] : [Number(invoked[1])];
    });
    expect(Math.max(...depths)).toBe(4);
  }, 120_000);

  it("refuses a fill below minOut: Jupiter's floor is the program's", async () => {
    fund();
    pays(829999999n);
    const held = potHolds();

    const done = await run(jupiterSwap, 830000000n);
    expect(done.code).not.toBe(0);
    expect(done.stdout + done.stderr).toMatch(/6001|0x1771/);
    expect(tokenAmount(harness, potUsdc)).toBe(100000000n);
    expect(potHolds()).toBe(held);
  }, 120_000);

  it("ecoSwap: the amount and floor the program computes, written into eco-swap's instruction as it runs", async () => {
    fund();
    pays(834000000n);
    const held = potHolds();

    const rehearsed = await simulate(ecoSwap, 200000000n, 834000000n);
    expect(rehearsed.stderr).toBe("");
    expect(JSON.parse(rehearsed.stdout)).toMatchObject({ returned: "834000000" });
    // eco-swap was asked for the pair, with no amount: the program computes it.
    const embed = asked.filter((url) => url.origin === ECO_API).at(-1)!;
    expect(embed.searchParams.get("amountIn")).toBeNull();
    expect(embed.searchParams.get("pot")).toBe(pot);

    const done = await run(ecoSwap, 200000000n, 834000000n);
    expect(done.code).toBe(0);
    expect(tokenAmount(harness, potUsdc)).toBe(0n);
    expect(potHolds() - held).toBe(834000000n);

    // A floor above what the route pays: the floor written into the instruction refuses it.
    fund();
    const refused = await run(ecoSwap, 200000000n, 834000001n);
    expect(refused.code).not.toBe(0);
    expect(refused.stdout + refused.stderr).toMatch(/6001|0x1771/);
    expect(tokenAmount(harness, potUsdc)).toBe(100000000n);
  }, 120_000);

  it("holds the output to minOut itself, whatever the route's own floor allows", async () => {
    // eco-swap's instruction tolerates 1% below the floor the program writes: the route pays
    // 834000000 against a floor of 840000000, which the program refuses.
    ecoSlippageBps = 100;
    fund();
    pays(834000000n);
    const held = potHolds();
    try {
      const refused = await run(ecoSwap, 200000000n, 840000000n);
      expect(refused.code).not.toBe(0);
      expect(refused.stdout + refused.stderr).toMatch(/below minOut/);
      expect(tokenAmount(harness, potUsdc)).toBe(100000000n);
      expect(potHolds()).toBe(held);
    } finally {
      ecoSlippageBps = 0;
    }
  }, 120_000);
});
