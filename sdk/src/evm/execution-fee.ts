/**
 * Reading the destination Kitchen's current execution fee.
 *
 * The one value the intent lowering cannot derive. It is mutable on-chain — the engine repo ships a
 * workflow that changes it — and it lives on the DESTINATION, which the source chain has no way to
 * read while it executes. So a program cannot look it up and neither can the compiler; a caller
 * reads it at build time and passes it in.
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
 * `Kitchen.executionFee()` on the destination chain, as a request plus its decoder.
 *
 * ```ts
 * const request = destinationExecutionFee();
 * const fee = request.decode(await client.call(request).then((r) => r.data!));
 * ```
 *
 * Pass the result as `intents.executionFee`. Read it shortly before building: an increase between
 * the read and the fulfillment makes the cook revert, which reverts the whole fulfillment.
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
