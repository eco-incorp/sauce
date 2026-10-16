/**
 * The Solana half of an intent SOLANA published: its reward escrowed in a vault of Solana's Portal,
 * read back (what the vault holds, the proof the reward's prover recorded, whether it was claimed),
 * and the transactions that move it — the publication with its funding, the claim (`withdraw`) and
 * the refund — as unsigned Solana transactions, the fee payer's signature left empty. Its fill,
 * proof and cancellation happen on the EVM destination, through `lifecycle.ts`.
 *
 * `lifecycle.ts` calls these where the source is Solana, and returns them in the same plans; like
 * it, this holds no key, store, prompt or environment, and reads only the endpoints it is given.
 * The instructions are `svm/portal-source.ts`'s.
 */
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import {
  AccountRole,
  address,
  getBase58Encoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address as SvmAddress,
  type Instruction,
} from "@solana/kit";
import { bytesToHex, concat, keccak256, type Hex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { decodeRouteEvm, hashIntent } from "../routes/encode.js";
import type { RewardStatus } from "../routes/portal.js";
import { SVM_TOKEN_REGISTRY } from "../routes/token-registry.js";
import type { Intent } from "../routes/types.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAccount,
  PORTAL_DISCRIMINATORS,
  SVM_CANCELLED_CLAIMANT,
  SYSTEM_PROGRAM_ID,
  svmKeyOf,
} from "../svm/portal.js";
import {
  buildPortalFundInstruction,
  buildPortalPublishInstruction,
  buildPortalRefundInstruction,
  buildPortalWithdrawInstruction,
  decodeHyperWhitelist,
  decodePortalPublish,
  decodeSvmProof,
  PORTAL_SOURCE_DISCRIMINATORS,
  SOLANA_CHAIN_ID,
  svmHyperConfigPda,
  svmProofPda,
  svmRewardTokens,
  svmVaultPda,
  svmWithdrawnMarkerPda,
  type SvmTokenPrograms,
} from "../svm/portal-source.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";
import { CliError } from "./args.js";
import {
  dispatchesDiscriminator,
  programCode,
  rehearseSvm,
  svmTime,
  svmTransaction,
  tokenAccountAmount,
  type SvmRpc,
  type SvmTxJson,
} from "./lifecycle-svm.js";

async function ask<T>(what: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    // The transport's message can name the endpoint, which may carry a key: never print one.
    const reason =
      error instanceof Error ? error.message.replace(/[a-z][\w+.-]*:\/\/\S+/gi, "<endpoint>") : "";
    throw new CliError(`reading ${what} from Solana failed${reason === "" ? "" : `: ${reason}`}`, {
      cause: error,
    });
  }
}

interface Account {
  readonly data: Uint8Array;
  readonly owner: string;
  readonly executable: boolean;
  readonly lamports: bigint;
}

/** Several accounts at once, each `null` where there is none. */
async function accounts(
  rpc: SvmRpc,
  keys: readonly SvmAddress[],
  what: string,
): Promise<Array<Account | null>> {
  if (keys.length === 0) return [];
  const { value } = await ask(what, () =>
    rpc.getMultipleAccounts([...keys], { encoding: "base64", commitment: "confirmed" }).send(),
  );

  return value.map((entry) =>
    entry === null
      ? null
      : {
          data: new Uint8Array(
            getBase64Encoder().encode((entry.data as readonly [string, string])[0]),
          ),
          owner: entry.owner,
          executable: entry.executable,
          lamports: BigInt(entry.lamports),
        },
  );
}

/** A registered mint's symbol and decimals, where the registry has it. */
const registered = (mint: string) =>
  SVM_TOKEN_REGISTRY["mainnet-beta"].find((row) => row.mint === mint);

/** The decimals a mint account records (SPL layout, Token-2022's base too). */
const mintDecimals = (data: Uint8Array | undefined): number | undefined =>
  data === undefined || data.length < 45 ? undefined : data[44];

// ---------------------------------------------------------------------------------------------
// Where it stands
// ---------------------------------------------------------------------------------------------

