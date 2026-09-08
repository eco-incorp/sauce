/**
 * CPI-acceptance probe — a prepare-time classifier that sorts a venue into the
 * prop-AMM tiers P-A / P-B / P-C BEFORE any adapter effort or admission (the
 * SVM analog of the EVM Metric/Tessera probing discipline). It never lands a
 * swap.
 *
 * The problem: every Solana prop-AMM integrates with aggregators via a
 * PERMISSIONED off-chain quote SDK, which says NOTHING about whether the swap
 * program accepts a CPI from an arbitrary caller (the engine's `CALL`). Two
 * signals answer that:
 *
 *  1. STATIC SCREEN (free, from the swap's account list): the presence of the
 *     Instructions sysvar (`Sysvar1nstructions…`) means the program
 *     introspects the enclosing transaction (router-path / anti-sandwich /
 *     caller gating) ⇒ CPI-hostile (candidate P-C). A signer other than the
 *     user (a maker seat, an oracle writer) is likewise a gating candidate.
 *     NEITHER verdict is definitive — step 2 decides. `PRESENT` is a P-C
 *     *candidate*, not a hard signal: a program can read the sysvar to price a
 *     caller **fee tier** rather than to reject, in which case an unrecognized
 *     caller's CPI succeeds and merely pays the worst tier (measured on ZeroFi
 *     — see docs/svm-venues.md). `absent` is likewise
 *     necessary-but-not-sufficient.
 *
 *  2. UNRECOGNIZED-CALLER SIMULATION (the definitive test): build the venue
 *     swap ix from an address the venue has never seen (wrapped in a non-router
 *     caller — here, `simulateTransaction` with `sigVerify:false` +
 *     `replaceRecentBlockhash`, the same lane as quoteSim.ts), a tiny input,
 *     `minOut=1`, funded scratch out-ATA. Classify by the out-ATA delta:
 *       ACCEPT  — success, delta > 0                         → P-A/P-B
 *       REJECT  — custom error / caller/owner/missing-acct   → P-C
 *       DEGRADE — success but delta materially below the     → P-C-with-penalty
 *                 venue's own quote for the size (adverse       (external lane only)
 *                 fill for "unrecognized" flow)
 *
 * The terminal realized-delta `minOut` on the out-ATA backstops ALL tiers
 * regardless of the verdict — the probe only decides ADMISSION (does a slot
 * enter the in-VM split, or stay an off-chain best-scan candidate, or drop).
 * See docs/svm-venues.md for the ranked ledger and per-venue evidence.
 */
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type {
  Address,
  Blockhash,
  GetAccountInfoApi,
  Instruction,
  Rpc,
  SimulateTransactionApi,
  TransactionSigner,
} from "@solana/kit";
import { readUintLE } from "./venues/math.js";

/** The instructions sysvar — its presence in a swap's account list = introspection. */
export const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111" as Address;

/** Prop-AMM integrability tier (see the module doc + docs/svm-venues.md). */
export type CpiTier = "P-A" | "P-B" | "P-C";

/** One account of a venue swap, for the static screen (address + signer flag). */
export interface ScreenAccount {
  address?: Address;
  signer?: boolean;
}

export interface StaticScreenInput {
  /** The venue swap's ordered accounts. */
  accounts: readonly ScreenAccount[];
  /** The user's own signer (owner) — the ONLY permitted signer; others are gating candidates. */
  userSigner?: Address;
}

export interface StaticScreen {
  /** The Instructions sysvar rides the account list ⇒ the swap introspects. */
  introspects: boolean;
  /** Signer accounts that are NOT the user (maker seats / oracle writers). */
  foreignSigners: Address[];
  /** P-C when introspecting or foreign-signed; else P-A candidate (needs the sim to confirm). */
  candidateTier: "P-A" | "P-C";
  /** Human-readable reasons feeding the ledger. */
  reasons: string[];
}

/**
 * The free static screen over a swap's account list. `introspects` /
 * foreign-signer ⇒ hard P-C candidate; otherwise the pool is a P-A candidate
 * that the unrecognized-caller simulation confirms.
 */
export function staticCpiScreen(input: StaticScreenInput): StaticScreen {
  const reasons: string[] = [];
  let introspects = false;
  const foreignSigners: Address[] = [];
  for (const account of input.accounts) {
    if (account.address === INSTRUCTIONS_SYSVAR) {
      introspects = true;
      reasons.push("carries the Instructions sysvar (transaction introspection)");
    }
    if (account.signer && account.address !== undefined && account.address !== input.userSigner) {
      foreignSigners.push(account.address);
      reasons.push(`requires a non-user signer ${account.address} (maker seat / oracle writer)`);
    }
  }
  const candidateTier: "P-A" | "P-C" = introspects || foreignSigners.length > 0 ? "P-C" : "P-A";
  if (candidateTier === "P-A")
    reasons.push(
      "no introspection, no foreign signer — P-A candidate (confirm with the simulation probe)",
    );
  return { introspects, foreignSigners, candidateTier, reasons };
}

/** ACCEPT / REJECT / DEGRADE / UNKNOWN — the simulation verdict. */
export type CpiVerdict = "accept" | "reject" | "degrade" | "unknown";

