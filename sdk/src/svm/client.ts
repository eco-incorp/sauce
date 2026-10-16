import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import type {
  Address,
  AddressesByLookupTableAddress,
  Commitment,
  Instruction,
  Signature,
  TransactionSigner,
} from "@solana/kit";
import type { AccountManifest } from "sauce-compiler";
import type { ArgsLayout, ArgValue } from "./layout.js";
import {
  LOOKUP_TABLE_MAX_ADDRESSES,
  createAltWithAddresses,
  extendAlt,
  fetchAlt,
  lookupTableAddresses,
  waitForAltActive,
} from "./alt.js";
import {
  assertNoExecutePin,
  buildCookAndPayFromAccountPinnedInstruction,
  buildCookAndPayInstruction,
} from "./instructions.js";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import { ENGINE_GAS_LIMIT_CU } from "./engine.js";
import { buildComputeBudgetPrepend, buildHeapFramePrepend } from "./prepends.js";
import { resolveAccounts } from "./resolve.js";
import {
  buildCookFromAccountInstruction,
  buildCookInstruction,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  fetchExecutionFee,
} from "./kitchen.js";
import type { AccountResolution } from "./resolve.js";
import { recommendedComputeUnitLimit, sendExecute, simulateExecute } from "./send.js";
import type { SendExecuteResult, SimulateExecuteResult } from "./send.js";
import {
  buildExecuteTransaction,
  getTransactionSize,
  measureExecuteTransaction,
  TRANSACTION_SIZE_LIMIT,
} from "./transaction.js";
import type { SignedExecuteTransaction } from "./transaction.js";

/**
 * How a cook reaches the engine.
 *
 * - `"kitchen"`: the Kitchen's `cook` (or `cook_from_account`), which CPIs the engine and signs the
 *   owner's Pot. The program can act as its Pot — hold assets in it, write its storage — and the
 *   Kitchen charges the execution fee first. The engine runs one level down the invoke stack.
 * - `"engine"`: the engine's own `cookAndPay` (or the staged, pinned `cookAndPayFromAccountPinned`).
 *   The engine charges the same fee, into the same treasury, then runs the program as the top-level
 *   instruction: no Pot, nothing signed for one — the program acts with the transaction's own
 *   signatures, such as the wallet's — and one more level of CPI depth for what it calls.
 */
export type CookVia = "kitchen" | "engine";

export interface SauceSvmClientConfig {
  /** Your cluster's JSON-RPC URL. Required: the SDK ships no RPC endpoints and has no default. */
  rpcUrl: string;
  /** Defaults to rpcUrl with the protocol swapped to ws(s). */
  wsUrl?: string;
  /** The ENGINE. Named per call rather than compiled in: the interpreter that runs, which a
   *  Kitchen cook CPIs and a direct cook (`via: "engine"`) calls itself. */
  programId: Address;
  /**
   * The KITCHEN, required either way.
   *
   * A Kitchen cook goes through it: the engine's legacy instructions refuse any invocation that did
   * not arrive through one. A direct cook does not, but pays the fee its `["execution_fee"]` config
   * sets, into that config — the engine re-derives the account against the Kitchen it bakes in.
   */
  kitchen: Address;
  payer: TransactionSigner;
  /** Which of the payer's Pots to run as. Defaults to the all-zero salt — the natural "primary". */
  potSalt?: Uint8Array;
  /**
   * What the caller consents to pay per cook, in lamports: every cook signs it as its
   * `max_execution_fee`, and the Kitchen (or, `via: "engine"`, the engine) charges the configured
   * fee only while it is at most this — a higher one refuses the cook before anything runs.
   * Defaults to zero, which succeeds only while the kitchen is priced at zero — a kitchen with a
   * positive fee refuses, rather than silently spending the payer's SOL on a quote they never saw.
   * Quote it with `executionFee()`; a cook's own `maxExecutionFee` option overrides this one.
   */
  maxExecutionFee?: bigint;
  /** How every cook reaches the engine: through the Kitchen (the default) or directly. See
   *  {@link CookVia}. `potSalt` means nothing to a direct cook, which runs as no Pot. */
  via?: CookVia;
}