/** One reward leg, as the vault holds it. */
export interface SvmVaultHold {
  readonly token: string | "native";
  readonly symbol?: string;
  readonly decimals?: number;
  readonly holds: bigint;
  readonly reward: bigint;
  /** The mint's token program, and the vault's account for it (absent when it was never opened,
   *  or a refund closed it). */
  readonly program?: SvmAddress;
  readonly account?: SvmAddress;
  readonly open: boolean;
}

/** What Solana's Portal and the reward's prover hold of an intent Solana published. */
export interface SvmSourceRead {
  readonly portal: SvmAddress;
  readonly vault: SvmAddress;
  /** As an EVM Portal words it: `Withdrawn` once claimed (its marker written), `Refunded` once a
   *  vault that held something holds nothing, `Funded` while it holds the reward, else `Initial`.
   *  Solana's Portal keeps no status of its own: these are read from the accounts. */
  readonly status: RewardStatus;
  readonly funded: boolean;
  readonly holds: readonly SvmVaultHold[];
  /** The proof the reward's prover recorded: the chain filled on, and the claimant — a Solana
   *  key, or the cancellation sentinel's bytes. */
  readonly proof: {
    readonly claimant: string;
    readonly destination: bigint;
    readonly cancelled: boolean;
  } | null;
  readonly tokenPrograms: SvmTokenPrograms;
  /** Whether `withdraw` refuses a proven cancellation (`IntentCancelled`): a Portal with
   *  `cancel`, which shipped with it. */
  readonly refusesCancelledClaimant: boolean;
  readonly time: bigint;
}

/** Solana's Portal's view of `intent`, Solana its source, through `portal`. */
export async function readSvmSource(
  rpc: SvmRpc,
  intent: Intent,
  portal: SvmAddress,
): Promise<SvmSourceRead> {
  const { intentHash } = hashIntent(intent);
  const prover = svmKeyOf(intent.reward.prover);
  const vault = await svmVaultPda(portal, intentHash);
  const legs = svmRewardTokens(intent.reward);
  // Everything in one read, the program's code beside it: each mint, and the vault's account for
  // it under either token program, since which one owns the mint is not known yet.
  const [read, code] = await Promise.all([
    accounts(
      rpc,
      [
        portal,
        await svmProofPda(prover, intentHash),
        await svmWithdrawnMarkerPda(portal, intentHash),
        vault,
        ...legs.map((leg) => leg.mint),
        ...(await tokenAccountsOf(vault, legs)),
      ],
      "the intent's vault, proof and marker",
    ),
    programCode(rpc, portal),
  ]);
  const [program, proof, marker, vaultAccount] = read;
  const mints = read.slice(4, 4 + legs.length);
  const candidates = read.slice(4 + legs.length);
  if (program === null || program === undefined || !program.executable) {
    throw new CliError(`the source Portal ${portal} is not a program on Solana`);
  }
  const tokenPrograms: Record<string, SvmAddress> = {};
  const held: Array<Account | null | undefined> = [];
  const opened = await Promise.all(
    legs.map(async (leg, index) => {
      const mint = mints[index];
      if (mint === null || mint === undefined) {
        throw new CliError(`the reward's mint ${leg.mint} does not exist on Solana`);
      }
      const owner = address(mint.owner);
      if (owner !== TOKEN_PROGRAM_ID && owner !== TOKEN_2022_PROGRAM_ID) {
        throw new CliError(`the reward's mint ${leg.mint} is owned by ${owner}, no token program`);
      }
      tokenPrograms[leg.mint] = owner;
      held[index] = candidates[2 * index + (owner === TOKEN_PROGRAM_ID ? 0 : 1)];

      return {
        leg,
        owner,
        decimals: mintDecimals(mint.data),
        held: await associatedTokenAccount(vault, leg.mint, owner),
      };
    }),
  );
  const holds: SvmVaultHold[] = [
    ...(intent.reward.nativeAmount > 0n
      ? [
          {
            token: "native" as const,
            symbol: "SOL",
            decimals: 9,
            holds: vaultAccount?.lamports ?? 0n,
            reward: intent.reward.nativeAmount,
            open: vaultAccount !== null,
          },
        ]
      : []),
    ...opened.map(({ leg, owner, decimals, held: account }, index) => {
      const row = registered(leg.mint);

      return {
        token: leg.mint,
        ...(row === undefined ? {} : { symbol: row.symbol }),
        ...(decimals === undefined ? {} : { decimals }),
        holds: tokenAccountAmount(held[index]?.data),
        reward: leg.amount,
        program: owner,
        account,
        open: held[index] !== null,
      };
    }),
  ];
  const decoded =
    proof === null || proof === undefined || proof.owner !== prover
      ? null
      : decodeSvmProof(proof.data);
  const funded = holds.every((entry) => entry.holds >= entry.reward);
  // The Portal's own marker, as `refund` reads it (its data, not the address's lamports): a
  // transfer to the marker's address is no claim.
  const withdrawn =
    marker !== null &&
    marker !== undefined &&
    marker.owner === portal &&
    PORTAL_SOURCE_DISCRIMINATORS.withdrawnMarker.every(
      (byte, index) => marker.data[index] === byte,
    );
  const empty = holds.every((entry) => entry.holds === 0n);
  // Solana's Portal records no refund: a vault some transaction touched that holds nothing now,
  // and was not claimed, was refunded.
  const touched =
    !withdrawn && empty && holds.length > 0
      ? (
          await ask("the vault's history", () =>
            rpc.getSignaturesForAddress(vault, { limit: 1 }).send(),
          )
        ).length > 0
      : false;

  return {
    portal,
    vault,
    status: withdrawn ? "Withdrawn" : touched ? "Refunded" : funded ? "Funded" : "Initial",
    funded,
    holds,
    proof:
      decoded === null
        ? null
        : {
            claimant:
              decoded.claimant.toLowerCase() === SVM_CANCELLED_CLAIMANT
                ? decoded.claimant
                : svmKeyOf(decoded.claimant),
            destination: decoded.destination,
            cancelled: decoded.claimant.toLowerCase() === SVM_CANCELLED_CLAIMANT,
          },
    tokenPrograms,
    refusesCancelledClaimant:
      code !== undefined && dispatchesDiscriminator(code, PORTAL_DISCRIMINATORS.cancel),
    time: await svmTime(rpc),
  };
}

