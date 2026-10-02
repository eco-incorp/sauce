/**
 * `sauce intent publish` with no file: an intent made step by step — which chains, what is
 * delivered and to whom, the reward and its margin, the deadlines, the prover — and written out as
 * a `.sauce.ts` file before anything is sent, so what is published is source a person can read,
 * keep and publish again. Every question has its flag (`--source`, `--destination`, `--token`,
 * `--amount`, `--recipient`, `--reward-token`, `--reward`, `--prover`, `--fill-deadline`,
 * `--reward-deadline`, `--out`); at a terminal what no flag gave is asked, and with no terminal a
 * missing one is an error naming every flag still needed (`prompt.ts#missingFlags`).
 *
 * The file is an ordinary intent file — `Dest(() => { TOKEN.transfer(RECIPIENT, AMOUNT) })
 * .reward({ tokens: [{ token, amount }] })`, a body of plain token transfers, which the Portal's
 * Executor runs with no Pot — and `run.ts` then publishes it exactly as `sauce intent publish
 * <file>` would: rehearsed on the source (`--dry-run`) and on the destination (`fill`), confirmed,
 * sent, stored.
 */
import {
  formatUnits,
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type PublicClient,
} from "viem";

import { CANONICAL_CHAINS, type CanonicalChain } from "../chains/canonical.js";
import { priceFromSqrtPriceX96 } from "../price.js";
import { ecoRoutesDeployment, ecoRoutesProver } from "../protocols/eco-routes/lookup.js";
import { deployments as uniswapV3 } from "../protocols/uniswap-v3/addresses.js";
import { hashIntent } from "../routes/encode.js";
import { proverFeeCall } from "../routes/portal.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";
import { CliError, parseChain, UsageError } from "./args.js";
import { connect, kitchenFee } from "./chain.js";
import { nativeSymbol, tokenInfo } from "./effects.js";
import { proverPlan } from "./lifecycle.js";
import { askChoice, askText, missingFlags, type Ask } from "./prompt.js";
import { isSupportedChain, requireSupported } from "./support.js";
import { parseFundVia } from "./args.js";
import type { IntentFundVia } from "../routes/portal.js";

/** What the flags gave; the rest is asked. */
export interface CreateGiven {
  readonly source?: string;
  readonly destination?: string;
  readonly token?: string;
  readonly amount?: string;
  readonly recipient?: string;
  readonly rewardToken?: string;
  readonly reward?: string;
  readonly prover?: string;
  readonly fillDeadline?: string;
  readonly rewardDeadline?: string;
  /** `--intent-fund-via`: how the reward reaches its vault. Default `transfer`. */
  readonly fundVia?: string;
  readonly out?: string;
}

export interface CreateInput {
  readonly given: CreateGiven;
  /** `undefined` with no terminal: then every value must come from a flag. */
  readonly ask?: Ask;
  readonly endpoint: (chain: CanonicalChain) => string | undefined;
  /** Who publishes: the creator, and the recipient by default. */
  readonly signer?: Address;
  /** The time deadlines count from (unix seconds). */
  readonly now: bigint;
  readonly writeText: (path: string, text: string) => void;
  readonly exists: (path: string) => boolean;
}

/** What creation made: the file, and the flags it is published with. */
export interface Created {
  readonly file: string;
  readonly text: string;
  readonly source: CanonicalChain;
  readonly destination: CanonicalChain;
  readonly deadline: bigint;
  readonly rewardDeadline: bigint;
  readonly prover: Address;
  readonly fundVia: IntentFundVia;
  readonly creator?: Address;
  /** For a person: what was chosen, and why the defaults are what they are. */
  readonly summary: readonly string[];
}

/** The chains a Portal is recorded on, in the current generation: where an intent can go. */
export const portalChains = (): CanonicalChain[] =>
  CANONICAL_CHAINS.filter(
    (chain) => chain.kind === "evm" && ecoRoutesDeployment(chain)?.Portal !== undefined,
  );

/** The chains creation offers: those with a Portal that the release supports (`support.ts`). */
export const publishableChains = (): CanonicalChain[] => portalChains().filter(isSupportedChain);