export interface SimulateOpts {
  prepends?: readonly Instruction[];
  lookupTables?: AddressesByLookupTableAddress;
  /**
   * Append the fee payer as an in-list readonly signer when the manifest yields no
   * signer meta. Needed ONLY for programs that read MSG_SENDER/TX_ORIGIN —
   * NoSigner is lazy, so everything else runs (and simulates) signerless.
   */
  appendPayerSigner?: boolean;
  /** This cook's `max_execution_fee`, in place of the client's `maxExecutionFee`. */
  maxExecutionFee?: bigint;
  /**
   * Accounts whose state after the transaction `simulate`/`simulateStaged` report, in order, as
   * `SimulateExecuteResult.accounts` — what a cook moved, read back without sending it. The
   * execute paths ignore it.
   */
  accounts?: readonly Address[];
}

export interface ExecuteOpts extends SimulateOpts {
  /** 'auto' simulates first and applies recommendedComputeUnitLimit (x1.2, capped 1.4M). */
  computeUnitLimit?: number | "auto";
}

/**
 * How `execute` and `executeStaged` fit a cook whose accounts do not fit one transaction: through
 * an address lookup table, where each account costs one byte rather than 32.
 */
export interface LookupTableOpts {
  /**
   * Unset (the default), a cook that does not fit one transaction goes through a lookup table the
   * client creates for it: over exactly the accounts a table may hold (every account the cook lists
   * but its signers and the programs it calls), owned by the payer, who pays its rent (about 0.0016
   * SOL, and 0.00022 more per account) and the fees that create it, and usable before the cook is
   * sent. A table's address reuses that table, extended with any account it lacks. `false` sends
   * the cook as it is. A cook that fits, or one given `lookupTables`, takes no table. The table the
   * cook went through is the result's `lookupTableAddress`, and an error's after the table was
   * made, for a later cook naming the same accounts.
   */
  lookupTable?: Address | false;
}

/** `execute`'s options: a cook's, and the lookup table it may go through. */
export interface SendOpts extends ExecuteOpts, LookupTableOpts {}

/** What `cookLookupTable` makes ready: the cook's options, and the table's. */
export type CookLookupTableOpts = ExecuteOpts & EnsureLookupTableOpts;

/** A buffer staged by this client — carries the SDK-computed content hash (the execute pin). */
export interface StagedBuffer {
  address: Address;
  /** The 32-byte PDA seed the buffer was derived + init'd under. */
  seed: Uint8Array;
  /** sha256 of the staged bytecode, computed SDK-side and verified on-chain at finalize. */
  sha256: Uint8Array;
  /** Staging transaction signatures in send order: init, writes…, finalize. */
  signatures: Signature[];
}

/** Per-execution args for a staged program. The layout is CALLER-SUPPLIED: neither `CompileResult`
 *  carries one — the compiler's is `{ bytecode, manifest? }`, the route seam's is
 *  `{ bytecode: Uint8Array[], warnings }` — so `ArgsLayout` is the SDK's own type (`./layout.ts`)
 *  describing where each value sits in the payload tail. */
export interface StagedArgs {
  layout: ArgsLayout;
  values: readonly ArgValue[];
}

export interface SimulateStagedOpts extends SimulateOpts {
  /**
   * Through the Kitchen: REJECTED, not enforced. Passing this THROWS.
   *
   * `execute_from_account` on the released engine takes no payload, so this was being forwarded
   * and then dropped while documented as an applied pin. The enforceable content pin is the
   * kitchen's, given to `buildFinalizeCodeBufferInstruction` when the buffer is finalized.
   *
   * `via: "engine"`: the pin the engine enforces. A direct staged cook is always
   * `cookAndPayFromAccountPinned`, and this is its digest — required unless the buffer is a
   * `StagedBuffer`, whose `sha256` is used (the two must agree when both are given).
   */
  expectedSha256?: Uint8Array;
}

export interface ExecuteStagedOpts extends SimulateStagedOpts {
  computeUnitLimit?: number | "auto";
}

