/**
 * The token methods on Solana, EXECUTED: `USDC.transfer(to, amount)`, `pot.USDC`,
 * `USDC.balanceOf(who)`, `approve`, `transferFrom` and `Token(mint)` compiled for Solana and run
 * through the `sauce` command with no `--account` at all — every account the lowering added to
 * `main` derived by the command from the owner, the Pot and main's arguments — against the released
 * Kitchen and engine in LiteSVM behind a JSON-RPC shim (`svm/rpc-shim.ts`), with the real SPL Token,
 * Token-2022 and associated-token-account programs LiteSVM carries.
 *
 * The mints are planted at their registry addresses: USDC and USDT (SPL Token, moved by the legacy
 * transfer), PYUSD as mainnet holds it (Token-2022 with its extensions, moved by `transferChecked`
 * with the registry's decimals), SPACEX, PreStocks' SpaceX mint as mainnet holds it (two
 * transfer-fee schedules, each run at its epoch), and a PreStocks stock's mint with a 1.5% fee (its
 * registry row's address and decimals, the fee config built here: the fee is Token-2022's to
 * withhold). Each holder's account is checked on chain, so a wrong account given in place of a
 * derived one is refused, and the derivation is the cook's: `--via engine` spends the owner's.
 *
 * The manual's quick start, `docs/examples/pay.sauce.ts`, runs here as its header's Solana lines
 * say: simulated, then run from the Solana wallet the page makes, the Pot and the recipient's USDC
 * account created when the run asks.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  createKeyPairSignerFromBytes,
  getAddressCodec,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getTransactionDecoder,
  lamports,
  signTransaction,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { Clock, FailedTransactionMetadata } from "litesvm";
import {
  findAssociatedTokenPda,
  getApproveInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToCheckedInstruction,
} from "@solana-program/token";

import { requireChain } from "../src/chains/canonical.js";
import { nodeIo, runCli } from "../src/cli/run.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { svmTokenRows } from "../src/routes/token-registry.js";
import { derivePotPda, resolveSvmToken, svmTokenReceived } from "../src/svm/index.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  sendInstructions,
  startEngine,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  tokenAmount,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOLANA_URL = "http://127.0.0.1:65533/";
const KITCHEN = address(v12SvmKitchenProgramId());
const ENGINE = v12SvmEngineProgramId();
const SOLANA = requireChain("solana");
const codec = getAddressCodec();

/** SPACEX, PreStocks' SpaceX token, as mainnet holds it: two transfer-fee schedules. */
const SPACEX_IMAGE = (
  JSON.parse(readFileSync(join(HERE, "svm/fixtures/token-2022/stock-mints.json"), "utf8")) as {
    mints: { SPACEX: { dataBase64: string } };
  }
).mints.SPACEX;

/** PYUSD's mint as mainnet holds it. */
const PYUSD_IMAGE = (
  JSON.parse(readFileSync(join(HERE, "svm/fixtures/token-2022/real-mints.json"), "utf8")) as {
    pyusd: { dataBase64: string };
  }
).pyusd;

const rowOf = (symbol: string) => svmTokenRows(SOLANA).find((row) => row.symbol === symbol)!;

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    ...nodeIo(),
    confirm: async () => undefined,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  });

  return { code, stdout, stderr };
}

const json = (run: Run): Record<string, unknown> => {
  if (run.code !== 0) throw new Error(`exit ${run.code}\n${run.stderr}${run.stdout}`);

  return JSON.parse(run.stdout) as Record<string, unknown>;
};

/** A keypair file as solana-keygen writes it, and the signer it holds. */
async function keypairFile(
  dir: string,
  name: string,
): Promise<{ path: string; signer: KeyPairSigner }> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const bytes = new Uint8Array([...seed, ...pub]);
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify([...bytes]));

  return { path, signer: await createKeyPairSignerFromBytes(bytes) };
}

/** A Token-2022 `TransferFeeConfig` (1): both schedules `bps` and `maximumFee`, from epoch 0. */
function transferFeeExtension(bps: number, maximumFee: bigint): Uint8Array {
  const entry = new Uint8Array(4 + 108);
  const view = new DataView(entry.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 108, true);
  for (const at of [4 + 72, 4 + 90]) {
    view.setBigUint64(at + 8, maximumFee, true);
    view.setUint16(at + 16, bps, true);
  }

  return entry;
}

