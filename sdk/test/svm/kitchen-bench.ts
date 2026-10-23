/**
 * Shared LiteSVM bench and assertion helpers for the kitchen e2e suites, against the REAL released
 * `kitchen.so` and `engine-devnet.so` — not mocks.
 *
 * NOT a `.test.ts`, so jest never collects it. The two suites that import it
 * (`kitchen.e2e.test.ts`, `kitchen-cook.e2e.test.ts`) run in separate processes under CI's
 * one-process-per-file loop, and each therefore builds its own VM from `start()`.
 */
import { existsSync, readFileSync } from "node:fs";
import { address, generateKeyPairSigner, getAddressCodec, lamports } from "@solana/kit";
import type { Address, TransactionSigner } from "@solana/kit";
import { FeatureSet, LiteSVM } from "litesvm";
import {
  buildInitializeExecutionFeeInstruction,
  buildSetExecutionFeeInstruction,
  deriveExecutionFeeConfigPda,
  deriveProgramDataPda,
} from "../../src/svm/kitchen.js";
import { buildHeapFramePrepend } from "../../src/svm/prepends.js";
import { KITCHEN_ERROR } from "./kitchen-errors.js";
import { buildExecuteTransaction } from "../../src/svm/transaction.js";

/** Fetched from the release by `sync-engine-artifacts --fetch-v12-engines`, which exports the path. */
const KITCHEN_SO = process.env.SAUCE_KITCHEN_SO;
const KITCHEN_IDL_JSON = process.env.SAUCE_KITCHEN_IDL_JSON;

/**
 * The kitchen's program id, read from the release's own IDL rather than written here.
 *
 * It was hardcoded, and the v0.6.0 bump moved it (`D1ziogw…` → `SauceYLd…`, a vanity id) with every
 * instruction, constant and error unchanged — so the literal silently became a program that does not
 * exist while the drift guards, which check the IDL's CONTENTS, stayed green. Reading `address` off
 * the same artifact the discriminators come from means the two cannot disagree.
 */
const kitchenProgramId = (): Address =>
  address(
    (JSON.parse(readFileSync(KITCHEN_IDL_JSON as string, "utf8")) as { address: string }).address,
  );
/**
 * The REAL engine, not a placeholder address. A Pot is owned by the engine, and only its owning
 * program may debit it — so `close_pot` CPIs into the engine and an address with no program behind
 * it fails `UnsupportedProgramId`. That is the unusable-Pot hazard `create_pot`'s own IDL docs
 * describe, and reproducing it is why this suite loads the engine rather than faking one.
 */
const ENGINE_SO = process.env.SAUCE_RUST_ENGINE_SO;

/** What `start()` prices the kitchen at before setting it free. Any positive value works;
 *  this mirrors v12's own harness so the two read the same. */
const INITIAL_FEE = 25_000n;

// The gate is a local-developer convenience, never a CI outcome: a skipped suite and a passing suite
// are the same line in jest's summary, so a sync that stopped printing SAUCE_KITCHEN_SO would delete
// this whole suite with CI still green. CI supplies both (see .github/workflows/ci.yml), so an absent
// one is a failure there.
if (process.env.CI) {
  // The FILES, not just the variables: the gate below uses existsSync, so a variable pointing at a
  // missing path skips the whole suite, and jest reports skipped and passing the same way.
  const missing = (
    [
      ["SAUCE_KITCHEN_SO", KITCHEN_SO],
      ["SAUCE_RUST_ENGINE_SO", ENGINE_SO],
      ["SAUCE_KITCHEN_IDL_JSON", KITCHEN_IDL_JSON],
    ] as const
  ).filter(([, path]) => path === undefined || !existsSync(path));

  if (missing.length > 0) {
    throw new Error(
      `this suite must never skip in CI, but ${missing
        .map(([name, path]) => `${name}=${path ?? "(unset)"}`)
        .join(", ")} does not point at a readable file. The sync step prints both and CI appends ` +
        `them to $GITHUB_ENV.`,
    );
  }
}

// existsSync on each, not truthiness on some: a set-but-missing path would otherwise run the suite
// and fail inside `start()` rather than being named here.
export const describeKitchen = [KITCHEN_SO, ENGINE_SO, KITCHEN_IDL_JSON].every(
  (path) => path !== undefined && existsSync(path),
)
  ? describe
  : describe.skip;

export interface Bench {
  svm: LiteSVM;
  owner: TransactionSigner;
  kitchen: Address;
  engine: Address;
  /** `["execution_fee"]`, initialized by `start()` and then priced at zero. Every cook takes it. */
  feeConfig: Address;
}

