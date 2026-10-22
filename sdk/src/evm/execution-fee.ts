/**
 * Reading a chain's Kitchen execution fee, the fee every cook pays.
 *
 * It is mutable on-chain — the engine repo ships a workflow that changes it — so a program cannot
 * look it up ahead of time and neither can the compiler; a caller reads it at build time.
 *
 * Like every other read helper here, this builds the request and decodes the answer and performs no
 * RPC itself, so compiling a program never needs the network.
 */
import { decodeAbiParameters, encodeFunctionData, type Hex } from "viem";

import { v12KitchenAbi } from "./engine.js";
import { v12KitchenAddress } from "../deployments/index.js";

export interface ExecutionFeeCall {
  readonly to: Hex;
  readonly data: Hex;
  decode(result: Hex): bigint;
}

/**
 * `Kitchen.executionFee()`, as a request plus its decoder.
 *
 * ```ts
 * const request = destinationExecutionFee();
 * const fee = request.decode(await client.call(request).then((r) => r.data!));
 * ```
 *
 * Read it shortly before building a cook: an increase between the read and the cook makes the cook
 * revert.
 */
export function destinationExecutionFee(
  kitchen: Hex = v12KitchenAddress() as Hex,
): ExecutionFeeCall {
  return {
    to: kitchen,
    data: encodeFunctionData({ abi: v12KitchenAbi, functionName: "executionFee" }),
    decode: (result) => decodeAbiParameters([{ type: "uint256" }], result)[0],
  };
}