/** `executeStaged`'s options: a staged cook's, and the lookup table it may go through. */
export interface SendStagedOpts extends ExecuteStagedOpts, LookupTableOpts {}

/** What `stagedCookLookupTable` makes ready: the staged cook's options, and the table's. */
export type StagedCookLookupTableOpts = ExecuteStagedOpts & EnsureLookupTableOpts;

/** An address lookup table this client created/extended, ready to compress a v0 transaction against. */
export interface EnsuredLookupTable {
  lookupTableAddress: Address;
  /** The shape `executeStaged`/`simulate`'s `lookupTables` option consumes (table → its addresses). */
  lookupTables: AddressesByLookupTableAddress;
}

export interface EnsureLookupTableOpts {
  /**
   * Reuse and EXTEND this table instead of creating a fresh one: the addresses
   * already in it are diffed out and only the missing ones are appended (an
   * all-present set sends nothing) — the idempotent per-universe reuse path.
   */
  existing?: Address;
  commitment?: Commitment;
}

export interface SauceSvmClient {
  /** Fee-payer / lookup-table authority public key — the ALT-address selection excludes it (signers cannot be looked up). */
  readonly payerAddress: Address;
  /** How this client's cooks reach the engine. */
  readonly via: CookVia;
  /**
   * The Kitchen's execution fee now, in lamports, from its fee config — what a cook pays either
   * way. Compare it with what you will pay, and give it as `maxExecutionFee`, so a cook pays what
   * was quoted or, if the fee rises before it lands, fails.
   */
  executionFee(): Promise<bigint>;
  /**
   * Creates (or, with `opts.existing`, extends) an address lookup table over
   * `addresses`, waits for it to warm up, and returns it in the shape the
   * execute/simulate `lookupTables` option consumes. Signers must NOT be in
   * `addresses` — they have to stay static message accounts. Idempotent on the
   * existing path: an already-covering table sends no transactions. A set that
   * would take the table past LOOKUP_TABLE_MAX_ADDRESSES throws before any
   * transaction is sent — a partially-extended table cannot be un-funded.
   */
  ensureLookupTable(
    addresses: readonly Address[],
    opts?: EnsureLookupTableOpts,
  ): Promise<EnsuredLookupTable>;
  /**
   * The lookup table the cook `cookTransaction` builds from the same arguments needs, made ready:
   * `undefined` when the cook fits one transaction as it is (or through `opts.lookupTables`);
   * else `ensureLookupTable` over exactly the accounts a table may hold — every account the cook
   * lists but its signers and the programs it calls — measured without a blockhash or a
   * signature. Pass its `lookupTables` to `simulate` or `cookTransaction`; `execute` does all of
   * this itself. Throws, sending nothing, when the cook would not fit even through a table: a
   * program that large is staged (`executeStaged`).
   */
  cookLookupTable(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: CookLookupTableOpts,
  ): Promise<EnsuredLookupTable | undefined>;
  /** `cookLookupTable` for a staged cook: the table `stagedCookTransaction`'s cook needs. */
  stagedCookLookupTable(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: StagedCookLookupTableOpts,
  ): Promise<EnsuredLookupTable | undefined>;
  simulate(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: SimulateOpts,
  ): Promise<SimulateExecuteResult>;
  /**
   * Builds the cook, sends it and confirms it. A cook too wide for one transaction goes through a
   * lookup table the client makes ready first (`lookupTable`, on by default).
   */
  execute(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: SendOpts,
  ): Promise<SendExecuteResult>;
  /**
   * The signed cook transaction `execute` sends, built the same way, without sending it: for a
   * caller that sends it by its own route (polled confirmation, a relayer) or hands its wire bytes
   * on. With `computeUnitLimit: "auto"` it simulates first, exactly as `execute` does.
   */
  cookTransaction(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: ExecuteOpts,
  ): Promise<SignedExecuteTransaction>;
  simulateStaged(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: SimulateStagedOpts,
  ): Promise<SimulateExecuteResult>;
  /**
   * Executes a finalized code buffer in ONE instruction: the Kitchen's `cook_from_account`, or
   * (`via: "engine"`) the engine's `cookAndPayFromAccountPinned`, pinned to the staged digest. The
   * buffer is the code buffer's metadata address (or the `StagedBuffer`); its code account is
   * derived from it. A staged program's arguments are part of the staged bytes.
   */
  executeStaged(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: SendStagedOpts,
  ): Promise<SendExecuteResult>;
  /** The signed `cook_from_account` transaction `executeStaged` sends, without sending it. */
  stagedCookTransaction(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: ExecuteStagedOpts,
  ): Promise<SignedExecuteTransaction>;
}

