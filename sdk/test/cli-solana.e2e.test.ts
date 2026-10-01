/**
 * The `sauce` command on Solana, executed: `pot`, `simulate`, `run` and `tx` against the released
 * Kitchen and engine in LiteSVM (`svm/engine-harness.ts`, the packaged binaries), the engine loaded
 * at the program id `/deployments` records so the CLI runs with no override.
 *
 * The seam is `globalThis.fetch`, as in the SDK's own client suites: a JSON-RPC shim answers the
 * calls the CLI makes — the blockhash, account reads, `simulateTransaction`, `sendTransaction`,
 * statuses and the confirmed transaction — from the in-process bank. `sendTransaction` checks each
 * signature against the message before executing, so a run proves the keypair signed what it sent.
 * No cluster, no validator, no network.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  createKeyPairSignerFromBytes,
  getAddressCodec,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  lamports,
  signTransaction,
  verifySignature,
  type Address,
  type KeyPairSigner,
  type ReadonlyUint8Array,
  type Transaction,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { FailedTransactionMetadata } from "litesvm";
import { bytesToHex, hexToBytes } from "viem";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { potSalt } from "../src/deployments/pot.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { svmTokenRows } from "../src/routes/token-registry.js";
import { requireChain } from "../src/chains/canonical.js";
import {
  buildSetExecutionFeeInstruction,
  COOK_AND_PAY_DISCRIMINATOR,
  COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR,
  createSauceSvmClient,
  deriveProgramDataPda,
  derivePotPda,
  getTransactionSize,
} from "../src/svm/index.js";
import { svmSettleSource } from "../src/svm/recipes/index.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  sendInstructions,
  setMint,
  setTokenAccount,
  startEngine,
  TOKEN_PROGRAM,
  tokenAmount,
  type EngineHarness,
} from "./svm/engine-harness.js";

const RPC_URL = "http://127.0.0.1:65535/";
const FEE = 5_000n;
const KITCHEN = address(v12SvmKitchenProgramId());

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauceWith(overrides: Partial<CliIo>, ...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    confirm: async () => undefined,
    ...overrides,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };

  return { code: await runCli(argv, io), stdout, stderr };
}
const sauce = (...argv: string[]): Promise<Run> => sauceWith({}, ...argv);

const json = (run: Run): Record<string, unknown> => {
  if (run.code !== 0) throw new Error(`exit ${run.code}\n${run.stderr}${run.stdout}`);

  return JSON.parse(run.stdout) as Record<string, unknown>;
};

// ---------------------------------------------------------------------------------------------
// The cluster: a JSON-RPC shim over the bank
// ---------------------------------------------------------------------------------------------

const b64 = (bytes: ReadonlyUint8Array): string => getBase64Decoder().decode(bytes);

/** An account as the JSON-RPC API encodes it (`encoding: "base64"`). */
const rpcAccount = (account: {
  readonly data: ReadonlyUint8Array;
  readonly executable: boolean;
  readonly lamports: bigint;
  readonly programAddress: Address;
}) => ({
  data: [b64(account.data), "base64"],
  executable: account.executable,
  lamports: Number(account.lamports),
  owner: account.programAddress,
  rentEpoch: 0,
  space: account.data.length,
});

/** A LiteSVM error as the JSON-RPC API spells it. */
function rpcError(err: unknown): unknown {
  const detail = err as { index?: number; err?: () => unknown };
  if (typeof detail.index === "number" && typeof detail.err === "function") {
    const inner = detail.err() as { code?: number } | number;

    return {
      InstructionError: [
        detail.index,
        typeof inner === "object" && inner !== null && "code" in inner
          ? { Custom: inner.code }
          : String(inner),
      ],
    };
  }

  return String(err);
}

interface Landed {
  readonly err: unknown;
  readonly logs: string[];
  readonly units: bigint;
  readonly returnData: Uint8Array;
  readonly transaction: Transaction;
  /** Per top-level instruction, the instructions it invoked, as the RPC's JSON encoding has them. */
  readonly inner: ReadonlyArray<
    ReadonlyArray<{ programIdIndex: number; accounts: number[]; data: string; stackHeight: number }>
  >;
}

/** The Kitchen instruction a transaction makes, by its Anchor discriminator. */
const KITCHEN_CALLS = {
  cook: [147, 233, 205, 239, 200, 21, 190, 159],
  cookFromAccount: [247, 166, 195, 248, 78, 176, 147, 84],
  writeCodeBuffer: [205, 152, 182, 5, 148, 70, 20, 25],
  closeCodeBuffer: [195, 203, 47, 242, 198, 177, 247, 6],
} as const;
type KitchenCall = keyof typeof KITCHEN_CALLS;

function kitchenCall(transaction: Transaction): KitchenCall | undefined {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (!("instructions" in message)) return undefined;
  for (const instruction of message.instructions) {
    if (message.staticAccounts[instruction.programAddressIndex] !== KITCHEN) continue;
    const head = [...(instruction.data ?? new Uint8Array()).subarray(0, 8)];
    const found = (Object.keys(KITCHEN_CALLS) as KitchenCall[]).find((name) =>
      KITCHEN_CALLS[name].every((byte, index) => head[index] === byte),
    );
    if (found !== undefined) return found;
  }

  return undefined;
}

/** What a test makes the cluster do instead of answering honestly. */
interface Faults {
  /** A simulation of this Kitchen call fails with this error, without running. */
  simulate?: { call: KitchenCall; err: unknown };
  /** A sent transaction making this Kitchen call fails with this error, without running. */
  send?: { call: KitchenCall; err: unknown };
  /** `getTransaction` answers null this many more times, as a lagging node does. */
  nullReads?: number;
  /** This method fails the way a broken transport does: with the URL in its message. */
  throwOn?: string;
}