/** A token on `chain`: what the program names it by (a symbol, or its address), and its decimals. */
interface Token {
  readonly symbol?: string;
  readonly address: Address;
  readonly decimals: number;
  /** How the program spells it: `USDC`, or `Token(0x…n)` for one the registry does not name. */
  readonly spelled: string;
}

const STABLES = new Set(["USDC", "USDT", "USDT0", "USDC.E", "USDBC", "DAI", "USDS", "PYUSD"]);

/** One `--flag` value, or the question that asks it; refused with no terminal. */
async function value(
  input: CreateInput,
  missing: string[],
  flag: string,
  given: string | undefined,
  ask: (ask: Ask) => Promise<string | undefined>,
): Promise<string | undefined> {
  if (given !== undefined) return given;
  const answer = input.ask === undefined ? undefined : await ask(input.ask);
  // No terminal to ask on (`ask` answers `undefined` there too): the flag is what is missing.
  if (answer === undefined) missing.push(flag);

  return answer;
}

/** `+30m`, `+2h`, `+1d`, `+90` (seconds) from `now`, or an absolute unix second. */
export function parseWhen(flag: string, raw: string, now: bigint): bigint {
  const relative = /^\+(\d+)([smhd]?)$/.exec(raw.trim());
  if (relative !== null) {
    const unit = { "": 1n, s: 1n, m: 60n, h: 3600n, d: 86400n }[relative[2] as "" | "s"]!;

    return now + BigInt(relative[1]!) * unit;
  }
  if (/^\d+$/.test(raw.trim())) return BigInt(raw.trim());
  throw new UsageError(`--${flag}: '${raw}' is neither a unix second nor +<n>[s|m|h|d] from now`);
}

/** `raw` on `chain`: a registry symbol, or an address (its decimals read on chain). */
async function tokenOn(
  chain: CanonicalChain,
  raw: string,
  client: PublicClient | undefined,
  flag: string,
): Promise<Token> {
  const rows = TOKEN_REGISTRY[chain.id] ?? [];
  const bySymbol = rows.find((row) => row.symbol.toLowerCase() === raw.toLowerCase());
  if (bySymbol !== undefined) {
    return {
      symbol: bySymbol.symbol,
      address: getAddress(bySymbol.address),
      decimals: bySymbol.decimals,
      spelled: bySymbol.symbol,
    };
  }
  const [given, decimalsText] = raw.split(":");
  if (given === undefined || !isAddress(given, { strict: false })) {
    // The chain's tokens by name, less its tokenized stocks: Ethereum has over a thousand.
    const listed = rows.filter((row) => row.stock === undefined).map((row) => row.symbol);
    const stocks = rows.length - listed.length;
    const more =
      stocks > 0
        ? `, one of its ${stocks} stock tokens (sauce globals --chain ${chain.slug} --tokens)`
        : "";
    throw new UsageError(
      `--${flag}: '${raw}' is not a token on ${chain.slug}: one of ` +
        `${listed.join(", ") || "(none recorded)"}${more}, or an address`,
    );
  }
  const address = getAddress(given);
  const known = rows.find((row) => getAddress(row.address) === address);
  if (known !== undefined) {
    return { symbol: known.symbol, address, decimals: known.decimals, spelled: known.symbol };
  }
  const read = client === undefined ? undefined : await tokenInfo(client, chain, address);
  const decimals =
    decimalsText !== undefined && /^\d{1,2}$/.test(decimalsText)
      ? Number(decimalsText)
      : read?.decimals;
  if (decimals === undefined) {
    throw new UsageError(
      `--${flag}: ${address}'s decimals are not known: give ${chain.slug}'s endpoint to read ` +
        `them, or write ${address}:<decimals>`,
    );
  }

  return {
    ...(read?.symbol === undefined ? {} : { symbol: read.symbol }),
    address,
    decimals,
    spelled: `Token(${address.toLowerCase()})`,
  };
}

