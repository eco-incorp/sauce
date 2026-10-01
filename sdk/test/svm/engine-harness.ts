/**
 * Shared LiteSVM engine harness for the solswap suites (gated on the vendored
 * engine .so existing — see ENGINE_SO below): boots the real SVM engine, pins
 * the cluster clock (the venue fragments read Clock via ctx.timestamp()),
 * loads venue fixtures, fabricates SPL token accounts / address lookup
 * tables, and executes compiled programs through the sdk's own pure builders
 * (resolveAccounts + buildExecuteInstruction + buildExecuteTransaction).
 * Interpreter memory is the transaction's 256 KiB heap frame — no memory
 * accounts, no provisioning; every execute transaction carries the
 * RequestHeapFrame prepend.
 */
import { existsSync, readFileSync } from "fs";
import { address, getAddressCodec, generateKeyPairSigner, lamports } from "@solana/kit";
import type {
  Address,
  AddressesByLookupTableAddress,
  Instruction,
  KeyPairSigner,
} from "@solana/kit";
import { Clock, FailedTransactionMetadata, FeatureSet, LiteSVM } from "litesvm";
import type { AccountManifest } from "sauce-compiler";
import {
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildCreatePotInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  buildInitializeExecutionFeeInstruction,
  buildSetExecutionFeeInstruction,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  deriveProgramDataPda,
  MAX_POT_LEN,
  getTransactionSize,
  resolveAccounts,
} from "../../src/svm/index.js";
import type {
  AccountResolution,
  SignedExecuteTransaction,
  StagedArgs,
} from "../../src/svm/index.js";
import {
  svmEnginePath,
  svmKitchenPath,
  svmKitchenIdlPath,
} from "../../src/svm/engine-artifacts.js";
import { fixtureAccounts } from "./fixtures.js";
import type { AccountFixture } from "./fixtures.js";

/** The path CI exports (its verified cache), else the packaged binary, else undefined so the suite
 *  skips. The SDK reads no environment: this harness reads CI's and passes the path in. */
const resolveArtifact = (fn: () => string): string | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

// ONE engine: the released `engine-devnet.so`, fetched and digest-pinned by
// `sync-engine-artifacts --fetch-v12-engines`, which prints the path this reads.
//
// There is no vendored fallback any more, deliberately. `artifacts/svm/engine.so` used to be the
// default here — a `release/beta` build predating every v12-svm release, with no JUMP/JUMP_I — so
// anything with control flow was rejected with `InvalidInstructionData` while straight-line programs
// ran fine, and a developer got that silently just by not setting a variable. The binary is gone and
// so is the split: `SAUCE_ENGINE_SO` is accepted as an override for an unreleased build, but the
// default is the release.
// env-then-packaged: CI still points these at its verified cache, which this harness reads and
// passes to the resolvers explicitly (engine-artifacts.ts reads no environment), and a bare
// `pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines` (or an installed package)
// supplies them from `artifacts/svm` too — so a local run executes instead of skipping.
export const ENGINE_SO = resolveArtifact(() =>
  svmEnginePath("devnet", process.env.SAUCE_ENGINE_SO ?? process.env.SAUCE_RUST_ENGINE_SO),
);

/** The kitchen the engine is gated to. A released engine refuses any invocation that did not arrive
 *  through a kitchen cook, so these are no longer optional for a suite that executes bytecode. */
const KITCHEN_SO = resolveArtifact(() => svmKitchenPath(process.env.SAUCE_KITCHEN_SO));
const KITCHEN_IDL_JSON = resolveArtifact(() =>
  svmKitchenIdlPath(process.env.SAUCE_KITCHEN_IDL_JSON),
);

/** The salt every harness Pot is minted under. One Pot per harness is enough: suites that need
 *  distinct storage use distinct accounts in their tail, not distinct Pots. */
export const HARNESS_POT_SALT = new Uint8Array(32).fill(11);

/** describe when an engine binary is available, describe.skip otherwise (a bare local run). */
/** Whether every artifact this harness needs is on disk. Exported so a suite with EXTRA gated inputs
 *  (per-cluster engines, wire files) can AND its own onto this one instead of re-deriving a partial copy. */
