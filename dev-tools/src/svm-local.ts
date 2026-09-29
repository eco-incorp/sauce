/**
 * Local SVM e2e for dev-tools: boot the REAL gated engine in-process and run a program through a
 * kitchen cook — the same orchestration the SDK's own suites use (sdk/test/svm/engine-harness.ts),
 * so a developer can execute SVM programs on their machine with no validator and no credentials.
 *
 * The engine + kitchen binaries come from the packaged resolver (`@eco-incorp/sauce/svm/engine-
 * artifacts`), so this works from an installed package: `eco-incorp/v12` is private, and the shipped
 * `.so` are the only way a consumer gets the engine. The cook is built by the SDK's own
 * `createSauceSvmClient`, so what runs here is exactly what the client would sign against a real
 * cluster — a released engine refuses anything that did not arrive through a kitchen cook.
 */
import { readFileSync } from "node:fs";
import {
  address,
  generateKeyPairSigner,
  getAddressCodec,
  getBase64Encoder,
  getTransactionDecoder,
  lamports,
} from "@solana/kit";
import type { Address, Instruction, KeyPairSigner } from "@solana/kit";
import { Clock, FailedTransactionMetadata, FeatureSet, LiteSVM } from "litesvm";
import {
  buildCreatePotInstruction,
  buildExecuteTransaction,
  buildInitializeExecutionFeeInstruction,
  buildSetExecutionFeeInstruction,
  createSauceSvmClient,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  deriveProgramDataPda,
  MAX_POT_LEN,
  svmEnginePath,
  svmKitchenIdlPath,
  svmKitchenPath,
} from "@eco-incorp/sauce-source/svm";
import type {
  AccountResolution,
  EngineCluster,
  SignedExecuteTransaction,
} from "@eco-incorp/sauce-source/svm";
import type { SvmEngineArtifactPaths } from "@eco-incorp/sauce-source/svm/engine-artifacts";
import type { AccountManifest } from "sauce-compiler";

/** Slot every local run sits at (must exceed a fabricated ALT's last_extended_slot 0). */
const LOCAL_SLOT = 1000n;
/** The salt the local Pot is minted under. One Pot is enough for a single-program local run. */
const LOCAL_POT_SALT = new Uint8Array(32).fill(11);
/** An unroutable URL: the client's RPC calls are answered by the LiteSVM fetch stub, never the net. */
const LOCAL_RPC_URL = "http://127.0.0.1:65535/";

export interface LocalEngine {
  svm: LiteSVM;
  /** The engine program id (random per boot — the gate keys off the kitchen, not this). */
  programId: Address;
  payer: KeyPairSigner;
  kitchen: Address;
  pot: Address;
}

export interface RunResult {
  ok: boolean;
  err: string | null;
  logs: string[];
  returnData: Uint8Array;
}

/** The kitchen's declared program id, read from the release IDL (a hardcoded id rotted once before). */
const kitchenProgramId = (idlPath?: string): Address =>
  address(
    (JSON.parse(readFileSync(svmKitchenIdlPath(idlPath), "utf8")) as { address: string }).address,
  );

/**
 * Makes `authority` the kitchen's upgrade authority so the fee config can be initialized. LiteSVM
 * loads programs immutable (no recorded authority), and an uninitialized fee config is a failed cook.
 * Bincode ProgramData header: u32 variant(=3), u64 slot, u8 Option tag, then the 32-byte authority.
 */
const grantUpgradeAuthority = (svm: LiteSVM, programData: Address, authority: Address): void => {
  const account = svm.getAccount(programData) as {
    data?: Uint8Array;
    lamports?: bigint;
    programAddress?: Address;
    executable?: boolean;
  } | null;
  if (account?.data === undefined) {
    throw new Error(`the loader recorded no ProgramData for the kitchen at ${programData}`);
  }
  const data = new Uint8Array(account.data);
  const variant = new DataView(data.buffer, data.byteOffset).getUint32(0, true);
  if (variant !== 3) {
    throw new Error(`expected a ProgramData account (variant 3) at ${programData}, got ${variant}`);
  }
  data[12] = 1; // Option::Some
  data.set(new Uint8Array(getAddressCodec().encode(authority)), 13);
  svm.setAccount({
    address: programData,
    data,
    executable: account.executable ?? false,
    lamports: lamports(account.lamports ?? 0n),
    programAddress: account.programAddress as Address,
    space: BigInt(data.length),
  });
};

