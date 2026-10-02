/**
 * `sauce intent publish`: the intents a file opens, published from a wallet on the source chain — no Pot.
 *
 * For a file whose intents are FIXED when it is built: every amount a literal, one of `main`'s
 * arguments bound by `--args` (`inputs.ts#bindMainArguments`), or a top-level `const` of a literal. Then the SDK's own lowering (`compileSauceProgram(...).intents`)
 * has already encoded each intent exactly, and publishing it is what the TypeScript builder hands a
 * caller (`routes/portal.ts` `intentSourceTxs`), sent from the wallet instead of a program. An
 * amount the program measures on chain (`const amount = USDC.balanceOf(ctx.self())`) exists only
 * while the program runs, so such an intent is published by running the program on a Pot —
 * `sauce run` — and `publish` refuses it, naming the value.
 *
 * So does a file that does anything besides open its intents: `publish` sends only the intents,
 * and silently dropping the rest of a program would be worse than refusing it.
 *
 * HOW THE REWARD IS FUNDED (`--intent-fund-via`). By default, `transfer`: each reward token is
 * transferred to the intent's vault, the native amount sent to it, and then `Portal.publish` — no
 * approval, so nothing for USDT to refuse and no allowance left standing. The vault is the SDK's
 * offline derivation (`predictIntentVault`); with an endpoint it is also read from the Portal and
 * the two must agree, or nothing is sent (a lying endpoint cannot redirect the reward). Only what
 * the vault does not already hold is transferred, and before `publish` is sent the Portal is asked
 * whether the intent is funded — so a token that returned `false`, or kept a fee, stops the
 * publication with the funds still in the vault, where a later publish or a refund after the
 * deadline recovers them. `publishAndFund`: each reward token approved to the Portal (reset to zero
 * first when a smaller allowance stands, as SafeERC20's `forceApprove` does), then
 * `publishAndFund`, which records the intent `Funded` and emits `IntentFunded`.
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
import { isTypeDeclaration, type AstNode } from "../routes/ast-walk.js";
import type { LoweredIntent } from "../routes/intent-host.js";
import {
  approvalTxs,
  assertIntentVault,
  intentVaultAddressCall,
  IntentVaultMismatchError,
  isIntentFundedCall,
  predictIntentVault,
  publishAndFundTx,
  publishTx,
  rewardVaultLegs,
  vaultTransferTx,
  type IntentFundVia,
  type VaultLeg,
} from "../routes/portal.js";
import { parseSauce } from "../routes/parse.js";
import { CliError, UsageError } from "./args.js";
import { assumeTokenBalance, mergeOverrides } from "./assume.js";
import { connect, revertReason, sendAndWait, type Sent, type TxRequest } from "./chain.js";
import {
  castSend,
  compileProgram,
  priceLimitNotes,
  refusePastDeadline,
  type CliFiles,
  type CommandOutput,
  type ProgramInput,
} from "./commands.js";
import { nativeSymbol, tokenInfo } from "./effects.js";
import { baseUnits, type FundRequest } from "./funding.js";
import { portalMethod, portalRoot } from "./intent-calls.js";
import { intentDestinations, requireSupported } from "./support.js";

const ERC20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/** A node of the SauceScript parser's tree, as far as this reads it. */
interface Node {
  readonly type: string;
  readonly loc?: { readonly start: { readonly line: number } };
  readonly [key: string]: unknown;
}

