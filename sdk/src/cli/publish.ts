/**
 * `sauce publish`: the intents a file opens, published from a wallet on the source chain — no Pot.
 *
 * For a file whose intents are FIXED when it is built: every amount a define or a literal. Then the
 * SDK's own lowering (`compileSauceProgram(...).intents`) has already encoded each intent exactly,
 * and publishing it is what the TypeScript builder hands a caller: the reward approvals and
 * `Portal.publishAndFund` (`routes/portal.ts`), sent from the wallet instead of a program. An
 * amount the program measures on chain (`const amount = USDC.balanceOf(ctx.self())`) exists only
 * while the program runs, so such an intent is published by running the program on a Pot —
 * `sauce run` — and `publish` refuses it, naming the value.
 *
 * So does a file that does anything besides open its intents: `publish` sends only the intents,
 * and silently dropping the rest of a program would be worse than refusing it.
 */
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { denormalizeToEvm, hashIntent } from "../routes/encode.js";
import { isTypeDeclaration } from "../routes/ast-walk.js";
import type { LoweredIntent } from "../routes/intent-sugar.js";
import { approvalTxs, publishAndFundTx } from "../routes/portal.js";
import { parseSauce } from "../routes/parse.js";
import { CliError, UsageError } from "./args.js";
import { assumeTokenBalance, mergeOverrides } from "./assume.js";
import { connect, revertReason, sendAndWait, type Sent, type TxRequest } from "./chain.js";
import {
  castSend,
  compileProgram,
  type CliFiles,
  type CommandOutput,
  type ProgramInput,
} from "./commands.js";
import { nativeSymbol, tokenInfo } from "./effects.js";
import { baseUnits, type FundRequest } from "./funding.js";

const ERC20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** A node of the SauceScript parser's tree, as far as this reads it. */
interface Node {
  readonly type: string;
  readonly loc?: { readonly start: { readonly line: number } };
  readonly [key: string]: unknown;
}

const isIntentSite = (node: Node): boolean => {
  const call = node.type === "ExpressionStatement" ? (node.expression as Node) : undefined;
  const callee = call?.type === "CallExpression" ? (call.callee as Node) : undefined;
  const property = callee?.type === "MemberExpression" ? (callee.property as Node) : undefined;
  const opened = callee?.object as Node | undefined;

  return (
    property?.type === "Identifier" &&
    property.name === "reward" &&
    opened?.type === "CallExpression" &&
    (opened.callee as Node).type === "Identifier"
  );
};

/** True when `node` holds no call: a value fixed at compile time, not something done at run time. */
const callFree = (node: unknown): boolean => {
  if (node === null || typeof node !== "object") return true;
  if ((node as Node).type === "CallExpression" || (node as Node).type === "NewExpression") {
    return false;
  }

  return Object.values(node).every(callFree);
};

/** A top-level statement that declares rather than runs: an import, a function, a type. */
const isDeclaration = (node: Node): boolean =>
  node.type === "ImportDeclaration" ||
  node.type === "FunctionDeclaration" ||
  node.type === "ExportNamedDeclaration" ||
  isTypeDeclaration(node.type);

/**
 * The first statement of `text`'s program that is neither one of its intents nor a declaration of
 * a fixed value, as `file:line`; `undefined` when the program only opens intents. The program's
 * statements are `main`'s body in a module, and the top-level statements of a script.
 */
function otherStatement(file: string, text: string): string | undefined {
  const program = parseSauce(text) as unknown as { body: Node[] };
  const main = program.body.find(
    (node) => node.type === "FunctionDeclaration" && (node.id as Node).name === "main",
  );
  const statements =
    main === undefined
      ? program.body.filter((node) => !isDeclaration(node))
      : (((main.body as Node | undefined)?.body as Node[] | undefined) ?? []);
  const other = statements.find(
    (node) => !isIntentSite(node) && !(node.type === "VariableDeclaration" && callFree(node)),
  );

  return other === undefined ? undefined : `${file}:${other.loc!.start.line}`;
}