export interface AcceptanceProbeInput {
  rpc: Rpc<SimulateTransactionApi & GetAccountInfoApi>;
  /** The venue swap ix, built as an UNRECOGNIZED caller would send it (tiny input, minOut=1). */
  swapIx: Instruction;
  /** Fee payer / signer (signature not verified — sigVerify:false). */
  payer: TransactionSigner;
  /** The scratch out-ATA the swap credits — the probe reads its delta. */
  outAta: Address;
  /**
   * The venue's own off-chain quote for the probe size (e.g. referenceQuote).
   * When given, a realized delta materially below it is DEGRADE (adverse fill
   * for unrecognized flow).
   */
  expectedOut?: bigint;
  /** DEGRADE threshold in bps: delta < expectedOut·(1 − bps/1e4) ⇒ degrade. Default 500 (5%). */
  degradeBps?: number;
}

export interface AcceptanceProbe {
  verdict: CpiVerdict;
  /** The out-ATA balance delta from the simulation (0 on reject). */
  delta: bigint;
  /** CU consumed by the simulated CPI (feeds the budgeter). */
  cu?: bigint;
  /** Error / log evidence. */
  detail?: string;
}

const TOKEN_AMOUNT_OFFSET = 64;
const TOKEN_ACCOUNT_MIN_LENGTH = TOKEN_AMOUNT_OFFSET + 8;
const PLACEHOLDER_BLOCKHASH = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 0n,
} as const;

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(getBase64Encoder().encode(data));
}

function tokenAmount(data: Uint8Array): bigint | null {
  if (data.length < TOKEN_ACCOUNT_MIN_LENGTH) return null;
  return readUintLE(data, TOKEN_AMOUNT_OFFSET, 8);
}

/**
 * Runs the unrecognized-caller simulation and classifies the venue. Never
 * lands a swap; on any simulation error it returns `reject` with the error
 * detail (a gated program refuses the arbitrary caller). ACCEPT/DEGRADE split
 * on `expectedOut` when supplied.
 */
export async function probeCpiAcceptance(input: AcceptanceProbeInput): Promise<AcceptanceProbe> {
  const { value: preAccount } = await input.rpc
    .getAccountInfo(input.outAta, { encoding: "base64" })
    .send();
  const preAmount =
    preAccount === null ? 0n : (tokenAmount(decodeBase64(preAccount.data[0])) ?? 0n);

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(input.payer, m),
    (m) => appendTransactionMessageInstructions([input.swapIx], m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(PLACEHOLDER_BLOCKHASH, m),
  );
  const transaction = await signTransactionMessageWithSigners(message);

  const { value } = await input.rpc
    .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
      replaceRecentBlockhash: true,
      accounts: { encoding: "base64", addresses: [input.outAta] },
    })
    .send();

  const cu =
    value.unitsConsumed === undefined || value.unitsConsumed === null
      ? undefined
      : BigInt(value.unitsConsumed);
  if (value.err !== null) {
    // A rejecting program surfaces a custom error / a caller/owner/missing-acct
    // failure — the definitive P-C signal.
    return {
      verdict: "reject",
      delta: 0n,
      cu,
      detail: `${JSON.stringify(value.err)}${value.logs ? `\n${value.logs.join("\n")}` : ""}`,
    };
  }
  const postAccount = value.accounts?.[0];
  const postAmount =
    postAccount === null || postAccount === undefined
      ? preAmount
      : (tokenAmount(decodeBase64(postAccount.data[0])) ?? preAmount);
  const delta = postAmount - preAmount;
  if (delta <= 0n)
    return { verdict: "reject", delta, cu, detail: "swap simulated but credited no output" };

  if (input.expectedOut !== undefined && input.expectedOut > 0n) {
    const bps = BigInt(input.degradeBps ?? 500);
    const floor = input.expectedOut - (input.expectedOut * bps) / 10_000n;
    if (delta < floor) {
      return {
        verdict: "degrade",
        delta,
        cu,
        detail: `delta ${delta} < expected ${input.expectedOut} − ${bps}bps (adverse fill for unrecognized flow)`,
      };
    }
  }
  return { verdict: "accept", delta, cu };
}

export interface VenueClassification {
  tier: CpiTier;
  reasons: string[];
  /** True iff a P-C venue may still be quoted through the off-chain simulation best-scan lane. */
  externalScanEligible: boolean;
}

/**
 * Combine the static screen with an optional simulation verdict into the final
 * tier. Introspection is decisive P-C. Otherwise ACCEPT ⇒ P-A (public/readable
 * oracle) or P-B (proprietary internal oracle located empirically — the caller
 * distinguishes via `internalOracle`); REJECT/DEGRADE ⇒ P-C. Without a sim
 * verdict the static candidate stands (a P-A candidate stays provisional).
 */
export function classifyVenue(
  screen: StaticScreen,
  probe?: AcceptanceProbe,
  opts: { internalOracle?: boolean } = {},
): VenueClassification {
  if (screen.candidateTier === "P-C") {
    return {
      tier: "P-C",
      reasons: screen.reasons,
      externalScanEligible: probe?.verdict === "accept",
    };
  }
  if (probe === undefined) {
    return {
      tier: opts.internalOracle ? "P-B" : "P-A",
      reasons: [...screen.reasons, "no simulation verdict — provisional"],
      externalScanEligible: true,
    };
  }
  if (probe.verdict === "accept") {
    const tier: CpiTier = opts.internalOracle ? "P-B" : "P-A";
    return {
      tier,
      reasons: [
        ...screen.reasons,
        `simulation ACCEPT (delta ${probe.delta}${probe.cu ? `, ${probe.cu} CU` : ""})`,
      ],
      externalScanEligible: true,
    };
  }
  const reasons = [
    ...screen.reasons,
    `simulation ${probe.verdict.toUpperCase()}${probe.detail ? `: ${probe.detail}` : ""}`,
  ];
  return { tier: "P-C", reasons, externalScanEligible: probe.verdict === "degrade" };
}