export const svmArtifactsPresent = [ENGINE_SO, KITCHEN_SO, KITCHEN_IDL_JSON].every(
  (path) => path !== undefined && existsSync(path),
);

export const describeSvm = svmArtifactsPresent ? describe : describe.skip;

// Kept as a name because suites reference it; it is the same engine as ENGINE_SO now that there is
// only one.
export const RUST_ENGINE_SO = ENGINE_SO;

/** describe for suites that execute compiler-emitted bytecode — they need the `main`-lineage engine. */
export const describeRustSvm = describeSvm;

// The gate above is a local-developer convenience, never a CI outcome: a skipped suite and a passing
// one are the same line in jest's summary. CI supplies the engine, so an absent one is a failure.
if (ENGINE_SO === undefined && process.env.CI) {
  throw new Error(
    "SAUCE_RUST_ENGINE_SO is unset in CI. Suites executing compiler-emitted bytecode must never skip " +
      'here — see the "Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
const ALT_PROGRAM = "AddressLookupTab1e1111111111111111111111111" as Address;

/** Slot every harness runs at (must be > the fabricated ALT's last_extended_slot 0). */
const HARNESS_SLOT = 1000n;

export interface EngineHarness {
  svm: LiteSVM;
  programId: Address;
  payer: KeyPairSigner;
  /** The kitchen every execution goes through, and the Pot it signs for. */
  kitchen: Address;
  pot: Address;
  feeConfig: Address;
}

export const randomAddress = (): Address =>
  getAddressCodec().decode(crypto.getRandomValues(new Uint8Array(32)));

/**
 * Boots LiteSVM with the engine program, a funded payer, and the cluster
 * clock pinned to `unixTimestamp` — the venue quote fragments read
 * ctx.timestamp(), so engine-side quotes evaluate at exactly this instant.
 * No memory setup exists: interpreter memory is the per-transaction heap
 * frame, requested by the RequestHeapFrame prepend on every execute.
 *
 * `engineSo` defaults to the vendored binary; a suite whose bytecode targets a
 * DIFFERENT engine lineage passes its own path rather than overriding
 * SAUCE_ENGINE_SO, which redirects every suite.
 */
export const startEngine = async (
  unixTimestamp: bigint,
  engineSo: string = ENGINE_SO as string,
  /** Where to load the engine. Random by default (the gate keys off the kitchen); a suite driving
   *  code that names the released engine id — the CLI — loads it there. */
  engineProgramId?: Address,
): Promise<EngineHarness> => {
  // The default constructor's program runtime misses the
  // sol_remaining_compute_units syscall (the engine's GasLeft, 0x62 — the
  // SvmRoute CU-floor guard); rebuilding the runtime with every feature
  // enabled registers it, matching mainnet where the feature is long active.
  const svm = new LiteSVM()
    .withFeatureSet(FeatureSet.allEnabled())
    .withBuiltins()
    .withPrecompiles()
    .withSysvars()
    .withDefaultPrograms();
  const programId = engineProgramId ?? (await generateKeyPairSigner()).address;
  svm.addProgramFromFile(programId, engineSo);
  // The kitchen goes in at its DECLARED id, not a random one: Anchor's own `declare_id!` check
  // rejects every instruction otherwise, and the engine's gate re-derives the Pot against the
  // kitchen address baked into the engine binary.
  const kitchen = kitchenProgramId();
  svm.addProgram(kitchen, new Uint8Array(readFileSync(KITCHEN_SO as string)));

  svm.warpToSlot(HARNESS_SLOT);
  svm.setClock(new Clock(HARNESS_SLOT, 0n, 0n, 0n, unixTimestamp));

  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(1_000_000_000_000n));

  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);
  const { address: programData } = await deriveProgramDataPda(kitchen);
  grantUpgradeAuthority(svm, programData, payer.address);

  const { address: pot } = await derivePotPda(kitchen, payer.address, HARNESS_POT_SALT);
  const harness: EngineHarness = { svm, programId, payer, kitchen, pot, feeConfig };

  const admin = { kitchen, authority: payer.address, programData, feeConfig };
  // Priced, then freed. Initialization refuses zero, a later set to zero is allowed, and a zero fee
  // performs no transfer — so every cook below costs nothing and the CU accounting stays comparable
  // to the direct-invocation runs these suites used to do.
  mustSucceed(
    await sendInstructions(harness, [
      buildInitializeExecutionFeeInstruction({ ...admin, initialFee: 25_000n }),
    ]),
    "initialize_execution_fee",
  );
  mustSucceed(
    await sendInstructions(harness, [buildSetExecutionFeeInstruction({ ...admin, fee: 0n })]),
    "set_execution_fee",
  );
  mustSucceed(
    await sendInstructions(harness, [
      buildCreatePotInstruction({
        kitchen,
        owner: payer.address,
        engineProgram: programId,
        pot,
        salt: HARNESS_POT_SALT,
        space: MAX_POT_LEN,
      }),
    ]),
    "create_pot",
  );

  return harness;
};