/** The intents `input`'s file opens, refusing a file that is not only fixed intents. */
function fixedIntents(input: ProgramInput, files: CliFiles): readonly LoweredIntent[] {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `sauce publish sends source-chain Portal transactions, and ${input.chain.slug} is not an ` +
        "EVM chain: the eco-routes Portal this SDK addresses is EVM only.",
    );
  }
  const program = compileProgram(input, files);
  if (program.intents.length === 0) {
    throw new UsageError(
      `${input.file} opens no intent — there is nothing to publish. Run it on a Pot with ` +
        "`sauce run` instead.",
    );
  }
  if (program.entryParams.length > 0) {
    throw new UsageError(
      `${input.file} takes arguments at run time (main(${program.entryParams.map((p) => p.name).join(", ")})), ` +
        "which only a run has: use `sauce run` on a Pot",
    );
  }
  const measured = program.intents.find((intent) => intent.captures.length > 0);
  if (measured !== undefined) {
    throw new CliError(
      `the intent to ${measured.destination.slug} uses ${measured.captures.map((name) => `\`${name}\``).join(", ")}, ` +
        "measured on chain while the program runs, so it cannot be built from a wallet: use " +
        "`sauce run` on a Pot",
    );
  }
  const other = otherStatement(input.file, input.text);
  if (other !== undefined) {
    throw new CliError(
      `${other} does something besides open an intent, and publish sends only the intents: ` +
        "use `sauce run` on a Pot to run the whole program",
    );
  }

  return program.intents;
}

/** One transaction of the plan, and what it is for. */
interface Step extends TxRequest {
  readonly what: string;
}

/**
 * The transactions that publish `intent` from `from`: each reward token approved to the Portal —
 * reset to zero first when a smaller allowance stands, as SafeERC20's `forceApprove` does, which
 * a USDT-style token requires — then `publishAndFund`. With no chain to read, the approvals are
 * the plain ones `approvalTxs` returns.
 */
async function stepsFor(
  intent: LoweredIntent,
  portal: Hex,
  client: PublicClient | undefined,
  from: Address | undefined,
): Promise<Step[]> {
  const steps: Step[] = [];
  for (const approval of approvalTxs(intent.intent, { portal })) {
    const token = getAddress(approval.to);
    const amount = intent.intent.reward.tokens
      .filter((entry) => getAddress(denormalizeToEvm(entry.token)) === token)
      .reduce((max, entry) => (entry.amount > max ? entry.amount : max), 0n);
    const standing =
      client === undefined || from === undefined
        ? undefined
        : await client.readContract({
            address: token,
            abi: ERC20,
            functionName: "allowance",
            args: [from, portal],
          });
    // Enough standing already: the Portal pulls `amount` and no more.
    if (standing !== undefined && standing >= amount) continue;
    if (standing !== undefined && standing !== 0n) {
      steps.push({
        what: `reset ${token}'s allowance to the Portal`,
        to: token,
        data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [portal, 0n] }),
        value: 0n,
      });
    }
    steps.push({ what: `approve ${token} to the Portal`, ...approval, to: token });
  }
  const publish = publishAndFundTx(intent.intent, false, { portal });
  steps.push({ what: "publishAndFund", ...publish, to: getAddress(publish.to) });

  return steps;
}

export interface PublishInput extends ProgramInput {
  /** Print the unsigned transactions, in this format, instead of sending them. */
  readonly format?: "json" | "cast";
  /** Rehearse the transactions together through `eth_simulateV1`, and send nothing. */
  readonly dryRun: boolean;
  readonly rpcUrl?: string;
  readonly account?: PrivateKeyAccount;
  /** Whose wallet, where no signer is given: for a dry run, or to plan exact approvals. */
  readonly from?: Address;
  /** `--assume-balance`, with a dry run: what the wallet holds, for the rehearsal only. */
  readonly assume?: readonly FundRequest[];
}

/** The wallet's balances `--assume-balance` sets for a dry run, as state overrides, and lines that
 *  say so. */
async function walletBalances(
  client: PublicClient,
  input: PublishInput,
  wallet: Address,
): Promise<{ overrides: StateOverride; lines: string[]; json: Record<string, string>[] }> {
  const overrides: StateOverride[number][] = [];
  const lines: string[] = [];
  const json: Record<string, string>[] = [];
  for (const request of input.assume ?? []) {
    const amount = await baseUnits(client, request);
    if (request.token === undefined) {
      overrides.push({ address: wallet, balance: amount });
      lines.push(`  ${wallet} holds ${formatUnits(amount, 18)} ${nativeSymbol(input.chain)}`);
      json.push({ holder: wallet, token: "native", amount: amount.toString() });
      continue;
    }
    const info = await tokenInfo(client, input.chain, request.token);
    const symbol = info.symbol ?? request.label;
    const found = await assumeTokenBalance(client, request.token, wallet, amount, symbol);
    overrides.push(found.override);
    json.push({
      holder: wallet,
      token: request.token,
      symbol,
      amount: amount.toString(),
      slot: found.slot,
      layout: found.layout,
    });
    lines.push(
      `  ${wallet} holds ${info.decimals === undefined ? `${amount} ${symbol} (base units)` : `${formatUnits(amount, info.decimals)} ${symbol}`} ` +
        `(its balance word ${found.slot}: ${found.layout})`,
    );
  }

  return {
    overrides: mergeOverrides(overrides),
    lines:
      lines.length === 0 ? [] : ["Assumed for this rehearsal only, by state override:", ...lines],
    json,
  };
}

const stepJson = (step: Step): Record<string, string> => ({
  what: step.what,
  to: step.to,
  data: step.data,
  value: step.value.toString(),
});

