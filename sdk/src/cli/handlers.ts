/**
 * A package of the async family as a program operand: `sauce run @sauce/random --chain base` cooks
 * the program installing that package's handlers on the Pot (`routes/handlers.ts`), so every
 * program command — compile, tx, simulate, run — takes it as it takes a file, with the same Pot,
 * signer and rehearsal.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { resolveSdkPackage } from "../embedded/resolve.js";
import { handlersInstallSource, packageHandlers } from "../routes/handlers.js";

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

  return handlersInstallSource(packageHandlers(chain, specifier), specifier);
}