/** Boot-time assertion: a harness that comes up half-built fails here, naming the step, rather than
 *  surfacing as an opaque engine fault in the first test that runs. */
const mustSucceed = (result: RunResult, what: string): void => {
  if (!result.ok)
    throw new Error(`harness setup: ${what} failed: ${result.err}\n${result.logs.join("\n")}`);
};

/**
 * Makes `authority` the kitchen's upgrade authority, which the fee instructions authorize against.
 *
 * LiteSVM loads programs immutable, so the loader records no authority and the fee config could
 * never be initialized — and an uninitialized config is a failed cook, not a free one. Bincode
 * layout of the 45-byte header: u32 variant (3 = ProgramData), u64 slot, u8 Option tag, then the
 * optional 32-byte authority.
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
  data[12] = 1;
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

/** The kitchen's program id, read from the release IDL rather than written here — the same reason
 *  `kitchen-bench.ts` does it: a hardcoded id silently became a nonexistent program once before. */
const kitchenProgramId = (): Address =>
  address(
    (JSON.parse(readFileSync(KITCHEN_IDL_JSON as string, "utf8")) as { address: string }).address,
  );

/** Loads mainnet fixture dumps into the bank (rent-exempt, original owners). */
export const loadFixtureAccounts = (harness: EngineHarness, fixtures: AccountFixture[]): void => {
  for (const account of fixtureAccounts(fixtures)) harness.svm.setAccount(account);
};