/** Asks which token, from `chain`'s registry or by address. */
async function askToken(ask: Ask, chain: CanonicalChain, question: string, fallback?: string) {
  // A tokenized stock is still a choice by address: Ethereum has over a thousand of them.
  const rows = (TOKEN_REGISTRY[chain.id] ?? []).filter((row) => row.stock === undefined);
  const choices = [
    ...rows.map((row) => ({ label: `${row.symbol} (${row.address})`, value: row.symbol })),
    { label: "another token, by address", value: "" },
  ];
  const at = fallback === undefined ? undefined : rows.findIndex((row) => row.symbol === fallback);
  const picked = await askChoice(ask, question, choices, at === -1 ? undefined : at);
  if (picked !== "") return picked;

  return askText(ask, `The token's address on ${chain.slug} (address, or address:decimals)`, {
    check: (text) =>
      isAddress(text.split(":")[0]!, { strict: false }) ? undefined : "not an address",
  });
}

const POOL = parseAbi([
  "function getPool(address, address, uint24) view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)",
]);

/** The native currency's price on `chain` in `stable` (a USD token there), from the deepest of the
 *  registry's Uniswap V3 pools of the wrapped native and that token; `undefined` when none answers. */
async function nativePrice(
  client: PublicClient,
  chain: CanonicalChain,
  stableSymbol: string,
): Promise<number | undefined> {
  const rows = TOKEN_REGISTRY[chain.id] ?? [];
  const wrapped = rows.find((row) => row.symbol === `W${nativeSymbol(chain)}`);
  const stable =
    rows.find((row) => row.symbol === stableSymbol) ??
    rows.find((row) => STABLES.has(row.symbol.toUpperCase()));
  const factory = uniswapV3.find((entry) => entry.chainId === chain.id)?.addresses.factory;
  if (wrapped === undefined || stable === undefined || factory === undefined) return undefined;
  // Every fee tier at once, the first in this order with a priced pool winning. A tier whose
  // read fails counts as having no pool: the price only suggests a margin, and none found
  // means the person gives the reward.
  const prices = await Promise.all(
    [500, 3000, 100].map(async (fee) => {
      try {
        const pool = await client.readContract({
          address: getAddress(factory),
          abi: POOL,
          functionName: "getPool",
          args: [getAddress(wrapped.address), getAddress(stable.address), fee],
        });
        if (BigInt(pool) === 0n) return undefined;
        const [sqrtPriceX96] = await client.readContract({
          address: pool,
          abi: POOL,
          functionName: "slot0",
        });
        if (sqrtPriceX96 === 0n) return undefined;

        return Number(
          priceFromSqrtPriceX96(sqrtPriceX96, {
            baseDecimals: wrapped.decimals,
            quoteDecimals: stable.decimals,
            baseIsToken0: BigInt(wrapped.address) < BigInt(stable.address),
          }),
        );
      } catch {
        return undefined;
      }
    }),
  );

  return prices.find((price) => price !== undefined);
}

/** What a solver spends on the destination to fill a plain transfer, as an estimate. */
const FILL_GAS = 250_000n;

/** The reward's margin over what is delivered: a solver's destination costs, priced where they can
 *  be, doubled so the fill is worth doing; and lines saying how it was reached. */
