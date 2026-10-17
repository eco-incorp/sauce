/**
 * The calls an intent's route makes on Solana, built synchronously: the intent lowering
 * (`routes/intent-sugar.ts`) runs inside the synchronous compile, and an intent opened for Solana
 * is encoded there, its route with it.
 *
 * Two routes, as on an EVM destination:
 *
 *  - TOKEN TRANSFERS (`svmTransferRoute`). Each `transfer` pays a wallet: the route creates the
 *    wallet's associated token account for the mint where it does not exist yet (the ATA program's
 *    `CreateIdempotent`, the Portal's executor paying its rent), then `TransferChecked` from the
 *    executor's token account, which the fill funds. No program runs, so no Pot and no fee.
 *  - A PROGRAM (`svmCookRoute`). The Kitchen's `cook` on the Pot the Portal's executor owns under
 *    the zero salt, which every intent's cook through that Portal shares (`portal.ts#svmIntentPot`).
 *    Before it, the route creates that Pot when it does not exist yet (`create_pot`: the Pot's
 *    owner must sign it, and only the Portal signs for its executor, so only a route can), creates
 *    each token account the program names that does not exist yet, and moves what the solver
 *    delivered from the executor's token accounts into the Pot's. The executor pays the Kitchen's
 *    fee.
 *
 * WHAT THE ROUTE DELIVERS IN LAMPORTS. The route's native amount is what its calls spend from the
 * executor: each rent it pays and the Kitchen's fee. Which accounts exist is the caller's to say
 * (`existing`, read from the cluster before building): an account that exists is not created, and
 * its rent is not delivered. The Pot is the one account whose existence must be KNOWN
 * (`potExists`): a `create_pot` for a Pot that exists fails, and so does a cook on one that does
 * not, so the wrong guess either way is a route no solver can fill.
 *
 * THE EXECUTOR STAYS RENT-EXEMPT. A fill that leaves the executor's account with lamports below the
 * rent-exempt minimum of an empty account fails. A token account's rent is exact for SPL Token; for
 * Token-2022 the size depends on the mint's extensions, so the route delivers rent for the largest
 * account a mint's extensions require at creation, and an empty account's rent besides, so what is
 * left over is either nothing or enough.
 *
 * Every derivation here is the memo's (`venues/pda-memo.ts`), synchronously; `portal.ts`'s
 * asynchronous builders derive the same accounts, which `svm-intent-route.test.ts` holds them to.
 */
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  getAddressEncoder,
  type Address,
  type Instruction,
  type ProgramDerivedAddress,
} from "@solana/kit";
import type { AccountManifest } from "sauce-compiler";
import { bytesToHex, type Hex } from "viem";

import type { UniversalAddress } from "../routes/types.js";
import type { ResolvedSvmAccountName } from "./account-names.js";
import { encodePortalCalldataWithAccounts } from "./intent.js";
import {
  buildCookInstruction,
  buildCreatePotInstruction,
  EXECUTION_FEE_SEED,
  MAX_POT_LEN,
  POT_SEED,
} from "./kitchen.js";
import { resolveAccounts, type AccountResolution } from "./resolve.js";
import { TOKEN_2022_PROGRAM_ID } from "./token-program.js";
import {
  memoizedAssociatedTokenAccountSync,
  memoizedFindProgramAddressSync,
} from "./venues/pda-memo.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const keyBytes = (key: Address): Uint8Array => new Uint8Array(getAddressEncoder().encode(key));

/** The salt of the executor's shared Pot: zero, by convention, as on an EVM chain. */
export const SVM_INTENT_POT_SALT = new Uint8Array(32);

/** Rent-exempt lamports for an account of `bytes` of data, at mainnet's rent: 3,480 lamports per
 *  byte-year, two years, over the data and the 128 bytes every account carries. */
export const svmRentExempt = (bytes: number): bigint => BigInt(128 + bytes) * 6_960n;

/** An SPL Token account. */
const SPL_ACCOUNT_BYTES = 165;
/**
 * The largest Token-2022 account its associated-account creation makes: the base, the account-type
 * byte, ImmutableOwner, and the account extensions a mint's extensions require (TransferFeeAmount,
 * PausableAccount, TransferHookAccount, NonTransferableAccount), each with its 4-byte header.
 */
const T22_ACCOUNT_BYTES = 165 + 1 + 4 + (4 + 8) + 4 + (4 + 1) + 4;

