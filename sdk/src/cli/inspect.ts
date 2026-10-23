/**
 * `sauce inspect`: a cook transaction, a Kitchen call, a program, or a program file, taken back
 * apart into what a SauceScript author wrote — the Pot and engine a cook names, and the program
 * and the arguments it carries.
 *
 * Everything is read at the level a program is written at. There is no opcode listing and no
 * disassembly: a program is reported by its size, its hash and — given the source it was compiled
 * from — the arguments appended to it. The decoders are the SDK's: `validateSettleProgram` for the
 * settle, `decodeEntryArguments` for `main`'s arguments.
 */
import {
  bytesToHex,
  decodeFunctionData,
  getAddress,
  hexToBytes,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { v12DeployedAddresses, v12EngineAddress } from "../deployments/index.js";
import { v12PredictPot } from "../deployments/pot.js";
import { v12KitchenAbi, v12PotAbi } from "../evm/engine.js";
import { ERC20ABI } from "../protocols/erc20/abis.js";
import { decodeEntryArguments, type EntryValue } from "../routes/entry.js";
import type { CompiledSauceProgram } from "../routes/sauce-route.js";
import { validateSettleProgram } from "../verify/decode.js";
import { CliError } from "./args.js";
import { connect, receiptOf } from "./chain.js";
import { manifestJson, type CommandOutput } from "./commands.js";
import { linkLines, txLinks } from "./links.js";
import { costJson, costLine, costOf, receiptEffects, receiptReport } from "./receipt.js";

/** What a description needs to know beyond the bytes. */
export interface InspectContext {
  /** The chain a transaction hash is on. */
  readonly chain?: CanonicalChain;
  /** The program a cook was compiled from, to read its arguments back against. */
  readonly source?: { readonly file: string; readonly program: CompiledSauceProgram };
}

/** One described thing: JSON for a program, lines for a person. */
interface Part {
  readonly json: Record<string, unknown>;
  readonly lines: readonly string[];
}

const indent = (lines: readonly string[], by = "  "): string[] => lines.map((line) => by + line);

/** A value as JSON: bigints in decimal, bytes as hex, structure kept. */
function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonValue(v)]));
  }

  return value;
}

const shown = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "bigint"
      ? value.toString()
      : JSON.stringify(jsonValue(value));

// ---------------------------------------------------------------------------------------------
// Calls a transaction makes
// ---------------------------------------------------------------------------------------------