async function margin(
  destination: CanonicalChain,
  client: PublicClient | undefined,
  rewardToken: Token,
  deliveredToken: Token,
  proverFee: bigint | undefined,
): Promise<{ readonly amount: bigint; readonly lines: string[] }> {
  if (client === undefined) {
    return {
      amount: 0n,
      lines: [
        `no ${destination.slug} endpoint: the solver's costs there are not estimated, so the reward ` +
          "has no margin over what it delivers. Set it with --reward.",
      ],
    };
  }
  const native = nativeSymbol(destination);
  const gasPrice = await client.getGasPrice().catch(() => 0n);
  const kitchen = await kitchenFee(client, destination).catch(() => 0n);
  // A body of plain transfers runs on the Executor, not a Pot: no Kitchen fee is paid.
  const costs = FILL_GAS * gasPrice + (proverFee ?? 0n);
  const lines = [
    `the solver's costs on ${destination.slug}: ~${FILL_GAS} gas at ${formatUnits(gasPrice, 9)} gwei ` +
      `and ${proverFee === undefined ? "an unquoted" : formatUnits(proverFee, 18)} ${native} for ` +
      `the proof = ${formatUnits(costs, 18)} ${native} (no Kitchen fee: a transfer runs on no Pot; ` +
      `a cook would pay ${formatUnits(kitchen, 18)} ${native})`,
  ];
  const stable = STABLES.has((rewardToken.symbol ?? "").toUpperCase());
  const sameNative =
    (rewardToken.symbol ?? "").toUpperCase() === `W${native}` ||
    (rewardToken.symbol ?? "").toUpperCase() === native;
  if (sameNative) {
    lines.push(`priced 1:1 in ${rewardToken.symbol}, doubled so a solver profits`);

    return { amount: (costs * 2n * 10n ** BigInt(rewardToken.decimals)) / 10n ** 18n, lines };
  }
  if (!stable) {
    lines.push(
      `${rewardToken.symbol ?? rewardToken.address} is not priced here: no margin is added`,
    );

    return { amount: 0n, lines };
  }
  const price = await nativePrice(client, destination, deliveredToken.symbol ?? "USDC");
  if (price === undefined) {
    lines.push(`no Uniswap V3 pool prices ${native} on ${destination.slug}: no margin is added`);

    return { amount: 0n, lines };
  }
  const usd = (Number(formatUnits(costs, 18)) * price * 2).toFixed(rewardToken.decimals);
  lines.push(
    `${native} at ${price.toFixed(2)} ${deliveredToken.symbol ?? "USD"} (Uniswap V3 on ` +
      `${destination.slug}): ${usd} ${rewardToken.symbol}, twice the cost so a solver profits`,
  );

  return { amount: parseUnits(usd, rewardToken.decimals), lines };
}

/** The provers the registry records on both chains, by role, the default first. */
function proverChoices(source: CanonicalChain, destination: CanonicalChain) {
  const here = ecoRoutesDeployment(source) ?? {};
  const there = ecoRoutesDeployment(destination) ?? {};
  const common = Object.keys(here).filter(
    (role) => /Prover$/.test(role) && there[role] !== undefined,
  );
  let preferred: string | undefined;
  try {
    preferred = getAddress(ecoRoutesProver(source, destination));
  } catch {
    preferred = undefined;
  }

  return common
    .map((role) => ({ role, address: getAddress(here[role]!) }))
    .sort((a, b) => (a.address === preferred ? -1 : b.address === preferred ? 1 : 0));
}

/** The intent file, written for a person to read and keep. */
function intentText(options: {
  readonly destination: CanonicalChain;
  readonly delivered: Token;
  readonly amount: bigint;
  readonly recipient: Address;
  readonly rewardToken: Token;
  readonly reward: bigint;
  readonly header: readonly string[];
}): string {
  const accessor = options.destination.name.replace(/[^A-Za-z0-9]/g, "");

  return [
    ...options.header.map((line) => `// ${line}`),
    `${accessor}(() => {`,
    `  ${options.delivered.spelled}.transfer(${options.recipient.toLowerCase()}, ${options.amount});`,
    `}).reward({ tokens: [{ token: ${options.rewardToken.spelled === options.rewardToken.symbol ? options.rewardToken.symbol : options.rewardToken.address.toLowerCase()}, amount: ${options.reward} }] });`,
    "",
  ].join("\n");
}