const isIntentSite = (node: Node): boolean => {
  const call = node.type === "ExpressionStatement" ? (node.expression as Node) : undefined;

  const method = call?.type === "CallExpression" ? portalMethod(call as AstNode) : undefined;

  return (method === "then" || method === "catch") && portalRoot(call as AstNode) !== undefined;
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
function fixedIntents(input: PublishInput, files: CliFiles): readonly LoweredIntent[] {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `sauce intent publish sends source-chain Portal transactions, and ${input.chain.slug} is not an ` +
        "EVM chain: the eco-routes Portal this SDK addresses is EVM only.",
    );
  }
  // The wallet that publishes them is the creator of each that names none, unless the flags name
  // another.
  const publisher = input.intents.creator ?? input.account?.address ?? input.from;
  const program = compileProgram(
    publisher === undefined ? input : { ...input, intents: { ...input.intents, publisher } },
    files,
  );
  if (program.intents.length === 0) {
    throw new UsageError(
      `${input.file} opens no intent — there is nothing to publish. Run it on a Pot with ` +
        "`sauce run` instead.",
    );
  }
  if (program.entryParams.length > 0) {
    throw new UsageError(
      `${input.file} takes arguments (main(${program.entryParams.map((p) => p.name).join(", ")})): ` +
        "give them with --args, and they are bound into the intents; or run it on a Pot with " +
        "`sauce run`",
    );
  }
  const measured = program.intents.find((intent) => intent.captures.length > 0);
  if (measured !== undefined) {
    throw new CliError(
      `the intent to ${measured.destination.slug} uses ${measured.captures.map((name) => `\`${name}\``).join(", ")}, ` +
        "which the program measures or computes while it runs, so it cannot be built from a " +
        "wallet: use `sauce run` on a Pot, or make it a literal, one of main's arguments (given " +
        "with --args) or a top-level `const` of a literal",
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
  /** The `publish` that follows a vault's funding: sent only once the Portal counts it funded. */
  readonly publishes?: boolean;
}

/** One intent's transactions, and the vault they fund. */
interface Plan {
  readonly intent: LoweredIntent;
  readonly hash: Hex;
  readonly fundVia: IntentFundVia;
  /** Where the reward is escrowed: the SDK's derivation, which the Portal agreed with when
   *  `vaultFrom` is `"read"`. */
  readonly vault: Address;
  readonly vaultFrom: "read" | "derived";
  readonly steps: readonly Step[];
}

/**
 * The intent's vault: the SDK's derivation and, with an endpoint, the Portal's own answer, which
 * must agree — a transfer is final, so an address two sources disagree on is not paid.
 */
async function vaultOf(
  intent: LoweredIntent,
  portal: Hex,
  client: PublicClient | undefined,
): Promise<{ readonly vault: Address; readonly vaultFrom: "read" | "derived" }> {
  const target = { portal };
  if (client === undefined) {
    return { vault: predictIntentVault(intent.intent, target), vaultFrom: "derived" };
  }
  const call = intentVaultAddressCall(intent.intent, target);
  let reported: Hex;
  try {
    reported = call.decode((await client.call({ to: call.to, data: call.data })).data ?? "0x");
  } catch (error) {
    throw new CliError(
      `could not read the intent's vault from the Portal ${portal}: ${revertReason(error)}`,
    );
  }
  try {
    return { vault: assertIntentVault(intent.intent, target, reported), vaultFrom: "read" };
  } catch (error) {
    if (error instanceof IntentVaultMismatchError) {
      throw new CliError(
        `the Portal ${portal} reports the intent's vault as ${error.reported}, but the SDK derives ` +
          `${error.predicted}: refusing to send the reward to either, and nothing was sent. The ` +
          "endpoint may be answering for another chain, or this Portal derives its vaults some " +
          "other way. --intent-fund-via publishAndFund funds it through the Portal instead, " +
          "which moves the reward itself.",
      );
    }
    throw error;
  }
}

/** What the vault already holds of one leg of the reward, read from the chain. */
async function heldBy(client: PublicClient, vault: Address, leg: VaultLeg): Promise<bigint> {
  return leg.token === undefined
    ? client.getBalance({ address: vault })
    : client.readContract({
        address: leg.token,
        abi: ERC20,
        functionName: "balanceOf",
        args: [vault],
      });
}

/**
 * The transactions that fund and publish `intent` from `from`, as `fundVia` says:
 *
 *  - `"transfer"`: what the vault does not hold yet of each reward leg, transferred to it (all of
 *    it, with no chain to read), then `publish`;
 *  - `"publishAndFund"`: each reward token approved to the Portal — reset to zero first when a
 *    smaller allowance stands, as SafeERC20's `forceApprove` does, which a USDT-style token
 *    requires — then `publishAndFund`. With no chain to read, the approvals are the plain ones
 *    `approvalTxs` returns.
 */
async function planFor(
  intent: LoweredIntent,
  input: PublishInput,
  portal: Hex,
  client: PublicClient | undefined,
  from: Address | undefined,
): Promise<Plan> {
  const fundVia = input.intents.fundVia ?? "transfer";
  const hash = hashIntent(intent.intent).intentHash;
  if (fundVia === "publishAndFund") {
    return {
      intent,
      hash,
      fundVia,
      vault: predictIntentVault(intent.intent, { portal }),
      vaultFrom: "derived",
      steps: await approveSteps(intent, portal, client, from),
    };
  }
  const { vault, vaultFrom } = await vaultOf(intent, portal, client);
  const steps: Step[] = [];
  const legs = rewardVaultLegs(intent.intent);
  const holdings = await Promise.all(
    legs.map((leg) => (client === undefined ? 0n : heldBy(client, vault, leg))),
  );
  for (const [index, leg] of legs.entries()) {
    const held = holdings[index]!;
    // Already there — a vault paid earlier, or a reward shared with another intent's — needs
    // nothing more: `isIntentFunded` compares balances, not who paid them.
    if (held >= leg.amount) continue;
    const tx = vaultTransferTx(vault, { ...leg, amount: leg.amount - held });
    steps.push({
      what:
        leg.token === undefined
          ? `send ${nativeSymbol(input.chain)} to the vault`
          : `transfer ${leg.token} to the vault`,
      ...tx,
      to: getAddress(tx.to),
    });
  }
  const publish = publishTx(intent.intent, { portal });
  steps.push({ what: "publish", ...publish, to: getAddress(publish.to), publishes: true });

  return { intent, hash, fundVia, vault, vaultFrom, steps };
}

