/**
 * The SDK's Solana Portal instructions (`svm/portal.ts`) run against eco-routes' own programs as
 * mainnet runs them: the Portal, the HyperProver, proof_helper, Hyperlane's Mailbox and IGP, loaded
 * into LiteSVM at their mainnet ids from the pinned dump (`svm/eco-routes-svm.ts`), with the
 * Mailbox's outbox and the IGP's accounts as mainnet held them.
 *
 * An intent published on Arbitrum for Solana, the route eco-routes' own
 * `DepositAddress_USDCTransfer_Solana` publishes (USDC moved from the executor to a recipient): it is
 * filled, the fill proven — the Hyperlane message written to the Mailbox and its gas paid to the
 * IGP — and, for a second intent, cancelled after its deadline and the cancellation proven.
 *
 * Nothing here is mocked: no cross-chain delivery is attempted (the message is read where the
 * Mailbox wrote it, which is all a relayer does on this side).
 */
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import {
  address,
  generateKeyPairSigner,
  lamports,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { FailedTransactionMetadata, type LiteSVM } from "litesvm";
import { bytesToHex, keccak256, pad, toHex, type Hex } from "viem";

import { hashIntent } from "../src/routes/encode.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import type { Intent } from "../src/routes/types.js";
import {
  associatedTokenAccount,
  buildExecuteTransaction,
  buildPortalCancelInstruction,
  buildPortalFulfillInstruction,
  buildPortalHyperProveInstructions,
  decodeFulfillMarker,
  hyperlaneDispatchedMessagePda,
  igpGasPaymentPda,
  SOLANA_HYPERLANE,
  svmExecutorPda,
  svmFulfillMarkerPda,
  svmHyperDispatcherPda,
  SVM_CANCELLED_CLAIMANT,
  svmTokenTransferCall,
  TOKEN_PROGRAM_ID,
  universalOfSvmKey,
} from "../src/svm/index.js";
import { ecoRoutesSvm, programId, setTime } from "./svm/eco-routes-svm.js";
import { setMint, setTokenAccount, tokenAmount, type EngineHarness } from "./svm/engine-harness.js";

const NOW = 1_790_000_000n;
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PORTAL = programId("portal");
const HYPER = programId("hyper_prover");
/** The EVM HyperProver, on Arbitrum as on every chain: the message's recipient there. */
const ARBITRUM_PROVER: Hex = "0xEC08fb4647f3f50d1162a578d481266687C60fc5";
const CLAIMANT: Hex = pad("0x658d45d9DEB56768ca379C50daEcde116Db44521");
const AMOUNT = 1_000_000n;

let svm: LiteSVM;
let solver: KeyPairSigner;
let recipient: Address;

/** The harness helpers take an engine harness; these need only its bank. */
const bank = (): EngineHarness => ({ svm }) as unknown as EngineHarness;

async function send(signer: KeyPairSigner, instructions: Instruction[]) {
  svm.expireBlockhash();
  const transaction = await buildExecuteTransaction({
    payer: signer,
    instructions: [getSetComputeUnitLimitInstruction({ units: 1_000_000 }), ...instructions],
    latestBlockhash: { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n },
  });
  const result = svm.sendTransaction(transaction);
  if (result instanceof FailedTransactionMetadata) {
    return { ok: false as const, err: String(result.err()), logs: result.meta().logs() };
  }

  return { ok: true as const, logs: result.logs() };
}

const expectSent = (result: Awaited<ReturnType<typeof send>>): void => {
  if (!result.ok) throw new Error(`${result.err}\n${result.logs.join("\n")}`);
};

/** An Arbitrum -> Solana intent: `AMOUNT` USDC to `recipient`, for Arbitrum USDC. */
async function intent(salt: string, deadline: bigint): Promise<Intent> {
  return {
    sourceChainId: 42161n,
    destination: 1399811149n,
    route: {
      salt: `0x${salt.repeat(32)}`,
      deadline,
      portal: universalOfSvmKey(PORTAL),
      nativeAmount: 0n,
      tokens: [{ token: universalOfSvmKey(USDC), amount: AMOUNT }],
      calls: [
        await svmTokenTransferCall({
          portal: PORTAL,
          mint: USDC,
          amount: AMOUNT,
          decimals: 6,
          recipient,
        }),
      ],
    },
    reward: {
      deadline: deadline + 86_400n,
      creator: toUniversalAddress("0x658d45d9DEB56768ca379C50daEcde116Db44521"),
      prover: toUniversalAddress(ARBITRUM_PROVER),
      nativeAmount: 0n,
      tokens: [
        { token: toUniversalAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"), amount: AMOUNT },
      ],
    },
  };
}

async function prove(hashes: Hex[]) {
  const uniqueMessage = await generateKeyPairSigner();
  const uniqueGasPayment = await generateKeyPairSigner();
  const instructions = await buildPortalHyperProveInstructions({
    portal: PORTAL,
    hyperProver: HYPER,
    intentHashes: hashes,
    sourceChainId: 42161n,
    sourceProver: ARBITRUM_PROVER,
    payer: solver,
    uniqueMessage,
    uniqueGasPayment,
  });
  const result = await send(solver, [...instructions]);

  return { result, uniqueMessage, uniqueGasPayment };
}

/** The Hyperlane message the Mailbox wrote under `unique` (past its 53-byte header). */
async function dispatched(unique: Address): Promise<Uint8Array> {
  const account = svm.getAccount(
    await hyperlaneDispatchedMessagePda(SOLANA_HYPERLANE.mailbox, unique),
  );
  if (!account.exists) throw new Error("no dispatched message");

  return account.data.subarray(1 + 8 + 4 + 8 + 32);
}

beforeAll(async () => {
  svm = ecoRoutesSvm(NOW);
  solver = await generateKeyPairSigner();
  svm.airdrop(solver.address, lamports(10_000_000_000n));
  setMint(bank(), USDC, 6);
  setTokenAccount(
    bank(),
    await associatedTokenAccount(solver.address, USDC, TOKEN_PROGRAM_ID),
    USDC,
    solver.address,
    10n * AMOUNT,
  );
  recipient = (await generateKeyPairSigner()).address;
  setTokenAccount(bank(), recipient, USDC, (await generateKeyPairSigner()).address, 0n);
});

describe("eco-routes on Solana, through the SDK's instructions", () => {
  it("fills an intent from Arbitrum, and proves it to Arbitrum through Hyperlane, gas paid", async () => {
    const value = await intent("01", NOW + 3600n);
    const { intentHash } = hashIntent(value);
    const fill = await buildPortalFulfillInstruction({
      intent: value,
      portal: PORTAL,
      solver,
      claimant: CLAIMANT,
      tokenPrograms: { [USDC]: TOKEN_PROGRAM_ID },
    });
    expectSent(await send(solver, [fill]));
    expect(tokenAmount(bank(), recipient)).toBe(AMOUNT);
    const marker = svm.getAccount(await svmFulfillMarkerPda(PORTAL, intentHash));
    expect(marker.exists && decodeFulfillMarker(marker.data)).toBe(CLAIMANT.toLowerCase());
    // The executor keeps nothing: the route moved all it was given.
    const executorAta = await associatedTokenAccount(
      await svmExecutorPda(PORTAL),
      USDC,
      TOKEN_PROGRAM_ID,
    );
    expect(tokenAmount(bank(), executorAta)).toBe(0n);

    const { result, uniqueMessage, uniqueGasPayment } = await prove([intentHash]);
    expectSent(result);
    // Hyperlane's message: version, nonce, origin Solana, sender the HyperProver's dispatcher,
    // destination Arbitrum, recipient Arbitrum's HyperProver, and the proof — Solana's chain id
    // then (intent hash, claimant).
    const message = await dispatched(uniqueMessage.address);
    const view = new DataView(message.buffer, message.byteOffset);
    expect(message[0]).toBe(3);
    expect(view.getUint32(5)).toBe(1399811149);
    expect(bytesToHex(message.subarray(9, 41))).toBe(
      universalOfSvmKey(await svmHyperDispatcherPda(HYPER)),
    );
    expect(view.getUint32(41)).toBe(42161);
    expect(bytesToHex(message.subarray(45, 77))).toBe(pad(ARBITRUM_PROVER).toLowerCase());
    expect(bytesToHex(message.subarray(77))).toBe(
      `${toHex(1399811149n, { size: 8 })}${intentHash.slice(2)}${CLAIMANT.slice(2)}`.toLowerCase(),
    );
    // The IGP recorded the payment for that message's id.
    const payment = svm.getAccount(
      await igpGasPaymentPda(SOLANA_HYPERLANE.igpProgram, uniqueGasPayment.address),
    );
    expect(payment.exists).toBe(true);
    expect(bytesToHex(payment.exists ? payment.data : new Uint8Array())).toContain(
      keccak256(message).slice(2),
    );
  });

  it("cancels an intent after its deadline, refuses its fill, and proves the cancellation", async () => {
    const value = await intent("02", NOW + 60n);
    const { intentHash } = hashIntent(value);
    const cancel = await buildPortalCancelInstruction({
      intent: value,
      portal: PORTAL,
      payer: solver,
    });
    // Not before the deadline.
    const early = await send(solver, [cancel]);
    expect(early.ok).toBe(false);
    setTime(svm, NOW + 120n);
    expectSent(await send(solver, [cancel]));
    const marker = svm.getAccount(await svmFulfillMarkerPda(PORTAL, intentHash));
    expect(marker.exists && decodeFulfillMarker(marker.data)).toBe(SVM_CANCELLED_CLAIMANT);
    // Cancelling again is a no-op, and a fill now fails.
    expectSent(await send(solver, [cancel]));
    const fill = await send(solver, [
      await buildPortalFulfillInstruction({
        intent: value,
        portal: PORTAL,
        solver,
        claimant: CLAIMANT,
        tokenPrograms: { [USDC]: TOKEN_PROGRAM_ID },
      }),
    ]);
    expect(fill.ok).toBe(false);
    const { result, uniqueMessage } = await prove([intentHash]);
    expectSent(result);
    const message = await dispatched(uniqueMessage.address);
    expect(bytesToHex(message.subarray(77))).toBe(
      `${toHex(1399811149n, { size: 8 })}${intentHash.slice(2)}${SVM_CANCELLED_CLAIMANT.slice(2)}`.toLowerCase(),
    );
  });
});