/** `owner`'s associated token account for each leg's mint under SPL Token, then under
 *  Token-2022: two candidates a mint, read before its program is known. */
async function tokenAccountsOf(
  owner: SvmAddress,
  legs: ReadonlyArray<{ readonly mint: SvmAddress }>,
): Promise<SvmAddress[]> {
  const out: SvmAddress[] = [];
  for (const { mint } of legs) {
    out.push(
      await associatedTokenAccount(owner, mint, TOKEN_PROGRAM_ID),
      await associatedTokenAccount(owner, mint, TOKEN_2022_PROGRAM_ID),
    );
  }

  return out;
}

/** Whether Solana's HyperProver takes a proof from `sender` (32 bytes): `undefined` where its
 *  whitelist cannot be read. */
export async function svmHyperTrusts(
  rpc: SvmRpc,
  hyperProver: SvmAddress,
  sender: Hex,
): Promise<boolean | undefined> {
  const [config] = await accounts(
    rpc,
    [await svmHyperConfigPda(hyperProver)],
    "the HyperProver's whitelist",
  );
  if (config === null || config === undefined || config.owner !== hyperProver) return undefined;
  const whitelist = decodeHyperWhitelist(config.data);

  return whitelist === null
    ? undefined
    : whitelist.some((entry) => entry.toLowerCase() === sender.toLowerCase());
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

/** The Associated Token Account program's `CreateIdempotent`: `owner`'s account for `mint`,
 *  created when absent, by `payer`. */
async function openTokenAccount(
  payer: SvmAddress,
  owner: SvmAddress,
  mint: SvmAddress,
  program: SvmAddress,
): Promise<Instruction> {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: await associatedTokenAccount(owner, mint, program), role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: program, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  };
}

/** What a funder holds of each reward leg, against what the reward names. */
export interface SvmFunderHold {
  readonly token: string | "native";
  readonly symbol?: string;
  readonly decimals?: number;
  readonly holds: bigint;
  readonly reward: bigint;
}