/** The Portal's executor, which runs every route's calls: `[b"executor"]` (portal state.rs). */
export function svmIntentExecutor(portal: Address): Address {
  return memoizedFindProgramAddressSync(portal, [text("executor")])[0];
}

/** The Kitchen Pot the Portal's executor owns under `salt` (zero by default). */
export function svmIntentPotOf(input: {
  readonly portal: Address;
  readonly kitchen: Address;
  readonly salt?: Uint8Array;
}): Address {
  return svmIntentPotPda(input)[0];
}

/** {@link svmIntentPotOf}, with the bump a cook on it passes. */
function svmIntentPotPda(input: {
  readonly portal: Address;
  readonly kitchen: Address;
  readonly salt?: Uint8Array;
}): ProgramDerivedAddress {
  return memoizedFindProgramAddressSync(input.kitchen, [
    text(POT_SEED),
    keyBytes(svmIntentExecutor(input.portal)),
    input.salt ?? SVM_INTENT_POT_SALT,
  ]);
}

/** A mint, as a route moves it. */
export interface SvmRouteMint {
  readonly mint: Address;
  /** SPL Token or Token-2022: the program that owns the mint. */
  readonly tokenProgram: Address;
  readonly decimals: number;
}

/** A token the solver delivers to the executor, and how much. */
export interface SvmDelivery extends SvmRouteMint {
  readonly amount: bigint;
}

/** A token transfer to a wallet. */
export interface SvmTransfer extends SvmDelivery {
  /** The wallet paid: its associated token account for the mint is derived, and created if
   *  needed. */
  readonly recipient: Address;
}

/** One call of a route, as the intent records it. */
export interface SvmRouteCall {
  readonly target: UniversalAddress;
  readonly data: Hex;
  readonly value: bigint;
}

/** An account a route creates, and the lamports it delivers for it. */
export interface SvmRouteCreation {
  readonly address: Address;
  readonly what: string;
  readonly lamports: bigint;
}

/** A route for Solana: its calls, what it needs delivered, and what it creates. */
export interface SvmIntentRoute {
  readonly calls: readonly SvmRouteCall[];
  /** Lamports the route's calls spend from the executor: rents, the Kitchen's fee. */
  readonly nativeAmount: bigint;
  /** What the solver delivers to the executor's token accounts, by mint. */
  readonly tokens: readonly { readonly token: UniversalAddress; readonly amount: bigint }[];
  /** Each account the route creates, in order. */
  readonly creates: readonly SvmRouteCreation[];
  /** Each account whose existence decides the route — the Pot of a cook, and each token account
   *  the route would create — with what creating it takes: what a caller reads from the cluster to
   *  give `existing` and `potExists`. */
  readonly accounts: readonly SvmRouteCreation[];
  /** The Pot a cook runs on: the Portal executor's. Absent for a route of transfers. */
  readonly pot?: Address;
}

const universal = (key: Address): UniversalAddress => bytesToHex(keyBytes(key)) as UniversalAddress;

/** The ATA program's `CreateIdempotent`: `owner`'s associated account for the mint, `payer`
 *  paying its rent, nothing done when it exists. */
function createAccountIdempotent(
  payer: Address,
  account: Address,
  owner: Address,
  token: Pick<SvmRouteMint, "mint" | "tokenProgram">,
): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: account, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: token.mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: token.tokenProgram, role: AccountRole.READONLY },
    ],
    data: Uint8Array.of(1),
  };
}

/** `TransferChecked` (12) of `amount` from `source` to `destination`, `authority` signing: both
 *  SPL Token and Token-2022 implement it. */
function transferChecked(
  source: Address,
  destination: Address,
  authority: Address,
  token: SvmDelivery,
): Instruction {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, token.amount, true);
  data[9] = token.decimals;

  return {
    programAddress: token.tokenProgram,
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: token.mint, role: AccountRole.READONLY },
      { address: destination, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}

/**
 * Route calls that run `instructions` as the Portal's `executor`, in order, each committed with
 * the flags the fill transaction will give its accounts: writable where any call writes it, or
 * where the fill writes it itself (`writable`, the executor's token accounts the fill funds), and a
 * signer only where a call needs its signature — never the executor's, which the Portal gives each
 * call. `portal.ts#svmRouteCalls` is this, its accounts derived for it.
 */