/** `fundVia: "publishAndFund"`'s transactions — see {@link planFor}. */
async function approveSteps(
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
  /** Called with each transaction sent, for what it published (the store); returns notes. */
  readonly onSent?: (sent: Sent) => Promise<readonly string[]>;
}

/** The wallet's balances `--assume-balance` sets for a dry run, as state overrides, and lines that
 *  say so. */
async function walletBalances(
  client: PublicClient,
  input: PublishInput,
  wallet: Address,
): Promise<{
  overrides: StateOverride;
  lines: string[];
  json: Record<string, string>[];
  notes: string[];
}> {
  const overrides: StateOverride[number][] = [];
  const lines: string[] = [];
  const json: Record<string, string>[] = [];
  const notes: string[] = [];
  for (const request of input.assume ?? []) {
    const { amount, note } = await baseUnits(client, request);
    if (note !== undefined) notes.push(note);
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
    notes,
  };
}

const stepJson = (step: Step): Record<string, string> => ({
  what: step.what,
  to: step.to,
  data: step.data,
  value: step.value.toString(),
});

/** An intent as each output names it: its hash, where it goes, how it is funded, and the vault. */
const intentJson = (plan: Plan): Record<string, string> => ({
  intentHash: plan.hash,
  destination: plan.intent.destination.slug,
  fundVia: plan.fundVia,
  vault: plan.vault,
});

/** `Portal.isIntentFunded` for `plan`'s intent, as a call to simulate or send. */
const fundedQuery = (plan: Plan, portal: Hex): TxRequest => {
  const call = isIntentFundedCall(plan.intent.intent, { portal });

  return { to: getAddress(call.to), data: call.data, value: 0n };
};

/** What the Portal says of `plan`'s intent now: whether its vault holds the reward. */
async function fundedNow(client: PublicClient, plan: Plan, portal: Hex): Promise<boolean> {
  const query = isIntentFundedCall(plan.intent.intent, { portal });

  return query.decode((await client.call({ to: query.to, data: query.data })).data ?? "0x");
}

/** `sauce intent publish`: send, rehearse or print the Portal transactions of a file's fixed intents. */
export async function publishCommand(input: PublishInput, files: CliFiles): Promise<CommandOutput> {
  // What no funding path can fix, refused or named first, for every front end: a deadline that has
  // passed, and a price limit at a bound, which fills nothing on the destination.
  refusePastDeadline(input);
  const limits = priceLimitNotes(input, [], undefined);
  const output = await publishIntents(input, files);

  return limits.length === 0 ? output : { ...output, notes: [...limits, ...(output.notes ?? [])] };
}

