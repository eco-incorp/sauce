/**
 * What a transaction that landed cost and did, read from its receipt: the gas it paid for, the L1
 * data fee an OP-stack chain charges besides, the value it carried (a cook's is the Kitchen's fee
 * plus any native the program spends), and the token transfers, approvals and net balance changes
 * its logs record — decoded by `effects.ts`, the decoder `sauce simulate` reports a rehearsal with.
 */
import {
  formatEther,
  getAddress,
  type Address,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { v12EngineAddress, v12KitchenAddress } from "../deployments/index.js";
import {
  addressLabels,
  effectLines,
  effectsJson,
  effectsOf,
  nativeSymbol,
  type Effects,
} from "./effects.js";

/** What a transaction cost its sender, in wei. */
export interface Cost {
  readonly gasUsed: bigint;
  readonly gasPrice: bigint;
  /** `gasUsed * gasPrice`: the execution the chain charged for. */
  readonly execution: bigint;
  /** An OP-stack chain's L1 data fee, where the receipt carries one. */
  readonly l1?: bigint;
  /** What the transaction carried: for a cook, the Kitchen's fee and any native it spends. */
  readonly value: bigint;
  readonly total: bigint;
}

/** The cost of a landed transaction that carried `value`. */
export function costOf(receipt: TransactionReceipt, value: bigint): Cost {
  const gasPrice = receipt.effectiveGasPrice;
  const execution = receipt.gasUsed * gasPrice;
  // The OP-stack field, present only on those chains' receipts; viem passes it through raw where it
  // has no chain formatter.
  const raw = (receipt as unknown as { l1Fee?: bigint | string | null }).l1Fee;
  const l1 = raw === undefined || raw === null ? undefined : BigInt(raw);

  return {
    gasUsed: receipt.gasUsed,
    gasPrice,
    execution,
    ...(l1 === undefined ? {} : { l1 }),
    value,
    total: execution + (l1 ?? 0n) + value,
  };
}

/** The cost as a line: the total, then what it is made of. */
export function costLine(cost: Cost, chain: CanonicalChain, valueIs: string): string {
  const native = nativeSymbol(chain);
  const eth = (wei: bigint) => `${formatEther(wei)} ${native}`;

  return (
    `cost ${eth(cost.total)}: gas ${cost.gasUsed} at ${cost.gasPrice} wei = ${eth(cost.execution)}` +
    (cost.l1 === undefined ? "" : `, L1 data ${eth(cost.l1)}`) +
    `, value ${eth(cost.value)} (${valueIs})`
  );
}

/** The cost for `--json`: wei as decimal strings. */
export const costJson = (cost: Cost): Record<string, string> => ({
  gasUsed: cost.gasUsed.toString(),
  gasPrice: cost.gasPrice.toString(),
  execution: cost.execution.toString(),
  ...(cost.l1 === undefined ? {} : { l1: cost.l1.toString() }),
  value: cost.value.toString(),
  total: cost.total.toString(),
});

/** What a landed transaction's logs record, decoded, with the Sauce addresses named. */
export async function receiptEffects(
  client: PublicClient,
  chain: CanonicalChain,
  receipt: TransactionReceipt,
  known: ReadonlyArray<readonly [Address, string]>,
): Promise<Effects> {
  const labels = addressLabels(chain, [
    [getAddress(v12KitchenAddress()), "Kitchen"],
    [getAddress(v12EngineAddress()), "engine"],
    ...known,
  ]);

  return effectsOf(
    client,
    chain,
    receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
    false,
    labels,
  );
}

/** The effects as lines, and for `--json`, of a landed transaction. */
export function receiptReport(effects: Effects): {
  readonly lines: readonly string[];
  readonly json: Record<string, unknown>;
} {
  return {
    // A receipt records logs: a native transfer inside the transaction is no log.
    lines: effectLines(effects).map((line) =>
      line.startsWith("Native transfers: not reported")
        ? "Native transfers: not in the receipt (only a trace has them)"
        : line,
    ),
    json: effectsJson(effects),
  };
}