function shim(harness: EngineHarness): {
  install: () => void;
  restore: () => void;
  sent: string[];
  faults: Faults;
  /** The transaction a signature `sent` names, as it was sent. */
  sentTransaction: (signature: string) => Transaction | undefined;
} {
  const original = globalThis.fetch;
  const landed = new Map<string, Landed>();
  const sent: string[] = [];
  const faults: Faults = {};
  const decode = (wire: string): Transaction =>
    getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(wire)));
  const answer = (id: unknown, result: unknown): Response =>
    Response.json({ id, jsonrpc: "2.0", result });
  const context = { apiVersion: "2.0.0", slot: 1000 };
  // A node refuses a transaction past the packet size, at simulation and at sending alike.
  const tooLarge = (id: unknown, wire: string): Response | undefined => {
    const size = getBase64Encoder().encode(wire).length;

    return size <= 1232
      ? undefined
      : Response.json({
          id,
          jsonrpc: "2.0",
          error: { code: -32602, message: `transaction too large: ${size} bytes (max: 1232)` },
        });
  };

  const stub = async (url: unknown, init: { body: string }): Promise<Response> => {
    const { id, method, params } = JSON.parse(init.body) as {
      id: unknown;
      method: string;
      params: unknown[];
    };
    if (faults.throwOn === method) {
      throw new Error(`request to ${String(url)} failed: connection reset`);
    }
    switch (method) {
      case "getLatestBlockhash":
        return answer(id, {
          context,
          value: { blockhash: harness.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000 },
        });
      case "getBalance":
        return answer(id, {
          context,
          value: Number(harness.svm.getBalance(address(params[0] as string)) ?? 0n),
        });
      case "getMinimumBalanceForRentExemption":
        return answer(
          id,
          Number(harness.svm.minimumBalanceForRentExemption(BigInt(params[0] as number))),
        );
      case "getAccountInfo": {
        const account = harness.svm.getAccount(address(params[0] as string));

        return answer(id, { context, value: account.exists ? rpcAccount(account) : null });
      }
      case "getTokenAccountBalance": {
        // An SPL token account's amount: a u64, little-endian, at byte 64.
        const account = harness.svm.getAccount(address(params[0] as string));
        if (!account.exists) {
          return Response.json({
            id,
            jsonrpc: "2.0",
            error: { code: -32602, message: "Invalid param: could not find account" },
          });
        }
        const data = new Uint8Array(account.data);
        const amount = new DataView(data.buffer, data.byteOffset).getBigUint64(64, true);

        return answer(id, {
          context,
          value: { amount: amount.toString(), decimals: 6, uiAmountString: "" },
        });
      }
      case "getMultipleAccounts":
        return answer(id, {
          context,
          value: (params[0] as string[]).map((key) => {
            const account = harness.svm.getAccount(address(key));

            return account.exists ? rpcAccount(account) : null;
          }),
        });
      case "simulateTransaction": {
        const refused = tooLarge(id, params[0] as string);
        if (refused !== undefined) return refused;
        const transaction = decode(params[0] as string);
        if (faults.simulate !== undefined && kitchenCall(transaction) === faults.simulate.call) {
          return answer(id, {
            context,
            value: { accounts: null, err: faults.simulate.err, logs: [], returnData: null },
          });
        }
        // As a node simulates by default: signatures unchecked.
        harness.svm.withSigverify(false);
        const result = harness.svm.simulateTransaction(transaction);
        harness.svm.withSigverify(true);
        const failed = result instanceof FailedTransactionMetadata;
        const meta = result.meta();
        const data = meta.returnData().data();
        // The accounts asked for, as the transaction leaves them; a failed one leaves none.
        const asked = (params[1] as { accounts?: { addresses: string[] } } | undefined)?.accounts;
        const post = failed ? [] : result.postAccounts();
        const accounts =
          asked === undefined || failed
            ? null
            : asked.addresses.map((key) => {
                // An account the transaction left with no lamports is closed: the RPC answers null.
                const after = post.find((account) => account.address === key);
                if (after !== undefined) return after.lamports > 0n ? rpcAccount(after) : null;
                const now = harness.svm.getAccount(address(key));

                return now.exists ? rpcAccount(now) : null;
              });

        return answer(id, {
          context,
          value: {
            accounts,
            err: failed ? rpcError(result.err()) : null,
            logs: meta.logs(),
            returnData:
              data.length === 0 ? null : { programId: KITCHEN, data: [b64(data), "base64"] },
            unitsConsumed: Number(meta.computeUnitsConsumed()),
          },
        });
      }
      case "sendTransaction": {
        const refused = tooLarge(id, params[0] as string);
        if (refused !== undefined) return refused;
        const transaction = decode(params[0] as string);
        // Every signature the message needs is there and verifies: the CLI signed what it sent.
        for (const [signer, signature] of Object.entries(transaction.signatures)) {
          const key = await getPublicKeyFromAddress(address(signer));
          if (
            signature === null ||
            !(await verifySignature(key, signature, transaction.messageBytes))
          ) {
            throw new Error(`sendTransaction: ${signer} did not sign the message`);
          }
        }
        const signature = getBase58Decoder().decode(Object.values(transaction.signatures)[0]!);
        if (faults.send !== undefined && kitchenCall(transaction) === faults.send.call) {
          // Landed, and failed, without running.
          landed.set(signature, {
            err: faults.send.err,
            logs: [],
            units: 0n,
            returnData: new Uint8Array(),
            transaction,
            inner: [],
          });
          sent.push(signature);

          return answer(id, signature);
        }
        const result = harness.svm.sendTransaction(transaction);
        harness.svm.expireBlockhash();
        const failed = result instanceof FailedTransactionMetadata;
        const meta = failed ? result.meta() : result;
        landed.set(signature, {
          err: failed ? rpcError(result.err()) : null,
          logs: meta.logs(),
          units: meta.computeUnitsConsumed(),
          returnData: meta.returnData().data(),
          transaction,
          inner: meta.innerInstructions().map((group) =>
            group.map((inner) => ({
              programIdIndex: inner.instruction().programIdIndex(),
              accounts: [...inner.instruction().accounts()],
              data: getBase58Decoder().decode(inner.instruction().data()),
              stackHeight: inner.stackHeight(),
            })),
          ),
        });
        sent.push(signature);

        return answer(id, signature);
      }
      case "getSignatureStatuses":
        return answer(id, {
          context,
          value: (params[0] as string[]).map((signature) => {
            const tx = landed.get(signature);

            return tx === undefined
              ? null
              : { slot: 1000, confirmations: null, err: tx.err, confirmationStatus: "confirmed" };
          }),
        });
      case "getTransaction": {
        if ((faults.nullReads ?? 0) > 0) {
          faults.nullReads! -= 1;

          return answer(id, null);
        }
        const tx = landed.get(params[0] as string);
        const encoding = (params[1] as { encoding?: string } | undefined)?.encoding;
        const message =
          tx === undefined
            ? undefined
            : getCompiledTransactionMessageDecoder().decode(tx.transaction.messageBytes);

        return answer(
          id,
          tx === undefined
            ? null
            : {
                slot: 1000,
                blockTime: null,
                version: 0,
                transaction:
                  encoding === "json"
                    ? {
                        signatures: [params[0]],
                        message: { accountKeys: message!.staticAccounts, instructions: [] },
                      }
                    : [
                        b64(new Uint8Array(getTransactionEncoder().encode(tx.transaction))),
                        "base64",
                      ],
                meta: {
                  err: tx.err,
                  fee: 5000,
                  logMessages: tx.logs,
                  computeUnitsConsumed: Number(tx.units),
                  returnData:
                    tx.returnData.length === 0
                      ? null
                      : { programId: KITCHEN, data: [b64(tx.returnData), "base64"] },
                  preBalances: [],
                  postBalances: [],
                  innerInstructions: tx.inner
                    .map((instructions, index) => ({ index, instructions }))
                    .filter((group) => group.instructions.length > 0),
                  loadedAddresses: { writable: [], readonly: [] },
                },
              },
        );
      }
    }
    throw new Error(`the CLI made an RPC call the shim does not answer: ${method}`);
  };

  return {
    install: () => {
      globalThis.fetch = stub as unknown as typeof fetch;
    },
    restore: () => {
      globalThis.fetch = original;
    },
    sent,
    faults,
    sentTransaction: (signature) => landed.get(signature)?.transaction,
  };
}

/** The program each top-level instruction of `transaction` calls, and the data it is given. */
function topLevel(transaction: Transaction): { program: Address; data: Uint8Array }[] {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (!("instructions" in message)) return [];

  return message.instructions.map((instruction) => ({
    program: message.staticAccounts[instruction.programAddressIndex]!,
    data: new Uint8Array(instruction.data ?? new Uint8Array()),
  }));
}