/** `sauce publish`: send, rehearse or print the Portal transactions of a file's fixed intents. */
export async function publishCommand(input: PublishInput, files: CliFiles): Promise<CommandOutput> {
  const intents = fixedIntents(input, files);
  const portal = ecoRoutesPortal(input.chain);
  const from = input.account?.address ?? input.from;
  const client = input.rpcUrl === undefined ? undefined : await connect(input.rpcUrl, input.chain);
  const plans = await Promise.all(
    intents.map(async (intent) => ({
      intent,
      hash: hashIntent(intent.intent).intentHash,
      steps: await stepsFor(intent, portal, client, from),
    })),
  );
  const summary = plans.map((plan) => `intent ${plan.hash} to ${plan.intent.destination.slug}`);

  if (input.format !== undefined) {
    const json = {
      chainId: input.chain.id,
      portal,
      intents: plans.map((plan) => ({
        intentHash: plan.hash,
        destination: plan.intent.destination.slug,
        transactions: plan.steps.map(stepJson),
      })),
    };

    return {
      text: JSON.stringify(json, null, 2),
      json,
      cast: plans
        .flatMap((plan) => plan.steps.map((step) => castSend(step.to, step.data, step.value)))
        .join("\n"),
      notes: [
        ...summary,
        ...(client === undefined || from === undefined
          ? [
              "Approvals are planned without reading the wallet's allowance: a USDT-style token " +
                "with a different allowance standing needs approve(Portal, 0) first.",
            ]
          : []),
        "Send them in order, from the wallet that funds the reward.",
      ],
    };
  }
  if (client === undefined) {
    throw new UsageError(
      "missing --rpc-url <url> (or --config <file>): the source chain's endpoint",
    );
  }
  if (input.dryRun) {
    if (from === undefined) {
      throw new UsageError("a dry run needs whose wallet: a signer, or --from <address>");
    }
    const calls = plans.flatMap((plan) => plan.steps);
    const assumed = await walletBalances(client, input, from);
    let results: ReadonlyArray<{ status: string; error?: unknown; gasUsed?: bigint }>;
    try {
      ({ results } = await client.simulateCalls({
        account: from,
        calls,
        ...(assumed.overrides.length === 0 ? {} : { stateOverrides: assumed.overrides }),
      }));
    } catch (error) {
      throw new CliError(
        `the endpoint could not simulate the transactions together (eth_simulateV1): ${revertReason(error)}`,
      );
    }
    const failed = results.findIndex((result) => result.status !== "success");
    const lines = calls.map((step, index) =>
      results[index]?.status === "success"
        ? `${step.what}: succeeds, gas ${results[index]!.gasUsed}`
        : `${step.what}: reverts: ${revertReason(results[index]?.error)}`,
    );

    return {
      text: [...summary, ...assumed.lines, ...lines].join("\n"),
      json: {
        ok: failed < 0,
        from,
        ...(assumed.json.length === 0 ? {} : { assumed: assumed.json }),
        intents: plans.map((plan) => ({
          intentHash: plan.hash,
          destination: plan.intent.destination.slug,
        })),
        // What the text says of each, as fields: its gas, or why it reverts.
        transactions: calls.map((step, index) => {
          const result = results[index];

          return {
            ...stepJson(step),
            status: result?.status ?? "not run",
            ...(result?.status === "success" && result.gasUsed !== undefined
              ? { gasUsed: result.gasUsed.toString() }
              : {}),
            ...(result !== undefined && result.status !== "success"
              ? { reason: revertReason(result.error) }
              : {}),
          };
        }),
      },
      notes: [
        `This rehearses publishing on ${input.chain.slug} only. What the intent does runs on ` +
          `${[...new Set(plans.map((plan) => plan.intent.destination.slug))].join(" and ")}, when ` +
          "a solver fills it: `sauce fill` with the same file and flags, and the destination's " +
          "endpoint, rehearses that.",
      ],
      ...(failed < 0 ? {} : { exitCode: 1 }),
    };
  }
  if (input.account === undefined) {
    throw new UsageError(
      "missing a signer to publish from: --keystore <path> or --private-key <hex> (or print the " +
        "unsigned transactions with --format json)",
    );
  }
  const sent: Array<{ readonly step: Step; readonly result: Sent }> = [];
  for (const plan of plans) {
    for (const step of plan.steps) {
      const result = await sendAndWait(client, input.rpcUrl!, input.account, step);
      sent.push({ step, result });
      if (result.status !== "success") {
        throw new CliError(`${step.what} ${result.hash} reverted: ${result.reason ?? "no reason"}`);
      }
    }
  }

  return {
    text: [
      ...summary,
      ...sent.map(
        ({ step, result }) =>
          `${step.what} ${result.hash}: ${result.status}, gas used ${result.gasUsed}`,
      ),
    ].join("\n"),
    json: {
      from: input.account.address,
      portal,
      intents: plans.map((plan) => ({
        intentHash: plan.hash,
        destination: plan.intent.destination.slug,
      })),
      transactions: sent.map(({ step, result }) => ({
        what: step.what,
        hash: result.hash,
        status: result.status,
        gasUsed: result.gasUsed.toString(),
      })),
    },
  };
}