/**
 * The publication of `intent` from `from`, which funds it, as two transactions to send in order:
 * `fund` (the reward moved into the intent's vault, the vault's token accounts opened as needed;
 * refused unless the whole reward arrives), then `publish` (the intent announced,
 * `IntentPublished`). Two because together they are past Solana's transaction size for the
 * smallest route: `publish` carries the route whole, and `fund` the reward again. A `publish` that
 * fails after its `fund` leaves the reward in the vault, where publishing again or a refund after
 * the reward's deadline recovers it. Each is simulated: `ok` false, with the reason, where the
 * cluster would refuse one (`publish` reads nothing, so it is simulated alone).
 */
export async function svmPublishPlan(
  rpc: SvmRpc,
  chain: CanonicalChain,
  intent: Intent,
  portal: SvmAddress,
  from: SvmAddress,
): Promise<{
  readonly transactions: readonly [SvmTxJson, SvmTxJson];
  readonly vault: SvmAddress;
  readonly funder: readonly SvmFunderHold[];
  readonly ok: boolean;
  readonly reason?: string;
  readonly notes: readonly string[];
}> {
  const { intentHash } = hashIntent(intent);
  const legs = svmRewardTokens(intent.reward);
  // One read: the funder, each mint, and the funder's account for it under either token program.
  const read = await accounts(
    rpc,
    [from, ...legs.map((leg) => leg.mint), ...(await tokenAccountsOf(from, legs))],
    "the reward's mints and the funder's balances",
  );
  const payer = read[0];
  const mints = read.slice(1, 1 + legs.length);
  const candidates = read.slice(1 + legs.length);
  const tokenPrograms: Record<string, SvmAddress> = {};
  const held = legs.map((leg, index) => {
    const mint = mints[index];
    if (mint === null || mint === undefined) {
      throw new CliError(`the reward's mint ${leg.mint} does not exist on Solana`);
    }
    tokenPrograms[leg.mint] = address(mint.owner);

    return candidates[2 * index + (mint.owner === TOKEN_PROGRAM_ID ? 0 : 1)];
  });
  const funder: SvmFunderHold[] = [
    ...(intent.reward.nativeAmount > 0n
      ? [
          {
            token: "native" as const,
            symbol: "SOL",
            decimals: 9,
            holds: payer?.lamports ?? 0n,
            reward: intent.reward.nativeAmount,
          },
        ]
      : []),
    ...legs.map((leg, index) => {
      const row = registered(leg.mint);
      const decimals = mintDecimals(mints[index]?.data);

      return {
        token: leg.mint,
        ...(row === undefined ? {} : { symbol: row.symbol }),
        ...(decimals === undefined ? {} : { decimals }),
        holds: tokenAccountAmount(held[index]?.data),
        reward: leg.amount,
      };
    }),
  ];
  const notes = funder
    .filter((entry) => entry.holds < entry.reward)
    .map(
      (entry) =>
        `${from} holds ${entry.holds} of ${entry.symbol ?? entry.token} (base units), and the ` +
        `reward is ${entry.reward}: the funding fails until it holds enough`,
    );
  const vault = await svmVaultPda(portal, intentHash);
  const fund = await svmTransaction(
    rpc,
    chain,
    from,
    [
      getSetComputeUnitLimitInstruction({ units: 100_000 + 60_000 * legs.length }),
      await buildPortalFundInstruction({ intent, portal, payer: from, tokenPrograms }),
    ],
    `Portal.fund(${intent.destination}, routeHash, reward): the reward into the vault ${vault}`,
  );
  let publish: SvmTxJson;
  try {
    publish = await svmTransaction(
      rpc,
      chain,
      from,
      [
        getSetComputeUnitLimitInstruction({ units: 100_000 }),
        buildPortalPublishInstruction({ intent, portal }),
      ],
      `Portal.publish(${intent.destination}, route, reward): intent ${intentHash}`,
    );
  } catch (error) {
    throw new CliError(
      `${(error as Error).message}. Solana's Portal takes the route whole in one instruction, so ` +
        "an intent from Solana carries a route small enough for one transaction: plain token " +
        "transfers, not a program",
    );
  }
  const simulations = [await rehearseSvm(rpc, fund, []), await rehearseSvm(rpc, publish, [])];
  const failed = simulations.find((simulation) => !simulation.ok);

  return {
    transactions: [fund, publish],
    vault,
    funder,
    ok: failed === undefined,
    ...(failed?.reason === undefined ? {} : { reason: failed.reason }),
    notes,
  };
}