const send = (svm: LiteSVM, transaction: SignedExecuteTransaction): RunResult => {
  const result = svm.sendTransaction(transaction);
  if (result instanceof FailedTransactionMetadata) {
    return {
      ok: false,
      err: String(result.err()),
      logs: result.meta().logs(),
      returnData: result.meta().returnData().data(),
    };
  }
  return { ok: true, err: null, logs: result.logs(), returnData: result.returnData().data() };
};

const sendInstructions = async (
  engine: LocalEngine,
  instructions: readonly Instruction[],
): Promise<RunResult> => {
  engine.svm.expireBlockhash();
  return send(
    engine.svm,
    await buildExecuteTransaction({
      payer: engine.payer,
      instructions,
      latestBlockhash: {
        blockhash: engine.svm.latestBlockhash(),
        lastValidBlockHeight: 1_000_000n,
      },
    }),
  );
};

const mustSucceed = (result: RunResult, what: string): void => {
  if (!result.ok)
    throw new Error(`local engine setup: ${what} failed: ${result.err}\n${result.logs.join("\n")}`);
};

/**
 * Boots LiteSVM with the packaged engine + kitchen, a funded payer, a priced-then-freed execution
 * fee, and a Pot — the full gated set. `unixTimestamp` pins the cluster clock (venue fragments read
 * ctx.timestamp()); `cluster` picks which packaged engine `.so` to load; `artifacts` names binaries
 * to load instead of the packaged ones (an unreleased engine build, say).
 */
export const bootLocalEngine = async (
  unixTimestamp = 1_700_000_000n,
  cluster: EngineCluster = "devnet",
  artifacts: SvmEngineArtifactPaths = {},
): Promise<LocalEngine> => {
  const svm = new LiteSVM()
    .withFeatureSet(FeatureSet.allEnabled())
    .withBuiltins()
    .withPrecompiles()
    .withSysvars()
    .withDefaultPrograms();

  const programId = (await generateKeyPairSigner()).address;
  svm.addProgramFromFile(programId, svmEnginePath(cluster, artifacts.engineSo));

  const kitchen = kitchenProgramId(artifacts.kitchenIdlJson);
  svm.addProgram(kitchen, new Uint8Array(readFileSync(svmKitchenPath(artifacts.kitchenSo))));

  svm.warpToSlot(LOCAL_SLOT);
  svm.setClock(new Clock(LOCAL_SLOT, 0n, 0n, 0n, unixTimestamp));

  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(1_000_000_000_000n));

  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);
  const { address: programData } = await deriveProgramDataPda(kitchen);
  grantUpgradeAuthority(svm, programData, payer.address);

  const { address: pot } = await derivePotPda(kitchen, payer.address, LOCAL_POT_SALT);
  const engine: LocalEngine = { svm, programId, payer, kitchen, pot };

  const admin = { kitchen, authority: payer.address, programData, feeConfig };
  mustSucceed(
    await sendInstructions(engine, [
      buildInitializeExecutionFeeInstruction({ ...admin, initialFee: 25_000n }),
    ]),
    "initialize_execution_fee",
  );
  mustSucceed(
    await sendInstructions(engine, [buildSetExecutionFeeInstruction({ ...admin, fee: 0n })]),
    "set_execution_fee",
  );
  mustSucceed(
    await sendInstructions(engine, [
      buildCreatePotInstruction({
        kitchen,
        owner: payer.address,
        engineProgram: programId,
        pot,
        salt: LOCAL_POT_SALT,
        space: MAX_POT_LEN,
      }),
    ]),
    "create_pot",
  );

  return engine;
};

