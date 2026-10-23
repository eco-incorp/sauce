/**
 * `sauce verify`: whether a payload, a cook or a transaction runs the audited settle program, and
 * with which `(tokens, minOut, recipient)` — `validateSettleProgram` from the command line.
 *
 * A rejection exits 1 and names the SDK's `SettleFailureCode`. One more check is the CLI's own,
 * because `/verify` leaves it to its caller and a command line has no caller to leave it to: the
 * engine a cook names must be the released one (or one named with `--engine`) — `UNKNOWN_ENGINE`.
 * A transaction hash is refused when the transaction reverted (`TX_FAILED`) or has no receipt yet
 * (`TX_PENDING`): it settled nothing, whatever its calldata carries.
 */
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { v12DeployedAddresses, v12EngineAddress } from "../deployments/index.js";
import { v12PotAbi } from "../evm/engine.js";
import {
  SettleDecodeError,
  validateSettleProgram,
  type DecodedSettleProgram,
  type ProgramPin,
} from "../verify/decode.js";
import { SETTLE_WIRE } from "../verify/wire.js";
import { CliError, UsageError } from "./args.js";
import { connect, receiptOf } from "./chain.js";
import type { CommandOutput } from "./commands.js";

/** `--pin <hash:bytes>`: a program hash and the length the payload splits at. */
export function parsePin(raw: string): ProgramPin {
  const match = /^(0x[0-9a-fA-F]{64}):(\d+)$/.exec(raw);
  if (match === null) {
    throw new UsageError(
      `--pin: '${raw}' is not <hash>:<bytes>, a 32-byte keccak256 and the program's length ` +
        `(the current pin is ${SETTLE_WIRE.PROGRAM_HASH}:${SETTLE_WIRE.PROGRAM_BYTES})`,
    );
  }

  return { hash: match[1]!.toLowerCase() as Hex, bytes: Number(match[2]) };
}

export interface VerifyInput {
  /** A settle payload, `Pot.cook` calldata, or a transaction hash with `rpcUrl`. */
  readonly hex: Hex;
  /** Historical pins accepted besides the current one. */
  readonly pins: readonly ProgramPin[];
  /** Engines accepted besides the released one. */
  readonly engines: readonly Address[];
  readonly chain?: CanonicalChain;
  readonly rpcUrl?: string;
}

/** Where the settle was found, beside what it decodes to. */
interface Found {
  readonly settle: DecodedSettleProgram;
  readonly engine?: Address;
}

class Rejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The settle in `data`: a cook's program, or `data` as a payload. */
function findSettle(data: Hex, accepted: readonly ProgramPin[]): Found {
  const validate = (payload: Hex): DecodedSettleProgram => {
    try {
      return validateSettleProgram(payload, accepted);
    } catch (error) {
      if (error instanceof SettleDecodeError) throw new Rejected(error.code, error.message);
      throw error;
    }
  };
  try {
    const cook = decodeFunctionData({ abi: v12PotAbi, data });
    if (cook.functionName === "cook") {
      const [engine, program] = cook.args as readonly [Address, Hex];

      return { settle: validate(program), engine: getAddress(engine) };
    }
  } catch (error) {
    if (error instanceof Rejected) throw error;
    // Not a cook.
  }

  return { settle: validate(data) };
}

const released = (): Address => getAddress(v12EngineAddress());

/** `sauce verify`: the settle's parameters, or the code it is rejected with (exit 1). */
export async function verifyCommand(input: VerifyInput): Promise<CommandOutput> {
  let data = input.hex;
  let transaction: Record<string, unknown> = {};
  let landed: Rejected | undefined;
  if (input.rpcUrl !== undefined) {
    if (input.chain === undefined) throw new CliError("verify: a transaction hash needs its chain");
    const client = await connect(input.rpcUrl, input.chain);
    try {
      const tx = await client.getTransaction({ hash: input.hex });
      data = tx.input;
      transaction = {
        hash: input.hex,
        chain: input.chain.slug,
        to: tx.to === null ? null : getAddress(tx.to),
      };
    } catch (error) {
      throw new CliError(
        `no transaction ${input.hex} on ${input.chain.slug}: ${(error as { shortMessage?: string }).shortMessage ?? "not found"}`,
      );
    }
    // A transaction that reverted settled nothing, and one not yet mined has settled nothing yet.
    const receipt = await receiptOf(client, input.hex);
    landed =
      receipt === undefined
        ? new Rejected(
            "TX_PENDING",
            "the transaction has no receipt yet: it settled nothing so far",
          )
        : receipt.status !== "success"
          ? new Rejected("TX_FAILED", "the transaction reverted, so it settled nothing")
          : undefined;
  }
  const accepted: ProgramPin[] = [
    { hash: SETTLE_WIRE.PROGRAM_HASH as Hex, bytes: SETTLE_WIRE.PROGRAM_BYTES },
    ...input.pins,
  ];
  const engines = [released(), ...input.engines.map((engine) => getAddress(engine))];
  try {
    if (landed !== undefined) throw landed;
    const found = findSettle(data, accepted);
    if (found.engine !== undefined && !engines.includes(found.engine)) {
      throw new Rejected(
        "UNKNOWN_ENGINE",
        `the cook runs the settle program on ${found.engine}, which is not the released engine ` +
          `(${released()}): the right bytes on another interpreter are another computation. ` +
          "Pass --engine <address> if you trust it.",
      );
    }
    const { settle } = found;
    const engineNote =
      found.engine === undefined
        ? []
        : [
            `  engine     ${found.engine} (${
              found.engine === released()
                ? `the released v12 engine ${v12DeployedAddresses().releases["v12-evm"].version}`
                : "accepted with --engine"
            })`,
          ];

    return {
      text: [
        "valid: the audited settle program",
        `  tokens     ${settle.tokens.join(", ")} (floor ${settle.floorToken})`,
        `  minOut     ${settle.minOut}`,
        `  recipient  ${settle.recipient}`,
        ...engineNote,
        `  program    ${settle.programHash}`,
      ].join("\n"),
      json: {
        ...transaction,
        valid: true,
        tokens: settle.tokens,
        floorToken: settle.floorToken,
        minOut: settle.minOut.toString(),
        recipient: settle.recipient,
        programHash: settle.programHash,
        ...(found.engine === undefined ? {} : { engine: found.engine }),
      },
    };
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;

    return {
      text: `rejected (${error.code}): ${error.message}`,
      json: { ...transaction, valid: false, code: error.code, message: error.message },
      exitCode: 1,
    };
  }
}