/**
 * The claim of `intent`'s reward on Solana, from `from`, which pays the fee: the claimant's token
 * accounts opened where absent (`withdraw` pays into them and creates none), then `withdraw`,
 * which pays the claimant the prover recorded and closes the proof.
 */
export async function svmClaimTransaction(
  rpc: SvmRpc,
  chain: CanonicalChain,
  intent: Intent,
  read: SvmSourceRead,
  claimant: SvmAddress,
  from: SvmAddress,
): Promise<SvmTxJson> {
  const open: Instruction[] = [];
  for (const { mint } of svmRewardTokens(intent.reward)) {
    open.push(await openTokenAccount(from, claimant, mint, read.tokenPrograms[mint]!));
  }
  const withdraw = await buildPortalWithdrawInstruction({
    intent,
    portal: read.portal,
    payer: from,
    claimant,
    tokenPrograms: read.tokenPrograms,
  });

  return svmTransaction(
    rpc,
    chain,
    from,
    [
      getSetComputeUnitLimitInstruction({ units: 200_000 + 60_000 * open.length }),
      ...open,
      withdraw,
    ],
    `Portal.withdraw(${intent.destination}, routeHash, reward) on ${chain.slug}: pays ${claimant}`,
  );
}

/**
 * The refund of `intent`'s reward on Solana, from `from`, which pays the fee: the creator's token
 * accounts opened where absent, then `refund`, draining every vault token account still open (and
 * closing it, its rent to `from`) and the vault's lamports to the creator; for a proven
 * cancellation, the proof closed too.
 */
export async function svmRefundTransaction(
  rpc: SvmRpc,
  chain: CanonicalChain,
  intent: Intent,
  read: SvmSourceRead,
  from: SvmAddress,
): Promise<SvmTxJson> {
  const creator = svmKeyOf(intent.reward.creator);
  const mints = read.holds
    .filter((entry) => entry.token !== "native" && entry.open)
    .map((entry) => address(entry.token));
  const open: Instruction[] = [];
  for (const mint of mints) {
    open.push(await openTokenAccount(from, creator, mint, read.tokenPrograms[mint]!));
  }
  const closesProof =
    read.proof !== null && read.proof.cancelled && read.proof.destination === intent.destination;
  const refund = await buildPortalRefundInstruction({
    intent,
    portal: read.portal,
    payer: from,
    mints,
    tokenPrograms: read.tokenPrograms,
    closesProof,
  });

  return svmTransaction(
    rpc,
    chain,
    from,
    [getSetComputeUnitLimitInstruction({ units: 200_000 + 60_000 * open.length }), ...open, refund],
    `Portal.refund(${intent.destination}, routeHash, reward) on ${chain.slug}: returns the vault's ` +
      `holdings to the creator ${creator}`,
  );
}

// ---------------------------------------------------------------------------------------------
// The intents a transaction published
// ---------------------------------------------------------------------------------------------

/** An intent hash an `IntentPublished` the Portal logged names (`Program data: <base64>`, the
 *  event's discriminator then the hash). */
function loggedPublished(logs: readonly string[]): Set<string> {
  const hashes = new Set<string>();
  for (const line of logs) {
    const found = /^Program data: (\S+)$/.exec(line);
    if (found === null) continue;
    const data = new Uint8Array(getBase64Encoder().encode(found[1]!));
    const head = PORTAL_SOURCE_DISCRIMINATORS.intentPublished;
    if (data.length >= 40 && head.every((byte, index) => data[index] === byte)) {
      hashes.add(bytesToHex(data.subarray(8, 40)));
    }
  }

  return hashes;
}

/** One instruction a transaction ran: its program, and its data. */
export interface SvmRanInstruction {
  readonly program: string;
  readonly data: Uint8Array;
}

/** Every instruction of a base64 transaction, and those its programs invoked (`inner`, as a node
 *  reports them, data in base58). */