/** Routes the `createSauceSvmClient` RPC calls (`getLatestBlockhash`, `simulateTransaction`) at the
 *  in-process LiteSVM, so the client's own signed wire bytes run exactly as sent. Swaps the process-
 *  wide `globalThis.fetch` for the duration, so calls must not overlap — see `runSvmProgramLocally`. */
const withLiteSvmRpc = async <T>(engine: LocalEngine, body: () => Promise<T>): Promise<T> => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: { body: string }): Promise<unknown> => {
    const { id, method, params } = JSON.parse(init.body) as {
      id: number;
      method: string;
      params: unknown[];
    };
    if (method === "getLatestBlockhash") {
      return Response.json({
        id,
        jsonrpc: "2.0",
        result: {
          context: { apiVersion: "2.0.0", slot: 100 },
          value: { blockhash: engine.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000 },
        },
      });
    }
    if (method === "simulateTransaction") {
      const wire = getBase64Encoder().encode(params[0] as string);
      const result = engine.svm.sendTransaction(
        getTransactionDecoder().decode(new Uint8Array(wire)),
      ) as { err?: () => unknown; logs?: () => string[] };
      const failed = typeof result.err === "function" ? result.err.call(result) : undefined;
      return Response.json({
        id,
        jsonrpc: "2.0",
        result: {
          context: { apiVersion: "2.0.0", slot: 100 },
          value: {
            accounts: null,
            err: failed ? String(failed) : null,
            logs: typeof result.logs === "function" ? result.logs.call(result) : [],
            returnData: null,
            unitsConsumed: 0,
          },
        },
      });
    }
    throw new Error(`local engine: the client made an unexpected RPC call: ${method}`);
  }) as unknown as typeof fetch;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
};

export interface RunProgramOptions {
  /** Maps the manifest's account refs to real addresses (empty for a self-contained program). */
  resolution?: AccountResolution;
  /** Cluster engine to run against (default devnet). */
  cluster?: EngineCluster;
  /** Cluster clock, unix seconds (default 1_700_000_000). */
  unixTimestamp?: bigint;
  /** Engine/kitchen binaries to load instead of the packaged ones. */
  artifacts?: SvmEngineArtifactPaths;
}

/**
 * One-shot: boot the local engine and run `bytecode` through a kitchen cook the gate accepts,
 * returning `{ err, logs }` (`err` is null on success). `bytecode` and `manifest` are exactly what
 * `@eco-incorp/sauce/compiler`'s `compile({ target: 'svm' })` returns; `options.resolution` maps the
 * manifest's account refs to addresses (empty for a self-contained program). This is the local e2e a
 * developer runs against a program they compiled — no validator, no credentials.
 *
 * Not concurrency-safe: it swaps `globalThis.fetch` for the length of the run to route the client's
 * RPC at the in-process LiteSVM, so run these one at a time (await each) rather than in parallel —
 * overlapping calls would clobber each other's fetch patch. Awaiting sequentially is the norm for the
 * per-program local e2e this is built for.
 */
export const runSvmProgramLocally = async (
  bytecode: Uint8Array,
  manifest: AccountManifest,
  options: RunProgramOptions = {},
): Promise<{ err: string | null; logs: string[] }> => {
  const engine = await bootLocalEngine(
    options.unixTimestamp ?? 1_700_000_000n,
    options.cluster,
    options.artifacts,
  );
  return withLiteSvmRpc(engine, async () => {
    const client = await createSauceSvmClient({
      kitchen: engine.kitchen,
      maxExecutionFee: 0n,
      payer: engine.payer,
      potSalt: LOCAL_POT_SALT,
      programId: engine.programId,
      rpcUrl: LOCAL_RPC_URL,
    });
    const result = (await client.simulate(bytecode, manifest, options.resolution ?? {}, {})) as {
      err?: unknown;
      logs?: string[];
    };
    return { err: (result.err as string | null) ?? null, logs: result.logs ?? [] };
  });
};
