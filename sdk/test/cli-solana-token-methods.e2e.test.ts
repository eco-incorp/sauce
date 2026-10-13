/**
 * The token methods on Solana, EXECUTED: `USDC.transfer(to, amount)`, `self.USDC`,
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
      { kind: "slot", index: 1, name: "pot", requires: "readonly_signer", derive: "self" },
      { kind: "slot", index: 2, name: "potUSDC", requires: "writable", derive: "self:USDC" },
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

  it("reads self.USDC and USDC.balanceOf(who), each account bound to its holder", async () => {
    const file = program(
      "balances",
      "function main(who: Address): Uint256 {\n  return self.USDC * 1000000 + USDC.balanceOf(who);\n}\n",
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
        "    USDC.accountOf(ctx.self()).writable(),\n" +
        "    dest,\n" +
        "    Solana.self.signer(),\n" +
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
      potUSDC: "self:USDC",
      pot: "self",
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
        "    PYUSD.accountOf(ctx.self()).writable(),\n" +
        "    PYUSD.mint,\n" +
        "    PYUSD.accountOf(to).writable(),\n" +
        "    Solana.self.signer(),\n" +
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
  }, 120_000);

  it("derives an address from its program and seeds as the cook is built: the Pot, from the Kitchen", async () => {
    const file = program(
      "accounts-pda",
      "function main(kitchen: Address, salt: Uint256): Uint256 {\n" +
        '  const found = Solana.pda(kitchen, ["pot", Solana.owner, salt.toBytesLe(16), salt.toBytesLe(16)]);\n' +
        '  require(found.address == Solana.self.address, "not the Pot");\n' +
        "  return found.dataLen;\n" +
        "}\n",
    );
    const out = json(await simulate(file, "--args", KITCHEN, "0"));
    expect(out).toMatchObject({ ok: true });
    expect(Number(out.returned)).toBe(harness.svm.getAccount(pot).data.length);
  }, 120_000);
});
