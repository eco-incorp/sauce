/**
 * `sauce sign`: a program signed for a Private Pot that has `@sauce/signed` installed, which anyone
 * may then submit to the Pot's `execute` (a relayer, a hop's body). The command compiles the file
 * with `main`'s arguments as `tx` does, and prints the EIP-712 typed data the Pot's owner signs
 * (`routes/signed.ts`), the signature when a signer is given, and the `execute` call that submits
 * it: `{ to: the Pot, data, value: 0 }`, for any account to send. It reads no chain.
 */
import { getAddress, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { v12PredictPot } from "../deployments/pot.js";
import { encodeExecute, executeTypedData, signedSalt } from "../routes/signed.js";
import { UsageError } from "./args.js";
import {
  castSend,
  compileProgram,
  payloadOf,
  type CliFiles,
  type CommandOutput,
  type CookInput,
} from "./commands.js";
import { intentDestinations, requireSupported } from "./support.js";

export interface SignInput extends CookInput {
  /** The last unix time the program may run. */
  readonly deadline: bigint;
  /** The salt it is signed under, 32 bytes; a fresh one when left out. */
  readonly signedSalt?: Hex;
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** `sauce sign`'s result: the typed data, and with `signer` the signature and the call. */
export async function signCommand(
  input: SignInput,
  files: CliFiles,
  signer?: PrivateKeyAccount,
): Promise<CommandOutput> {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `a signed program runs on a Private Pot's Router, an EVM contract: ${input.chain.slug} has none`,
    );
  }
  const salt = input.signedSalt ?? signedSalt();
  if (!BYTES32.test(salt)) {
    throw new UsageError(`--signed-salt is 32 bytes as hex, not ${salt}`);
  }
  const target = input.target;
  const pot = "pot" in target ? target.pot : (v12PredictPot(target.owner, target.salt) as Address);
  const owner = "owner" in target ? getAddress(target.owner) : undefined;
  if (signer !== undefined && owner !== undefined && getAddress(signer.address) !== owner) {
    throw new UsageError(
      `${signer.address} does not own the Pot: only its owner, ${owner}, signs what it runs`,
    );
  }
  const compiled = compileProgram(input, files);
  requireSupported("signing a program for a Pot", [
    input.chain,
    ...intentDestinations(compiled.bodies),
  ]);
  const program = payloadOf(compiled, input.args);
  const execution = {
    pot,
    chainId: input.chain.id,
    program,
    salt: salt.toLowerCase() as Hex,
    deadline: input.deadline,
  };
  const typedData = executeTypedData(execution);
  const signature = signer === undefined ? undefined : await signer.signTypedData(typedData);
  const data = signature === undefined ? undefined : encodeExecute({ ...execution, signature });
  const json = {
    chainId: input.chain.id,
    pot,
    program,
    salt: execution.salt,
    deadline: input.deadline.toString(),
    // As eth_signTypedData_v4 takes it, the domain's type spelled out.
    typedData: {
      ...typedData,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...typedData.types,
      },
      domain: { ...typedData.domain, chainId: input.chain.id },
      message: { ...typedData.message, deadline: input.deadline.toString() },
    },
    ...(signature === undefined
      ? {}
      : { signature, execute: { chainId: input.chain.id, to: pot, data, value: "0" } }),
  };
  const notes = [
    `Pot ${pot}${owner === undefined ? "" : `, owned by ${owner}`}: it runs the program once the ` +
      `Pot's owner has signed it, for anyone who sends the execute call, until ${input.deadline} ` +
      `(unix seconds), under salt ${execution.salt}, once.`,
    `The Pot needs @sauce/signed installed (sauce run @sauce/signed --chain ${input.chain.slug}), ` +
      "and the native coin for the Kitchen's fee, which it pays.",
    signature === undefined
      ? "No signer was given: sign `typedData` with the Pot's owner (eth_signTypedData_v4), " +
        "or run again with --wallet, --keystore or --private-key."
      : "Send `execute` from any account; the program checks what it needs, since anyone may " +
        "send it as soon as it is signed.",
  ];

  return {
    text: JSON.stringify(json, null, 2),
    json,
    ...(data === undefined ? {} : { cast: castSend(pot, data, 0n) }),
    notes,
  };
}
