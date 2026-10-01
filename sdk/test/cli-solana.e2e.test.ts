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
  type Transaction,
} from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";
import { bytesToHex, hexToBytes } from "viem";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { potSalt } from "../src/deployments/pot.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import {
  buildSetExecutionFeeInstruction,
  deriveProgramDataPda,
  derivePotPda,
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

const b64 = (bytes: Uint8Array): string => getBase64Decoder().decode(bytes);

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

function shim(harness: EngineHarness): {
  install: () => void;
  restore: () => void;
  sent: string[];
} {
  const original = globalThis.fetch;
  const landed = new Map<string, Landed>();
  const sent: string[] = [];
  const decode = (wire: string): Transaction =>
    getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(wire)));
  const answer = (id: unknown, result: unknown): Response =>
    Response.json({ id, jsonrpc: "2.0", result });
  const context = { apiVersion: "2.0.0", slot: 1000 };

  const stub = async (_url: unknown, init: { body: string }): Promise<Response> => {
    const { id, method, params } = JSON.parse(init.body) as {
      id: unknown;
      method: string;
      params: unknown[];
    };
    switch (method) {
      case "getLatestBlockhash":
        return answer(id, {
          context,
          value: { blockhash: harness.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000 },
        });
      case "getAccountInfo": {
        const account = harness.svm.getAccount(address(params[0] as string));

        return answer(id, {
          context,
          value: account.exists
            ? {
                data: [b64(account.data), "base64"],
                executable: account.executable,
                lamports: Number(account.lamports),
                owner: account.programAddress,
                rentEpoch: 0,
                space: account.data.length,
              }
            : null,
        });
      }
      case "simulateTransaction": {
        // As a node simulates by default: signatures unchecked.
        harness.svm.withSigverify(false);
        const result = harness.svm.simulateTransaction(decode(params[0] as string));
        harness.svm.withSigverify(true);
        const failed = result instanceof FailedTransactionMetadata;
        const meta = result.meta();
        const data = meta.returnData().data();

        return answer(id, {
          context,
          value: {
            accounts: null,
            err: failed ? rpcError(result.err()) : null,
            logs: meta.logs(),
            returnData:
              data.length === 0 ? null : { programId: KITCHEN, data: [b64(data), "base64"] },
            unitsConsumed: Number(meta.computeUnitsConsumed()),
          },
        });
      }
      case "sendTransaction": {
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
        const result = harness.svm.sendTransaction(transaction);
        harness.svm.expireBlockhash();
        const failed = result instanceof FailedTransactionMetadata;
        const meta = failed ? result.meta() : result;
        const signature = getBase58Decoder().decode(Object.values(transaction.signatures)[0]!);
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
  };
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
    // The signer is the owner: --owner naming someone else is refused.
    const other = await sauce(...deploy, "--keypair", owner.path, "--owner", harness.payer.address);
    expect(other.code).toBe(2);
    expect(other.stderr).toMatch(/is not the signer/);
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
      /^The cook fails: instruction \d failed with custom program error 1 \(0x1\)/,
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

  it("asks before creating a missing Pot; --yes creates it, then cooks", async () => {
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
    expect(noTerminal.code).toBe(1);
    expect(noTerminal.stderr).toMatch(
      /is not deployed on solana\. Create it first .*or pass --yes/,
    );
    let asked = "";
    const declined = await sauceWith(
      { confirm: async (question) => ((asked = question), false) },
      ...argv,
    );
    expect(asked).toBe(
      `Pot ${pot} (owner ${owner.signer.address}, salt ${potSalt("fresh")}) is not deployed on ` +
        "solana. Deploy it now? [y/N] ",
    );
    expect(declined.stderr).toMatch(/so nothing was sent/);
    expect(harness.svm.getAccount(pot).exists).toBe(false);
    const yes = await sauce(...argv.slice(0, -2), "--yes", "--args", "50");
    expect(yes.code).toBe(0);
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
    // Too large for a single unsigned transaction or a simulation: both say to `sauce run`.
    const tx = await sauce(
      "tx",
      big,
      "--owner",
      owner.signer.address,
      "--salt",
      "vault",
      "--rpc-url",
      RPC_URL,
    );
    expect(tx.stderr).toMatch(/has to be staged first, which one unsigned transaction cannot do/);
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

  it("refuses EVM keys, --pot and --value on Solana, and a publish from it", async () => {
    const base = ["run", sweep, "--define", mintDefine, "--rpc-url", RPC_URL];
    expect((await sauce(...base, "--private-key", `0x${"11".repeat(32)}`)).stderr).toMatch(
      /--keystore and --private-key are EVM keys: on Solana, sign with --keypair/,
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
    expect((await sauce("publish", sweep)).stderr).toMatch(
      /Publishing from Solana is not supported/,
    );
    const bad = join(work, "bad.json");
    writeFileSync(bad, "[1, 2, 3]");
    const keypair = await sauce(...base, "--keypair", bad);
    expect(keypair.stderr).toMatch(/not a Solana keypair file/);
    expect(keypair.stderr).not.toContain("[1, 2, 3]");
  }, 60_000);
});