/** `publishCommand` past its checks: the plans, and what it prints, rehearses or sends. */
async function publishIntents(input: PublishInput, files: CliFiles): Promise<CommandOutput> {
  const intents = fixedIntents(input, files);
  // A dry run only rehearses; the transactions, printed or sent, go only where every chain is
  // supported.
  if (input.format !== undefined || !input.dryRun) {
    requireSupported("publishing intents", [input.chain, ...intentDestinations(intents)]);
  }
  const portal = ecoRoutesPortal(input.chain);
  const from = input.account?.address ?? input.from;
  const client = input.rpcUrl === undefined ? undefined : await connect(input.rpcUrl, input.chain);
  const plans = await Promise.all(
    intents.map((intent) => planFor(intent, input, portal, client, from)),
  );
  const summary = plans.map(
    (plan) =>
      `intent ${plan.hash} to ${plan.intent.destination.slug}, ` +
      (plan.fundVia === "transfer"
        ? `funded by transfer to its vault ${plan.vault}, then publish`
        : `funded through publishAndFund into its vault ${plan.vault}`),
  );

  if (input.format !== undefined) {
    const json = {
      chainId: input.chain.id,
      portal,
      intents: plans.map((plan) => ({
        ...intentJson(plan),
        vaultFrom: plan.vaultFrom,
        transactions: plan.steps.map(stepJson),
      })),
    };
    const transfers = plans.some((plan) => plan.fundVia === "transfer");
    const approvals = plans.some((plan) => plan.fundVia === "publishAndFund");

    return {
      text: JSON.stringify(json, null, 2),
      json,
      cast: plans
        .flatMap((plan) => plan.steps.map((step) => castSend(step.to, step.data, step.value)))
        .join("\n"),
      notes: [
        ...summary,
        ...(transfers && client === undefined
          ? [
              "Each vault is the SDK's offline derivation for the Portal, and every transfer is " +
                "for the whole reward: with --rpc-url the vault is also read from the Portal, " +
                "which must agree, and only what it does not hold yet is transferred.",
            ]
          : []),
        ...(approvals && (client === undefined || from === undefined)
          ? [
              "Approvals are planned without reading the wallet's allowance: a USDT-style token " +
                "with a different allowance standing needs approve(Portal, 0) first.",
            ]
          : []),
        "Send them in order, from the wallet that funds the reward.",
        ...(transfers
          ? [
              "The transfers come first: publish only once they have landed. If publish fails, " +
                "the reward stays in the vault — publish again, or refund it after the reward " +
                "deadline.",
            ]
          : []),
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
    let results: ReadonlyArray<{ status: string; error?: unknown; gasUsed?: bigint; data?: Hex }>;
    try {
      ({ results } = await client.simulateCalls({
        account: from,
        // After every transaction, the Portal is asked what a solver asks: is each intent funded.
        calls: [...calls, ...plans.map((plan) => fundedQuery(plan, portal))],
        ...(assumed.overrides.length === 0 ? {} : { stateOverrides: assumed.overrides }),
      }));
    } catch (error) {
      throw new CliError(
        `the endpoint could not simulate the transactions together (eth_simulateV1): ${revertReason(error)}`,
      );
    }
    const failed = results.slice(0, calls.length).findIndex((r) => r.status !== "success");
    const funded = plans.map((plan, index) => {
      const result = results[calls.length + index];
      if (failed >= 0 || result?.status !== "success") return undefined;

      return isIntentFundedCall(plan.intent.intent, { portal }).decode(result.data ?? "0x");
    });
    const lines = calls.map((step, index) =>
      results[index]?.status === "success"
        ? `${step.what}: succeeds, gas ${results[index]!.gasUsed}`
        : `${step.what}: reverts: ${revertReason(results[index]?.error)}`,
    );
    const ok = failed < 0 && funded.every((value) => value === true);

    return {
      text: [
        ...summary,
        ...assumed.lines,
        ...lines,
        ...plans.flatMap((plan, index) =>
          funded[index] === undefined
            ? []
            : [`then Portal.isIntentFunded(${plan.hash}): ${funded[index]}`],
        ),
      ].join("\n"),
      json: {
        ok,
        from,
        ...(assumed.json.length === 0 ? {} : { assumed: assumed.json }),
        intents: plans.map((plan, index) => ({
          ...intentJson(plan),
          ...(funded[index] === undefined ? {} : { funded: funded[index] }),
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
        ...assumed.notes,
        `This rehearses publishing on ${input.chain.slug} only. What the intent does runs on ` +
          `${[...new Set(plans.map((plan) => plan.intent.destination.slug))].join(" and ")}, when ` +
          "a solver fills it: `sauce intent fill` with the same file and flags, and the destination's " +
          "endpoint, rehearses that.",
      ],
      ...(ok ? {} : { exitCode: 1 }),
    };
  }
  if (input.account === undefined) {
    throw new UsageError(
      "missing a signer to publish from: --keystore <path> or --private-key <hex> (or print the " +
        "unsigned transactions with --format json)",
    );
  }
  const sent: Array<{ readonly step: Step; readonly result: Sent }> = [];
  const stored: string[] = [];
  const sentSoFar = (): string =>
    sent.length === 0
      ? "nothing was sent"
      : `sent so far: ${sent.map(({ step, result }) => `${step.what} ${result.hash}`).join(", ")}`;
  for (const plan of plans) {
    for (const step of plan.steps) {
      // The transfers have landed: the Portal must count the intent funded before it is published,
      // because a transfer "succeeds" for a token that returns false, or that keeps a fee.
      if (step.publishes === true && !(await fundedNow(client, plan, portal))) {
        throw new CliError(
          `the vault ${plan.vault} does not hold intent ${plan.hash}'s reward after the ` +
            "transfers — a token that returned false, or kept a fee — so it is not published " +
            `(${sentSoFar()}). What was paid stays in the vault: top it up and run sauce intent publish ` +
            "again, which sends only what is missing, or refund it after the reward deadline.",
        );
      }
      const result = await sendAndWait(client, input.rpcUrl!, input.account, step);
      sent.push({ step, result });
      if (result.status !== "success") {
        throw new CliError(
          `${step.what} ${result.hash} reverted: ${result.reason ?? "no reason"} (${sentSoFar()})`,
        );
      }
      if (input.onSent !== undefined) stored.push(...(await input.onSent(result)));
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
      intents: plans.map(intentJson),
      transactions: sent.map(({ step, result }) => ({
        what: step.what,
        hash: result.hash,
        status: result.status,
        gasUsed: result.gasUsed.toString(),
      })),
    },
    ...(stored.length === 0 ? {} : { notes: stored }),
  };
}