/** Asks (or reads from flags) everything an intent needs, and writes it as a `.sauce.ts` file. */
export async function createIntent(input: CreateInput): Promise<Created> {
  const missing: string[] = [];
  const chains = publishableChains();
  const chainChoices = (exclude?: CanonicalChain) =>
    chains
      .filter((chain) => chain !== exclude)
      .map((chain) => ({ label: `${chain.name} (${chain.id})`, value: chain.slug }));

  const sourceRaw = await value(input, missing, "--source", input.given.source, (ask) =>
    askChoice(ask, "Source chain (where the reward is escrowed):", chainChoices()),
  );
  const source = sourceRaw === undefined ? undefined : parseChain(sourceRaw);
  const destinationRaw = await value(
    input,
    missing,
    "--destination",
    input.given.destination,
    (ask) => askChoice(ask, "Destination chain (where it is delivered):", chainChoices(source)),
  );
  const destination = destinationRaw === undefined ? undefined : parseChain(destinationRaw);
  // Before anything is read from either chain: publishing goes only between supported ones.
  requireSupported(
    "publishing intents",
    [source, destination].filter((chain) => chain !== undefined),
  );
  for (const chain of [source, destination]) {
    if (chain !== undefined && !chains.includes(chain)) {
      throw new UsageError(
        `${chain.slug} has no eco-routes Portal recorded: one of ${chains.map((c) => c.slug).join(", ")}`,
      );
    }
  }
  if (source !== undefined && source === destination) {
    throw new UsageError("the source and the destination are the same chain");
  }
  const destinationUrl = destination === undefined ? undefined : input.endpoint(destination);
  const destinationClient =
    destination === undefined || destinationUrl === undefined
      ? undefined
      : await connect(destinationUrl, destination);
  const sourceUrl = source === undefined ? undefined : input.endpoint(source);
  const sourceClient =
    source === undefined || sourceUrl === undefined ? undefined : await connect(sourceUrl, source);

  // What is delivered.
  // A question about a chain not chosen yet cannot be asked; its flag is still named as missing.
  const unasked = (flag: string, given: string | undefined) => {
    if (given === undefined) missing.push(flag);

    return given;
  };
  const tokenRaw =
    destination === undefined
      ? unasked("--token", input.given.token)
      : await value(input, missing, "--token", input.given.token, (ask) =>
          askToken(ask, destination, `Token to deliver on ${destination.slug}:`, "USDC"),
        );
  const delivered =
    destination === undefined || tokenRaw === undefined
      ? undefined
      : await tokenOn(destination, tokenRaw, destinationClient, "token");
  const amountRaw = await value(input, missing, "--amount", input.given.amount, (ask) =>
    askText(ask, `Amount of ${delivered?.symbol ?? "it"} to deliver, in whole units`, {
      check: (text) => (/^\d+(\.\d+)?$/.test(text) ? undefined : "a number like 1 or 0.5"),
    }),
  );
  const amount =
    amountRaw === undefined || delivered === undefined
      ? undefined
      : parseUnits(amountRaw, delivered.decimals);
  const recipientRaw = await value(input, missing, "--recipient", input.given.recipient, (ask) =>
    askText(ask, `Recipient on ${destination?.slug ?? "the destination"}`, {
      ...(input.signer === undefined ? {} : { fallback: input.signer }),
      check: (text) => (isAddress(text, { strict: false }) ? undefined : "not an address"),
    }),
  );
  if (recipientRaw !== undefined && !isAddress(recipientRaw, { strict: false })) {
    throw new UsageError(`--recipient: '${recipientRaw}' is not an address`);
  }
  const recipient = recipientRaw === undefined ? undefined : getAddress(recipientRaw);

  // The prover, which also prices the proof.
  const provers =
    source === undefined || destination === undefined ? [] : proverChoices(source, destination);
  if (source !== undefined && destination !== undefined && provers.length === 0) {
    throw new CliError(`no prover is recorded on both ${source.slug} and ${destination.slug}`);
  }
  const proverRaw = await value(input, missing, "--prover", input.given.prover, (ask) =>
    askChoice(
      ask,
      "Prover (carries the proof of the fill back to the source):",
      provers.map((entry) => ({ label: `${entry.role} ${entry.address}`, value: entry.role })),
      0,
    ),
  );
  const prover =
    proverRaw === undefined
      ? undefined
      : isAddress(proverRaw, { strict: false })
        ? getAddress(proverRaw)
        : provers.find((entry) => entry.role.toLowerCase() === proverRaw.toLowerCase())?.address;
  if (proverRaw !== undefined && prover === undefined) {
    throw new UsageError(
      `--prover: '${proverRaw}' is none of ${provers.map((entry) => entry.role).join(", ")}, nor an address`,
    );
  }

  // The reward, pre-filled: what is delivered, plus a margin over the solver's costs.
  const rewardTokenRaw =
    source === undefined
      ? unasked("--reward-token", input.given.rewardToken)
      : await value(input, missing, "--reward-token", input.given.rewardToken, (ask) =>
          askToken(ask, source, `Reward token on ${source.slug}:`, delivered?.symbol),
        );
  const rewardToken =
    source === undefined || rewardTokenRaw === undefined
      ? undefined
      : await tokenOn(source, rewardTokenRaw, sourceClient, "reward-token");
  let suggested: bigint | undefined;
  const marginLines: string[] = [];
  if (
    rewardToken !== undefined &&
    delivered !== undefined &&
    amount !== undefined &&
    destination !== undefined &&
    source !== undefined &&
    prover !== undefined
  ) {
    const fee =
      destinationClient === undefined
        ? undefined
        : await proverFeeFor(destinationClient, source, destination, prover);
    const same =
      rewardToken.symbol !== undefined &&
      (rewardToken.symbol === delivered.symbol ||
        (STABLES.has(rewardToken.symbol.toUpperCase()) &&
          STABLES.has((delivered.symbol ?? "").toUpperCase())));
    const extra = await margin(destination, destinationClient, rewardToken, delivered, fee);
    marginLines.push(...extra.lines);
    if (same) {
      const base =
        (amount * 10n ** BigInt(rewardToken.decimals)) / 10n ** BigInt(delivered.decimals);
      suggested = base + extra.amount;
      marginLines.push(
        `reward suggested: ${formatUnits(base, rewardToken.decimals)} delivered + ` +
          `${formatUnits(extra.amount, rewardToken.decimals)} margin = ` +
          `${formatUnits(suggested, rewardToken.decimals)} ${rewardToken.symbol}`,
      );
    } else {
      marginLines.push(
        `${rewardToken.symbol ?? rewardToken.address} is not what is delivered, so no reward is suggested`,
      );
    }
  }
  const rewardRaw = await value(input, missing, "--reward", input.given.reward, (ask) =>
    askText(
      ask,
      `${marginLines.map((line) => `  ${line}`).join("\n")}\nReward, in whole ${rewardToken?.symbol ?? "units"}`,
      {
        ...(suggested === undefined || rewardToken === undefined
          ? {}
          : { fallback: formatUnits(suggested, rewardToken.decimals) }),
        check: (text) => (/^\d+(\.\d+)?$/.test(text) ? undefined : "a number like 1.05"),
      },
    ),
  );
  const reward =
    rewardRaw === undefined || rewardToken === undefined
      ? undefined
      : parseUnits(rewardRaw, rewardToken.decimals);

  // The deadlines.
  const fillRaw = await value(input, missing, "--fill-deadline", input.given.fillDeadline, (ask) =>
    askText(
      ask,
      "Fill deadline: the last second a solver may fill (Inbox reverts IntentExpired after it;\n" +
        "a 2.12 Portal lets anyone cancel after it). A unix second or +<n>[s|m|h|d]",
      { fallback: "+1h", check: (text) => checkWhen(text, input.now) },
    ),
  );
  const deadline =
    fillRaw === undefined ? undefined : parseWhen("fill-deadline", fillRaw, input.now);
  const rewardDeadlineRaw = await value(
    input,
    missing,
    "--reward-deadline",
    input.given.rewardDeadline,
    (ask) =>
      askText(
        ask,
        "Reward deadline: from when an unproven reward is refundable to you. Leave the solver time\n" +
          "to prove after the fill deadline, and its proof to arrive: a unix second or\n" +
          "+<n>[s|m|h|d] from now",
        { fallback: "+25h", check: (text) => checkWhen(text, input.now) },
      ),
  );
  const rewardDeadline =
    rewardDeadlineRaw === undefined
      ? undefined
      : parseWhen("reward-deadline", rewardDeadlineRaw, input.now);
  // How the reward reaches its vault. It has a default, so with no terminal and no flag it is
  // that default rather than a missing flag.
  const fundViaRaw =
    input.given.fundVia ??
    (input.ask === undefined
      ? undefined
      : await askChoice(
          input.ask,
          "Funding: how the reward reaches the intent's vault:",
          [
            {
              label: "transfer each reward token to the vault, then publish (no approval)",
              value: "transfer",
            },
            {
              label:
                "approve the Portal, then publishAndFund (records it Funded and emits IntentFunded)",
              value: "publishAndFund",
            },
          ],
          0,
        ));
  const fundVia = parseFundVia(fundViaRaw ?? "transfer");
  if (missing.length > 0) throw missingFlags("sauce intent publish", missing);
  if (deadline! <= input.now) throw new UsageError("the fill deadline is already past");
  if (rewardDeadline! < deadline!) {
    throw new UsageError(
      "the reward deadline is before the fill deadline: a solver who fills in time could find " +
        "the reward refunded before its proof arrives",
    );
  }

  const out =
    input.given.out ??
    `intent-${source!.slug}-to-${destination!.slug}-${new Date(Number(input.now) * 1000)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..*$/, "")}.sauce.ts`;
  if (input.exists(out)) throw new CliError(`${out} exists: name another with --out`);
  const header = [
    `${formatUnits(amount!, delivered!.decimals)} ${delivered!.symbol ?? delivered!.address} to ` +
      `${recipient!} on ${destination!.slug}, for ${formatUnits(reward!, rewardToken!.decimals)} ` +
      `${rewardToken!.symbol ?? rewardToken!.address} on ${source!.slug}.`,
    "Written by `sauce intent publish`. Publish it again with the same deadlines and prover:",
    `  sauce intent publish ${out} --chain ${source!.slug} --keystore <path> \\`,
    `    --intent-deadline ${deadline} --intent-reward-deadline ${rewardDeadline} \\`,
    `    --intent-prover ${prover}${input.signer === undefined ? "" : ` --intent-creator ${input.signer}`}` +
      (fundVia === "transfer" ? "" : ` --intent-fund-via ${fundVia}`),
  ];
  const text = intentText({
    destination: destination!,
    delivered: delivered!,
    amount: amount!,
    recipient: recipient!,
    rewardToken: rewardToken!,
    reward: reward!,
    header,
  });
  input.writeText(out, text);

  return {
    file: out,
    text,
    source: source!,
    destination: destination!,
    deadline: deadline!,
    rewardDeadline: rewardDeadline!,
    prover: prover!,
    fundVia,
    ...(input.signer === undefined ? {} : { creator: input.signer }),
    summary: [
      `Wrote ${out}:`,
      ...text.split("\n").map((line) => `  ${line}`),
      `fill by ${new Date(Number(deadline!) * 1000).toISOString()}, refundable from ` +
        `${new Date(Number(rewardDeadline!) * 1000).toISOString()} if no fill is proven`,
      fundVia === "transfer"
        ? "funded by a transfer of the reward to its vault, then publish"
        : "funded by approving the Portal, then publishAndFund",
      ...marginLines,
    ],
  };
}