describeSvm("the token methods on Solana: every account derived by the command", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let owner: { path: string; signer: KeyPairSigner };
  let pot: Address;

  /** A mint planted at `at`, the harness's payer its mint authority. */
  function plantMint(at: Address, data: Uint8Array, program: Address): Address {
    const image = new Uint8Array(data);
    image.set([1, 0, 0, 0], 0);
    image.set(codec.encode(harness.payer.address), 4);
    image[45] = 1;
    harness.svm.setAccount({
      address: at,
      data: image,
      executable: false,
      lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(image.length))),
      programAddress: program,
      space: BigInt(image.length),
    });

    return at;
  }

  /** `holder`'s associated account for the mint, created by the ATA program and given `amount`. */
  async function account(
    mint: Address,
    holder: Address,
    amount: bigint,
    program: Address,
    decimals: number,
  ): Promise<Address> {
    const [at] = await findAssociatedTokenPda({ owner: holder, mint, tokenProgram: program });
    const made = await sendInstructions(harness, [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: harness.payer,
        ata: at,
        owner: holder,
        mint,
        tokenProgram: program,
      }),
      ...(amount === 0n
        ? []
        : [
            getMintToCheckedInstruction(
              { mint, token: at, mintAuthority: harness.payer, amount, decimals },
              { programAddress: program },
            ),
          ]),
    ]);
    if (!made.ok) throw new Error(`creating ${at} failed: ${made.err}`);

    return at;
  }

  /** Where `holder`'s account for the mint derives, without creating it. */
  const ataOf = async (mint: Address, holder: Address, program: Address): Promise<Address> =>
    (await findAssociatedTokenPda({ owner: holder, mint, tokenProgram: program }))[0];

  const program = (name: string, source: string): string => {
    const path = join(work, `${name}.sauce.ts`);
    writeFileSync(path, source);

    return path;
  };

  const run = (file: string, ...rest: string[]) =>
    sauce(
      ...["run", file, "--chain", "solana", "--rpc-url", SOLANA_URL, "--keypair", owner.path],
      ...["--json", ...rest],
    );
  const simulate = (file: string, ...rest: string[]) =>
    sauce(
      ...["simulate", file, "--chain", "solana", "--rpc-url", SOLANA_URL],
      ...["--owner", owner.signer.address, "--json", ...rest],
    );

  let usdc: Address;
  let usdt: Address;
  let pyusd: Address;
  let stock: Address;
  let potUsdc: Address;
  let potUsdt: Address;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, ENGINE_SO as string, address(ENGINE));
    work = mkdtempSync(join(tmpdir(), "sauce-token-methods-"));
    owner = await keypairFile(work, "owner");
    harness.svm.airdrop(owner.signer.address, lamports(10_000_000_000n));
    pot = (await derivePotPda(KITCHEN, owner.signer.address, new Uint8Array(32))).address;

    const legacy = (decimals: number): Uint8Array => {
      const data = new Uint8Array(82);
      data[44] = decimals;

      return data;
    };
    usdc = plantMint(address(rowOf("USDC").mint), legacy(6), TOKEN_PROGRAM);
    usdt = plantMint(address(rowOf("USDT").mint), legacy(6), TOKEN_PROGRAM);
    pyusd = plantMint(
      address(rowOf("PYUSD").mint),
      new Uint8Array(Buffer.from(PYUSD_IMAGE.dataBase64, "base64")),
      TOKEN_2022_PROGRAM,
    );
    // A PreStocks mint at its registry address, with its registry decimals and a 1.5% fee.
    const prestock = svmTokenRows(SOLANA).find((row) => row.stock?.issuer === "prestocks")!;
    const feeMint = new Uint8Array(166 + 112);
    feeMint[44] = prestock.decimals;
    feeMint[165] = 1;
    feeMint.set(transferFeeExtension(150, 1_000_000_000n), 166);
    stock = plantMint(address(prestock.mint), feeMint, TOKEN_2022_PROGRAM);

    potUsdc = await account(usdc, pot, 1_000_000n, TOKEN_PROGRAM, 6);
    potUsdt = await account(usdt, pot, 1_000_000n, TOKEN_PROGRAM, 6);
    await account(pyusd, pot, 1_000_000n, TOKEN_2022_PROGRAM, 6);
    await account(stock, pot, 10_000_000_000n, TOKEN_2022_PROGRAM, prestock.decimals);
    shim = solanaShim(harness.svm, SOLANA_URL);
    shim.install();
    // The owner's Pot, created once, so each test's cook runs on it whatever runs first.
    const deployed = await sauce(
      ...["pot", "--deploy", "--chain", "solana", "--keypair", owner.path],
      ...["--rpc-url", SOLANA_URL],
    );
    if (deployed.code !== 0) throw new Error(`creating the Pot failed: ${deployed.stderr}`);
  }, 120_000);

  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("runs the sauce-solana pay example as its header says: --args and nothing else", async () => {
    const file = join(HERE, "../../skills/sauce-solana/examples/pay.sauce.ts");
    // The example line of the program's header, as written, its placeholders filled in and the
    // endpoint added.
    const header = readFileSync(file, "utf8")
      .split("\n")
      .filter((one) => one.startsWith("//"))
      .map((one) => one.replace(/^\/\/\s*/, ""));
    const line = header.find((one) => one.startsWith("sauce run pay.sauce.ts --chain solana"))!;
    const recipient = randomAddress();
    const toUsdc = await account(usdc, recipient, 0n, TOKEN_PROGRAM, 6);
    const argv = line
      .split(/\s+/)
      .slice(1)
      .map((word) => ({ "<keypair>": owner.path, "<recipient>": recipient })[word] ?? word);
    expect(argv.slice(0, 2)).toEqual(["run", "pay.sauce.ts"]);
    expect(argv).not.toContain("--account");
    argv[1] = file;
    const held = tokenAmount(harness, potUsdc);
    const out = json(await sauce(...argv, "--rpc-url", SOLANA_URL, "--json"));
    expect(out).toMatchObject({ cook: { status: "success" } });
    expect(tokenAmount(harness, toUsdc)).toBe(400n);
    expect(tokenAmount(harness, potUsdc)).toBe(held - 400n);

    // Past what the Pot holds, its own check refuses it.
    const short = await simulate(file, "--args", recipient, String(held));
    expect(JSON.parse(short.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "not enough USDC"',
    });
  }, 120_000);

  it("runs the manual's quick start, docs/examples/pay.sauce.ts, on Solana as its header says, from a wallet", async () => {
    const file = join(HERE, "../../docs/examples/pay.sauce.ts");
    // The page's reader types the wallet's password at the prompt; here it comes from a variable.
    const password = `throwaway-${process.pid}-${Date.now()}`;
    const PASSWORD = ["--password-env", "SAUCE_WALLET_PASSWORD"];
    const asReader = async (...argv: string[]): Promise<Run> => {
      let stdout = "";
      let stderr = "";
      const code = await runCli(argv, {
        ...nodeIo(),
        walletsDir: join(work, "wallets"),
        readEnv: (name) => (name === "SAUCE_WALLET_PASSWORD" ? password : undefined),
        canAsk: () => true,
        confirm: async () => true,
        stdout: (text) => void (stdout += text),
        stderr: (text) => void (stderr += text),
      });

      return { code, stdout, stderr };
    };
    const recipient = randomAddress();
    /** The example's `sauce <command> pay.sauce.ts --chain solana` line, as words, filled in. */
    const usage = (command: string): string[] => {
      const line = readFileSync(file, "utf8")
        .split("\n")
        .map((one) => one.replace(/^\/\/\s*/, ""))
        .find((one) => one.startsWith(`sauce ${command} pay.sauce.ts --chain solana `))!;
      const argv = line
        .split(/\s+/)
        .slice(1)
        .map((word) => ({ "pay.sauce.ts": file, "<recipient>": recipient })[word] ?? word);
      expect(argv).not.toContain("--account");

      return [...argv, "--rpc-url", SOLANA_URL];
    };

    // The page's wallet, made as the page makes it, given SOL for the fees and the rent.
    const made = json(
      await asReader("wallet", "new", "me-solana", "--solana", ...PASSWORD, "--json"),
    );
    const me = address(made.address as string);
    harness.svm.airdrop(me, lamports(1_000_000_000n));

    // Simulated first: no password, the Pot not created yet, its USDC assumed. The 1 USDC moves from
    // the Pot's USDC account to the recipient's, in the copy only: nothing is created or paid.
    const mePot = (await derivePotPda(KITCHEN, me, new Uint8Array(32))).address;
    const toUsdc = await ataOf(usdc, recipient, TOKEN_PROGRAM);
    const simulated = json(await asReader(...usage("simulate"), "--json"));
    expect(simulated).toMatchObject({ ok: true });
    expect(simulated.tokenChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: await ataOf(usdc, mePot, TOKEN_PROGRAM),
          delta: "-1000000",
        }),
        expect.objectContaining({ account: toUsdc, delta: "1000000" }),
      ]),
    );
    expect(harness.svm.getAccount(toUsdc).exists).toBe(false);
    expect(harness.svm.getAccount(mePot).exists).toBe(false);

    // Then run: the page has its reader send the Pot 1 USDC first, and the run asks to create the
    // Pot and the recipient's USDC account before the cook.
    const potUsdcOfMe = await account(usdc, mePot, 1_000_000n, TOKEN_PROGRAM, 6);
    const ran = await asReader(...usage("run"), ...PASSWORD);
    expect(ran.code).toBe(0);
    expect(tokenAmount(harness, toUsdc)).toBe(1_000_000n);
    expect(tokenAmount(harness, potUsdcOfMe)).toBe(0n);
  }, 120_000);

  it("runs the sauce-solana wrap example as its header says: the owner's SOL into the Pot's WSOL", async () => {
    const file = join(HERE, "../../skills/sauce-solana/examples/wrap.sauce.ts");
    const header = readFileSync(file, "utf8")
      .split("\n")
      .filter((one) => one.startsWith("//"))
      .map((one) => one.replace(/^\/\/\s*/, ""));
    const line = header.find((one) => one.startsWith("sauce run wrap.sauce.ts --chain solana"))!;
    const argv = line
      .split(/\s+/)
      .slice(1)
      .map((word) => ({ "<keypair>": owner.path })[word] ?? word);
    expect(argv).not.toContain("--account");
    argv[1] = file;
    // The native mint, as the cluster holds it.
    const wsol = address(rowOf("WSOL").mint);
    if (!harness.svm.getAccount(wsol).exists) {
      const data = new Uint8Array(82);
      data[44] = 9;
      plantMint(wsol, data, TOKEN_PROGRAM);
    }
    const potWsol = await ataOf(wsol, pot, TOKEN_PROGRAM);
    expect(harness.svm.getAccount(potWsol).exists).toBe(false);
    const lamportsBefore = harness.svm.getBalance(owner.signer.address)!;

    // The Pot's WSOL account is created first, as the header says, with --yes.
    const out = json(await sauce(...argv, "--yes", "--rpc-url", SOLANA_URL, "--json"));
    expect(out).toMatchObject({ cook: { status: "success" } });
    expect(tokenAmount(harness, potWsol)).toBe(1_000_000n);
    // The owner paid the lamports wrapped, the account's rent and the fees.
    expect(lamportsBefore - harness.svm.getBalance(owner.signer.address)!).toBeGreaterThan(
      1_000_000n,
    );

    // Run again, the account there, the simulation returns the balance the cook leaves.
    expect(json(await simulate(file, "--args", "500"))).toMatchObject({
      ok: true,
      returned: "1000500",
    });
  }, 120_000);

  it("`sauce compile --json` lists each added account with how it is derived", async () => {
    const file = program(
      "pay",
      "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
    );
    const out = json(
      await sauce(
        ...["compile", file, "--chain", "solana", "--json"],
        ...["--args", randomAddress(), "400"],
      ),
    );
    expect((out.manifest as { accounts: unknown[] }).accounts).toEqual([
      { kind: "slot", index: 0, name: "tokenProgram", requires: "readonly", derive: TOKEN_PROGRAM },
      { kind: "slot", index: 1, name: "pot", requires: "readonly_signer", derive: "authority" },
      { kind: "slot", index: 2, name: "potUSDC", requires: "writable", derive: "authority:USDC" },
      { kind: "slot", index: 3, name: "toUSDC", requires: "writable", derive: "@to:USDC" },
    ]);
    expect(out.entryParams).toEqual([
      { name: "to", type: "Address" },
      { name: "amount", type: "Uint256" },
    ]);
    // No slot is assumed: each is derived, so the size is the cook's.
    expect(out.cook).toMatchObject({ fits: true, assumed: [] });
  });

  it("pays USDC and USDT to main's argument with no --account, the recipient's account bound", async () => {
    const file = program(
      "pay-both",
      "function main(to: Address, amount: Uint256) {\n" +
        "  USDC.transfer(to, amount);\n" +
        "  USDT.transfer(to, amount * 2);\n" +
        "}\n",
    );
    const to = randomAddress();
    const toUsdc = await account(usdc, to, 0n, TOKEN_PROGRAM, 6);
    const toUsdt = await account(usdt, to, 0n, TOKEN_PROGRAM, 6);
    const before = { usdc: tokenAmount(harness, potUsdc), usdt: tokenAmount(harness, potUsdt) };

    const out = json(await run(file, "--args", to, "400"));
    expect(out).toMatchObject({ pot, cook: { status: "success" } });
    expect(tokenAmount(harness, toUsdc)).toBe(400n);
    expect(tokenAmount(harness, toUsdt)).toBe(800n);
    expect(tokenAmount(harness, potUsdc)).toBe(before.usdc - 400n);
    expect(tokenAmount(harness, potUsdt)).toBe(before.usdt - 800n);

    // Another holder's account in the recipient's place is refused by the program, and nothing moves.
    const someoneElse = await account(usdc, randomAddress(), 0n, TOKEN_PROGRAM, 6);
    const wrong = await simulate(file, "--args", to, "1", "--account", `toUSDC=${someoneElse}`);
    expect(wrong.code).toBe(1);
    expect(JSON.parse(wrong.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "wrong recipient account"',
    });
    expect(tokenAmount(harness, someoneElse)).toBe(0n);
  }, 120_000);

  it("creates a recipient's missing account before the cook, when agreed", async () => {
    const file = program(
      "pay-new",
      "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
    );
    const to = randomAddress();
    const toUsdc = await ataOf(usdc, to, TOKEN_PROGRAM);

    // A rehearsal names it as the account the program was given, which a run creates.
    const rehearsed = JSON.parse((await simulate(file, "--args", to, "5")).stdout) as {
      missingAccounts?: string[];
    };
    expect(rehearsed.missingAccounts).toEqual([
      `the account toUSDC: ${toUsdc} does not exist on solana (main's argument to's USDC ` +
        "account: nothing has created it yet; `sauce run` creates it before the cook, asking " +
        "first, or with --yes)",
    ]);

    const refused = await sauce(
      ...["run", file, "--chain", "solana", "--rpc-url", SOLANA_URL, "--keypair", owner.path],
      ...["--args", to, "5"],
    );
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain(`main's argument to's USDC account, ${toUsdc}`);
    expect(harness.svm.getAccount(toUsdc).exists).toBe(false);

    const out = json(await run(file, "--yes", "--args", to, "5"));
    expect(out).toMatchObject({ cook: { status: "success" } });
    expect(tokenAmount(harness, toUsdc)).toBe(5n);
  }, 120_000);

  it("reads pot.USDC and USDC.balanceOf(who), each account bound to its holder", async () => {
    const file = program(
      "balances",
      "function main(who: Address): Uint256 {\n  return pot.USDC * 1000000 + USDC.balanceOf(who);\n}\n",
    );
    const who = randomAddress();
    await account(usdc, who, 77n, TOKEN_PROGRAM, 6);
    const held = tokenAmount(harness, potUsdc);

    const out = json(await simulate(file, "--args", who));
    expect(out).toMatchObject({ ok: true, returned: String(held * 1_000_000n + 77n) });

    const wrong = await simulate(file, "--args", who, "--account", `whoUSDC=${potUsdc}`);
    expect(JSON.parse(wrong.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "wrong holder account"',
    });
  }, 120_000);

  it("moves PYUSD by transferChecked with the registry's decimals, and a fee stock less its fee", async () => {
    // The stock's symbol, written into the program as a reader would.
    const symbol = svmTokenRows(SOLANA).find((row) => row.mint === stock)!.symbol;
    const file = program(
      "token-2022",
      "function main(to: Address, amount: Uint256): Uint256 {\n" +
        `  const before = ${symbol}.balanceOf(to);\n` +
        "  PYUSD.transfer(to, amount);\n" +
        `  ${symbol}.transfer(to, amount);\n` +
        `  return ${symbol}.balanceOf(to) - before;\n` +
        "}\n",
    );
    const to = randomAddress();
    const toPyusd = await account(pyusd, to, 0n, TOKEN_2022_PROGRAM, 6);
    const toStock = await account(stock, to, 0n, TOKEN_2022_PROGRAM, rowOf(symbol).decimals);

    const out = json(await run(file, "--args", to, "1000000"));
    expect(out).toMatchObject({ cook: { status: "success" } });
    expect(tokenAmount(harness, toPyusd)).toBe(1_000_000n);
    // 1.5% of 1,000,000 withheld by Token-2022, and the program measured what arrived.
    expect(tokenAmount(harness, toStock)).toBe(985_000n);
  }, 120_000);

  it("pays SPACEX, PreStocks' mint as mainnet holds it, less the fee its schedule charges at the epoch", async () => {
    const row = rowOf("SPACEX");
    const spacex = plantMint(
      address(row.mint),
      new Uint8Array(Buffer.from(SPACEX_IMAGE.dataBase64, "base64")),
      TOKEN_2022_PROGRAM,
    );
    await account(spacex, pot, 10_000_000_000n, TOKEN_2022_PROGRAM, row.decimals);
    const file = program(
      "pay-spacex",
      "function main(to: Address, amount: Uint256): Uint256 {\n" +
        "  const before = SPACEX.balanceOf(to);\n" +
        "  SPACEX.transfer(to, amount);\n" +
        "  return SPACEX.balanceOf(to) - before;\n" +
        "}\n",
    );
    // What Token-2022 withholds at an epoch, as the SDK nets it from the mint's own schedules.
    const token = await resolveSvmToken(async (key) => {
      const found = harness.svm.getAccount(key);
      return found.exists ? { owner: found.programAddress, data: found.data } : null;
    }, spacex);
    const clock = harness.svm.getClock();
    try {
      for (const epoch of [0n, 1039n]) {
        harness.svm.setClock(
          new Clock(clock.slot, clock.epochStartTimestamp, epoch, epoch, clock.unixTimestamp),
        );
        const to = randomAddress();
        const toSpacex = await account(spacex, to, 0n, TOKEN_2022_PROGRAM, row.decimals);
        const out = json(await run(file, "--args", to, "1000000"));
        expect(out).toMatchObject({ cook: { status: "success" } });
        // 0.5% under the older schedule, 1% from epoch 1039 under the newer.
        const received = svmTokenReceived(token, 1_000_000n, epoch);
        expect(received).toBe(epoch === 0n ? 995_000n : 990_000n);
        expect(tokenAmount(harness, toSpacex)).toBe(received);
      }
    } finally {
      harness.svm.setClock(clock);
    }
  }, 120_000);

  it("approves a spender, the delegate account checked to be the spender", async () => {
    const approve = program(
      "approve",
      "function main(spender: Address, amount: Uint256) {\n  USDT.approve(spender, amount);\n}\n",
    );
    const spender = randomAddress();
    expect(json(await run(approve, "--args", spender, "321"))).toMatchObject({
      cook: { status: "success" },
    });
    const delegated = harness.svm.getAccount(potUsdt);
    const data = delegated.exists ? delegated.data : new Uint8Array();
    expect(codec.decode(data.subarray(76, 108))).toBe(spender);
    expect(new DataView(data.buffer, data.byteOffset).getBigUint64(121, true)).toBe(321n);

    // A wrong delegate account given for the spender is refused.
    const wrong = await simulate(
      approve,
      "--args",
      spender,
      "1",
      "--account",
      `spenderAccount=${randomAddress()}`,
    );
    expect(JSON.parse(wrong.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "wrong spender account"',
    });
  }, 120_000);

  it("moves from a holder that approved the Pot, the sender's and recipient's accounts checked", async () => {
    const file = program(
      "pull",
      "function main(from: Address, to: Address, amount: Uint256) {\n  USDC.transferFrom(from, to, amount);\n}\n",
    );
    // The harness's payer holds USDC and makes the Pot its delegate for 500.
    const from = harness.payer.address;
    const fromUsdc = await account(usdc, from, 1_000n, TOKEN_PROGRAM, 6);
    const approved = await sendInstructions(harness, [
      getApproveInstruction({
        source: fromUsdc,
        delegate: pot,
        owner: harness.payer,
        amount: 500n,
      }),
    ]);
    expect(approved.ok).toBe(true);
    const to = randomAddress();
    const toUsdc = await account(usdc, to, 0n, TOKEN_PROGRAM, 6);

    expect(json(await run(file, "--args", from, to, "300"))).toMatchObject({
      cook: { status: "success" },
    });
    expect(tokenAmount(harness, fromUsdc)).toBe(700n);
    expect(tokenAmount(harness, toUsdc)).toBe(300n);

    // The Pot's own USDC account, which it may also spend, in the sender's place: refused.
    const wrong = await simulate(file, "--args", from, to, "1", "--account", `fromUSDC=${potUsdc}`);
    expect(JSON.parse(wrong.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "wrong sender account"',
    });
  }, 120_000);

  it("`--via engine` derives the owner's accounts: the signer is the authority it acts with", async () => {
    const file = program(
      "pay-engine",
      "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
    );
    const ownerUsdc = await account(usdc, owner.signer.address, 1_000n, TOKEN_PROGRAM, 6);
    const to = randomAddress();
    const toUsdc = await account(usdc, to, 0n, TOKEN_PROGRAM, 6);
    const potBefore = tokenAmount(harness, potUsdc);

    expect(json(await run(file, "--via", "engine", "--args", to, "9"))).toMatchObject({
      cook: { status: "success" },
    });
    expect(tokenAmount(harness, toUsdc)).toBe(9n);
    expect(tokenAmount(harness, ownerUsdc)).toBe(991n);
    expect(tokenAmount(harness, potUsdc)).toBe(potBefore);
  }, 120_000);

  it("--account names a program-derived address by its program and seeds, an argument among them", async () => {
    const file = program(
      "derived",
      "function main(found: Account, salt: Uint256): Address {\n  return found.address;\n}\n",
    );
    // The Pot is the Kitchen's address for "pot", its owner and a 32-byte salt: here the salt is
    // main's argument, written as a u128 seed twice over (16 bytes each).
    const out = json(
      await simulate(
        file,
        ...["--account", `found=pda:${KITCHEN}:"pot",owner,u128:@salt,u128:@salt`],
        ...["--args", "0"],
      ),
    );
    expect(out).toMatchObject({ ok: true });
    // An Address main returns is read back as the key it is, in base58.
    expect(out.returned).toBe(pot);
  }, 120_000);

  it("creates a Token-2022 recipient's missing account under Token-2022, and pays it by transferChecked", async () => {
    const file = program(
      "pay-pyusd",
      "function main(to: Address, amount: Uint256) {\n  PYUSD.transfer(to, amount);\n}\n",
    );
    await account(pyusd, pot, 1_000n, TOKEN_2022_PROGRAM, 6); // what the Pot pays from
    const to = randomAddress();
    const toPyusd = await ataOf(pyusd, to, TOKEN_2022_PROGRAM);
    expect(harness.svm.getAccount(toPyusd).exists).toBe(false);

    expect(json(await run(file, "--yes", "--args", to, "250"))).toMatchObject({
      cook: { status: "success" },
    });
    const made = harness.svm.getAccount(toPyusd);
    expect(made.exists && made.programAddress).toBe(TOKEN_2022_PROGRAM);
    expect(tokenAmount(harness, toPyusd)).toBe(250n);
  }, 120_000);

  it("`--via engine` with a Token-2022 mint pays from the owner's own Token-2022 account", async () => {
    const file = program(
      "pay-pyusd-engine",
      "function main(to: Address, amount: Uint256) {\n  PYUSD.transfer(to, amount);\n}\n",
    );
    const ownerPyusd = await account(pyusd, owner.signer.address, 500n, TOKEN_2022_PROGRAM, 6);
    const to = randomAddress();
    const toPyusd = await account(pyusd, to, 0n, TOKEN_2022_PROGRAM, 6);

    expect(json(await run(file, "--via", "engine", "--args", to, "40"))).toMatchObject({
      cook: { status: "success" },
    });
    expect(tokenAmount(harness, toPyusd)).toBe(40n);
    expect(tokenAmount(harness, ownerPyusd)).toBe(460n);
  }, 120_000);

  it("`sauce tx` prints the cook with every derived account filled; signed by the owner, it lands", async () => {
    const file = program(
      "pay-tx",
      "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
    );
    const to = randomAddress();
    const toUsdc = await account(usdc, to, 0n, TOKEN_PROGRAM, 6);
    const printed = json(
      await sauce(
        ...["tx", file, "--chain", "solana", "--rpc-url", SOLANA_URL],
        ...["--owner", owner.signer.address, "--args", to, "33"],
      ),
    );
    const unsigned = getTransactionDecoder().decode(
      new Uint8Array(getBase64Encoder().encode(printed.transaction as string)),
    );
    const keys = getCompiledTransactionMessageDecoder().decode(
      unsigned.messageBytes,
    ).staticAccounts;
    expect(keys).toEqual(expect.arrayContaining([toUsdc, potUsdc, TOKEN_PROGRAM, pot]));
    const signed = await signTransaction([owner.signer.keyPair], unsigned);
    const result = harness.svm.sendTransaction(signed);
    harness.svm.expireBlockhash();
    expect(result instanceof FailedTransactionMetadata ? result.meta().logs() : "ok").toBe("ok");
    expect(tokenAmount(harness, toUsdc)).toBe(33n);

    // With no arguments, nothing to derive `@to:USDC` from: refused, naming main's parameters.
    const bare = await sauce(
      ...["tx", file, "--chain", "solana", "--rpc-url", SOLANA_URL],
      ...["--owner", owner.signer.address],
    );
    expect(bare.code).toBe(2);
    expect(bare.stderr).toContain("takes 2 arguments: pass them after --args");
  }, 120_000);

  it("refuses a token program the cook attaches that is neither SPL Token nor Token-2022", async () => {
    const file = program(
      "any-mint-program",
      "function main(mint: Address, to: Address, amount: Uint256) {\n  Token(mint).transfer(to, amount);\n}\n",
    );
    const to = randomAddress();
    await account(usdc, to, 0n, TOKEN_PROGRAM, 6);
    const out = await simulate(
      file,
      ...["--account", "mintProgram=11111111111111111111111111111111"],
      ...["--args", usdc, to, "1"],
    );
    expect(JSON.parse(out.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "not the token program"',
    });
    // A mint whose program cannot be read is refused before anything is built: never assumed.
    const missing = randomAddress();
    const unread = await simulate(file, "--args", missing, to, "1");
    expect(unread.code).toBe(2);
    expect(unread.stderr).toContain(
      `the account mintProgram (program:@mint): the token program of mint ${missing} could not be read`,
    );
  }, 120_000);

  it("Token(mint) of an argument: the mint's program read from the cluster, the decimals from the mint", async () => {
    const file = program(
      "any-mint",
      "function main(mint: Address, to: Address, amount: Uint256) {\n  Token(mint).transfer(to, amount);\n}\n",
    );
    // An unregistered Token-2022 mint with no extensions.
    const other = plantMint(
      randomAddress(),
      (() => {
        const data = new Uint8Array(82);
        data[44] = 4;

        return data;
      })(),
      TOKEN_2022_PROGRAM,
    );
    const potOther = await account(other, pot, 50_000n, TOKEN_2022_PROGRAM, 4);
    const to = randomAddress();
    const toOther = await account(other, to, 0n, TOKEN_2022_PROGRAM, 4);

    expect(json(await run(file, "--args", other, to, "20000"))).toMatchObject({
      cook: { status: "success" },
    });
    expect(tokenAmount(harness, toOther)).toBe(20_000n);
    expect(tokenAmount(harness, potOther)).toBe(30_000n);
  }, 120_000);

  it("writes each account where it is used: a hand-built SPL Token transfer runs with --args alone", async () => {
    const file = program(
      "accounts-spl",
      "function main(to: Address, amount: Uint256): Uint256 {\n" +
        "  const dest = Solana.pda(Solana.associatedTokenProgram, [to, Solana.tokenProgram, USDC]).writable();\n" +
        "  let data = hex`03`;\n" +
        "  svm.call(USDC.tokenProgram, [\n" +
        "    USDC.accountOf(pot).writable(),\n" +
        "    dest,\n" +
        "    pot.signer(),\n" +
        "  ], data.concat(amount.toBytesLe(8)));\n" +
        "  return svm.sload(dest, 64, 8).toLe();\n" +
        "}\n",
    );
    const to = randomAddress();
    const toUsdc = await account(usdc, to, 0n, TOKEN_PROGRAM, 6);
    const held = tokenAmount(harness, potUsdc);

    // What the command derives: the recipient's account as the ATA program's address, the rest by name.
    const compiled = json(
      await sauce("compile", file, "--chain", "solana", "--json", "--args", to, "250"),
    ) as { manifest: { accounts: { name: string; derive?: string }[] } };
    expect(
      Object.fromEntries(compiled.manifest.accounts.map((slot) => [slot.name, slot.derive])),
    ).toEqual({
      destPda: `pda:ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL:@to,${TOKEN_PROGRAM},mint:USDC`,
      tokenProgram: TOKEN_PROGRAM,
      potUSDC: "pot:USDC",
      pot: "pot",
    });

    // The simulation reads back what arrived; the run moves it.
    expect(json(await simulate(file, "--args", to, "250"))).toMatchObject({
      ok: true,
      returned: "250",
    });
    const out = json(await run(file, "--args", to, "250"));
    expect(out).toMatchObject({ pot, cook: { status: "success" } });
    expect(tokenAmount(harness, toUsdc)).toBe(250n);
    expect(tokenAmount(harness, potUsdc)).toBe(held - 250n);
  }, 120_000);

  it("moves PYUSD by a hand-built transferChecked: its mint and Token-2022 named by the symbol", async () => {
    const file = program(
      "accounts-2022",
      "function main(to: Address, amount: Uint256) {\n" +
        "  let data = hex`0c`;\n" +
        "  svm.call(PYUSD.tokenProgram, [\n" +
        "    PYUSD.accountOf(pot).writable(),\n" +
        "    PYUSD.mint,\n" +
        "    PYUSD.accountOf(to).writable(),\n" +
        "    pot.signer(),\n" +
        "  ], data.concat(amount.toBytesLe(8)).concat(hex`06`));\n" +
        "}\n",
    );
    const potPyusd = await account(pyusd, pot, 1_000n, TOKEN_2022_PROGRAM, 6);
    const held = tokenAmount(harness, potPyusd);
    const to = randomAddress();
    const toPyusd = await account(pyusd, to, 0n, TOKEN_2022_PROGRAM, 6);

    expect(json(await run(file, "--args", to, "125"))).toMatchObject({
      cook: { status: "success" },
    });
    expect(tokenAmount(harness, toPyusd)).toBe(125n);
    expect(tokenAmount(harness, potPyusd)).toBe(held - 125n);

    // Another holder's account in the recipient's place is refused by the program: an account
    // written where it is used is held to its derivation, as the token methods hold theirs.
    const someoneElse = await account(pyusd, randomAddress(), 0n, TOKEN_2022_PROGRAM, 6);
    const wrong = await simulate(file, "--args", to, "1", "--account", `toPYUSD=${someoneElse}`);
    expect(JSON.parse(wrong.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "wrong holder account"',
    });
    // And so is another program in Token-2022's.
    const notTheProgram = await simulate(
      file,
      ...["--args", to, "1", "--account", `token2022Program=${TOKEN_PROGRAM}`],
    );
    expect(JSON.parse(notTheProgram.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "wrong program"',
    });
  }, 120_000);

  it("holds Solana.account(key) to its key: another account in its slot is refused", async () => {
    const file = program(
      "accounts-key",
      "function main(key: Address): Uint256 {\n  return Solana.account(key).dataLen;\n}\n",
    );
    const potAccount = harness.svm.getAccount(pot);
    if (!potAccount.exists) throw new Error("the Pot was created before the suite");
    expect(json(await simulate(file, "--args", pot))).toMatchObject({
      ok: true,
      returned: String(potAccount.data.length),
    });
    const wrong = await simulate(file, "--args", pot, "--account", `keyAccount=${potUsdc}`);
    expect(JSON.parse(wrong.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "wrong account"',
    });
  }, 120_000);

  it("derives an address from its program and seeds as the cook is built: the Pot, from the Kitchen", async () => {
    const file = program(
      "accounts-pda",
      "function main(kitchen: Address, salt: Uint256): Uint256 {\n" +
        '  const found = Solana.pda(kitchen, ["pot", Solana.owner, salt.toBytesLe(16), salt.toBytesLe(16)]);\n' +
        '  require(found.address == pot, "not the Pot");\n' +
        "  return found.dataLen;\n" +
        "}\n",
    );
    const out = json(await simulate(file, "--args", KITCHEN, "0"));
    expect(out).toMatchObject({ ok: true });
    const potAccount = harness.svm.getAccount(pot);
    if (!potAccount.exists) throw new Error("the Pot was created before the suite");
    expect(Number(out.returned)).toBe(potAccount.data.length);

    // Seeded by the owner, the slot is the owner's to fill: the command refuses another account
    // in it before anything is built.
    const refused = await simulate(file, "--args", KITCHEN, "0", "--account", `foundPda=${potUsdc}`);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(
      `--account foundPda=${potUsdc}: the account foundPda is derived from the owner, as ` +
        `pda:@kitchen:"pot",owner,`,
    );
    // Seeded by an argument, the slot is the caller's: the engine derives the address again, and
    // another account there is refused, before the program's own check.
    const byArgument = program(
      "accounts-pda-argument",
      "function main(kitchen: Address, who: Address, salt: Uint256): Uint256 {\n" +
        '  const found = Solana.pda(kitchen, ["pot", who, salt.toBytesLe(16), salt.toBytesLe(16)]);\n' +
        '  require(found.address == pot, "not the Pot");\n' +
        "  return found.dataLen;\n" +
        "}\n",
    );
    const args = ["--args", KITCHEN, owner.signer.address, "0"];
    expect(json(await simulate(byArgument, ...args))).toMatchObject({ ok: true });
    const wrong = await simulate(byArgument, ...args, "--account", `foundPda=${potUsdc}`);
    expect(JSON.parse(wrong.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "wrong program-derived address"',
    });
  }, 120_000);

  describe("pot where the program stands: a script, a top-level function, a value", () => {
    // Each simulated in the command's local copy (LiteSVM): `--assume-balance` gives the Pot's USDC
    // account the balance named, 5 USDC, whatever the cluster holds.
    const assumed = ["--assume-balance", "USDC:5"];

    it("a script's pot.USDC: the main it runs as takes the Pot's accounts", async () => {
      const holds = program("script-holds", 'require(pot.USDC == 5000000, "not 5 USDC");\n');
      expect(json(await simulate(holds, ...assumed))).toMatchObject({ ok: true });
      const short = program("script-short", 'require(pot.USDC > 5000000, "5 USDC or less");\n');
      const refused = await simulate(short, ...assumed);
      expect(refused.code).toBe(1);
      expect(JSON.parse(refused.stdout)).toMatchObject({
        ok: false,
        reason: 'the program threw "5 USDC or less"',
      });
    }, 120_000);

    it("pot.USDC in a top-level function and one it calls: each given the Pot's accounts", async () => {
      const file = program(
        "helpers",
        "function held(): Uint256 {\n  return pot.USDC;\n}\n" +
          "function twice(): Uint256 {\n  return held() + held();\n}\n" +
          "function main(who: Address): Uint256 {\n  return twice() + USDC.balanceOf(who);\n}\n",
      );
      const who = randomAddress();
      await account(usdc, who, 77n, TOKEN_PROGRAM, 6);
      expect(json(await simulate(file, "--args", who, ...assumed))).toMatchObject({
        ok: true,
        returned: String(2n * 5_000_000n + 77n),
      });
    }, 120_000);

    it("bare pot is the Pot's key: the address the Kitchen derives, and the one pot.balance reads", async () => {
      const file = program("pot-key", "function main(): Address {\n  return pot;\n}\n");
      expect(json(await simulate(file, ...assumed))).toMatchObject({ ok: true, returned: pot });
      // Its slot must sign (`Account<Signer>`): the Kitchen signs for the Pot, and the cook lands.
      const compiled = json(await sauce("compile", file, "--chain", "solana", "--json")) as {
        manifest: { accounts: { name: string; requires: string }[] };
      };
      expect(compiled.manifest.accounts).toEqual([
        expect.objectContaining({ name: "pot", requires: "readonly_signer" }),
      ]);
      expect(json(await run(file))).toMatchObject({ cook: { status: "success" } });
      const lamports = program(
        "pot-lamports",
        'function main(): Uint256 {\n  require(ctx.balance(pot) == pot.balance, "two balances");\n  return pot.balance;\n}\n',
      );
      const held = harness.svm.getBalance(pot)!;
      expect(json(await simulate(lamports, ...assumed))).toMatchObject({
        ok: true,
        returned: String(held),
      });
    }, 120_000);

    it("--via engine refuses a program that uses the Pot: there is none cooked directly", async () => {
      const file = program("pot-engine", "function main(): Uint256 {\n  return pot.USDC;\n}\n");
      const refused = await simulate(file, "--via", "engine");
      expect(refused.code).toBe(2);
      expect(refused.stderr).toContain(
        "the program uses the Pot (potUSDC: pot:USDC, pot: pot), and --via engine cooks with " +
          "no Pot, so there is no Pot to attach: cook through the Kitchen",
      );
      // Whatever --account gives in the Pot's place: the program still names the Pot.
      const overridden = await simulate(
        program("pot-engine-key", "function main(): Address {\n  return pot;\n}\n"),
        ...["--via", "engine", "--account", "pot=owner"],
      );
      expect(overridden.code).toBe(2);
      expect(overridden.stderr).toContain(
        "the program uses the Pot (pot: pot), and --via engine cooks with no Pot",
      );
      // A given `self` is refused too, naming what to write.
      const self = await simulate(file, "--account", "potUSDC=self:USDC");
      expect(self.code).toBe(2);
      expect(self.stderr).toContain(
        "'self:USDC' names no account: self is retired. Write 'pot:USDC' (the Pot)",
      );
    }, 120_000);
  });

  describe("the Pot's slots are the Pot: no account a caller gives stands in for one", () => {
    // Through the Kitchen a slot the lowering derived from the Pot (`pot`, `pot:<token>`,
    // `authority`, an address seeded by the Pot) is the Pot's own: given another account in its
    // place, `return pot` would return that account, `pot.balance` and `pot.USDC` would read it, and
    // `pot.signer()` would carry the owner's signature. The command refuses before it builds
    // anything. The refusal names the slot, its derivation, the account it gives and the value given.
    const assumed = ["--assume-balance", "USDC:5"];
    const programs = {
      key: "function main(): Address {\n  return pot;\n}\n",
      token: "function main(): Uint256 {\n  return pot.USDC;\n}\n",
      lamports: "function main(): Uint256 {\n  return pot.balance;\n}\n",
      signer:
        "function main() {\n  svm.call(Solana.systemProgram, [pot.signer(), pot.writable()], hex`00`);\n}\n",
      // It names no `pot`: its authority slot derives as `authority`, which is the Pot here too.
      pays: "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
    };
    /** The refusal's text up to what the given value is: the slot, its derivation and the Pot's. */
    const stands = (name: string, derivation: string, expected: string, given: string) =>
      `--account ${name}=${given}: the account ${name} is derived from the Pot, as ` +
      `${derivation} (${expected}), and `;
    /** How the refusal names the value given: a name with the account it is, or the address. */
    const givenAs = (given: string, resolved: string) =>
      `${given === resolved ? given : `${given} (${resolved})`} is another account. Through the ` +
      "Kitchen nothing stands in for the Pot:";

    it.each([
      ["return pot", "key", "pot", "pot"],
      ["pot.balance", "lamports", "pot", "pot"],
      ["pot.USDC", "token", "pot", "pot"],
      ["pot.signer() in an svm.call", "signer", "pot", "pot"],
    ] as const)(
      "refuses the owner for the Pot's own slot, by --account and by --accounts: %s",
      async (_what, name, slot, derivation) => {
        const file = program(`pot-slot-${name}`, programs[name]);
        for (const given of [owner.signer.address, "owner"]) {
          for (const flags of [
            ["--account", `${slot}=${given}`],
            ["--accounts", JSON.stringify({ [slot]: given })],
          ]) {
            const out = await simulate(file, ...flags, ...assumed);
            expect(out.code).toBe(2);
            expect(out.stderr).toContain(stands(slot, derivation, pot, given));
            expect(out.stderr).toContain(givenAs(given, owner.signer.address));
          }
        }
      },
      120_000,
    );

    it("refuses another account for the Pot's token account, and any other for a pda seeded by the Pot", async () => {
      const file = program("pot-slot-usdc", programs.token);
      const someone = randomAddress();
      const refused = await simulate(file, "--account", `potUSDC=${someone}`, ...assumed);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toContain(
        stands("potUSDC", "pot:USDC", potUsdc, someone) + givenAs(someone, someone),
      );
      // The owner's own USDC account is another holder's: refused as well.
      const ownerUsdc = await account(usdc, owner.signer.address, 0n, TOKEN_PROGRAM, 6);
      const other = await simulate(file, "--account", `potUSDC=${ownerUsdc}`, ...assumed);
      expect(other.code).toBe(2);
      expect(other.stderr).toContain(stands("potUSDC", "pot:USDC", potUsdc, ownerUsdc));

      const seeded = program(
        "pot-slot-pda",
        'function main(program: Address): Uint256 {\n  return Solana.pda(program, ["vault", pot]).dataLen;\n}\n',
      );
      const derived = json(await sauce("compile", seeded, "--chain", "solana", "--json")) as {
        manifest: { accounts: { name: string; derive?: string }[] };
      };
      const pda = derived.manifest.accounts.find((slot) => slot.derive?.includes(",pot"))!;
      const wrongPda = await simulate(
        seeded,
        ...["--args", KITCHEN, "--account", `${pda.name}=${someone}`],
      );
      expect(wrongPda.code).toBe(2);
      expect(wrongPda.stderr).toContain(
        `--account ${pda.name}=${someone}: the account ${pda.name} is derived from the Pot, as ${pda.derive} (`,
      );
      // Its own address is taken, by its derivation and by its key, and the cook runs.
      const [vault] = await getProgramDerivedAddress({
        programAddress: KITCHEN,
        seeds: [new TextEncoder().encode("vault"), codec.encode(pot)],
      });
      for (const given of [pda.derive!, vault]) {
        const out = await simulate(seeded, ...["--args", KITCHEN, "--account", `${pda.name}=${given}`]);
        expect(json(out)).toMatchObject({ ok: true, returned: "0" });
      }
    }, 120_000);

    it("refuses the owner for the authority slot of a program that never names pot", async () => {
      const file = program("pot-slot-authority", programs.pays);
      const to = randomAddress();
      await account(usdc, to, 0n, TOKEN_PROGRAM, 6);
      for (const given of [owner.signer.address, "owner"]) {
        const out = await simulate(file, "--args", to, "1", "--account", `pot=${given}`);
        expect(out.code).toBe(2);
        expect(out.stderr).toContain(stands("pot", "authority", pot, given));
      }
    }, 120_000);

    it("takes the Pot itself for its slot, by role or by address, and runs", async () => {
      const key = program("pot-slot-same-key", programs.key);
      for (const given of ["pot", pot, "authority"]) {
        for (const flags of [
          ["--account", `pot=${given}`],
          ["--accounts", JSON.stringify({ pot: given })],
        ]) {
          expect(json(await simulate(key, ...flags, ...assumed))).toMatchObject({
            ok: true,
            returned: pot,
          });
        }
      }
      const token = program("pot-slot-same-usdc", programs.token);
      expect(
        json(await simulate(token, "--account", "potUSDC=pot:USDC", ...assumed)),
      ).toMatchObject({ ok: true, returned: "5000000" });
      expect(
        json(await simulate(token, "--account", `potUSDC=${potUsdc}`, ...assumed)),
      ).toMatchObject({ ok: true, returned: "5000000" });
    }, 120_000);

    it("--via engine is as it was: the owner is the authority, and a given owner stands for it", async () => {
      const file = program("pot-slot-engine", programs.pays);
      const ownerUsdc = await account(usdc, owner.signer.address, 1_000n, TOKEN_PROGRAM, 6);
      const to = randomAddress();
      const toUsdc = await account(usdc, to, 0n, TOKEN_PROGRAM, 6);
      for (const given of ["owner", owner.signer.address]) {
        const out = await simulate(
          file,
          ...["--via", "engine", "--args", to, "1", "--account", `pot=${given}`],
        );
        expect(json(out)).toMatchObject({ ok: true });
      }
      // Run, it moves the owner's USDC and none of the Pot's.
      const before = { owner: tokenAmount(harness, ownerUsdc), pot: tokenAmount(harness, potUsdc) };
      expect(
        json(await run(file, ...["--via", "engine", "--args", to, "7", "--account", "pot=owner"])),
      ).toMatchObject({ cook: { status: "success" } });
      expect(tokenAmount(harness, toUsdc)).toBe(7n);
      expect(tokenAmount(harness, ownerUsdc)).toBe(before.owner - 7n);
      expect(tokenAmount(harness, potUsdc)).toBe(before.pot);
    }, 120_000);
  });

  describe("a slot derived from a cook role is that account: pot, owner and authority alike", () => {
    // One rule for every role a cook fills: a slot the lowering derived from the Pot, the owner or
    // the authority (their token accounts and the addresses they seed included) takes only the
    // account its derivation gives, on every command that builds the cook, through the Kitchen and
    // cooked directly. `--account owner=<another key>` with `return Solana.owner.address;` used to
    // return the other key.
    const tx = (file: string, ...rest: string[]) =>
      sauce(
        ...["tx", file, "--chain", "solana", "--rpc-url", SOLANA_URL],
        ...["--owner", owner.signer.address, ...rest],
      );
    const commands = { simulate, run, tx } as const;
    const programs = {
      pot: "function main(): Address {\n  return pot;\n}\n",
      potToken: "function main(): Uint256 {\n  return pot.USDC;\n}\n",
      owner: "function main(): Address {\n  return Solana.owner.address;\n}\n",
      ownerToken: "function main(): Uint256 {\n  return Solana.owner.USDC;\n}\n",
      pays: "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
      ownerSeeded:
        'function main(program: Address): Uint256 {\n  return Solana.pda(program, ["vault", Solana.owner]).dataLen;\n}\n',
    };
    let to: Address;
    let ownerUsdc: Address;

    beforeAll(async () => {
      to = randomAddress();
      await account(usdc, to, 0n, TOKEN_PROGRAM, 6);
      ownerUsdc = await account(usdc, owner.signer.address, 1_000n, TOKEN_PROGRAM, 6);
    });

    /** Each role's slot: the program, the slot, its derivation, whose it is, and main's args. */
    const cases = (): [string, string, string, string, "the Pot" | "the owner", string[]][] => [
      ["pot", programs.pot, "pot", "pot", "the Pot", []],
      ["pot:USDC", programs.potToken, "potUSDC", "pot:USDC", "the Pot", []],
      ["owner", programs.owner, "owner", "owner", "the owner", []],
      ["owner:USDC", programs.ownerToken, "ownerUSDC", "owner:USDC", "the owner", []],
      ["authority", programs.pays, "pot", "authority", "the Pot", ["--args", to, "1"]],
      ["authority:USDC", programs.pays, "potUSDC", "authority:USDC", "the Pot", ["--args", to, "1"]],
      [
        "a pda the owner seeds",
        programs.ownerSeeded,
        "vaultPda",
        'pda:@program:"vault",owner',
        "the owner",
        ["--args", KITCHEN],
      ],
    ];

    it.each(["simulate", "run", "tx"] as const)(
      "%s refuses another key for each role's slot, before anything is built or sent",
      async (command) => {
        for (const [role, source, slot, derivation, whose, args] of cases()) {
          const file = program(`role-${slot}-${command}`, source);
          const someone = randomAddress();
          const held = tokenAmount(harness, potUsdc);
          for (const flags of [
            ["--account", `${slot}=${someone}`],
            ["--accounts", JSON.stringify({ [slot]: someone })],
          ]) {
            const out = await commands[command](file, ...args, ...flags);
            expect({ role, code: out.code }).toEqual({ role, code: 2 });
            expect(out.stdout).toBe("");
            expect(out.stderr).toContain(
              `--account ${slot}=${someone}: the account ${slot} is derived from ${whose}, as ` +
                `${derivation} (`,
            );
            expect(out.stderr).toContain(
              `${someone} is another account. ` +
                (whose === "the Pot"
                  ? "Through the Kitchen nothing stands in for the Pot: "
                  : "Nothing stands in for the owner, who signs the cook: ") +
                `give ${derivation} or `,
            );
          }
          expect(tokenAmount(harness, potUsdc)).toBe(held);
        }
      },
      120_000,
    );

    it("refuses the Pot for the owner's slot, and the owner for the Pot's, by role", async () => {
      const ownerFile = program("role-owner-pot", programs.owner);
      const asPot = await simulate(ownerFile, "--account", "owner=pot");
      expect(asPot.code).toBe(2);
      expect(asPot.stderr).toContain(
        `--account owner=pot: the account owner is derived from the owner, as owner ` +
          `(${owner.signer.address}), and pot (${pot}) is another account.`,
      );
      const tokenFile = program("role-owner-usdc-pot", programs.ownerToken);
      const potToken = await simulate(tokenFile, "--account", "ownerUSDC=pot:USDC");
      expect(potToken.code).toBe(2);
      expect(potToken.stderr).toContain(
        `--account ownerUSDC=pot:USDC: the account ownerUSDC is derived from the owner, as ` +
          `owner:USDC (${ownerUsdc}), and pot:USDC (${potUsdc}) is another account.`,
      );
    }, 120_000);

    it("takes each role's own account, by role or by key, and runs", async () => {
      const ownerFile = program("role-owner-same", programs.owner);
      for (const given of ["owner", owner.signer.address]) {
        expect(json(await simulate(ownerFile, "--account", `owner=${given}`))).toMatchObject({
          ok: true,
          returned: owner.signer.address,
        });
      }
      const tokenFile = program("role-owner-usdc-same", programs.ownerToken);
      for (const given of ["owner:USDC", ownerUsdc]) {
        expect(json(await simulate(tokenFile, "--account", `ownerUSDC=${given}`))).toMatchObject({
          ok: true,
          returned: String(tokenAmount(harness, ownerUsdc)),
        });
      }
      const pays = program("role-authority-same", programs.pays);
      for (const flags of [
        ["--account", "pot=authority", "--account", "potUSDC=authority:USDC"],
        ["--account", `pot=${pot}`, "--account", `potUSDC=${potUsdc}`],
      ]) {
        expect(json(await simulate(pays, "--args", to, "1", ...flags))).toMatchObject({
          ok: true,
        });
      }
      expect(json(await run(ownerFile, "--account", "owner=owner"))).toMatchObject({
        cook: { status: "success" },
      });
    }, 120_000);

    it("--via engine: the authority is the owner, and another key for it is refused", async () => {
      const pays = program("role-authority-engine", programs.pays);
      const someone = randomAddress();
      const out = await simulate(
        pays,
        ...["--via", "engine", "--args", to, "1", "--account", `pot=${someone}`],
      );
      expect(out.code).toBe(2);
      expect(out.stderr).toContain(
        `--account pot=${someone}: the account pot is derived from the owner, as authority ` +
          `(${owner.signer.address}), and ${someone} is another account. Nothing stands in for ` +
          "the owner, who signs the cook: give authority or ",
      );
      const ownerFile = program("role-owner-engine", programs.owner);
      const direct = await simulate(ownerFile, "--via", "engine", "--account", `owner=${someone}`);
      expect(direct.code).toBe(2);
      expect(direct.stderr).toContain(`the account owner is derived from the owner, as owner (`);
    }, 120_000);
  });
});