/**
 * The digest a direct staged cook pins: the caller's `expectedSha256`, else the `StagedBuffer`'s
 * own. A direct cook runs the code account with the transaction's signatures and the engine checks
 * nothing else about that account, so the client makes no unpinned direct cook —
 * `buildCookAndPayFromAccountInstruction` is the raw builder for a caller who wants one.
 */
function directPin(
  buffer: Address | StagedBuffer,
  expectedSha256: Uint8Array | undefined,
): Uint8Array {
  const staged = typeof buffer === "string" ? undefined : buffer.sha256;
  if (
    expectedSha256 !== undefined &&
    staged !== undefined &&
    (expectedSha256.length !== staged.length || expectedSha256.some((b, i) => b !== staged[i]))
  ) {
    throw new Error(
      "expectedSha256 disagrees with the StagedBuffer's sha256: the pin must be the staged bytes' digest",
    );
  }
  const pin = expectedSha256 ?? staged;
  if (pin === undefined) {
    throw new Error(
      'a staged cook via "engine" is pinned: the engine runs the code account with the ' +
        "transaction's signatures and checks nothing else about it. Pass the StagedBuffer staging " +
        "returned, or the staged bytes' sha256 as expectedSha256.",
    );
  }
  if (pin.length !== 32) throw new Error("expectedSha256 must be exactly 32 bytes");

  return pin;
}

