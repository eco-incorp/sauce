/**
 * `sauce inspect`: a cook transaction, a Kitchen or Portal call, a program, or a program file,
 * taken back apart into what a SauceScript author wrote — the Pot and engine a cook names, the
 * program and the arguments it carries, and the intents it opens, with their routes and rewards.
 *
 * Everything is read at the level a program is written at. There is no opcode listing and no
 * disassembly: a program is reported by its size, its hash, the intents whose Portal calls it
 * embeds, and — given the source it was compiled from — the arguments appended to it. The decoders
 * are the SDK's: `decodeRoute`/`hashIntent` for intents, `validateSettleProgram` for the settle,
 * `decodeEntryArguments` for `main`'s arguments.
 */
import {
  bytesToHex,
  decodeFunctionData,
  getAddress,
  hexToBigInt,
  hexToBytes,
  keccak256,
  slice,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";

import { resolveChain, type CanonicalChain } from "../chains/canonical.js";
import { v12DeployedAddresses, v12EngineAddress } from "../deployments/index.js";
import { v12PredictPot } from "../deployments/pot.js";
import { v12KitchenAbi, v12PotAbi } from "../evm/engine.js";
import { PortalABI } from "../protocols/eco-routes/abis.js";
import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { ERC20ABI } from "../protocols/erc20/abis.js";
import { decodeRoute, denormalizeToEvm, hashIntent } from "../routes/encode.js";
import { decodeEntryArguments, type EntryValue } from "../routes/entry.js";
import { toUniversalAddress } from "../routes/normalize.js";
import type { CompiledSauceProgram } from "../routes/sauce-route.js";
import type { Reward, Route, UniversalAddress } from "../routes/types.js";
import { ecoRoutesVaultConfig, predictVaultAddress } from "../routes/vault.js";
import { validateSettleProgram } from "../verify/decode.js";
import { CliError } from "./args.js";
import { connect, receiptOf } from "./chain.js";
import { manifestJson, type CommandOutput } from "./commands.js";
import { linkLines, txLinks } from "./links.js";
import { costJson, costLine, costOf, receiptEffects, receiptReport } from "./receipt.js";

/** What a description needs to know beyond the bytes. */
export interface InspectContext {
  /** The chain the call or program runs on, when known: it names the source of an intent. */
  readonly chain?: CanonicalChain;
  /** The program a cook was compiled from, to read its arguments back against. */
  readonly source?: { readonly file: string; readonly program: CompiledSauceProgram };
  /** The Portal a publication was sent to, when known (a transaction's `to`); otherwise an intent's
   *  vault is derived for `chain`'s registry Portal. */
  readonly portal?: Address;
  /** The intent carries values a program measures as it runs, so its vault is not known yet. */
  readonly measured?: boolean;
}

/** The chain's eco-routes Portal, or `undefined` where the registry has none. */
function registryPortal(chain: CanonicalChain): Address | undefined {
  try {
    return getAddress(ecoRoutesPortal(chain));
  } catch {
    return undefined;
  }
}

/** One described thing: JSON for a program, lines for a person. */
interface Part {
  readonly json: Record<string, unknown>;
  readonly lines: readonly string[];
}

const portalSelector = (name: "publish" | "publishAndFund"): string =>
  toFunctionSelector(
    PortalABI.find(
      (item): item is Extract<(typeof PortalABI)[number], { type: "function" }> =>
        item.type === "function" && item.name === name,
    )!,
  ).slice(2);

/**
 * The two Portal calls a program publishes an intent with: `publish`, after paying the vault itself
 * (the SDK's default), or `publishAndFund`, after approving the Portal. Both take the destination,
 * the route bytes and the reward first.
 */
const PUBLISHING: ReadonlyMap<string, "transfer" | "publishAndFund"> = new Map([
  [portalSelector("publish"), "transfer"],
  [portalSelector("publishAndFund"), "publishAndFund"],
]);

/** How an intent a program opens is funded, as a line and as JSON. */
const funding = (fundVia: "transfer" | "publishAndFund"): Part => ({
  json: { fundVia },
  lines: [
    fundVia === "transfer"
      ? "funded: the program pays the reward into the intent's vault, then calls Portal.publish"
      : "funded: the program approves the Portal, then calls Portal.publishAndFund",
  ],
});

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

/** A 32-byte universal address as the 20-byte one it carries, when it is one. */
function evmOf(address: UniversalAddress): string {
  try {
    return getAddress(denormalizeToEvm(address));
  } catch {
    return address;
  }
}

const chainNamed = (id: bigint): string => {
  const chain = resolveChain(id);

  return chain === undefined ? `chain ${id}` : `${chain.slug} (${id})`;
};

// ---------------------------------------------------------------------------------------------
// Calls a route makes, and calls a transaction makes
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

/** What one call in an intent's route does: a token call, a cook on a Pot, or raw bytes. */
function routeCall(call: Route["calls"][number], depth: number): Part {
  const target = evmOf(call.target);
  const data = call.data;
  const head = `${target}${call.value === 0n ? "" : ` (value ${call.value})`}`;
  const token = erc20Call(data);
  if (token !== undefined) {
    return {
      json: { target, value: call.value.toString(), ...token.json },
      lines: [`${head}.${token.lines[0]}`],
    };
  }
  const cook = depth < 3 ? cookCall(data, {}, depth + 1) : undefined;
  if (cook !== undefined) {
    return {
      json: { target, value: call.value.toString(), ...cook.json },
      lines: [`${head}: ${cook.lines[0]}`, ...cook.lines.slice(1)],
    };
  }

  return {
    json: { target, value: call.value.toString(), data },
    lines: [
      `${head}: ${data.length <= 10 ? data : `${data.slice(0, 10)}… (${(data.length - 2) / 2} bytes)`}`,
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------------------------

interface DecodedReward {
  readonly deadline: bigint;
  readonly creator: Address;
  readonly prover: Address;
  readonly nativeAmount: bigint;
  readonly tokens: readonly { readonly token: Address; readonly amount: bigint }[];
}

/** `publishAndFund`'s reward argument as the SDK's universal `Reward`. */
const universalReward = (reward: DecodedReward): Reward => ({
  deadline: reward.deadline,
  creator: toUniversalAddress(reward.creator),
  prover: toUniversalAddress(reward.prover),
  nativeAmount: reward.nativeAmount,
  tokens: reward.tokens.map((token) => ({
    token: toUniversalAddress(token.token),
    amount: token.amount,
  })),
});

/** The intent `publishAndFund(destination, route, reward, allowPartial)` carries. */
function publishedIntent(
  destination: bigint,
  routeBytes: Hex,
  reward: DecodedReward,
  context: InspectContext,
  depth: number,
): Part {
  const kind = resolveChain(destination)?.kind === "svm" ? "svm" : "evm";

  return intentPart(
    destination,
    decodeRoute(routeBytes, kind),
    universalReward(reward),
    context,
    depth,
  );
}

/** An intent: where it goes, what its route does there, and what it pays for that. */
function intentPart(
  destination: bigint,
  route: Route,
  universal: Reward,
  context: InspectContext,
  depth: number,
): Part {
  const destinationChain = resolveChain(destination);
  const reward = {
    deadline: universal.deadline,
    creator: evmOf(universal.creator),
    prover: evmOf(universal.prover),
    nativeAmount: universal.nativeAmount,
    tokens: universal.tokens.map((t) => ({ token: evmOf(t.token), amount: t.amount })),
  };
  const hashes =
    context.chain === undefined
      ? undefined
      : hashIntent({
          destination,
          sourceChainId: BigInt(context.chain.id),
          route,
          reward: universal,
        });
  // Where the reward is escrowed — the address a funder pays into before `publish` — derived as the
  // SDK derives it, for the Portal the call went to or, failing that, the chain's registry Portal.
  const portal =
    context.portal ?? (context.chain === undefined ? undefined : registryPortal(context.chain));
  const vault =
    hashes === undefined || portal === undefined || context.measured === true
      ? undefined
      : predictVaultAddress(hashes.intentHash, ecoRoutesVaultConfig(portal));
  const calls = route.calls.map((call) => routeCall(call, depth));
  const tokens = (list: readonly { token: string; amount: bigint }[]): string =>
    list.length === 0 ? "none" : list.map((t) => `${t.amount} of ${t.token}`).join(", ");

  return {
    json: {
      destination: {
        id: destination.toString(),
        ...(destinationChain === undefined ? {} : { chain: destinationChain.slug }),
      },
      ...(hashes === undefined ? {} : hashes),
      ...(vault === undefined ? {} : { vault }),
      route: {
        salt: route.salt,
        deadline: route.deadline.toString(),
        portal: evmOf(route.portal),
        nativeAmount: route.nativeAmount.toString(),
        tokens: route.tokens.map((t) => ({ token: evmOf(t.token), amount: t.amount.toString() })),
        calls: calls.map((call) => call.json),
      },
      reward: jsonValue(reward),
    },
    lines: [
      `intent to ${chainNamed(destination)}${hashes === undefined ? "" : `, hash ${hashes.intentHash}`}`,
      ...indent([
        `reward: ${tokens(reward.tokens)}${reward.nativeAmount === 0n ? "" : ` and ${reward.nativeAmount} wei`}, ` +
          `to whoever proves it through ${reward.prover} by ${reward.deadline}; creator ${reward.creator}`,
        ...(vault === undefined
          ? []
          : [`vault: ${vault}, funded once it holds the reward (Portal ${portal})`]),
        `route: deadline ${route.deadline}, delivers ${tokens(
          route.tokens.map((t) => ({ token: evmOf(t.token), amount: t.amount })),
        )}, then calls:`,
        ...indent(calls.flatMap((call) => call.lines)),
      ]),
    ],
  };
}

/** `part` with how it is funded beside it. */
const fundedBy = (part: Part, fundVia: "transfer" | "publishAndFund"): Part => ({
  json: { ...part.json, ...funding(fundVia).json },
  lines: [part.lines[0]!, ...indent(funding(fundVia).lines), ...part.lines.slice(1)],
});

/** Every `publish` and `publishAndFund` a program embeds, in the order its bytes carry them,
 *  decoded where its bytes are all known at compile time. */
function embeddedIntents(program: Uint8Array, context: InspectContext, depth: number): Part[] {
  const hex = bytesToHex(program).slice(2);
  const sites = [...PUBLISHING]
    .flatMap(([selector, fundVia]) => {
      const found: { at: number; fundVia: "transfer" | "publishAndFund" }[] = [];
      for (let at = hex.indexOf(selector); at >= 0; at = hex.indexOf(selector, at + 2)) {
        if (at % 2 === 0) found.push({ at, fundVia });
      }

      return found;
    })
    .sort((a, b) => a.at - b.at);
  const parts: Part[] = [];
  for (const { at, fundVia } of sites) {
    const data = `0x${hex.slice(at)}` as Hex;
    const expected = fundVia === "transfer" ? "publish" : "publishAndFund";
    try {
      const decoded = decodeFunctionData({ abi: PortalABI, data });
      if (decoded.functionName !== expected) continue;
      const [destination, routeBytes, reward] = decoded.args as unknown as [
        bigint,
        Hex,
        DecodedReward,
      ];
      parts.push(
        fundedBy(publishedIntent(destination, routeBytes, reward, context, depth), fundVia),
      );
    } catch {
      // Split around values the program measures when it runs: only the destination, the first
      // argument, is whole. The rest is filled in on chain.
      if (data.length < 2 + 8 + 64) continue;
      const destination = hexToBigInt(slice(data, 4, 36));
      if (destination >> 64n !== 0n) continue;
      parts.push(
        fundedBy(
          {
            json: {
              destination: {
                id: destination.toString(),
                ...(resolveChain(destination) === undefined
                  ? {}
                  : { chain: resolveChain(destination)!.slug }),
              },
              measured: true,
            },
            lines: [
              `intent to ${chainNamed(destination)}, with values the program measures when it ` +
                "runs (inspect its source file to see them)",
            ],
          },
          fundVia,
        ),
      );
    }
  }

  return parts;
}

// ---------------------------------------------------------------------------------------------
// Programs and cooks
// ---------------------------------------------------------------------------------------------

/** A program: its size and hash, the settle it is if it is one, its arguments, its intents. */
function programPart(
  program: Uint8Array,
  context: InspectContext,
  depth: number,
  scan = true,
): Part {
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
  let code = program;
  const source = depth === 0 ? context.source : undefined;
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
      code = compiled;
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
  if (scan) {
    const intents = embeddedIntents(code, context, depth);
    json.intents = intents.map((intent) => intent.json);
    lines.push(...indent(intents.flatMap((intent) => intent.lines)));
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
function cookCall(data: Hex, context: InspectContext, depth: number): Part | undefined {
  let engine: Address;
  let program: Hex;
  try {
    const decoded = decodeFunctionData({ abi: v12PotAbi, data });
    if (decoded.functionName !== "cook") return undefined;
    [engine, program] = decoded.args as readonly [Address, Hex];
  } catch {
    return undefined;
  }
  const described = programPart(hexToBytes(program), context, depth);

  return {
    json: {
      call: "Pot.cook",
      engine: { address: engine, released: engineName(engine) !== "not the released engine" },
      program: described.json,
    },
    lines: [`Pot.cook on engine ${engine} (${engineName(engine)})`, ...indent(described.lines)],
  };
}

/** What `data` calls: a cook, a Kitchen or Portal call, a token call — or a program itself. */
export function describeData(data: Hex, given: InspectContext): Part {
  // The call's target is the Portal only when the call is the Portal's: a cook's target is a Pot,
  // and the intents its program publishes go to the chain's Portal.
  const { portal: target, ...context } = given;
  const cook = cookCall(data, context, 0);
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
  try {
    const portal = decodeFunctionData({ abi: PortalABI, data });
    if (portal.functionName === "publishAndFund" || portal.functionName === "publish") {
      const [destination, routeBytes, reward] = portal.args as unknown as [
        bigint,
        Hex,
        DecodedReward,
      ];
      const intent = publishedIntent(
        destination,
        routeBytes,
        reward,
        target === undefined ? context : { ...context, portal: target },
        0,
      );

      return {
        json: { call: `Portal.${portal.functionName}`, intent: intent.json },
        lines: [`Portal.${portal.functionName}:`, ...indent(intent.lines)],
      };
    }

    return {
      json: { call: `Portal.${portal.functionName}`, args: jsonValue(portal.args) },
      lines: [`Portal.${portal.functionName}(${(portal.args ?? []).map(shown).join(", ")})`],
    };
  } catch {
    // Not a Portal call.
  }
  const token = erc20Call(data);
  if (token !== undefined) {
    return { json: { call: `ERC20.${token.json.function}`, ...token.json }, lines: token.lines };
  }
  // No call this knows: read it as a program (or a payload: a program and its arguments).
  const program = programPart(hexToBytes(data), context, 0);

  return { json: { call: null, program: program.json }, lines: program.lines };
}

/** `sauce inspect <file>`: the program the file compiles to, and what it takes. */
export function inspectFile(file: string, program: CompiledSauceProgram): CommandOutput {
  const described = programPart(program.bytecode, {}, 1, false);
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
  const part = describeData(transaction.input, to === null ? input : { ...input, portal: to });
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
