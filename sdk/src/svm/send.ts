import {
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import type {
  Commitment,
  GetEpochInfoApi,
  GetSignatureStatusesApi,
  GetTransactionApi,
  Rpc,
  RpcSubscriptions,
  SendTransactionApi,
  Signature,
  SignatureNotificationsApi,
  SimulateTransactionApi,
  SlotNotificationsApi,
  Transaction,
} from "@solana/kit";
import { ENGINE_GAS_LIMIT_CU } from "./engine.js";
import type { SignedExecuteTransaction } from "./transaction.js";

export interface SimulateExecuteResult {
  ok: boolean;
  unitsConsumed?: bigint;
  returnData?: Uint8Array;
  logs: string[];
  /** Present iff the failure was a sauce REVERT — payload is the revert data. */
  revert?: { payload: Uint8Array };
  err?: unknown;
}

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(getBase64Encoder().encode(data));
}

/**
 * Custom(0) is the only custom program error the engine emits (Error::Revert),
 * but any program in the transaction can fail with error code 0 too (SPL Token
 * error 0 = NotRentExempt, ATA error 0 = InvalidOwner — exactly the prepend
 * kinds shipped by prepends.ts), so the failing instruction index must be the
 * engine execute instruction's.
 */
function isSauceRevert(err: unknown, executeInstructionIndex: number): boolean {
  if (typeof err !== "object" || err === null || !("InstructionError" in err)) return false;

  const detail = (err as { InstructionError: unknown }).InstructionError;

  if (!Array.isArray(detail) || Number(detail[0]) !== executeInstructionIndex) return false;

  const inner: unknown = detail[1];

  return (
    typeof inner === "object" && inner !== null && (inner as { Custom?: unknown }).Custom === 0
  );
}

function instructionCount(transaction: Transaction): number {
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);

  return "instructions" in compiled ? compiled.instructions.length : compiled.numInstructions;
}

export interface SimulateExecuteOptions {
  /**
   * Index of the engine execute instruction inside the transaction. Defaults
   * to the last instruction — buildExecuteTransaction and the client place
   * prepends first and the execute instruction last. Pass it explicitly when
   * the transaction is composed differently.
   */
  executeInstructionIndex?: number;
}

/**
 * Simulates a signed execute transaction. A `Custom(0)` error from the execute
 * instruction is a sauce REVERT: the revert payload rides in returnData and
 * surfaces as `revert.payload`. All other engine failures map to the same
 * InvalidInstructionData instruction error and are NOT distinguishable from
 * each other except by reading `logs`. Failures of other instructions
 * (prepends) surface as plain `err` — never as `revert`.
 */
export async function simulateExecute(
  rpc: Rpc<SimulateTransactionApi>,
  transaction: Transaction,
  { executeInstructionIndex }: SimulateExecuteOptions = {},
): Promise<SimulateExecuteResult> {
  const wireTransaction = getBase64EncodedWireTransaction(transaction);
  const { value } = await rpc
    .simulateTransaction(wireTransaction, { encoding: "base64", replaceRecentBlockhash: true })
    .send();

  const logs = value.logs ? [...value.logs] : [];
  const returnData = value.returnData ? decodeBase64(value.returnData.data[0]) : undefined;

  if (value.err === null) {
    return { ok: true, unitsConsumed: value.unitsConsumed, returnData, logs };
  }

  const executeIndex = executeInstructionIndex ?? instructionCount(transaction) - 1;
  const result: SimulateExecuteResult = {
    ok: false,
    err: value.err,
    unitsConsumed: value.unitsConsumed,
    logs,
  };

  if (isSauceRevert(value.err, executeIndex)) {
    result.revert = { payload: returnData ?? new Uint8Array(0) };
  }

  return result;
}

export interface SendExecuteInput {
  rpc: Rpc<GetEpochInfoApi & GetSignatureStatusesApi & GetTransactionApi & SendTransactionApi>;
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
  transaction: SignedExecuteTransaction;
  commitment?: Commitment;
}

export interface SendExecuteResult {
  signature: Signature;
  returnData?: Uint8Array;
  computeUnits?: bigint;
  logs: string[];
}

/** Sends a signed execute transaction, confirms it, and reads back return data from the transaction meta. */
export async function sendExecute({
  rpc,
  rpcSubscriptions,
  transaction,
  commitment = "confirmed",
}: SendExecuteInput): Promise<SendExecuteResult> {
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(transaction, { commitment });

  const signature = getSignatureFromTransaction(transaction);
  const response = await rpc
    .getTransaction(signature, {
      commitment,
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
    })
    .send();
  const meta = response?.meta;

  return {
    signature,
    returnData: meta?.returnData ? decodeBase64(meta.returnData.data[0]) : undefined,
    computeUnits: meta?.computeUnitsConsumed,
    logs: meta?.logMessages ? [...meta.logMessages] : [],
  };
}

/** Simulated units padded 20% (rounded up), capped at the engine's 1.4M CU budget. */
export function recommendedComputeUnitLimit(simulatedUnits: bigint): number {
  const padded = (simulatedUnits * 12n + 9n) / 10n;
  const cap = BigInt(ENGINE_GAS_LIMIT_CU);

  return Number(padded > cap ? cap : padded);
}