/** 165-byte SPL token account image: mint@0, owner@32, amount u64 LE@64, state Initialized. */
export const tokenAccountData = (mint: Address, owner: Address, amount: bigint): Uint8Array => {
  const codec = getAddressCodec();
  const data = new Uint8Array(165);
  data.set(new Uint8Array(codec.encode(mint)), 0);
  data.set(new Uint8Array(codec.encode(owner)), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1; // AccountState::Initialized
  return data;
};

/** Places a token account at `address` (Tokenkeg-owned unless `tokenProgram` says otherwise) and returns the address. */
export const setTokenAccount = (
  harness: EngineHarness,
  address: Address,
  mint: Address,
  owner: Address,
  amount: bigint,
  tokenProgram: Address = TOKEN_PROGRAM,
): Address => {
  const data = tokenAccountData(mint, owner, amount);
  harness.svm.setAccount({
    address,
    data,
    executable: false,
    lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: tokenProgram,
    space: BigInt(data.length),
  });
  return address;
};

/** SPL token `amount` (u64 LE at 64) of an account in the bank. */
export const tokenAmount = (harness: EngineHarness, address: Address): bigint => {
  const account = harness.svm.getAccount(address);
  if (!account.exists) throw new Error(`token account ${address} does not exist`);
  return new DataView(account.data.buffer, account.data.byteOffset).getBigUint64(64, true);
};

/** SPL Token Transfer instruction data: u8 tag 3 + amount u64 LE. */
export const splTransferData = (amount: bigint): Uint8Array => {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  return data;
};

/** SPL Token TransferChecked instruction data: u8 tag 12 + amount u64 LE + decimals u8. This is the
 *  shape the `settle` recipe emits (via ix 12, not the legacy ix 3 above) so it is correct for
 *  Token-2022 fee mints; the token program checks the passed decimals against the mint's own. */
export const transferCheckedData = (amount: bigint, decimals: number): Uint8Array => {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  data[9] = decimals;
  return data;
};

/** 82-byte SPL Mint image (identical base layout in classic SPL and Token-2022): decimals @44,
 *  is_initialized=1 @45, authorities left as COption::None. Enough for TransferChecked, which reads
 *  the decimals byte and requires an initialized mint. Pass `tokenProgram` = TOKEN_2022_PROGRAM to
 *  etch a Token-2022 mint (a plain one, no extension TLV appended). */
export const setMint = (
  harness: EngineHarness,
  address: Address,
  decimals: number,
  tokenProgram: Address = TOKEN_PROGRAM,
): Address => {
  const data = new Uint8Array(82);
  data[44] = decimals;
  data[45] = 1; // is_initialized
  harness.svm.setAccount({
    address,
    data,
    executable: false,
    lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: tokenProgram,
    space: BigInt(data.length),
  });
  return address;
};

/**
 * Fabricates an ACTIVE address lookup table directly in the bank — the
 * on-chain layout the runtime's create/extend path would build, minus the
 * transactions: 56-byte meta (bincode ProgramState::LookupTable, never
 * deactivating, fully extended before the harness slot) + raw addresses.
 * Returns the table in the shape `buildExecuteTransaction` compresses with.
 */
export const fabricateAlt = (
  harness: EngineHarness,
  addresses: readonly Address[],
): AddressesByLookupTableAddress => {
  const codec = getAddressCodec();
  const table = randomAddress();
  const data = new Uint8Array(56 + 32 * addresses.length);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true); // ProgramState::LookupTable
  view.setBigUint64(4, 0xffff_ffff_ffff_ffffn, true); // deactivation_slot: never
  view.setBigUint64(12, 0n, true); // last_extended_slot 0 < HARNESS_SLOT: all addresses active
  data[20] = 0; // last_extended_slot_start_index
  data[21] = 1; // authority: Some(payer)
  data.set(new Uint8Array(codec.encode(harness.payer.address)), 22);
  addresses.forEach((address, i) => data.set(new Uint8Array(codec.encode(address)), 56 + 32 * i));

  harness.svm.setAccount({
    address: table,
    data,
    executable: false,
    lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: ALT_PROGRAM,
    space: BigInt(data.length),
  });

  return { [table]: [...addresses] };
};

export type RunResult =
  | { ok: true; returnData: Uint8Array; logs: string[] }
  | { ok: false; revertData: Uint8Array; err: string; logs: string[] };

export interface ExecutableOutput {
  bytecode: Uint8Array;
  manifest: AccountManifest;
}

export interface ExecuteOptions {
  lookupTables?: AddressesByLookupTableAddress;
  /** Compute-unit limit prepend; generous default so Newton-loop programs never starve. */
  computeUnits?: number;
}

/**
 * Signs (but does not send) the execute transaction for a compiled output: CU
 * prepend + the mandatory heap-frame request + engine execute instruction,
 * v0, optionally ALT-compressed.
 */
export const signExecuteTransaction = async (
  harness: EngineHarness,
  output: ExecutableOutput,
  resolution: AccountResolution,
  { lookupTables, computeUnits = 1_400_000 }: ExecuteOptions = {},
): Promise<SignedExecuteTransaction> => {
  const accounts = resolveAccounts(output.manifest, resolution, harness.payer.address);
  const instructions: Instruction[] = [
    ...buildComputeBudgetPrepend({ unitLimit: computeUnits }),
    buildHeapFramePrepend(),
    buildCookInstruction({
      kitchen: harness.kitchen,
      owner: harness.payer.address,
      engineProgram: harness.programId,
      potSalt: HARNESS_POT_SALT,
      pot: harness.pot,
      feeConfig: harness.feeConfig,
      bytecode: output.bytecode,
      maxExecutionFee: 0n,
      tail: accounts,
    }),
  ];

  // A fresh blockhash per send keeps signatures unique — LiteSVM's history
  // rejects a byte-identical resend.
  harness.svm.expireBlockhash();

  return buildExecuteTransaction({
    payer: harness.payer,
    instructions,
    latestBlockhash: { blockhash: harness.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n },
    lookupTables,
  });
};

