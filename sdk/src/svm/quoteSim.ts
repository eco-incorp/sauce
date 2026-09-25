/**
 * External-quote helper for solswapBest: quote a swap instruction by
 * simulating it as a standalone transaction and reading the out token
 * account's balance delta. This is the only quoting path for venues whose
 * math cannot be reproduced from account reads (closed-source prop AMMs,
 * aggregator routes).
 *
 * STALENESS CONTRACT: the returned quote is exact at simulate time ONLY —
 * any state change between the simulation and the on-chain execution
 * (someone else trades, fees change, an oracle ticks) silently invalidates
 * it. A baked external quote is therefore a candidate value for the best
 * scan, never a guarantee; the recipe's post-swap outAta delta check
 * (`throw "out"` when `after - before < minOut`) is the on-chain safety net.
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

/** SPL token account amount: u64 LE at offset 64 (Tokenkeg and Token-2022). */
const TOKEN_AMOUNT_OFFSET = 64;
const TOKEN_ACCOUNT_MIN_LENGTH = TOKEN_AMOUNT_OFFSET + 8;

// The simulation replaces the blockhash server-side (replaceRecentBlockhash),
// so the signed message carries this placeholder — no getLatestBlockhash
// round-trip, and the payer's signature is never checked (sigVerify defaults
// to false).
const PLACEHOLDER_BLOCKHASH = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 0n,
} as const;

export interface QuoteViaSimulationInput {
  rpc: Rpc<SimulateTransactionApi & GetAccountInfoApi>;
  /** The venue swap instruction, exactly as it would be sent. */
  swapIx: Instruction;
  /** Fee payer / signer of the simulated transaction (signature not verified). */
  payer: TransactionSigner;
  /** The user's output-token account — the quote is its balance delta. */
  outAta: Address;
}

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(getBase64Encoder().encode(data));
}

function tokenAmount(data: Uint8Array, outAta: Address, when: string): bigint {
  if (data.length < TOKEN_ACCOUNT_MIN_LENGTH) {
    throw new Error(
      `out token account ${outAta} data is ${data.length} bytes ${when}, expected an SPL token account`,
    );
  }
  return readUintLE(data, TOKEN_AMOUNT_OFFSET, 8);
}

/**
 * Simulates `swapIx` as a standalone single-instruction transaction and
 * returns the outAta token-balance delta (post − pre) as the quoted output.
 * See the module doc for the staleness contract.
 */
export async function quoteViaSimulation({
  rpc,
  swapIx,
  payer,
  outAta,
}: QuoteViaSimulationInput): Promise<bigint> {
  const { value: preAccount } = await rpc.getAccountInfo(outAta, { encoding: "base64" }).send();
  if (preAccount === null) throw new Error(`out token account ${outAta} not found`);
  const preAmount = tokenAmount(decodeBase64(preAccount.data[0]), outAta, "before the swap");

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => appendTransactionMessageInstructions([swapIx], m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(PLACEHOLDER_BLOCKHASH, m),
  );
  const transaction = await signTransactionMessageWithSigners(message);

  const { value } = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
      replaceRecentBlockhash: true,
      accounts: { encoding: "base64", addresses: [outAta] },
    })
    .send();

  if (value.err !== null) {
    throw new Error(
      `swap simulation failed: ${JSON.stringify(value.err)}${value.logs ? `\n${value.logs.join("\n")}` : ""}`,
    );
  }
  const postAccount = value.accounts?.[0];
  if (postAccount === null || postAccount === undefined) {
    throw new Error(`swap simulation did not return the out token account ${outAta}`);
  }
  const postAmount = tokenAmount(decodeBase64(postAccount.data[0]), outAta, "after the swap");

  return postAmount - preAmount;
}