const checkWhen = (text: string, now: bigint): string | undefined => {
  try {
    return parseWhen("deadline", text, now) > now ? undefined : "that is not in the future";
  } catch (error) {
    return (error as Error).message;
  }
};

/** The prover's fee for one proof from `destination` to `source`, quoted where the prover is one
 *  this command drives; `undefined` otherwise. The fee depends on the message's size, not on which
 *  intent it carries, so it is quoted for a placeholder one. */
async function proverFeeFor(
  client: PublicClient,
  source: CanonicalChain,
  destination: CanonicalChain,
  prover: Address,
): Promise<bigint | undefined> {
  const portal = ecoRoutesDeployment(destination)?.Portal;
  if (portal === undefined) return undefined;
  const placeholder = {
    sourceChainId: BigInt(source.id),
    destination: BigInt(destination.id),
    route: {
      salt: `0x${"00".repeat(32)}`,
      deadline: 0n,
      portal: `0x${"00".repeat(12)}${portal.slice(2).toLowerCase()}`,
      nativeAmount: 0n,
      tokens: [],
      calls: [],
    },
    reward: {
      deadline: 0n,
      creator: `0x${"00".repeat(32)}`,
      prover: `0x${"00".repeat(12)}${prover.slice(2).toLowerCase()}`,
      nativeAmount: 0n,
      tokens: [],
    },
  } as const;
  const plan = await proverPlan(placeholder as never, client).catch(() => undefined);
  if (plan === undefined || !plan.supported) return undefined;
  const { intentHash } = hashIntent(placeholder as never);
  const call = proverFeeCall({
    prover: plan.destinationProver! as Address,
    sourceDomain: plan.sourceDomain!,
    destinationChainId: BigInt(destination.id),
    pairs: [{ intentHash, claimant: `0x${"11".repeat(20)}` }],
    data: plan.data!,
  });
  try {
    const { data } = await client.call({ to: call.to, data: call.data });

    return data === undefined ? undefined : call.decode(data);
  } catch {
    return undefined;
  }
}
