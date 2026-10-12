/**
 * Owner-signed programs: what a Private Pot's owner signs for `@sauce/signed`'s handlers, and the
 * calls that submit it.
 *
 * A Pot with `@sauce/signed` installed (`sauce run @sauce/signed --chain base`, or
 * {@link packageHandlers}) answers `execute(bytes program, bytes32 salt, uint256 deadline, bytes
 * signature)` for anyone: it runs `program` as the Pot when the Pot's owner signed it. The owner
 * signs EIP-712 typed data, so any wallet can (viem's `signTypedData`, `eth_signTypedData_v4`):
 *
 * ```ts
 * const program = routes.signedProgram(routes.compileSauceProgram("base", source), [amount]);
 * const request = { pot, chainId: 8453, program, salt: routes.signedSalt(), deadline };
 * const signature = await wallet.signTypedData(routes.executeTypedData(request));
 * const data = routes.encodeExecute({ ...request, signature }); // to: pot, from anyone
 * ```
 *
 * `program` is the bytecode with its entry arguments appended: exactly what runs, all of it signed.
 * Each salt runs once, in any order (Permit2's unordered nonces); {@link signedSaltSlot} says where
 * the Pot records it, and {@link cancelSaltsSource} writes the program that cancels salts.
 *
 * `executeAcross` takes one signature over an execution per chain ({@link executeAcrossTypedData},
 * {@link encodeExecuteAcross}). The package also installs the core's ERC-1271 handler
 * (`erc1271.ts`), whose `potMessageTypedData` the owner signs for the Pot to answer
 * `isValidSignature`, under the same domain.
 *
 * Every hash here is the one `sdk/src/std/signed/signed.evm.js` computes on chain; the SDK's tests
 * hold the two together.
 */
import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  hashStruct,
  isHex,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import { encodeEntryArguments, type EntryValue } from "./entry.js";
import { POT_SIGNER_DOMAIN } from "./erc1271.js";
import type { CompiledSauceProgram } from "./sauce-route.js";

/** The package whose handlers answer the calls this module encodes. */
export const SIGNED_PACKAGE = "@sauce/signed";

/** The EIP-712 domain's `name` and `version` every Pot signs under: the core's, which its ERC-1271
 *  handler checks too. */
export const SIGNED_DOMAIN = POT_SIGNER_DOMAIN;

/** The Pot's calls `@sauce/signed` answers, as a contract calls them; `isValidSignature` is the
 *  core's (`erc1271Abi`). */
export const signedAbi = parseAbi([
  "function execute(bytes program, bytes32 salt, uint256 deadline, bytes signature) returns (bytes)",
  "function executeAcross(bytes program, bytes32 salt, uint256 deadline, bytes32[] executions, uint256 index, bytes signature) returns (bytes)",
  "event SaltsCancelled(uint256 indexed word, uint256 mask)",
]);

/** The ERC-7201 namespace `sauce.storage.Signed`, where the Pot keeps its salts. */
export const SIGNED_NAMESPACE: Hex =
  "0x445da62d53bdea9331f042175775dc985d50361ac56f5f57e8a11871d9d99500";