// ---------------------------------------------------------------------------------------------

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

const SWEEP = [
  "// @chain solana",
  "function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, authority: Account<Signer>, amount: Uint256) {",
  "  transfer(MINT, tokenProgram, source, dest, authority, amount);",
  "}",
  "",
].join("\n");

describeSvm("sauce on Solana: pot, simulate, run and tx through the released Kitchen", () => {
  let harness: EngineHarness;
  let rpc: ReturnType<typeof shim>;
  let work: string;
  let owner: { path: string; signer: KeyPairSigner };
  let sweep: string;
  const mint = randomAddress();
  const mintDefine = `MINT=${bytesToHex(new Uint8Array(getAddressCodec().encode(mint)))}`;

  beforeAll(async () => {
    harness = await startEngine(
      1_700_000_000n,
      ENGINE_SO as string,
      address(v12SvmEngineProgramId()),
    );
    // Priced: every cook pays it, from the owner, up to the cap the CLI reads.
    const { address: programData } = await deriveProgramDataPda(harness.kitchen);
    const priced = await sendInstructions(harness, [
      buildSetExecutionFeeInstruction({
        kitchen: harness.kitchen,
        authority: harness.payer.address,
        programData,
        feeConfig: harness.feeConfig,
        fee: FEE,
      }),
    ]);
    if (!priced.ok) throw new Error(`pricing the Kitchen failed: ${priced.err}`);
    setMint(harness, mint, 6);
    work = mkdtempSync(join(tmpdir(), "sauce-cli-solana-"));
    owner = await keypairFile(work, "owner");
    harness.svm.airdrop(owner.signer.address, lamports(10_000_000_000n));
    sweep = join(work, "sweep.sauce.ts");
    writeFileSync(sweep, SWEEP);
    rpc = shim(harness);
    rpc.install();
  }, 120_000);

  afterAll(() => {
    rpc?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const fault of Object.keys(rpc?.faults ?? {}) as (keyof Faults)[]) {
      delete rpc.faults[fault];
    }
  });

  /** A program whose bytecode carries a `bytes`-byte constant, and checks its length is `length`. */
  const blobProgram = (name: string, bytes: number, length = bytes): string => {
    const path = join(work, name);
    writeFileSync(
      path,
      [
        "// @chain solana",
        "function main() {",
        `  const blob = hex\`${"ab".repeat(bytes)}\`;`,
        `  require(blob.length == ${length});`,
        "}",
        "",
      ].join("\n"),
    );

    return path;
  };
  /** `sauce <argv>` on the owner's "vault" Pot, the flags going before any trailing `--args`. */
  const runVault = (...argv: string[]) => {
    const at = argv.includes("--args") ? argv.indexOf("--args") : argv.length;

    return sauce(
      ...argv.slice(0, at),
      ...["--salt", "vault", "--rpc-url", RPC_URL, "--keypair", owner.path],
      ...argv.slice(at),
    );
  };

  /** Token accounts for a sweep from `pot`: a source it owns, holding `held`, and a destination. */
  const accountsFor = (pot: Address, held: bigint) => {
    const source = setTokenAccount(harness, randomAddress(), mint, pot, held);
    const dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);

    return {
      source,
      dest,
      flags: [
        "--account",
        `tokenProgram=${TOKEN_PROGRAM}`,
        "--account",
        `source=${source}`,
        "--account",
        `dest=${dest}`,
        "--account",
        "authority=pot",
      ],
    };
  };
  const potOf = async (salt: Uint8Array) =>
    (await derivePotPda(KITCHEN, owner.signer.address, salt)).address;

  it("`sauce pot` derives the Pot the Kitchen does, and --deploy creates it once", async () => {
    const salt = hexToBytes(potSalt("vault"));
    const pot = await potOf(salt);
    const predicted = json(
      await sauce("pot", "--chain", "solana", "--owner", owner.signer.address, "--salt", "vault"),
    );
    expect(predicted).toMatchObject({
      chain: "solana",
      pot,
      owner: owner.signer.address,
      salt: potSalt("vault"),
      kitchen: KITCHEN,
      engine: v12SvmEngineProgramId(),
      instruction: { programAddress: KITCHEN },
    });
    expect(harness.svm.getAccount(pot).exists).toBe(false);
    // With an endpoint, it reads the cluster: the released programs, the fee, the Pot.
    const status = async () =>
      json(
        await sauce(
          ...["pot", "--chain", "solana", "--owner", owner.signer.address, "--salt", "vault"],
          ...["--rpc-url", RPC_URL],
        ),
      ).deployment;
    expect(await status()).toEqual({
      engine: { address: v12SvmEngineProgramId(), deployed: true },
      kitchen: { address: KITCHEN, deployed: true, executionFee: `${FEE}` },
      pot: { address: pot, deployed: false },
    });
    const deploy = ["pot", "--deploy", "--chain", "solana", "--rpc-url", RPC_URL];
    const created = await sauce(...deploy, "--keypair", owner.path, "--salt", "vault");
    expect(json(created)).toMatchObject({ pot, deployed: true, createPot: { status: "success" } });
    // Owned by the engine, as the Kitchen creates every Pot.
    expect(harness.svm.getAccount(pot)).toMatchObject({
      exists: true,
      programAddress: v12SvmEngineProgramId(),
    });
    const again = await sauce(...deploy, "--keypair", owner.path, "--salt", "vault");
    expect(again.stderr).toMatch(/is already created on solana/);
    expect(await status()).toMatchObject({ pot: { address: pot, deployed: true } });
    // The signer is the owner, who signs create_pot: --owner naming someone else is refused.
    const other = await sauce(...deploy, "--keypair", owner.path, "--owner", harness.payer.address);
    expect(other.code).toBe(2);
    expect(other.stderr).toMatch(/is not the signer, .*: on Solana the owner signs create_pot/);
  }, 60_000);

  it("names the Pot's own token account as pot:USDC, lists them, and says when one is missing", async () => {
    const salt = hexToBytes(potSalt("tokens"));
    const pot = await potOf(salt);
    const [usdc, usdt] = ["USDC", "USDT"].map((symbol) =>
      svmTokenRows(requireChain("solana")).find((row) => row.symbol === symbol)!,
    );
    const ataOf = async (mint: string) =>
      (
        await findAssociatedTokenPda({
          owner: pot,
          mint: address(mint),
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        })
      )[0];
    const potUsdc = await ataOf(usdc!.mint);
    const potUsdt = await ataOf(usdt!.mint);
    // The registered mints, on this cluster; the Pot holds USDC and has no USDT account.
    setMint(harness, address(usdc!.mint), 6);
    setMint(harness, address(usdt!.mint), 6);
    setTokenAccount(harness, potUsdc, address(usdc!.mint), pot, 1_500_000n);

    // `sauce pot` lists the Pot's account for each registered mint, with what it holds.
    const status = await sauce(
      ...["pot", "--chain", "solana", "--owner", owner.signer.address, "--salt", "tokens"],
      ...["--rpc-url", RPC_URL],
    );
    expect(json(status).tokenAccounts).toEqual(
      expect.arrayContaining([
        {
          symbol: "USDC",
          mint: usdc!.mint,
          decimals: 6,
          account: potUsdc,
          exists: true,
          balance: "1500000",
        },
        {
          symbol: "USDT",
          mint: usdt!.mint,
          decimals: 6,
          account: potUsdt,
          exists: false,
          balance: null,
        },
      ]),
    );
    expect(status.stderr).toContain(
      `The Pot's USDC account, --account NAME=pot:USDC: ${potUsdc}, holding 1.5 USDC`,
    );
    expect(status.stderr).toContain(
      `The Pot's USDT account, --account NAME=pot:USDT: ${potUsdt}, not created yet`,
    );

    // A program reads it through pot:USDC, and returns the balance, read as Uint256.
    const reads = join(work, "held.sauce.ts");
    writeFileSync(
      reads,
      "function main(held: Account): Uint256 {\n  return balanceOf(USDC, held);\n}\n",
    );
    const rehearse = (account: string) =>
      sauce(
        ...["simulate", reads, "--chain", "solana", "--owner", owner.signer.address],
        ...["--salt", "tokens", "--rpc-url", RPC_URL, "--account", `held=${account}`],
      );
    const held = await rehearse("pot:USDC");
    expect(held.stderr).not.toContain("does not exist");
    expect(held.code).toBe(0);
    expect(held.stdout).toContain("main returns Uint256: 1500000");
    // Its JSON says the same, with the raw return data beside it.
    const out = json(
      await sauce(
        ...["simulate", reads, "--chain", "solana", "--owner", owner.signer.address],
        ...["--salt", "tokens", "--rpc-url", RPC_URL, "--account", "held=pot:USDC", "--json"],
      ),
    );
    expect(out).toMatchObject({ ok: true, returnType: "Uint256", returned: "1500000" });
    expect(out.returns).toMatch(/^0x[0-9a-f]+$/);

    // pot:USDT has no account: the guard fails with no message, and the note says why.
    const missing = await rehearse("pot:USDT");
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain(
      `--account held: ${potUsdt} does not exist on solana (the Pot's USDT account: nothing has ` +
        "created it yet",
    );
    // A symbol the cluster does not register is refused by name.
    const unknown = await rehearse("pot:USDX");
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("USDX is not a mint solana registers (USDC, USDT, WSOL)");
    // Cooked directly, there is no Pot, so no Pot's token account either.
    const direct = await sauce(
      ...["simulate", reads, "--chain", "solana", "--owner", owner.signer.address],
      ...["--rpc-url", RPC_URL, "--via", "engine", "--account", "held=pot:USDC"],
    );
    expect(direct.code).toBe(2);
    expect(direct.stderr).toContain(
      "--account held=pot:USDC: --via engine cooks with no Pot, so there is no Pot's token account",
    );
  }, 60_000);

  it("`sauce simulate` reads a revert's message from the engine's return data in the logs", async () => {
    const keeps = join(work, "keeps.sauce.ts");
    writeFileSync(
      keeps,
      'function main(amount: Uint256) {\n  require(amount < 10n, "Pot would keep under the minimum");\n}\n',
    );
    const failed = await sauce(
      ...["simulate", keeps, "--chain", "solana", "--owner", owner.signer.address],
      ...["--salt", "vault", "--rpc-url", RPC_URL, "--json", "--args", "50"],
    );
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "Pot would keep under the minimum"',
    });
  }, 60_000);

  it("`sauce simulate` creates a missing Pot in the same transaction as the cook, sending nothing", async () => {
    const salt = hexToBytes(potSalt("rehearsed"));
    const pot = await potOf(salt);
    const { flags } = accountsFor(pot, 1_000n);
    const before = rpc.sent.length;
    const run = await sauce(
      ...["simulate", sweep, "--define", mintDefine, "--owner", owner.signer.address],
      ...["--salt", "rehearsed", "--rpc-url", RPC_URL, ...flags, "--args", "400"],
    );
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(
      new RegExp(`^The cook succeeds from ${owner.signer.address}: \\d+ compute units\n`),
    );
    expect(run.stdout).toContain(
      `  1. Kitchen create_pot: Pot ${pot} is not created on solana yet, so the transaction ` +
        "creates it first, the owner signing and paying its rent\n" +
        `  2. the cook, from the owner ${owner.signer.address}`,
    );
    expect(harness.svm.getAccount(pot).exists).toBe(false);
    expect(rpc.sent.length).toBe(before);

    // An owner with no lamports cannot pay the rent, and no override can give it any: it is told.
    const broke = randomAddress();
    const poor = await sauce(
      ...["simulate", sweep, "--define", mintDefine, "--owner", broke, "--rpc-url", RPC_URL],
      ...accountsFor(await (await derivePotPda(KITCHEN, broke, new Uint8Array(32))).address, 1n)
        .flags,
      ...["--json", "--args", "1"],
    );
    expect(poor.code).toBe(1);
    expect(JSON.parse(poor.stdout)).toMatchObject({ ok: false, createPot: { owner: broke } });
    expect(poor.stderr).toMatch(
      new RegExp(`^${broke} holds 0 lamports, and the cook takes \\d+: \\d+ in rent for the Pot`),
    );
    expect(poor.stderr).toContain("Solana's simulateTransaction takes no balance overrides");
  }, 60_000);

  it("takes a public key for an Address argument, in base58, as the 32-byte word the engine reads", async () => {
    const key = randomAddress();
    const hex = bytesToHex(new Uint8Array(getAddressCodec().encode(key)));
    const checks = join(work, "checks-key.sauce.ts");
    writeFileSync(
      checks,
      `function main(key: Address, keys: Address[]) {\n  require(key == ${hex}n, "not the key");\n  require(keys[1] == ${hex}n, "not the key at 1");\n}\n`,
    );
    const base = ["simulate", checks, "--chain", "solana", "--owner", owner.signer.address];
    const flags = ["--salt", "vault", "--rpc-url", RPC_URL];
    const ok = await sauce(
      ...base,
      ...flags,
      "--args",
      key,
      JSON.stringify([owner.signer.address, key]),
    );
    expect(ok.stderr).toBe("");
    expect(ok.code).toBe(0);
    // 32 bytes of hex is the same key.
    const asHex = await sauce(...base, ...flags, "--args-json", JSON.stringify([hex, [hex, hex]]));
    expect(asHex.code).toBe(0);
    const other = await sauce(
      ...base,
      ...flags,
      "--args",
      owner.signer.address,
      `["${key}","${key}"]`,
    );
    expect(other.stdout).toMatch(/^The cook fails: the program threw "not the key"/);
    const evm = await sauce(
      ...base,
      ...flags,
      "--args",
      "0x6666666666666666666666666666666666666666",
      "[]",
    );
    expect(evm.code).toBe(2);
    expect(evm.stderr).toContain(
      `--args: key: "0x6666666666666666666666666666666666666666" is not a Solana public key (base58, or 32 bytes of hex)`,
    );
  }, 60_000);

  it("`sauce simulate` rehearses the cook with no key; a failure prints the program logs", async () => {
    const pot = await potOf(hexToBytes(potSalt("vault")));
    const { flags } = accountsFor(pot, 1_000n);
    const base = ["simulate", sweep, "--define", mintDefine, "--owner", owner.signer.address];
    const ok = json(
      await sauce(
        ...base,
        "--salt",
        "vault",
        "--rpc-url",
        RPC_URL,
        ...flags,
        "--json",
        "--args",
        "400",
      ),
    );
    expect(ok).toMatchObject({ ok: true, chain: "solana", pot, fee: FEE.toString() });
    expect(Number(ok.computeUnits)).toBeGreaterThan(0);
    // More than the source holds: SPL refuses, and the logs say so.
    const failed = await sauce(
      ...base,
      "--salt",
      "vault",
      "--rpc-url",
      RPC_URL,
      ...flags,
      "--args",
      "5000",
    );
    expect(failed.code).toBe(1);
    expect(failed.stdout).toMatch(
      /^The cook fails: program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed with custom program error 1 \(0x1\)/,
    );
    expect(failed.stdout).toMatch(/Program logs:\n {2}Program /);
    expect(failed.stdout).toMatch(/insufficient funds/i);
    // Nothing was sent by either.
    expect(rpc.sent.length).toBe(1);
    // A slot the program takes, left out, is named with the role it needs.
    const missing = await sauce(...base, "--salt", "vault", "--rpc-url", RPC_URL, "--args", "1");
    expect(missing.stderr).toMatch(
      /missing --account for tokenProgram \(readonly\), source \(writable\)/,
    );
  }, 60_000);

  it("`sauce simulate` shows what the cook moved, from the accounts as it leaves them", async () => {
    const pot = await potOf(hexToBytes(potSalt("vault")));
    const { source, dest, flags } = accountsFor(pot, 1_000n);
    const base = ["simulate", sweep, "--define", mintDefine, "--owner", owner.signer.address];
    const flagged = [...base, "--salt", "vault", "--rpc-url", RPC_URL, ...flags];
    const sentBefore = rpc.sent.length;
    const out = json(await sauce(...flagged, "--json", "--args", "400"));
    // In the transaction's account order, which follows the addresses: compared as a set.
    expect(out.tokenChanges).toHaveLength(2);
    expect(out.tokenChanges).toEqual(
      expect.arrayContaining([
        {
          account: source,
          label: "source",
          mint,
          owner: pot,
          before: "1000",
          after: "600",
          delta: "-400",
          decimals: 6,
          formatted: "-0.0004",
        },
        {
          account: dest,
          label: "dest",
          mint,
          owner: expect.any(String),
          before: "0",
          after: "400",
          delta: "400",
          decimals: 6,
          formatted: "0.0004",
        },
      ]),
    );
    // The owner pays the Kitchen's fee and the transaction's: its lamports fall by at least both.
    const lamportChanges = out.lamportChanges as Array<{ account: string; delta: string }>;
    const paid = lamportChanges.find((change) => change.account === owner.signer.address);
    expect(paid).toMatchObject({ label: "the owner" });
    expect(-BigInt(paid!.delta)).toBeGreaterThanOrEqual(FEE);
    expect(lamportChanges).toContainEqual(
      expect.objectContaining({ label: "the Kitchen's fee config", delta: FEE.toString() }),
    );
    // Read back, not applied: the accounts hold what they held.
    expect(tokenAmount(harness, source)).toBe(1_000n);
    expect(tokenAmount(harness, dest)).toBe(0n);
    expect(rpc.sent.length).toBe(sentBefore);

    const text = await sauce(...flagged, "--args", "400");
    expect(text.stdout).toContain("Token balance changes:\n");
    expect(text.stdout).toContain(
      `\n  ${source} (source), owned by ${pot} (the Pot): -0.0004 of mint ${mint}\n`,
    );
    expect(text.stdout).toMatch(
      new RegExp(`\\n {2}${dest} \\(dest\\), owned by \\w+: \\+0\\.0004 of mint ${mint}\\n`),
    );
    expect(text.stdout).toMatch(
      new RegExp(
        `Lamport changes:\\n(?: {2}.*\\n)*? {2}${owner.signer.address} \\(the owner\\): -\\d+ lamports, the transaction's fee included`,
      ),
    );
  }, 60_000);

  it("`sauce run` signs with the keypair, pays the fee, and moves the tokens", async () => {
    const pot = await potOf(hexToBytes(potSalt("vault")));
    const { source, dest, flags } = accountsFor(pot, 1_000n);
    const before = harness.svm.getBalance(owner.signer.address) ?? 0n;
    const run = await sauce(
      "run",
      sweep,
      "--define",
      mintDefine,
      "--salt",
      "vault",
      "--rpc-url",
      RPC_URL,
      "--keypair",
      owner.path,
      ...flags,
      "--json",
      "--args",
      "400",
    );
    expect(json(run)).toMatchObject({
      chain: "solana",
      owner: owner.signer.address,
      pot,
      fee: FEE.toString(),
      cook: { status: "success" },
    });
    expect(tokenAmount(harness, source)).toBe(600n);
    expect(tokenAmount(harness, dest)).toBe(400n);
    // The Kitchen's fee, and the transaction's own, from the owner.
    expect(before - (harness.svm.getBalance(owner.signer.address) ?? 0n)).toBeGreaterThanOrEqual(
      FEE,
    );
    // The key never reaches the output.
    const secret = (JSON.parse(readFileSync(owner.path, "utf8")) as number[]).slice(0, 8).join(",");
    expect(run.stdout + run.stderr).not.toContain(secret);
  }, 60_000);

  it("asks before creating a missing Pot; --auto-approve creates it, then cooks", async () => {
    const salt = hexToBytes(potSalt("fresh"));
    const pot = await potOf(salt);
    const { dest, flags } = accountsFor(pot, 50n);
    const argv = [
      "run",
      sweep,
      "--define",
      mintDefine,
      "--salt",
      "fresh",
      "--rpc-url",
      RPC_URL,
      "--keypair",
      owner.path,
      ...flags,
      "--args",
      "50",
    ];
    const noTerminal = await sauce(...argv);
    // No terminal: the approval it needs is named before anything is sent.
    expect(noTerminal.code).toBe(1);
    expect(noTerminal.stderr).toContain(
      "nothing was sent: this run needs an approval, and there is no terminal to ask on:\n" +
        `  create Pot ${pot}\nPass --auto-approve`,
    );
    let asked = "";
    const declined = await sauceWith(
      { confirm: async (question) => ((asked = question), false), canAsk: () => true },
      ...argv,
    );
    expect(asked).toBe(
      `Pot ${pot} (owner ${owner.signer.address}, salt ${potSalt("fresh")}) is not deployed on ` +
        "solana. Deploy it now? [y/N] ",
    );
    expect(declined.stderr).toMatch(/so nothing was sent/);
    expect(harness.svm.getAccount(pot).exists).toBe(false);
    const yes = await sauce(...argv.slice(0, -2), "--auto-approve", "--args", "50");
    expect(yes.code).toBe(0);
    expect(yes.stderr).toContain(`auto-approved: create Pot ${pot}`);
    expect(yes.stdout).toMatch(new RegExp(`^created Pot ${pot} in \\w+: success`, "m"));
    expect(yes.stdout).toMatch(/^cook \w+: success/m);
    expect(tokenAmount(harness, dest)).toBe(50n);
  }, 60_000);

  it("stages a program too large for one transaction, cooks it, and closes the buffer", async () => {
    const big = join(work, "big.sauce.ts");
    writeFileSync(
      big,
      [
        "// @chain solana",
        "function main() {",
        `  const blob = hex\`${"ab".repeat(1500)}\`;`,
        "  require(blob.length == 1500);",
        "}",
        "",
      ].join("\n"),
    );
    const out = json(
      await sauce(
        "run",
        big,
        "--salt",
        "vault",
        "--rpc-url",
        RPC_URL,
        "--keypair",
        owner.path,
        "--json",
      ),
    );
    expect(out).toMatchObject({
      cook: { status: "success" },
      closeCodeBuffer: { status: "success" },
      staged: { codeBuffer: expect.any(String), transactions: expect.any(Array) },
    });
    const { codeBuffer } = out.staged as { codeBuffer: Address };
    expect(harness.svm.getAccount(codeBuffer).exists).toBe(false);
    // Too large for a single unsigned transaction or a simulation: both say by how much, and that
    // `sauce run` stages it. A simulation says so before it looks for the Pot.
    const program = compileSauceProgram("solana", readFileSync(big, "utf8"), {}).bytecode.length;
    for (const command of ["tx", "simulate"]) {
      const refused = await sauce(
        ...[command, big, "--owner", owner.signer.address, "--salt", "absent"],
        ...["--rpc-url", RPC_URL],
      );
      expect(refused.code).toBe(1);
      expect(refused.stderr).toMatch(
        new RegExp(
          `the payload \\(the program, with no arguments\\) is ${program} bytes, so its cook is ` +
            "a (\\d+)-byte transaction, (\\d+) past Solana's 1232\\. .* Shrink the payload by at " +
            "least \\2 bytes to fit, or let `sauce run` stage it",
        ),
      );
    }
  }, 120_000);

  it("`sauce tx` prints the cook unsigned; signed by the owner as printed, it lands", async () => {
    const pot = await potOf(hexToBytes(potSalt("vault")));
    const { dest, flags } = accountsFor(pot, 70n);
    const out = await sauce(
      "tx",
      sweep,
      "--define",
      mintDefine,
      "--owner",
      owner.signer.address,
      "--salt",
      "vault",
      "--rpc-url",
      RPC_URL,
      ...flags,
      "--args",
      "70",
    );
    const printed = json(out);
    expect(printed).toMatchObject({ chain: "solana", feePayer: owner.signer.address, pot });
    expect(out.stderr).toMatch(/signed by no one/);
    const unsigned = getTransactionDecoder().decode(
      new Uint8Array(getBase64Encoder().encode(printed.transaction as string)),
    );
    const message = getCompiledTransactionMessageDecoder().decode(unsigned.messageBytes);
    expect(message.staticAccounts[0]).toBe(owner.signer.address);
    expect(
      Object.values(unsigned.signatures).every((s) => s === null || s.every((b) => b === 0)),
    ).toBe(true);
    // A wallet signs it; nothing else changes.
    const signed = await signTransaction([owner.signer.keyPair], unsigned);
    const result = harness.svm.sendTransaction(signed);
    harness.svm.expireBlockhash();
    expect(result instanceof FailedTransactionMetadata ? result.meta().logs() : "ok").toBe("ok");
    expect(tokenAmount(harness, dest)).toBe(70n);
    expect(getBase64EncodedWireTransaction(signed)).not.toBe(printed.transaction);
    expect(getTransactionEncoder().encode(signed).length).toBeLessThanOrEqual(1232);
  }, 60_000);

  it("`sauce verify` checks a settle cook's engine invocation against the recompiled settle", async () => {
    // The SDK's own SVM settle for one escrow, run through `sauce run` like any other program.
    const settle = join(work, "settle.sauce.ts");
    writeFileSync(settle, `// @chain solana\n${svmSettleSource(1)}`);
    const escrow = setTokenAccount(harness, randomAddress(), mint, owner.signer.address, 800n);
    const dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
    const run = json(
      await sauce(
        "run",
        settle,
        "--define",
        "SETTLE_MIN_OUT=500",
        "--define",
        "SETTLE_SPL_COUNT=1",
        "--salt",
        "vault",
        "--rpc-url",
        RPC_URL,
        "--keypair",
        owner.path,
        "--account",
        `tokenProgram0=${TOKEN_PROGRAM}`,
        "--account",
        `tokenProgram1=${TOKEN_PROGRAM}`,
        "--account",
        `escrow0=${escrow}`,
        "--account",
        `mint0=${mint}`,
        "--account",
        `dest0=${dest}`,
        "--account",
        "owner=owner",
        "--json",
      ),
    );
    expect(tokenAmount(harness, dest)).toBe(800n);
    const { signature } = run.cook as { signature: string };
    const verify = ["verify", signature, "--chain", "solana", "--rpc-url", RPC_URL];
    expect(
      json(await sauce(...verify, "--min-out", "500", "--spl-count", "1", "--json")),
    ).toMatchObject({
      valid: true,
      escrowCount: 1,
      minOut: "500",
      accounts: { escrow0: escrow, dest0: dest, owner: owner.signer.address },
      owner: owner.signer.address,
      verifiedBy: "inline-bytecode",
    });
    // A floor the program does not enforce: not the settle that was asked about.
    const floor = await sauce(...verify, "--min-out", "1", "--spl-count", "1");
    expect(floor.code).toBe(1);
    expect(floor.stdout).toMatch(
      /^rejected \(NOT_GENUINE\): inline execute bytecode does not byte-match/,
    );
    // A cook that is not a settle at all.
    const other = await sauce(
      ...verify.slice(0, 1),
      rpc.sent[1]!,
      ...verify.slice(2),
      "--min-out",
      "0",
      "--spl-count",
      "1",
    );
    expect(other.code).toBe(1);
    expect(other.stdout).toMatch(/^rejected \((?:NO_SETTLE|NOT_GENUINE)\)/);
  }, 120_000);

  it("reports a cook that failed on chain as failed, while the node lags; verify refuses it", async () => {
    const pot = await potOf(hexToBytes(potSalt("vault")));
    const { flags } = accountsFor(pot, 1_000n);
    // The rehearsal passes; the transaction then fails where it lands, and the node is slow to
    // serve it.
    rpc.faults.send = { call: "cook", err: { InstructionError: [2, { Custom: 1 }] } };
    rpc.faults.nullReads = 3;
    const run = await runVault("run", sweep, "--define", mintDefine, ...flags, "--args", "1");
    expect(run.code).toBe(1);
    const failed = /^cook (\w+): failed, /m.exec(run.stdout);
    expect(failed).not.toBeNull();
    const verify = await sauce(
      ...["verify", failed![1]!, "--chain", "solana", "--rpc-url", RPC_URL],
      ...["--min-out", "0", "--spl-count", "1", "--json"],
    );
    expect(verify.code).toBe(1);
    expect(JSON.parse(verify.stdout)).toMatchObject({ valid: false, code: "TX_FAILED" });
  }, 60_000);

  it("prints the cook it sent even when closing the code buffer afterwards fails", async () => {
    rpc.faults.simulate = {
      call: "closeCodeBuffer",
      err: { InstructionError: [1, { Custom: 6001 }] },
    };
    const run = await runVault("run", blobProgram("close.sauce.ts", 1500), "--json");
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as { cook: { status: string }; warning: string };
    expect(out.cook.status).toBe("success");
    const open = /^warning: the code buffer (\w+) is still open/m.exec(run.stderr);
    expect(open).not.toBeNull();
    expect(out.warning).toContain(open![1]!);
    // It is still there, so the warning is true.
    expect(harness.svm.getAccount(address(open![1]!)).exists).toBe(true);
  }, 120_000);

  it("reports a staging failure as one, and closes the code buffer again", async () => {
    rpc.faults.simulate = {
      call: "writeCodeBuffer",
      err: { InstructionError: [1, { Custom: 6004 }] },
    };
    const run = await runVault("run", blobProgram("stage.sauce.ts", 1500));
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(
      /staging the program failed: writing bytes 0… of the program would fail/,
    );
    const closed = /The code buffer (\w+) was closed again\./.exec(run.stderr);
    expect(closed).not.toBeNull();
    expect(harness.svm.getAccount(address(closed![1]!)).exists).toBe(false);
  }, 120_000);

  it("closes the code buffer of a staged cook whose rehearsal fails", async () => {
    const run = await runVault("run", blobProgram("wrong.sauce.ts", 1500, 1));
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/the cook would fail, so it was not sent/);
    const closed = /The code buffer (\w+) was closed again\./.exec(run.stderr);
    expect(closed).not.toBeNull();
    expect(harness.svm.getAccount(address(closed![1]!)).exists).toBe(false);
  }, 120_000);

  it("measures a cook with the compute-limit instruction it is sent with", async () => {
    // A program whose cook fits only WITHOUT that instruction: sent as one transaction, it would be
    // refused for its size, so `run` has to stage it.
    const client = await createSauceSvmClient({
      rpcUrl: RPC_URL,
      programId: address(v12SvmEngineProgramId()),
      kitchen: KITCHEN,
      payer: owner.signer,
      potSalt: hexToBytes(potSalt("vault")),
      maxExecutionFee: FEE,
    });
    const sizes = async (bytes: number): Promise<[number, number]> => {
      const { bytecode } = compileSauceProgram(
        "solana",
        `function main() {\n  const blob = hex\`${"ab".repeat(bytes)}\`;\n  require(blob.length == ${bytes});\n}\n`,
      );
      const bare = await client.cookTransaction(bytecode, { accounts: [] }, {}, {});
      const limited = await client.cookTransaction(
        bytecode,
        { accounts: [] },
        {},
        {
          computeUnitLimit: 1_400_000,
        },
      );

      return [getTransactionSize(bare), getTransactionSize(limited)];
    };
    let bytes = 600;
    for (; ; bytes++) {
      const [bare, limited] = await sizes(bytes);
      if (limited > 1232) {
        expect(bare).toBeLessThanOrEqual(1232);
        break;
      }
    }
    // `sauce compile --json` measures that same transaction offline, on either side of the limit.
    for (const length of [bytes - 1, bytes]) {
      const [, limited] = await sizes(length);
      const compiled = json(
        await sauce("compile", blobProgram(`window-${length}.sauce.ts`, length), "--json"),
      );
      expect(compiled.cook).toMatchObject({ size: limited, limit: 1232, fits: limited <= 1232 });
    }
    const out = json(await runVault("run", blobProgram("window.sauce.ts", bytes), "--json"));
    expect(out).toMatchObject({ cook: { status: "success" }, staged: expect.any(Object) });
  }, 120_000);

  it("never prints the RPC URL, even in an error the Solana client raises", async () => {
    const keyed = `${RPC_URL}?api-key=SECRETKEY123`;
    rpc.faults.throwOn = "getLatestBlockhash";
    const pot = await potOf(hexToBytes(potSalt("vault")));
    const { flags } = accountsFor(pot, 10n);
    const run = await sauce(
      ...["simulate", sweep, "--define", mintDefine, "--owner", owner.signer.address],
      ...["--salt", "vault", "--rpc-url", keyed, ...flags, "--args", "1"],
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/connection reset/);
    expect(run.stdout + run.stderr).not.toContain("SECRETKEY123");
  }, 60_000);

  it("refuses EVM keys, --pot and --value on Solana, and a publish from it", async () => {
    const base = ["run", sweep, "--define", mintDefine, "--rpc-url", RPC_URL];
    expect((await sauce(...base, "--private-key", `0x${"11".repeat(32)}`)).stderr).toMatch(
      /--keystore and --private-key are EVM keys: on Solana, sign with --wallet <name> \(a Solana wallet\) or --keypair/,
    );
    expect(
      (await sauce("simulate", sweep, "--pot", owner.signer.address, "--rpc-url", RPC_URL)).stderr,
    ).toMatch(/names its Pot by owner and salt/);
    expect(
      (
        await sauce(
          "simulate",
          sweep,
          "--owner",
          owner.signer.address,
          "--value",
          "1",
          "--rpc-url",
          RPC_URL,
        )
      ).stderr,
    ).toMatch(/--value is for EVM/);
    expect((await sauce("intent", "publish", sweep)).stderr).toMatch(
      /Publishing from Solana is not supported/,
    );
    const bad = join(work, "bad.json");
    writeFileSync(bad, "[1, 2, 3]");
    const keypair = await sauce(...base, "--keypair", bad);
    expect(keypair.stderr).toMatch(/not a Solana keypair file/);
    expect(keypair.stderr).not.toContain("[1, 2, 3]");
  }, 60_000);

  describe("--via engine: the engine's own paid cook, with no Kitchen and no Pot", () => {
    const ENGINE = address(v12SvmEngineProgramId());
    /** A sweep from a token account the OWNER holds, the owner signing as its authority. */
    const ownersAccounts = (held: bigint) => {
      const source = setTokenAccount(harness, randomAddress(), mint, owner.signer.address, held);
      const dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);

      return {
        source,
        dest,
        flags: [
          ...["--account", `tokenProgram=${TOKEN_PROGRAM}`, "--account", `source=${source}`],
          ...["--account", `dest=${dest}`, "--account", "authority=owner"],
        ],
      };
    };
    const startsWith = (data: Uint8Array, prefix: Uint8Array): boolean =>
      prefix.every((byte, index) => data[index] === byte);

    it("`simulate` rehearses it from the owner, showing the fee and what it moved, and sends nothing", async () => {
      const { source, dest, flags } = ownersAccounts(1_000n);
      const before = rpc.sent.length;
      const argv = [
        ...["simulate", sweep, "--define", mintDefine, "--owner", owner.signer.address],
        ...["--via", "engine", "--rpc-url", RPC_URL, ...flags],
      ];
      const rehearsed = json(await sauce(...argv, "--json", "--args", "400"));
      expect(rehearsed).toMatchObject({
        ok: true,
        chain: "solana",
        via: "engine",
        owner: owner.signer.address,
        fee: FEE.toString(),
        maxExecutionFee: FEE.toString(),
      });
      expect(rehearsed).not.toHaveProperty("pot");
      expect(rehearsed).not.toHaveProperty("createPot");
      // What it moved: the signer's tokens, and the fee into the Kitchen's treasury, as the
      // engine pays it there itself.
      const { tokenChanges, lamportChanges } = rehearsed as {
        tokenChanges: { account: string; delta: string }[];
        lamportChanges: { account: string; label?: string; delta: string }[];
      };
      expect(tokenChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: source, delta: "-400" }),
          expect.objectContaining({ account: dest, delta: "400" }),
        ]),
      );
      expect(lamportChanges).toContainEqual(
        expect.objectContaining({
          account: harness.feeConfig,
          label: "the Kitchen's fee config",
          delta: FEE.toString(),
        }),
      );
      const text = await sauce(...argv, "--args", "400");
      expect(text.stdout).toContain(
        `the engine's direct cook (cookAndPay), from ${owner.signer.address}, which signs for ` +
          `the program and pays the execution fee of ${FEE} lamports: no Kitchen and no Pot`,
      );
      expect(rpc.sent.length).toBe(before);
    }, 60_000);

    it("`run` signs as the program's authority, pays the fee into the Kitchen's treasury, and creates no Pot", async () => {
      const { source, dest, flags } = ownersAccounts(1_000n);
      const pot = await potOf(hexToBytes(potSalt("direct")));
      const feeConfig = harness.feeConfig;
      const treasury = harness.svm.getBalance(feeConfig) ?? 0n;
      const run = await sauce(
        ...["run", sweep, "--define", mintDefine, "--salt", "direct", "--via", "engine"],
        ...["--max-execution-fee", FEE.toString(), "--rpc-url", RPC_URL, "--keypair", owner.path],
        ...flags,
        ...["--json", "--args", "400"],
      );
      const out = json(run);
      expect(out).toMatchObject({
        chain: "solana",
        via: "engine",
        owner: owner.signer.address,
        fee: FEE.toString(),
        cook: { status: "success" },
      });
      expect(out).not.toHaveProperty("pot");
      expect(out).not.toHaveProperty("createPot");
      expect(tokenAmount(harness, source)).toBe(600n);
      expect(tokenAmount(harness, dest)).toBe(400n);
      expect((harness.svm.getBalance(feeConfig) ?? 0n) - treasury).toBe(FEE);
      expect(harness.svm.getAccount(pot).exists).toBe(false);
      // What it sent calls the engine itself: no Kitchen instruction, a cookAndPay.
      const sent = rpc.sentTransaction((out.cook as { signature: string }).signature)!;
      const calls = topLevel(sent);
      expect(calls.some((call) => call.program === KITCHEN)).toBe(false);
      const cook = calls.find((call) => call.program === ENGINE)!;
      expect(startsWith(cook.data, COOK_AND_PAY_DISCRIMINATOR)).toBe(true);
    }, 60_000);

    it("refuses the Pot as a signer it cannot be, before reading the cluster", async () => {
      const pot = await potOf(new Uint8Array(32));
      const { flags } = accountsFor(pot, 1n);
      const refused = await sauce(
        ...["simulate", sweep, "--define", mintDefine, "--owner", owner.signer.address],
        ...["--via", "engine", "--rpc-url", RPC_URL, ...flags, "--args", "1"],
      );
      expect(refused.code).toBe(2);
      expect(refused.stderr).toMatch(
        /--account authority=pot: authority must sign \(readonly_signer\), and cooked directly to the engine \(--via engine\) nothing signs for the Pot/,
      );
      const bogus = await sauce(
        ...["simulate", sweep, "--owner", owner.signer.address, "--via", "pot"],
        ...["--rpc-url", RPC_URL],
      );
      expect(bogus.code).toBe(2);
      expect(bogus.stderr).toMatch(/--via: 'pot' is not kitchen .* or engine/);
    }, 60_000);

    it.each(["kitchen", "engine"])(
      "--via %s refuses a fee above --max-execution-fee, sending nothing",
      async (via) => {
        const { flags } = ownersAccounts(10n);
        const before = rpc.sent.length;
        const run = await sauce(
          ...["run", sweep, "--define", mintDefine, "--via", via, "--rpc-url", RPC_URL],
          ...["--keypair", owner.path, "--max-execution-fee", (FEE - 1n).toString(), ...flags],
          ...["--args", "1"],
        );
        expect(run.code).toBe(1);
        expect(run.stderr).toContain(
          `the execution fee is ${FEE} lamports, above --max-execution-fee ${FEE - 1n}: ` +
            "nothing was signed or sent",
        );
        expect(rpc.sent.length).toBe(before);
      },
      60_000,
    );

    it("`tx` prints the direct cook unsigned; signed by the owner, it lands", async () => {
      const { dest, flags } = ownersAccounts(90n);
      const out = await sauce(
        ...[
          "tx",
          sweep,
          "--define",
          mintDefine,
          "--owner",
          owner.signer.address,
          "--via",
          "engine",
        ],
        ...["--rpc-url", RPC_URL, ...flags, "--args", "90"],
      );
      const printed = json(out);
      expect(printed).toMatchObject({
        chain: "solana",
        via: "engine",
        feePayer: owner.signer.address,
        fee: FEE.toString(),
        maxExecutionFee: FEE.toString(),
      });
      expect(printed).not.toHaveProperty("pot");
      expect(out.stderr).toMatch(/no Kitchen and no Pot/);
      const unsigned = getTransactionDecoder().decode(
        new Uint8Array(getBase64Encoder().encode(printed.transaction as string)),
      );
      const signed = await signTransaction([owner.signer.keyPair], unsigned);
      const result = harness.svm.sendTransaction(signed);
      harness.svm.expireBlockhash();
      expect(result instanceof FailedTransactionMetadata ? result.meta().logs() : "ok").toBe("ok");
      expect(tokenAmount(harness, dest)).toBe(90n);
    }, 60_000);

    it("stages a program too large for one transaction and runs it pinned to the staged bytes", async () => {
      const big = blobProgram("direct-big.sauce.ts", 1500);
      const out = json(
        await sauce(
          ...["run", big, "--via", "engine", "--rpc-url", RPC_URL, "--keypair", owner.path],
          "--json",
        ),
      );
      expect(out).toMatchObject({
        via: "engine",
        cook: { status: "success" },
        closeCodeBuffer: { status: "success" },
        staged: { codeBuffer: expect.any(String), sha256: expect.any(String) },
      });
      const cook = topLevel(
        rpc.sentTransaction((out.cook as { signature: string }).signature)!,
      ).find((call) => call.program === ENGINE)!;
      expect(startsWith(cook.data, COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR)).toBe(true);
      // The pin is the staged bytes' digest, after the discriminator and the fee cap.
      expect(bytesToHex(cook.data.subarray(16, 48))).toBe(
        (out.staged as { sha256: string }).sha256,
      );
    }, 120_000);

    it("`compile --via engine` sizes the direct cook, which carries no Kitchen, Pot or salt", async () => {
      const program = blobProgram("direct-size.sauce.ts", 400);
      const kitchen = json(await sauce("compile", program, "--json")).cook as { size: number };
      const direct = json(await sauce("compile", program, "--via", "engine", "--json")).cook as {
        size: number;
        via: string;
      };
      expect(direct.via).toBe("engine");
      expect(direct.size).toBeLessThan(kitchen.size);
    }, 60_000);
  });
});