export function ranInstructions(
  transaction: string,
  loaded:
    { readonly writable: readonly string[]; readonly readonly: readonly string[] } | undefined,
  inner:
    | ReadonlyArray<{
        readonly instructions: ReadonlyArray<{
          readonly programIdIndex: number;
          readonly data: string;
        }>;
      }>
    | undefined,
): SvmRanInstruction[] {
  const decoded = getTransactionDecoder().decode(
    new Uint8Array(getBase64Encoder().encode(transaction)),
  );
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes) as {
    readonly staticAccounts: readonly string[];
    readonly instructions: ReadonlyArray<{
      readonly programAddressIndex: number;
      readonly data?: Uint8Array;
    }>;
  };
  const keys = [
    ...message.staticAccounts,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ];
  const base58 = getBase58Encoder();

  return [
    ...message.instructions.map((instruction) => ({
      program: keys[instruction.programAddressIndex] ?? "",
      data: instruction.data ?? new Uint8Array(),
    })),
    ...(inner ?? []).flatMap((group) =>
      group.instructions.map((instruction) => ({
        program: keys[instruction.programIdIndex] ?? "",
        data: new Uint8Array(base58.encode(instruction.data)),
      })),
    ),
  ];
}

/** The intents `instructions` published through `portal`, each rebuilt from its `publish` and
 *  checked against the hash the Portal logged for it. */
export function svmPublishedIntents(
  instructions: readonly SvmRanInstruction[],
  portal: SvmAddress,
  logs: readonly string[],
): Intent[] {
  const logged = loggedPublished(logs);
  const intents: Intent[] = [];
  for (const instruction of instructions) {
    if (instruction.program !== portal) continue;
    const published = decodePortalPublish(instruction.data);
    if (published === null) continue;
    let intent: Intent;
    try {
      intent = {
        sourceChainId: SOLANA_CHAIN_ID,
        destination: published.destination,
        route: decodeRouteEvm(published.route),
        reward: published.reward,
      };
    } catch {
      // A route this does not read: one for a destination other than an EVM chain.
      continue;
    }
    // The Portal hashed the route as it was given; re-encoding must give the same bytes.
    const { intentHash, routeHash } = hashIntent(intent);
    if (routeHash !== keccak256(published.route)) continue;
    if (!logged.has(intentHash)) {
      throw new CliError(
        `the transaction published an intent this rebuilds as ${intentHash}, which the Portal did ` +
          "not log: refused",
      );
    }
    intents.push(intent);
  }

  return intents;
}

/** What one Portal instruction on Solana did to the intent it names, Solana its source:
 *  `fund`, `withdraw`, `refund`, by the intent's hash (rebuilt from the arguments). */
export function svmSourceInstruction(
  data: Uint8Array,
): { readonly event: "funded" | "claimed" | "refunded"; readonly intentHash: Hex } | undefined {
  const is = (head: Uint8Array): boolean =>
    data.length >= head.length && head.every((byte, index) => data[index] === byte);
  const event = is(PORTAL_SOURCE_DISCRIMINATORS.fund)
    ? "funded"
    : is(PORTAL_SOURCE_DISCRIMINATORS.withdraw)
      ? "claimed"
      : is(PORTAL_SOURCE_DISCRIMINATORS.refund)
        ? "refunded"
        : undefined;
  if (event === undefined || data.length < 8 + 8 + 32 + 8 + 32 + 32 + 8 + 4) return undefined;
  // `(destination: u64, route_hash, reward)`: the reward is Borsh, its token list sized by a u32
  // count of 40-byte entries, after deadline, creator, prover and the native amount.
  const rewardAt = 8 + 8 + 32;
  const count = new DataView(data.buffer, data.byteOffset + rewardAt + 80, 4).getUint32(0, true);
  const rewardEnd = rewardAt + 84 + 40 * count;
  if (data.length < rewardEnd) return undefined;
  const destination = data.subarray(8, 16).slice().reverse();

  return {
    event,
    intentHash: keccak256(
      concat([
        bytesToHex(destination),
        bytesToHex(data.subarray(16, 48)),
        keccak256(data.subarray(rewardAt, rewardEnd)),
      ]),
    ),
  };
}