/**
 * Makes `owner` the kitchen's upgrade authority, which is what the fee instructions authorize
 * against.
 *
 * LiteSVM loads programs as IMMUTABLE, so the loader's `ProgramData` records no authority and
 * `initialize_execution_fee` would fail `NotFeeAuthority` — leaving the config uninitialized, which
 * is not a free cook but a failed one. Patching the record in place is what v12's own Rust harness
 * does; the slot and the ELF are untouched.
 *
 * Bincode layout of the 45-byte reserved header: u32 variant (3 = ProgramData), u64 slot, u8 Option
 * tag, then the optional 32-byte authority.
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

export const start = async (): Promise<Bench> => {
  const svm = new LiteSVM()
    .withFeatureSet(FeatureSet.allEnabled())
    .withBuiltins()
    .withSysvars()
    .withDefaultPrograms();
  // `addProgram` (bytes) rather than `addProgramFromFile` (path). These are the only suites that
  // load TWO programs into one VM — the kitchen and the engine it CPIs into — and the only ones that
  // hit an intermittent native std::bad_alloc at teardown, at the LOWEST peak RSS of the seven on a
  // box with GBs free. Reading the files here keeps the loading in JS.
  const kitchen = kitchenProgramId();
  svm.addProgram(kitchen, new Uint8Array(readFileSync(KITCHEN_SO as string)));
  const engine = (await generateKeyPairSigner()).address;
  svm.addProgram(engine, new Uint8Array(readFileSync(ENGINE_SO as string)));
  const owner = await generateKeyPairSigner();
  svm.airdrop(owner.address, lamports(1_000_000_000_000n));

  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);
  const { address: programData } = await deriveProgramDataPda(kitchen);
  grantUpgradeAuthority(svm, programData, owner.address);

  const bench: Bench = { svm, owner, kitchen, engine, feeConfig };
  // Priced, then made free. Initialization refuses a zero fee — a kitchen is unusable until it is
  // priced — while a later set to zero is allowed, and a zero fee performs no transfer at all. That
  // keeps every cook below free of fee bookkeeping without pretending the config is optional.
  const admin = { kitchen, authority: owner.address, programData, feeConfig };
  expectOk(
    await send(bench, [
      buildInitializeExecutionFeeInstruction({ ...admin, initialFee: INITIAL_FEE }),
    ]),
    "initialize_execution_fee",
  );
  expectOk(
    await send(bench, [buildSetExecutionFeeInstruction({ ...admin, fee: 0n })]),
    "set_execution_fee",
  );

  return bench;
};

/**
 * Sends with the mandatory RequestHeapFrame in front. A cook CPIs into the engine, whose interpreter
 * memory lives in the transaction's heap frame rather than in accounts — without it the ENGINE (not
 * the kitchen) dies with an SBF access violation before a single opcode runs, which reads as an
 * opaque `ProgramFailedToComplete` from the kitchen. The Pot/code-buffer lifecycle instructions
 * never touch interpreter memory, so `send` leaves them alone.
 */
export const sendCook = async (
  bench: Bench,
  instructions: Parameters<typeof buildExecuteTransaction>[0]["instructions"],
) => send(bench, [buildHeapFramePrepend(), ...instructions]);

export const send = async (
  bench: Bench,
  instructions: Parameters<typeof buildExecuteTransaction>[0]["instructions"],
) => {
  const tx = await buildExecuteTransaction({
    payer: bench.owner,
    instructions,
    latestBlockhash: { blockhash: bench.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n },
  });

  return bench.svm.sendTransaction(tx);
};

export const expectOk = (result: unknown, what: string): void => {
  const err = (result as { err?: () => unknown }).err;
  // `err()` and nothing else. litesvm exposes the failure reason as a METHOD, so a plain stringify
  // prints nothing — but do NOT reach for `meta()` here: building transaction metadata from a
  // FAILED transaction is what aborted this suite on CI with a native std::bad_alloc, while passing
  // everywhere it was reproduced. `err()` alone carries the instruction index and the program's own
  // error code, which is what the assertions want anyway.
  if (err) {
    const detail = typeof err === "function" ? String(err.call(result)) : String(err);

    throw new Error(`${what} failed: ${detail}`);
  }
};

export const expectKitchenError = (result: unknown, name: keyof typeof KITCHEN_ERROR): void =>
  expectErrorCode(result, KITCHEN_ERROR[name]);

/** The transaction failed with the custom error `code`: one of the Kitchen's, or Anchor's own. */
export const expectErrorCode = (result: unknown, code: number): void => {
  const err = (result as { err?: () => unknown }).err;
  const detail = typeof err === "function" ? String(err.call(result)) : String(err);

  expect(detail).toContain(`InstructionErrorCustom { code: ${code} }`);
};

/**
 * The account at `at`, narrowed. `getAccount` returns a union discriminated on `exists`, which a
 * jest matcher cannot narrow — so this throws (failing the test just the same) and hands back the
 * present branch.
 */
export const present = (
  svm: LiteSVM,
  at: Address,
  what: string,
): { data: Uint8Array; owner: Address } => {
  // `programAddress` is the owning program — @solana/kit's name for what Solana calls the account
  // owner. There is no `owner` key on this shape; reading one gives `undefined`.
  const account = svm.getAccount(at) as {
    exists?: boolean;
    data?: Uint8Array;
    programAddress?: Address;
  } | null;
  if (account === null || account.exists === false || account.data === undefined) {
    throw new Error(`expected ${what} to exist at ${at}`);
  }

  return { data: account.data, owner: account.programAddress as Address };
};

// ONE LiteSVM per suite, built in `beforeAll`. It holds a real BPF VM with two loaded programs and
// exposes no close, so its native arena is reclaimed only when this process exits — one VM per test
// aborted CI's node with std::bad_alloc. Safe to share across a file: every test uses its own pot
// salt / buffer nonce.
//
// **Keep the reference for the life of the process.** Clearing it in `afterAll` makes the VM
// collectable while jest is still finishing, so litesvm's native finalizer can free that arena
// mid-run — which is where the intermittent `std::bad_alloc` landed, after the last test's trace
// line and before jest printed PASS. Holding it costs nothing: the process is about to exit, and
// the OS reclaims the arena either way.

/**
 * Names each test on stderr as it starts, when SAUCE_TRACE_TESTS is set.
 *
 * A native abort kills the process before jest flushes anything, so a crashing suite reports no test
 * at all — `process.stderr.write` is unbuffered and bypasses jest's console capture, which makes the
 * last line printed the test that was running. Off by default; CI turns it on for the engine suites.
 */
export const traceTests = (): void => {
  if (!process.env.SAUCE_TRACE_TESTS) return;

  beforeEach(() => {
    process.stderr.write(`RUNNING: ${expect.getState().currentTestName}\n`);
  });
};