/** An ERC-20 write or read, or `undefined` when `data` is not one. */
function erc20Call(data: Hex): Part | undefined {
  try {
    const decoded = decodeFunctionData({ abi: ERC20ABI, data });
    const item = ERC20ABI.find(
      (entry) => entry.type === "function" && entry.name === decoded.functionName,
    ) as { inputs: readonly { name?: string }[] } | undefined;
    const args = (decoded.args ?? []) as readonly unknown[];
    const named = Object.fromEntries(
      args.map((arg, index) => [item?.inputs[index]?.name || `arg${index}`, jsonValue(arg)]),
    );

    return {
      json: { function: decoded.functionName, args: named },
      lines: [`${decoded.functionName}(${args.map(shown).join(", ")})`],
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Programs and cooks
// ---------------------------------------------------------------------------------------------

/** A program: its size and hash, the settle it is if it is one, and its arguments. */
function programPart(program: Uint8Array, context: InspectContext): Part {
  const hex = bytesToHex(program);
  const json: Record<string, unknown> = { size: program.length, keccak256: keccak256(program) };
  const lines: string[] = [`program: ${program.length} bytes, keccak256 ${json.keccak256}`];
  try {
    const settle = validateSettleProgram(hex);
    json.settle = jsonValue({
      tokens: settle.tokens,
      minOut: settle.minOut,
      recipient: settle.recipient,
    });
    lines.push(
      `  the audited settle program: sweeps ${settle.tokens.join(", ")} to ${settle.recipient}, ` +
        `minOut ${settle.minOut} of ${settle.floorToken}`,
    );
  } catch {
    // Not the settle: nothing to claim.
  }
  const source = context.source;
  if (source !== undefined) {
    const compiled = source.program.bytecode;
    const matches =
      program.length >= compiled.length && compiled.every((byte, index) => byte === program[index]);
    if (!matches) {
      json.source = { file: source.file, matches: false };
      lines.push(
        `  not ${source.file}'s program, as compiled for ${source.program.chain.slug} with these defines`,
      );
    } else {
      const tail = program.slice(compiled.length);
      let values: EntryValue[] | undefined;
      let problem: string | undefined;
      try {
        values = decodeEntryArguments(source.program, tail);
      } catch (error) {
        problem = (error as Error).message;
      }
      json.source = {
        file: source.file,
        matches: true,
        argumentsSize: tail.length,
        ...(values === undefined
          ? { argumentsError: problem }
          : {
              arguments: source.program.entryParams.map((param, index) => ({
                ...param,
                value: jsonValue(values![index]),
              })),
            }),
      };
      lines.push(
        `  ${source.file}'s program, ${compiled.length} bytes, then ${tail.length} of arguments`,
      );
      if (values !== undefined) {
        source.program.entryParams.forEach((param, index) => {
          lines.push(`    ${param.name}: ${param.type} = ${shown(values![index])}`);
        });
      } else {
        lines.push(`    arguments do not decode: ${problem}`);
      }
    }
  }

  return { json, lines };
}

/** The released engine's name, for an engine a cook names. */
function engineName(engine: Address): string {
  if (engine.toLowerCase() !== v12EngineAddress().toLowerCase()) return "not the released engine";
  const { version } = v12DeployedAddresses().releases["v12-evm"];

  return `the released v12 engine ${version}`;
}

/** `Pot.cook(engine, program)`, or `undefined` when `data` is not one. */
function cookCall(data: Hex, context: InspectContext): Part | undefined {
  let engine: Address;
  let program: Hex;
  try {
    const decoded = decodeFunctionData({ abi: v12PotAbi, data });
    if (decoded.functionName !== "cook") return undefined;
    [engine, program] = decoded.args as readonly [Address, Hex];
  } catch {
    return undefined;
  }
  const described = programPart(hexToBytes(program), context);

  return {
    json: {
      call: "Pot.cook",
      engine: { address: engine, released: engineName(engine) !== "not the released engine" },
      program: described.json,
    },
    lines: [`Pot.cook on engine ${engine} (${engineName(engine)})`, ...indent(described.lines)],
  };
}

/** What `data` calls: a cook, a Kitchen call, a token call — or a program itself. */
export function describeData(data: Hex, context: InspectContext): Part {
  const cook = cookCall(data, context);
  if (cook !== undefined) return cook;
  try {
    const kitchen = decodeFunctionData({ abi: v12KitchenAbi, data });
    if (kitchen.functionName === "deployPot") {
      const [owner, salt] = kitchen.args as readonly [Address, Hex];
      const pot = v12PredictPot(owner, salt);

      return {
        json: { call: "Kitchen.deployPot", owner, salt, pot },
        lines: [`Kitchen.deployPot: the Pot ${pot}, owner ${owner}, salt ${salt}`],
      };
    }
  } catch {
    // Not a Kitchen call.
  }
  const token = erc20Call(data);
  if (token !== undefined) {
    return { json: { call: `ERC20.${token.json.function}`, ...token.json }, lines: token.lines };
  }
  // No call this knows: read it as a program (or a payload: a program and its arguments).
  const program = programPart(hexToBytes(data), context);

  return { json: { call: null, program: program.json }, lines: program.lines };
}

/** `sauce inspect <file>`: the program the file compiles to, and what it takes. */
export function inspectFile(file: string, program: CompiledSauceProgram): CommandOutput {
  const described = programPart(program.bytecode, {});
  const params = program.entryParams.map((param) => `${param.name}: ${param.type}`).join(", ");

  return {
    text: [
      `${file} for ${program.chain.slug} (${program.chain.kind})`,
      ...indent(described.lines),
      `  main(${params})${program.entryParams.length === 0 ? "" : `, arguments ${program.entryEncoding}`}`,
      ...(program.manifest === undefined
        ? []
        : [
            `  accounts: ${program.manifest.accounts
              .map((account) =>
                account.kind === "slot"
                  ? `${account.name} (${account.requires}${
                      program.derivedAccounts?.[account.name] === undefined
                        ? ""
                        : `, ${program.derivedAccounts[account.name]}`
                    })`
                  : `any more, from ${account.from}`,
              )
              .join(", ")}`,
          ]),
    ].join("\n"),
    json: {
      file,
      chain: program.chain.slug,
      chainId: program.chain.id,
      program: {
        ...described.json,
        entryEncoding: program.entryEncoding,
        entryParams: program.entryParams,
        ...(program.manifest === undefined ? {} : { manifest: manifestJson(program) }),
      },
    },
  };
}

export interface InspectInput extends InspectContext {
  /** Calldata or program bytes, or a transaction hash with `rpcUrl`. */
  readonly hex: Hex;
  readonly rpcUrl?: string;
}

/** `sauce inspect <hex | tx-hash>`: the call taken apart; for a hash, the transaction around it. */
export async function inspectCommand(input: InspectInput): Promise<CommandOutput> {
  if (input.rpcUrl === undefined) {
    const part = describeData(input.hex, input);

    return { text: part.lines.join("\n"), json: part.json };
  }
  if (input.chain === undefined) throw new CliError("inspect: a transaction hash needs its chain");
  const client = await connect(input.rpcUrl, input.chain);
  let transaction;
  try {
    transaction = await client.getTransaction({ hash: input.hex });
  } catch (error) {
    throw new CliError(
      `no transaction ${input.hex} on ${input.chain.slug}: ${(error as { shortMessage?: string }).shortMessage ?? "not found"}`,
    );
  }
  const receipt = await receiptOf(client, input.hex);
  const from = getAddress(transaction.from);
  const to = transaction.to === null ? null : getAddress(transaction.to);
  const part = describeData(transaction.input, input);
  const status = receipt === undefined ? "pending" : receipt.status;
  // A landed transaction: what it cost, and what its logs record.
  const cost = receipt === undefined ? undefined : costOf(receipt, transaction.value);
  const effects =
    receipt === undefined || receipt.status !== "success"
      ? undefined
      : receiptReport(
          await receiptEffects(client, input.chain, receipt, [
            [from, "the sender"],
            ...(to === null ? [] : ([[to, "the callee"]] as const)),
          ]),
        );

  return {
    text: [
      `transaction ${input.hex} on ${input.chain.slug}: ${status}` +
        (receipt === undefined
          ? ""
          : `, block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`),
      `  from ${from} to ${to ?? "(a contract creation)"}, value ${transaction.value}`,
      ...linkLines(txLinks(input.chain, input.hex)),
      ...(cost === undefined ? [] : [`  ${costLine(cost, input.chain, "what it carried")}`]),
      ...indent(part.lines),
      ...indent(effects?.lines ?? []),
    ].join("\n"),
    json: {
      hash: input.hex,
      ...txLinks(input.chain, input.hex),
      chain: input.chain.slug,
      chainId: input.chain.id,
      status,
      ...(receipt === undefined
        ? {}
        : { blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() }),
      from,
      to,
      value: transaction.value.toString(),
      ...(cost === undefined ? {} : { cost: costJson(cost) }),
      ...part.json,
      ...(effects === undefined ? {} : { effects: effects.json }),
    },
  };
}