/**
 * Signs (but does not send) arbitrary instructions as one payer-fee-paid v0
 * transaction on a fresh blockhash — the staging-protocol building block
 * (init/write/finalize/close txs and hand-assembled execute_from_account
 * transactions are all built through it). Callers assembling an EXECUTE
 * transaction must include buildHeapFramePrepend() themselves.
 */
export const buildExecuteTransactionForHarness = async (
  harness: EngineHarness,
  instructions: readonly Instruction[],
): Promise<SignedExecuteTransaction> => {
  // A fresh blockhash per send keeps signatures unique — LiteSVM's history
  // rejects a byte-identical resend.
  harness.svm.expireBlockhash();

  return buildExecuteTransaction({
    payer: harness.payer,
    instructions,
    latestBlockhash: { blockhash: harness.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n },
  });
};

/** Builds, signs, and sends one transaction of `instructions`; returns the run result. */
export const sendInstructions = async (
  harness: EngineHarness,
  instructions: readonly Instruction[],
): Promise<RunResult> =>
  sendSigned(harness, await buildExecuteTransactionForHarness(harness, instructions));

export const sendSigned = (
  harness: EngineHarness,
  transaction: SignedExecuteTransaction,
): RunResult => {
  const result = harness.svm.sendTransaction(transaction);

  if (result instanceof FailedTransactionMetadata) {
    return {
      ok: false,
      revertData: result.meta().returnData().data(),
      err: String(result.err()),
      logs: result.meta().logs(),
    };
  }

  return { ok: true, returnData: result.returnData().data(), logs: result.logs() };
};

export const execute = async (
  harness: EngineHarness,
  output: ExecutableOutput,
  resolution: AccountResolution,
  options: ExecuteOptions = {},
): Promise<RunResult> =>
  sendSigned(harness, await signExecuteTransaction(harness, output, resolution, options));

export const expectOk = (result: RunResult): { returnData: Uint8Array; logs: string[] } => {
  if (!result.ok)
    throw new Error(`expected success, got: ${result.err}\n${result.logs.join("\n")}`);
  return result;
};

export const expectFail = (
  result: RunResult,
): { revertData: Uint8Array; err: string; logs: string[] } => {
  if (result.ok) throw new Error("expected the transaction to fail, but it succeeded");
  return result;
};

export const toBigInt = (bytes: Uint8Array): bigint =>
  bytes.length === 0 ? 0n : BigInt("0x" + Buffer.from(bytes).toString("hex"));

/** Deterministic 32-byte PDA seed from a small integer — the test-side stand-in for the old u8 index. */
export const seed32 = (n: number): Uint8Array => {
  const s = new Uint8Array(32);
  new DataView(s.buffer).setUint32(0, n, true);
  return s;
};

/**
 * ONE-instruction staged execute: [CU limit, RequestHeapFrame, execute_from_account]
 * — the payload args ride the execute instruction's own data (no writer
 * instruction exists on the Wave D surface). Hoisted alongside `stageBytecode` — see its doc.
 */
export const executeStaged = async (
  harness: EngineHarness,
  codeBuffer: Address,
  code: Address,
  accounts: ReturnType<typeof resolveAccounts>,
  _opts: { pin?: Uint8Array; args?: StagedArgs } = {},
): Promise<RunResult> => {
  // Generous CU limit — the default 200K/tx starves multi-KB staged programs.
  const instructions: Instruction[] = [
    ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
    buildHeapFramePrepend(),
    buildCookFromAccountInstruction({
      kitchen: harness.kitchen,
      owner: harness.payer.address,
      codeBuffer,
      code,
      engineProgram: harness.programId,
      potSalt: HARNESS_POT_SALT,
      pot: harness.pot,
      feeConfig: harness.feeConfig,
      maxExecutionFee: 0n,
      tail: accounts,
    }),
  ];

  return sendInstructions(harness, instructions);
};

export { getTransactionSize };