const EXECUTE_TYPES = {
  Execute: [
    { name: "program", type: "bytes" },
    { name: "salt", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const EXECUTION_TYPES = {
  Execution: [
    { name: "chainId", type: "uint256" },
    { name: "program", type: "bytes" },
    { name: "salt", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const EXECUTIONS_TYPES = {
  Executions: [{ name: "executions", type: "Execution[]" }],
  ...EXECUTION_TYPES,
} as const;

/** One program the owner signs for one Pot on one chain. */
export interface SignedExecution {
  /** The Private Pot that runs it. */
  readonly pot: Address;
  /** The chain it runs on. */
  readonly chainId: number | bigint;
  /** The bytecode with its entry arguments appended ({@link signedProgram}): all of it signed. */
  readonly program: Hex;
  /** A salt not used on that Pot ({@link signedSalt}). */
  readonly salt: Hex;
  /** The last unix time it may run. */
  readonly deadline: bigint;
}

/** {@link SignedExecution} with the owner's signature: what {@link encodeExecute} submits. */
export interface SignedCall extends SignedExecution {
  readonly signature: Hex;
}

/** `compiled` with `args` for its `main` appended: the exact bytes a signature covers and the Pot
 *  runs. */
export function signedProgram(
  compiled: Pick<
    CompiledSauceProgram,
    "bytecode" | "entryEncoding" | "entrySchema" | "entryParams"
  >,
  args: readonly EntryValue[] = [],
): Hex {
  return bytesToHex(concat([compiled.bytecode, encodeEntryArguments(compiled, args)]));
}

/** A fresh salt: 32 random bytes, which no two signatures share but by chance. */
export function signedSalt(): Hex {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

function salt32(salt: Hex): Hex {
  if (!isHex(salt) || salt.length !== 66) {
    throw new Error(`a salt is 32 bytes as hex, not ${salt}`);
  }

  return salt;
}

/** The typed data the owner of `pot` signs to run `program` there: domain `Sauce Pot` (the Pot,
 *  the chain), message `Execute { program, salt, deadline }`. */
export function executeTypedData(execution: SignedExecution) {
  return {
    domain: {
      ...SIGNED_DOMAIN,
      chainId: BigInt(execution.chainId),
      verifyingContract: execution.pot,
    },
    types: EXECUTE_TYPES,
    primaryType: "Execute",
    message: {
      program: execution.program,
      salt: salt32(execution.salt),
      deadline: execution.deadline,
    },
  } as const;
}

/** The Pot's `execute` call submitting a signed program, from anyone: `{ to: pot, data }`. */
export function encodeExecute(call: SignedCall): Hex {
  return encodeFunctionData({
    abi: signedAbi,
    functionName: "execute",
    args: [call.program, salt32(call.salt), call.deadline, call.signature],
  });
}

/** One chain's execution in a signature across chains: the hash `executeAcross` checks. */
export function executionHash(execution: Omit<SignedExecution, "pot">): Hex {
  return hashStruct({
    types: EXECUTION_TYPES,
    primaryType: "Execution",
    data: {
      chainId: BigInt(execution.chainId),
      program: execution.program,
      salt: salt32(execution.salt),
      deadline: execution.deadline,
    },
  });
}

/** What runs a program on each of several chains from one signature: every execution for one Pot
 *  (a Private Pot has the same address on every chain its owner mints it on). */
export interface SignedAcross {
  readonly pot: Address;
  readonly executions: readonly Omit<SignedExecution, "pot">[];
}

/** The typed data the owner signs to run `executions` on their chains, one signature for them all:
 *  domain `Sauce Pot` (the Pot, no chain), message `Executions { executions }`. */
export function executeAcrossTypedData(across: SignedAcross) {
  if (across.executions.length === 0) throw new Error("executeAcross needs an execution");

  return {
    domain: { ...SIGNED_DOMAIN, verifyingContract: across.pot },
    types: EXECUTIONS_TYPES,
    primaryType: "Executions",
    message: {
      executions: across.executions.map((execution) => ({
        chainId: BigInt(execution.chainId),
        program: execution.program,
        salt: salt32(execution.salt),
        deadline: execution.deadline,
      })),
    },
  } as const;
}

/** The Pot's `executeAcross` call that runs `chainId`'s execution of a signature across chains. */
export function encodeExecuteAcross(
  across: SignedAcross & { readonly signature: Hex },
  chainId: number | bigint,
): Hex {
  const index = across.executions.findIndex(
    (execution) => BigInt(execution.chainId) === BigInt(chainId),
  );
  if (index === -1) throw new Error(`the signature runs nothing on chain ${chainId}`);
  const execution = across.executions[index]!;

  return encodeFunctionData({
    abi: signedAbi,
    functionName: "executeAcross",
    args: [
      execution.program,
      salt32(execution.salt),
      execution.deadline,
      across.executions.map(executionHash),
      BigInt(index),
      across.signature,
    ],
  });
}

/** Where a Pot records `salt`: the storage word (`eth_getStorageAt` on the Pot) and its bit, set
 *  once the salt was used or cancelled. */
export function signedSaltSlot(salt: Hex): { readonly slot: Hex; readonly bit: bigint } {
  const value = BigInt(salt32(salt));

  return {
    slot: keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "bytes32" }],
        [value >> 8n, SIGNED_NAMESPACE],
      ),
    ),
    bit: 1n << (value & 255n),
  };
}

/** The program the owner cooks to cancel `salts` it signed and no longer wants run: one
 *  `invalidate` per storage word they share, after `Signed.setup()`, which sets the Pot up to run
 *  signed programs if it is not yet, as every owner cook with the package does. */
export function cancelSaltsSource(salts: readonly Hex[]): string {
  if (salts.length === 0) throw new Error("there is no salt to cancel");
  const words = new Map<bigint, bigint>();
  for (const salt of salts) {
    const value = BigInt(salt32(salt));
    words.set(value >> 8n, (words.get(value >> 8n) ?? 0n) | (1n << (value & 255n)));
  }

  return [
    "// Cancels salts this Pot's owner signed: a signed program under any of them never runs.",
    `import { Signed, invalidate } from "${SIGNED_PACKAGE}";`,
    "",
    "Signed.setup();",
    ...[...words].map(
      ([word, mask]) => `invalidate(0x${word.toString(16)}, 0x${mask.toString(16)});`,
    ),
    "",
  ].join("\n");
}