export function svmRouteCallsFor(
  executor: Address,
  instructions: readonly Instruction[],
  writable: Iterable<Address> = [],
): SvmRouteCall[] {
  const written = new Set<string>(writable);
  const signers = new Set<string>();
  for (const instruction of instructions) {
    for (const meta of instruction.accounts ?? []) {
      if (!("address" in meta)) throw new Error("a route call cannot use a lookup table");
      if (meta.role === AccountRole.WRITABLE || meta.role === AccountRole.WRITABLE_SIGNER) {
        written.add(meta.address);
      }
      if (
        (meta.role === AccountRole.READONLY_SIGNER || meta.role === AccountRole.WRITABLE_SIGNER) &&
        meta.address !== executor
      ) {
        signers.add(meta.address);
      }
    }
  }

  return instructions.map((instruction) => ({
    target: universal(instruction.programAddress),
    data: encodePortalCalldataWithAccounts({
      instructionData: new Uint8Array(instruction.data ?? new Uint8Array()),
      accounts: (instruction.accounts ?? []).map((meta) => ({
        pubkey: meta.address,
        isSigner: signers.has(meta.address),
        isWritable: written.has(meta.address),
      })),
    }),
    value: 0n,
  }));
}

/** What a route delivers, summed per mint in first-seen order. */
function deliveries(tokens: readonly SvmDelivery[]): SvmDelivery[] {
  const byMint = new Map<string, SvmDelivery>();
  for (const token of tokens) {
    const seen = byMint.get(token.mint);
    byMint.set(
      token.mint,
      seen === undefined ? token : { ...seen, amount: seen.amount + token.amount },
    );
  }

  return [...byMint.values()];
}

/** Collects the token accounts a route creates where they do not exist, with their rent. */
class Creations {
  readonly creates: SvmRouteCreation[] = [];
  readonly accounts: SvmRouteCreation[] = [];
  readonly instructions: Instruction[] = [];
  private readonly seen = new Set<string>();
  private token2022 = false;

  constructor(
    private readonly executor: Address,
    private readonly existing: ReadonlySet<string>,
  ) {}

  /** `owner`'s account for `token`, created by the route unless it exists. */
  account(owner: Address, token: Pick<SvmRouteMint, "mint" | "tokenProgram">, what: string) {
    const account = memoizedAssociatedTokenAccountSync({
      owner,
      mint: token.mint,
      tokenProgram: token.tokenProgram,
    });
    if (this.seen.has(account)) return account;
    this.seen.add(account);
    const t22 = token.tokenProgram === TOKEN_2022_PROGRAM_ID;
    const lamports = svmRentExempt(t22 ? T22_ACCOUNT_BYTES : SPL_ACCOUNT_BYTES);
    this.accounts.push({ address: account, what, lamports });
    if (this.existing.has(account)) return account;
    this.token2022 ||= t22;
    this.creates.push({ address: account, what, lamports });
    this.instructions.push(createAccountIdempotent(this.executor, account, owner, token));

    return account;
  }

  /** The lamports the creations take, with an empty account's rent where a Token-2022 account's
   *  size was an upper bound (see the module's notes). */
  lamports(): bigint {
    return (
      this.creates.reduce((sum, created) => sum + created.lamports, 0n) +
      (this.token2022 ? svmRentExempt(0) : 0n)
    );
  }
}

/** The route of an intent whose body is token transfers to wallets on Solana. */
export function svmTransferRoute(input: {
  readonly portal: Address;
  readonly transfers: readonly SvmTransfer[];
  /** Accounts that exist already, which the route does not create (read from the cluster). */
  readonly existing?: ReadonlySet<string>;
}): SvmIntentRoute {
  const executor = svmIntentExecutor(input.portal);
  const creations = new Creations(executor, input.existing ?? new Set());
  const moves: Instruction[] = [];
  for (const transfer of input.transfers) {
    const to = creations.account(
      transfer.recipient,
      transfer,
      `${transfer.recipient}'s token account for ${transfer.mint}`,
    );
    const from = memoizedAssociatedTokenAccountSync({
      owner: executor,
      mint: transfer.mint,
      tokenProgram: transfer.tokenProgram,
    });
    moves.push(transferChecked(from, to, executor, transfer));
  }
  const delivered = deliveries(input.transfers);

  return {
    calls: svmRouteCallsFor(
      executor,
      [...creations.instructions, ...moves],
      delivered.map((token) =>
        memoizedAssociatedTokenAccountSync({
          owner: executor,
          mint: token.mint,
          tokenProgram: token.tokenProgram,
        }),
      ),
    ),
    nativeAmount: creations.lamports(),
    tokens: delivered.map((token) => ({ token: universal(token.mint), amount: token.amount })),
    creates: creations.creates,
    accounts: creations.accounts,
  };
}