export async function createSauceSvmClient({
  rpcUrl,
  wsUrl,
  programId,
  kitchen,
  payer,
  potSalt = new Uint8Array(32),
  maxExecutionFee = 0n,
  via = "kitchen",
}: SauceSvmClientConfig): Promise<SauceSvmClient> {
  if (via !== "kitchen" && via !== "engine") {
    throw new Error(`createSauceSvmClient: via must be "kitchen" or "engine", got ${String(via)}`);
  }
  // The type already requires it; this is for callers the type does not reach (plain JS, a config
  // object built at runtime), who would otherwise get an opaque failure from inside the RPC client.
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    throw new Error(
      "createSauceSvmClient: pass `rpcUrl`, your cluster's JSON-RPC URL. The SDK ships no RPC " +
        "endpoints and has no default.",
    );
  }
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl ?? rpcUrl.replace(/^http/, "ws"));
  // Derived once: both are pure functions of the kitchen and the payer, and a cook names them on
  // every call.
  const { address: pot } = await derivePotPda(kitchen, payer.address, potSalt);
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);

  /**
   * Signs an execute transaction: RequestHeapFrame(262144) FIRST (required on
   * every execute/simulate; add-once — caller prepends must not carry their
   * own), then the prepends, then the execute instruction.
   */
  async function signExecuteTransaction(
    executeInstruction: Instruction,
    prepends: readonly Instruction[],
    lookupTables?: AddressesByLookupTableAddress,
  ): Promise<SignedExecuteTransaction> {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    return buildExecuteTransaction({
      payer,
      instructions: [buildHeapFramePrepend(), ...prepends, executeInstruction],
      latestBlockhash,
      lookupTables,
    });
  }

  /** The size of a transaction of the payer's `instructions`, through `lookupTables`, unsigned. */
  const sizeOf = (
    instructions: readonly Instruction[],
    lookupTables?: AddressesByLookupTableAddress,
  ): number =>
    getTransactionSize(
      measureExecuteTransaction({ feePayer: payer.address, instructions, lookupTables }),
    );

  /**
   * Whether `instructions` fit one transaction with `addresses`, every account of theirs a table
   * may hold, in one.
   */
  const fitsThroughTable = (
    instructions: readonly Instruction[],
    addresses: readonly Address[],
  ): boolean =>
    // Where a table will be is not known before it is created; any key measures the same.
    sizeOf(instructions, { [payer.address]: [...addresses] }) <= TRANSACTION_SIZE_LIMIT;

  /**
   * Refuses to simulate a cook too large for one transaction, which the cluster would refuse
   * opaquely — measured before a signer or the cluster is asked anything — saying what fits it.
   */
  function refuseTooLarge(
    executeInstruction: Instruction,
    prepends: readonly Instruction[],
    lookupTables: AddressesByLookupTableAddress | undefined,
    staged: boolean,
  ): void {
    const instructions = [buildHeapFramePrepend(), ...prepends, executeInstruction];
    const plain = measureExecuteTransaction({ feePayer: payer.address, instructions });
    const size =
      lookupTables === undefined ? getTransactionSize(plain) : sizeOf(instructions, lookupTables);
    if (size <= TRANSACTION_SIZE_LIMIT) return;
    const prefix = `the cook is a ${size}-byte transaction, past Solana's ${TRANSACTION_SIZE_LIMIT}: `;
    if (!staged && !fitsThroughTable(instructions, lookupTableAddresses(plain))) {
      throw new Error(
        `${prefix}the program itself is too large for one, so stage it in a code buffer and ` +
          "simulateStaged it",
      );
    }
    throw new Error(
      `${prefix}${staged ? "executeStaged takes" : "execute and executeStaged take"} its accounts ` +
        "through a lookup table it makes ready; to simulate it, pass the lookupTables " +
        `${staged ? "stagedCookLookupTable" : "cookLookupTable"} returns`,
    );
  }

  /** The cook's own instruction: the Kitchen's `cook`, or the engine's `cookAndPay`. */
  function cookInstruction(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: SimulateOpts,
  ): Instruction {
    const accounts = resolveAccounts(manifest, resolution, payer.address, {
      appendPayerSigner: opts.appendPayerSigner,
    });
    const cap = opts.maxExecutionFee ?? maxExecutionFee;

    return via === "engine"
      ? buildCookAndPayInstruction({
          engineProgram: programId,
          feeConfig,
          feePayer: payer.address,
          maxExecutionFee: cap,
          bytecode,
          tail: accounts,
        })
      : buildCookInstruction({
          kitchen,
          owner: payer.address,
          engineProgram: programId,
          potSalt,
          pot,
          feeConfig,
          bytecode,
          maxExecutionFee: cap,
          tail: accounts,
        });
  }

  async function buildTransaction(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    prepends: readonly Instruction[],
    opts: SimulateOpts,
  ): Promise<SignedExecuteTransaction> {
    return signExecuteTransaction(
      cookInstruction(bytecode, manifest, resolution, opts),
      prepends,
      opts.lookupTables,
    );
  }

  async function simulate(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: SimulateOpts = {},
  ): Promise<SimulateExecuteResult> {
    const prepends = measuring(opts.prepends ?? []);
    refuseTooLarge(
      cookInstruction(bytecode, manifest, resolution, opts),
      prepends,
      opts.lookupTables,
      false,
    );
    const transaction = await buildTransaction(bytecode, manifest, resolution, prepends, opts);

    return simulateExecute(
      rpc,
      transaction,
      opts.accounts === undefined ? {} : { accounts: opts.accounts },
    );
  }

  /** A staged cook's own instruction: `cook_from_account`, or `cookAndPayFromAccountPinned`. */
  async function stagedCookInstruction(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: SimulateStagedOpts,
  ): Promise<Instruction> {
    const address = typeof buffer === "string" ? buffer : buffer.address;
    const accounts = resolveAccounts(manifest, resolution, payer.address, {
      appendPayerSigner: opts.appendPayerSigner,
    });
    const cap = opts.maxExecutionFee ?? maxExecutionFee;
    if (via === "kitchen") assertNoExecutePin(opts.expectedSha256);
    const pin = via === "engine" ? directPin(buffer, opts.expectedSha256) : undefined;

    const { address: code } = await deriveCodePda(kitchen, address);

    return pin !== undefined
      ? buildCookAndPayFromAccountPinnedInstruction({
          engineProgram: programId,
          code,
          expectedSha256: pin,
          feeConfig,
          feePayer: payer.address,
          maxExecutionFee: cap,
          tail: accounts,
        })
      : buildCookFromAccountInstruction({
          kitchen,
          owner: payer.address,
          codeBuffer: address,
          code,
          engineProgram: programId,
          potSalt,
          pot,
          feeConfig,
          maxExecutionFee: cap,
          tail: accounts,
        });
  }

  async function buildStagedTransaction(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    prepends: readonly Instruction[],
    opts: SimulateStagedOpts,
  ): Promise<SignedExecuteTransaction> {
    return signExecuteTransaction(
      await stagedCookInstruction(buffer, manifest, resolution, opts),
      prepends,
      opts.lookupTables,
    );
  }

  async function simulateStaged(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: SimulateStagedOpts = {},
  ): Promise<SimulateExecuteResult> {
    const prepends = measuring(opts.prepends ?? []);
    refuseTooLarge(
      await stagedCookInstruction(buffer, manifest, resolution, opts),
      prepends,
      opts.lookupTables,
      true,
    );
    const transaction = await buildStagedTransaction(buffer, manifest, resolution, prepends, opts);

    return simulateExecute(
      rpc,
      transaction,
      opts.accounts === undefined ? {} : { accounts: opts.accounts },
    );
  }

  /**
   * A simulation's prepends with the most compute a transaction may use, unless they set a limit
   * themselves: a rehearsal measures the units a cook takes, and with no limit a transaction gets
   * 200,000 for its one instruction, which a program past that would fail rather than report.
   */
  /** The compute-budget instruction that sets a transaction's limit, by its first byte. */
  const SET_COMPUTE_UNIT_LIMIT = 2;
  const measuring = (prepends: readonly Instruction[]): Instruction[] =>
    prepends.some(
      (instruction) =>
        instruction.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS &&
        instruction.data?.[0] === SET_COMPUTE_UNIT_LIMIT,
    )
      ? [...prepends]
      : [...buildComputeBudgetPrepend({ unitLimit: ENGINE_GAS_LIMIT_CU }), ...prepends];

  async function autoComputeUnitPrepends(
    simulateRun: () => Promise<SimulateExecuteResult>,
    opts: ExecuteOpts | ExecuteStagedOpts,
  ): Promise<Instruction[]> {
    let unitLimit: number | undefined;

    if (opts.computeUnitLimit === "auto") {
      const sim = await simulateRun();

      if (!sim.ok || sim.unitsConsumed === undefined) {
        throw new Error(
          `compute unit auto-limit simulation failed: ${JSON.stringify(sim.err) ?? "no units consumed"}`,
        );
      }

      unitLimit = recommendedComputeUnitLimit(sim.unitsConsumed);
    } else {
      unitLimit = opts.computeUnitLimit;
    }

    return [
      ...(unitLimit !== undefined ? buildComputeBudgetPrepend({ unitLimit }) : []),
      ...(opts.prepends ?? []),
    ];
  }

  const sendAndConfirmAlt = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  async function ensureLookupTable(
    addresses: readonly Address[],
    opts: EnsureLookupTableOpts = {},
  ): Promise<EnsuredLookupTable> {
    if (addresses.length === 0) {
      throw new Error(
        "ensureLookupTable needs at least one address (a lookup table cannot be empty)",
      );
    }
    const commitment = opts.commitment ?? "confirmed";
    const deduped = [...new Set(addresses)];

    if (opts.existing !== undefined) {
      const current = (await fetchAlt(rpc, opts.existing))[opts.existing] ?? [];
      const have = new Set(current);
      const missing = deduped.filter((address) => !have.has(address));
      if (current.length + missing.length > LOOKUP_TABLE_MAX_ADDRESSES) {
        throw new Error(
          `lookup table ${opts.existing} holds ${current.length} addresses and cannot take ${missing.length} more: one table holds at most ${LOOKUP_TABLE_MAX_ADDRESSES}`,
        );
      }
      if (missing.length > 0) {
        const { lastExtendedSlot } = await extendAlt({
          rpc,
          payer,
          authority: payer,
          lookupTableAddress: opts.existing,
          addresses: missing,
          sendAndConfirm: sendAndConfirmAlt,
          commitment,
        });
        await waitForAltActive(rpc, lastExtendedSlot);
      }
      return {
        lookupTableAddress: opts.existing,
        lookupTables: await fetchAlt(rpc, opts.existing),
      };
    }

    const { lookupTableAddress, lastExtendedSlot } = await createAltWithAddresses({
      rpc,
      payer,
      authority: payer,
      addresses: deduped,
      sendAndConfirm: sendAndConfirmAlt,
      commitment,
    });
    await waitForAltActive(rpc, lastExtendedSlot);
    return { lookupTableAddress, lookupTables: await fetchAlt(rpc, lookupTableAddress) };
  }

  /**
   * The table a transaction of `cook` needs, made ready, or `undefined` when it fits without one.
   * Measured as it is sent — the heap frame, then `prepends`, then the cook — with no blockhash and
   * no signature, so no signer is asked for anything.
   */
  async function lookupTableFor(
    cook: Instruction,
    prepends: readonly Instruction[],
    opts: CookLookupTableOpts,
    staged: boolean,
  ): Promise<EnsuredLookupTable | undefined> {
    const instructions = [buildHeapFramePrepend(), ...prepends, cook];
    // Compiled once: its size, and the accounts a table would hold.
    const plain = measureExecuteTransaction({ feePayer: payer.address, instructions });
    const size =
      opts.lookupTables === undefined
        ? getTransactionSize(plain)
        : sizeOf(instructions, opts.lookupTables);
    if (size <= TRANSACTION_SIZE_LIMIT) return undefined;
    const addresses = lookupTableAddresses(plain);
    if (addresses.length > LOOKUP_TABLE_MAX_ADDRESSES) {
      throw new Error(
        `the cook names ${addresses.length} accounts a lookup table may hold, more than one table ` +
          `holds (${LOOKUP_TABLE_MAX_ADDRESSES})`,
      );
    }
    if (!fitsThroughTable(instructions, addresses)) {
      throw new Error(
        `the cook is a transaction past Solana's ${TRANSACTION_SIZE_LIMIT} bytes even with every ` +
          "account it names through a lookup table: " +
          (staged
            ? "it signs or calls too many accounts"
            : "the program itself is too large for one, so stage it in a code buffer and " +
              "executeStaged it"),
      );
    }

    return ensureLookupTable(addresses, {
      ...(opts.existing === undefined ? {} : { existing: opts.existing }),
      ...(opts.commitment === undefined ? {} : { commitment: opts.commitment }),
    });
  }

  /**
   * The prepends a cook is sent with: a compute limit where one is asked for (`execute`), or, for a
   * table a simulation goes through too, wherever `simulate` adds one (`measuring`).
   */
  const sentPrepends = (opts: ExecuteOpts, simulated: boolean): Instruction[] =>
    simulated
      ? measuring(opts.prepends ?? [])
      : [
          ...(opts.computeUnitLimit === undefined
            ? []
            : buildComputeBudgetPrepend({ unitLimit: ENGINE_GAS_LIMIT_CU })),
          ...(opts.prepends ?? []),
        ];

  async function cookLookupTable(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: CookLookupTableOpts = {},
  ): Promise<EnsuredLookupTable | undefined> {
    return lookupTableFor(
      cookInstruction(bytecode, manifest, resolution, opts),
      sentPrepends(opts, true),
      opts,
      false,
    );
  }

  async function stagedCookLookupTable(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: StagedCookLookupTableOpts = {},
  ): Promise<EnsuredLookupTable | undefined> {
    return lookupTableFor(
      await stagedCookInstruction(buffer, manifest, resolution, opts),
      sentPrepends(opts, true),
      opts,
      true,
    );
  }

  /** The table `opts.lookupTable` asks `execute` for, made ready where the cook needs one. */
  const tableOptions = (opts: LookupTableOpts & SimulateOpts): EnsureLookupTableOpts | undefined =>
    opts.lookupTable === false || opts.lookupTables !== undefined
      ? undefined
      : opts.lookupTable === undefined
        ? {}
        : { existing: opts.lookupTable };

  /**
   * Sends a cook through the table `execute` made ready for it, if any: its result names the table,
   * and so does a failure after the table was made, which the payer has paid for and may reuse.
   */
  async function sendThrough(
    table: EnsuredLookupTable | undefined,
    transaction: () => Promise<SignedExecuteTransaction>,
  ): Promise<SendExecuteResult> {
    try {
      const sent = await sendExecute({ rpc, rpcSubscriptions, transaction: await transaction() });

      return table === undefined ? sent : { ...sent, lookupTableAddress: table.lookupTableAddress };
    } catch (error) {
      if (table === undefined || !(error instanceof Error)) throw error;
      throw Object.assign(
        new Error(
          `${error.message} (the cook's lookup table ${table.lookupTableAddress} stays, for a ` +
            "later cook: pass it as lookupTable)",
          { cause: error },
        ),
        { lookupTableAddress: table.lookupTableAddress },
      );
    }
  }

  async function cookTransaction(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: ExecuteOpts = {},
  ): Promise<SignedExecuteTransaction> {
    const prepends = await autoComputeUnitPrepends(
      () =>
        simulate(bytecode, manifest, resolution, {
          prepends: opts.prepends,
          lookupTables: opts.lookupTables,
          appendPayerSigner: opts.appendPayerSigner,
          maxExecutionFee: opts.maxExecutionFee,
        }),
      opts,
    );

    return buildTransaction(bytecode, manifest, resolution, prepends, opts);
  }

  async function stagedCookTransaction(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: ExecuteStagedOpts = {},
  ): Promise<SignedExecuteTransaction> {
    const prepends = await autoComputeUnitPrepends(
      () =>
        simulateStaged(buffer, manifest, resolution, {
          prepends: opts.prepends,
          lookupTables: opts.lookupTables,
          appendPayerSigner: opts.appendPayerSigner,
          expectedSha256: opts.expectedSha256,
          maxExecutionFee: opts.maxExecutionFee,
        }),
      opts,
    );

    return buildStagedTransaction(buffer, manifest, resolution, prepends, opts);
  }

  return {
    payerAddress: payer.address,
    via,
    executionFee: () => fetchExecutionFee(rpc, kitchen),
    ensureLookupTable,
    cookLookupTable,
    stagedCookLookupTable,
    simulate,
    cookTransaction,

    async execute(
      bytecode: Uint8Array,
      manifest: AccountManifest,
      resolution: AccountResolution,
      opts: SendOpts = {},
    ): Promise<SendExecuteResult> {
      const wanted = tableOptions(opts);
      const table =
        wanted === undefined
          ? undefined
          : await lookupTableFor(
              cookInstruction(bytecode, manifest, resolution, opts),
              sentPrepends(opts, false),
              { ...opts, ...wanted },
              false,
            );

      return sendThrough(table, () =>
        cookTransaction(
          bytecode,
          manifest,
          resolution,
          table === undefined ? opts : { ...opts, lookupTables: table.lookupTables },
        ),
      );
    },

    simulateStaged,
    stagedCookTransaction,

    async executeStaged(
      buffer: Address | StagedBuffer,
      manifest: AccountManifest,
      resolution: AccountResolution,
      opts: SendStagedOpts = {},
    ): Promise<SendExecuteResult> {
      const wanted = tableOptions(opts);
      const table =
        wanted === undefined
          ? undefined
          : await lookupTableFor(
              await stagedCookInstruction(buffer, manifest, resolution, opts),
              sentPrepends(opts, false),
              { ...opts, ...wanted },
              true,
            );

      return sendThrough(table, () =>
        stagedCookTransaction(
          buffer,
          manifest,
          resolution,
          table === undefined ? opts : { ...opts, lookupTables: table.lookupTables },
        ),
      );
    },
  };
}
