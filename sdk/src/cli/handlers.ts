/**
 * A package of the async family as a program operand: `sauce run @sauce/random --chain base` cooks
 * the program installing that package's handlers on the Pot (`routes/handlers.ts`), so every
 * program command — compile, tx, simulate, run — takes it as it takes a file, with the same Pot,
 * signer and rehearsal.
 */
import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  getContractAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { v12EngineAddress } from "../deployments/v12-addresses.js";
import { resolveSdkPackage } from "../embedded/resolve.js";
import { handlersInstallSource, packageInstall } from "../routes/handlers.js";
import type { InstalledHandler } from "../routes/sauce-route.js";

const PACKAGE = /^@sauce\/[\w-]+$/;

/** Whether `operand` names a standard-library package rather than a file. */
export function isPackageOperand(operand: string): boolean {
  return PACKAGE.test(operand) && resolveSdkPackage(operand) !== undefined;
}

/** The program installing `specifier`'s handlers on a Pot on `chain`, as a file's text. */
export function packageOperandText(specifier: string, chain: CanonicalChain): string {
  if (chain.kind !== "evm") {
    throw new Error(
      `${specifier}'s handlers answer on a Pot's Router, an EVM contract: ${chain.slug} has none`,
    );
  }

  const { handlers, interfaces, skipped } = packageInstall(chain, specifier);
  if (handlers.length === 0 && interfaces.length === 0) {
    const lacking = skipped.map(({ selector, missing }) => `${selector} needs ${missing}`);
    throw new Error(
      `${specifier} has no handler ${chain.slug} can run` +
        (lacking.length === 0 ? "" : `: ${lacking.join("; ")}`),
    );
  }

  return handlersInstallSource(handlers, specifier, interfaces);
}

/** The Router's handler records, in a Pot's storage: ERC-7201 `sauce.storage.Handlers`, selector to
 *  `{ address bytecode; bool isView; }` in one word. */
const HANDLERS_LOCATION = 0x3ede71929532386d53b5e25665f65f4ad4a552935973d8ba46f290dd0524c500n;

/** The slot of the Router's record for `selector` on a Pot. */
export function handlerSlot(selector: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [toHex(selector << 224n, { size: 32 }), HANDLERS_LOCATION],
    ),
  );
}

/** The record `handler` leaves on `pot` once installed: the code contract `0x00 ++ engine ++
 *  program` the Router deploys by CREATE2 from the Pot with salt zero, its mode in the byte above. */
export function handlerRecord(pot: Address, handler: InstalledHandler): bigint {
  const code = handler.bytecode;
  const init = concat([
    "0x61",
    toHex(code.length + 21, { size: 2 }),
    "0x80600a3d393df300",
    v12EngineAddress() as Hex,
    bytesToHex(code),
  ]);
  const at = getContractAddress({
    opcode: "CREATE2",
    from: pot,
    salt: toHex(0n, { size: 32 }),
    bytecode: init,
  });

  return BigInt(at) | (handler.readOnly ? 1n << 160n : 0n);
}

/**
 * Whether every one of `handlers` is in place on `pot`, read from the Router's records there. The
 * CLI asks it of a program's own handlers (`program.handlers` installed outside any body or
 * continuation): then the program is compiled to carry none of them (`SAUCE_ASYNC_INSTALLED`), and
 * it refuses to run should one be gone by then.
 */
export async function handlersInPlace(
  client: Pick<PublicClient, "getStorageAt">,
  pot: Address,
  handlers: readonly InstalledHandler[],
): Promise<boolean> {
  if (handlers.length === 0) return false;
  for (const handler of handlers) {
    const word = await client.getStorageAt({ address: pot, slot: handlerSlot(handler.selector) });
    if (BigInt(word ?? "0x0") !== handlerRecord(pot, handler)) return false;
  }

  return true;
}