/** The route of an intent whose body is a program, cooked on the executor's Pot. */
export function svmCookRoute(input: {
  readonly portal: Address;
  readonly kitchen: Address;
  readonly engine: Address;
  readonly bytecode: Uint8Array;
  readonly manifest: AccountManifest;
  /** Each of the manifest's slots, resolved (`resolveSvmAccountNameSync`, the Pot its `pot` and
   *  the executor its `owner`). */
  readonly accounts: Readonly<Record<string, ResolvedSvmAccountName>>;
  /** The Kitchen's fee, which the executor pays and the route delivers. */
  readonly executionFee: bigint;
  /** What the solver delivers, moved from the executor's token accounts into the Pot's. */
  readonly delivered: readonly SvmDelivery[];
  /** Whether the executor's Pot exists: when it does not, the route creates it. */
  readonly potExists: boolean;
  readonly existing?: ReadonlySet<string>;
}): SvmIntentRoute {
  const executor = svmIntentExecutor(input.portal);
  const [pot, potBump] = svmIntentPotPda(input);
  const creations = new Creations(executor, input.existing ?? new Set());
  const potRent = svmRentExempt(MAX_POT_LEN);
  const potCreation = { address: pot, what: "the Portal executor's Pot", lamports: potRent };
  const head: Instruction[] = input.potExists
    ? []
    : [
        buildCreatePotInstruction({
          kitchen: input.kitchen,
          owner: executor,
          engineProgram: input.engine,
          pot,
          salt: SVM_INTENT_POT_SALT,
          space: MAX_POT_LEN,
        }),
      ];
  const delivered = deliveries(input.delivered);
  const moves = delivered.map((token) =>
    transferChecked(
      memoizedAssociatedTokenAccountSync({
        owner: executor,
        mint: token.mint,
        tokenProgram: token.tokenProgram,
      }),
      creations.account(pot, token, `the Pot's token account for ${token.mint}`),
      executor,
      token,
    ),
  );
  if (input.manifest.accounts.some((entry) => entry.kind !== "slot")) {
    throw new Error(
      "the program takes a variable list of accounts after its named ones, which an intent's " +
        "route cannot attach: name each account it takes",
    );
  }
  const resolution: AccountResolution = {};
  for (const entry of input.manifest.accounts) {
    if (entry.kind !== "slot") continue;
    const resolved = input.accounts[entry.name];
    if (resolved === undefined) throw new Error(`no account is given for ${entry.name}`);
    if (resolved.account !== undefined) {
      creations.account(
        resolved.account.holder,
        { mint: resolved.account.mint, tokenProgram: resolved.account.program },
        resolved.label ?? `${resolved.account.holder}'s token account`,
      );
    }
    resolution[entry.name] =
      resolved.value === "pot"
        ? // The Kitchen signs for the Pot.
          { address: pot, signer: false }
        : resolved.value === "owner"
          ? executor
          : resolved.value;
  }
  const feeConfig = memoizedFindProgramAddressSync(input.kitchen, [text(EXECUTION_FEE_SEED)])[0];
  const cook = buildCookInstruction({
    kitchen: input.kitchen,
    owner: executor,
    engineProgram: input.engine,
    potSalt: SVM_INTENT_POT_SALT,
    pot,
    potBump,
    feeConfig,
    bytecode: input.bytecode,
    maxExecutionFee: input.executionFee,
    feePayer: executor,
    tail: resolveAccounts(input.manifest, resolution, executor),
  });

  return {
    calls: svmRouteCallsFor(
      executor,
      [...head, ...creations.instructions, ...moves, cook],
      delivered.map((token) =>
        memoizedAssociatedTokenAccountSync({
          owner: executor,
          mint: token.mint,
          tokenProgram: token.tokenProgram,
        }),
      ),
    ),
    nativeAmount: (input.potExists ? 0n : potRent) + creations.lamports() + input.executionFee,
    tokens: delivered.map((token) => ({ token: universal(token.mint), amount: token.amount })),
    creates: [...(input.potExists ? [] : [potCreation]), ...creations.creates],
    accounts: [potCreation, ...creations.accounts],
    pot,
  };
}
