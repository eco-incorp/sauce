/**
 * What a command's input means, given as plain values: the chain a program runs on, whether its
 * defines reach it, the Pot a cook runs on, and the funding and assumed balances a cook carries.
 *
 * `run.ts` reads these values from the command line and `sauce mcp` (`mcp/`) from a tool's
 * arguments; both hand them here, so the rules are one set whichever front end a program comes
 * through. The messages name the CLI's flags, which the MCP tools mirror by name.
 */
import type { Address, Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { CANONICAL_CHAINS, type CanonicalChain } from "../chains/canonical.js";
import {
  bindEntryArguments,
  mainParams,
  mainSignature,
  type BoundEntryArguments,
  type EntryValue,
} from "../routes/entry.js";
import { blankLiterals } from "../routes/rs-compile.js";
import {
  parseAddress,
  parseChain,
  parseHeader,
  parseSalt,
  parseTarget,
  UsageError,
} from "./args.js";
import type { Approver, ArgsInput, CookInput, PotInput, ProgramInput } from "./commands.js";
import { parsePubkey } from "./solana.js";
import {
  FUND_MODES,
  parseFund,
  parseTokenAmount,
  permit2On,
  planFunding,
  type FundMode,
  type FundRequest,
} from "./funding.js";

/**
 * A program's text with a leading `#!` line blanked: each of its characters a space, so every
 * offset and line number after it — the compiler's diagnostics, a `// @chain` header — is the
 * file's own. A program file may start with one to run as a command (`#!/usr/bin/env -S sauce
 * simulate`); the compiler accepts it only as the very first bytes, and the SDK
 * puts imports above the program, so it is blanked before the compile sees it.
 */
export function withoutShebang(text: string): string {
  return text.replace(/^#![^\r\n]*/, (line) => " ".repeat(line.length));
}

/** The one chain of kind svm, which `--target svm` alone names. */
const svmChain = (): CanonicalChain => CANONICAL_CHAINS.find((chain) => chain.kind === "svm")!;

/**
 * The chain a program runs on: `given.chain`, else the file's `// @chain`, else — for a `svm`
 * target given or in its `// @target` alone — the one SVM chain, else `fallback`. A target that
 * disagrees with the chain is an error, wherever either came from.
 */
export function programChain(
  given: { readonly chain?: string; readonly target?: string },
  file: string,
  text: string,
  fallback?: CanonicalChain,
): CanonicalChain {
  const header = parseHeader(text, file);
  const targetFrom = given.target !== undefined ? "--target" : `${file}'s // @target`;
  const targetRaw = given.target ?? header.target;
  const target = targetRaw === undefined ? undefined : parseTarget(targetRaw, targetFrom);
  const chain =
    given.chain !== undefined
      ? parseChain(given.chain)
      : header.chain !== undefined
        ? parseChain(header.chain, `${file}'s // @chain`)
        : target === "svm"
          ? svmChain()
          : fallback;
  if (chain === undefined) {
    throw new UsageError(
      "missing --chain <slug|id>: which chain the program runs on (or head the file with a " +
        "`// @chain <slug>` line)",
    );
  }
  if (target !== undefined && target !== chain.kind) {
    throw new UsageError(
      `${targetFrom} ${target} does not match ${chain.slug}, an ${chain.kind.toUpperCase()} chain`,
    );
  }

  return chain;
}

/**
 * Refuses a define the program would never see. A file with no `function main` is a script: its
 * top-level statements are the entry's body, so a `const` there is the script's own local, and a
 * define of the same name — which replaces a MODULE-level const — would be silently ignored.
 */
export function definesReach(file: string, text: string, names: readonly string[]): void {
  if (mainSignature(text) !== undefined) return;
  const code = blankLiterals(text);
  for (const name of names) {
    if (new RegExp(`(^|[^.\\w$])(?:const|let)\\s+${name.replace(/\$/g, "\\$")}\\b`).test(code)) {
      throw new UsageError(
        `--define ${name} would not reach ${file}: with no \`function main\`, its top-level ` +
          `\`const ${name}\` is the script's own, which a define does not replace. Drop the ` +
          `declaration and read ${name} as a define, or declare function main() and keep the ` +
          "const beside it, where a define replaces it.",
      );
    }
  }
}

/**
 * A program whose intents a wallet publishes, with `main`'s arguments given and validated by
 * `bindEntryArguments`. Keep the arguments separate from caller defines until the shared program
 * lowering can check every effective define, including each destination chain's. A wallet publishes
 * from values known before anything runs, so the intents it opens come out fixed.
 *
 * Only a single word binds this way: an integer, an address or a `bool`. A program whose `main`
 * takes bytes, a string, an array or a record is refused, naming the parameter: run it on a Pot
 * (`sauce run`), where its arguments are read as it runs. With no `args`, a program whose `main`
 * takes none is returned as it is, and one that takes some is refused, naming them.
 */
export function bindMainArguments(input: ProgramInput, args: ArgsInput | undefined): ProgramInput {
  const params = mainParams(input.text);
  const shape = `main(${params.map((param) => `${param.name}: ${param.type}`).join(", ")})`;
  if (args === undefined) {
    if (params.length === 0) return input;
    throw new UsageError(
      `${shape} takes ${params.length} argument${params.length === 1 ? "" : "s"}: pass them ` +
        "after --args, in order, or as --args-json; the intents are built with them",
    );
  }
  if (params.length === 0) {
    throw new UsageError(
      `${args.from} gives main's arguments, and ${input.file} declares no \`main\` with ` +
        "parameters: declare the values it reads as main's parameters, then pass them in order",
    );
  }
  let bound: BoundEntryArguments;
  try {
    bound = bindEntryArguments(input.text, args.values as EntryValue[]);
  } catch (error) {
    const message = (error as Error).message;
    throw new UsageError(
      /only one word binds/.test(message)
        ? `${args.from}: ${message.replace(/: only one word.*$/, "")}: a wallet publishes an ` +
            "intent from values known before anything runs, each bound into the intent as one " +
            "word, and this one is not: an integer, an address or a bool binds. Run the program " +
            "on a Pot instead (sauce run), where it reads its arguments as it runs"
        : `${args.from}: ${message}`,
    );
  }
  for (const name of [...Object.keys(bound.constants), ...bound.declared]) {
    if (Object.hasOwn(input.defines, name)) {
      throw new UsageError(
        `${name} is main's parameter, given by ${args.from}; it cannot also be a --define`,
      );
    }
  }

  return {
    ...input,
    boundArgs: args.values as EntryValue[],
    ...(bound.addresses.length === 0
      ? {}
      : { addressDefines: [...(input.addressDefines ?? []), ...bound.addresses] }),
  };
}

/** The Pot a cook names: by address, or by its owner and salt. */
export interface PotGiven {
  readonly pot?: string | undefined;
  readonly owner?: string | undefined;
  readonly salt?: string | undefined;
  readonly saltHex?: string | undefined;
}

/**
 * The Pot a cook runs on: `pot`, or derived from `owner` — or, when `signer` is given (a run), from
 * the signer, whose Pot it must be anyway.
 */
export function potTarget(given: PotGiven, signer?: Address): PotInput {
  if (given.pot !== undefined && given.owner !== undefined) {
    throw new UsageError("give --pot or --owner, not both");
  }
  if (given.pot !== undefined) {
    if (given.salt !== undefined || given.saltHex !== undefined) {
      throw new UsageError("--salt and --salt-hex go with --owner: --pot names the Pot itself");
    }

    return { pot: parseAddress("pot", given.pot) };
  }
  if (given.owner === undefined && signer === undefined) {
    throw new UsageError("missing --pot <address> or --owner <address>: the Pot to cook on");
  }

  return {
    owner: given.owner === undefined ? signer! : parseAddress("owner", given.owner),
    ...parseSalt(given.salt, given.saltHex),
  };
}

/** A Pot's owner as given: a 0x address on an EVM chain, a public key on Solana (base58, or its 32
 *  bytes as 0x hex); with no chain, as it is written: 20 bytes are an EVM address. */
export function potOwner(chain: CanonicalChain | undefined, raw: string): string {
  return chain?.kind === "svm" ||
    (chain === undefined && (!raw.startsWith("0x") || /^0x[0-9a-fA-F]{64}$/.test(raw)))
    ? parsePubkey("owner", raw)
    : parseAddress("owner", raw);
}

/** The Pots `sauce pot import` records: one by its address, or an owner's at its salt. */
export interface PotImportTarget {
  /** The Pot itself (an EVM chain). */
  readonly pot?: Address;
  /** Or its owner: every known release's Pot of theirs at `salt`. */
  readonly owner?: string;
  readonly salt: Hex;
}

/**
 * What `sauce pot import` records on `chain`: `pot`, by address, on an EVM chain — its salt read
 * off it, so none is given — or `owner`'s at its salt (zero by default), the only way on Solana,
 * where a Pot holds nothing that names its owner.
 */
export function potImportTarget(chain: CanonicalChain, given: PotGiven): PotImportTarget {
  if ((given.pot === undefined) === (given.owner === undefined)) {
    throw new UsageError("give the Pot (--pot <address>) or its owner (--owner), one of them");
  }
  if (given.pot !== undefined && chain.kind === "svm") {
    throw new UsageError(
      "a Solana Pot holds nothing that names its owner: give --owner (and its --salt) instead of " +
        "--pot",
    );
  }
  if (given.pot !== undefined) {
    if (given.salt !== undefined || given.saltHex !== undefined) {
      throw new UsageError("--pot names the Pot, whose salt is read off it: give no --salt");
    }

    return { pot: parseAddress("pot", given.pot), salt: parseSalt(undefined, undefined).salt };
  }

  return {
    owner: potOwner(chain, given.owner!),
    salt: parseSalt(given.salt, given.saltHex).salt,
  };
}

/** `--fund`, `--fund-mode` and `--sweep`, and what the cook may do about them. */
export interface FundingGiven {
  readonly chain: CanonicalChain;
  readonly rpcUrl: string;
  /** `--fund` values, `<TOKEN|address>:<amount>`. */
  readonly fund: readonly string[];
  readonly mode?: string;
  readonly sweep: boolean;
  /** May the run approve and transfer before the cook (`run`), or only report (`simulate`)? */
  readonly send: boolean;
  /** Who signs the pulls; absent, a simulation credits the Pot instead. */
  readonly account?: PrivateKeyAccount;
  /** Who approves the transactions a run sends before its cook (`--yes`, or a person). */
  readonly approver: Approver;
}

/**
 * The funding a cook carries, as the callback `runCommand`/`simulateCommand` call once the Pot is
 * there; `undefined` with nothing to fund. Everything about the requests is checked here, before
 * anything is sent.
 */
export function fundingFor(given: FundingGiven): CookInput["fund"] {
  const { chain, mode, sweep } = given;
  if (given.fund.length === 0) {
    if (mode !== undefined) throw new UsageError("--fund-mode says how --fund pulls: give --fund");
    if (sweep) {
      throw new UsageError(
        "--sweep returns what is left of the tokens --fund pulls in: give --fund",
      );
    }

    return undefined;
  }
  if (chain.kind !== "evm") {
    throw new UsageError(
      `--fund is for EVM chains: on ${chain.slug} a program spends from the accounts it is given`,
    );
  }
  if (mode !== undefined && !(FUND_MODES as readonly string[]).includes(mode)) {
    throw new UsageError(`--fund-mode: '${mode}' is not ${FUND_MODES.join(", ")}`);
  }
  const requests = given.fund.map((value) => parseFund(value, chain));
  const seen = new Set<string>();
  for (const request of requests) {
    const key = request.token ?? "native";
    if (seen.has(key)) {
      throw new UsageError(`--fund names ${request.label} twice: give it once, with the total`);
    }
    seen.add(key);
  }
  // Before anything is sent — a Pot deployed — rather than once the run reaches the pulls.
  if (
    (mode ?? "permit2") === "permit2" &&
    requests.some((request) => request.token !== undefined)
  ) {
    permit2On(chain);
  }
  const account = given.account;

  return async (client, pot, owner, plan = false) => {
    if (account !== undefined && account.address !== owner) {
      throw new UsageError(
        `the signer ${account.address} is not the owner of Pot ${pot}, ${owner}: --fund pulls the ` +
          "owner's tokens on the owner's signature",
      );
    }

    return planFunding({
      chain,
      client,
      rpcUrl: given.rpcUrl,
      owner,
      pot,
      mode: (mode ?? "permit2") as FundMode,
      requests,
      sweep,
      ...(account === undefined ? {} : { account }),
      send: given.send && !plan,
      approver: given.approver,
    });
  };
}

/**
 * `sauce tx --fund` values, `<TOKEN|address>:<amount>`, each named once: what the owner moves into
 * the Pot before the cook, each token a transfer the plan lists and `ETH` the cook's value
 * (`funding.ts#transfersToPot`). EVM only.
 */
export function fundTransfers(raws: readonly string[], chain: CanonicalChain): FundRequest[] {
  const requests = raws.map((raw) => parseTokenAmount(raw, chain, "--fund"));
  const seen = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.token ?? "native")) {
      throw new UsageError(`--fund names ${request.label} twice: give it once, with the total`);
    }
    seen.add(request.token ?? "native");
  }

  return requests;
}

/** `--assume-balance` values, `<TOKEN|address>:<amount>`, each named once. */
export function assumedBalances(raws: readonly string[], chain: CanonicalChain): FundRequest[] {
  const requests = raws.map((raw) => parseTokenAmount(raw, chain, "--assume-balance"));
  const seen = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.token ?? "native")) {
      throw new UsageError(`--assume-balance names ${request.label} twice: give it once`);
    }
    seen.add(request.token ?? "native");
  }

  return requests;
}
