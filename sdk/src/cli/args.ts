/**
 * The `sauce` command's flags: parsing them, and turning each value into the SDK type it names.
 *
 * Every failure here is a {@link UsageError} whose message names the flag and what it accepts, so
 * the command can tell a mistyped invocation (exit 2, with a pointer to `--help`) from a program
 * that does not compile or a chain that says no (exit 1).
 */
import { parseArgs } from "node:util";
import { getAddressEncoder, isAddress as isSolanaAddress } from "@solana/kit";
import { bytesToBigInt, getAddress, isAddress, type Address, type Hex } from "viem";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { potSalt, SAUCE_INTENT_POT_SALT } from "../deployments/pot.js";
import { INTENT_FUND_VIA, type IntentFundVia } from "../routes/portal.js";
import type { CookVia } from "../svm/client.js";

/** A mistyped invocation: an unknown or missing flag, or a value that is not what the flag takes. */
export class UsageError extends Error {}

/** A failure that is not the invocation's fault: a program that does not compile, a chain that
 *  disagrees. Exit 1, where a {@link UsageError} is exit 2. */
export class CliError extends Error {}

/** A flag, as `parseArgs` takes it, plus the placeholder and sentence `--help` prints for it. */
export interface FlagSpec {
  readonly type: "string" | "boolean";
  readonly multiple?: boolean;
  readonly short?: string;
  /** The value's placeholder in `--help`, e.g. `<address>`. Absent for a boolean flag. */
  readonly value?: string;
  readonly help: string;
  /** A flag one kind of chain takes and the other refuses, listed under its own heading. */
  readonly only?: "evm" | "svm";
}

export type FlagSpecs = Readonly<Record<string, FlagSpec>>;

export interface ParsedArgs {
  readonly values: Readonly<Record<string, string | boolean | (string | boolean)[] | undefined>>;
  readonly positionals: readonly string[];
}

/** `argv` against `flags`, strictly: an unknown flag, a missing value or a stray operand throws. */
export function parseFlags(argv: readonly string[], flags: FlagSpecs): ParsedArgs {
  const options = Object.fromEntries(
    Object.entries(flags).map(([name, spec]) => [
      name,
      {
        type: spec.type,
        ...(spec.multiple === true ? { multiple: true } : {}),
        ...(spec.short === undefined ? {} : { short: spec.short }),
      },
    ]),
  );
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options,
      strict: true,
      allowPositionals: true,
    });

    return { values, positionals };
  } catch (error) {
    throw new UsageError(describeParseError(error, flags, argv));
  }
}

/** `parseArgs`'s messages advise on `--` escaping; say what was wrong with the flag instead. */
function describeParseError(error: unknown, flags: FlagSpecs, argv: readonly string[]): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  const flag = /'(-{1,2}[^' ]+)/.exec(message)?.[1];
  // Several flags in one word: a shell handed over a quoted string, or a variable it did not split
  // (zsh never splits an unquoted `$FLAGS`).
  const joined = argv.find((word) => /^-{1,2}\S+\s/.test(word) && word.startsWith(flag ?? "\0"));
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && joined !== undefined) {
    // Only the flags' names: a value in there may be a key.
    const names = joined.split(/\s+/).filter((word) => /^-{1,2}[\w-]+$/.test(word));
    return (
      `one argument holds several words, ${names.join(", ")} and their values, with spaces ` +
      "between them: a shell passed a quoted string, or a variable it did not split (zsh does not " +
      "split an unquoted $VARIABLE). Pass each flag and each value as a word of its own."
    );
  }
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && flag !== undefined) {
    return `unknown option ${flag}`;
  }
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && flag !== undefined) {
    const name = flag.replace(/^-+/, "");
    const spec = flags[name] ?? Object.values(flags).find((f) => f.short === name);

    return spec?.type === "boolean"
      ? `${flag} takes no value`
      : `${flag} needs a value${spec?.value === undefined ? "" : `: ${spec.value}`}`;
  }

  return message;
}

/** The one string value of `flag`, or `undefined` when it was not given. */
export function stringFlag(args: ParsedArgs, flag: string): string | undefined {
  const value = args.values[flag];

  return typeof value === "string" ? value : undefined;
}

/** The one string value of `flag`; missing, it is a usage error naming what it takes. */
export function requiredFlag(args: ParsedArgs, flag: string, value: string): string {
  const given = stringFlag(args, flag);
  if (given === undefined) throw new UsageError(`missing --${flag} ${value}`);

  return given;
}

/** Every value of a repeatable flag, in the order given. */
export function repeatedFlag(args: ParsedArgs, flag: string): readonly string[] {
  const value = args.values[flag];

  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** A chain by canonical slug, alias or numeric id — the same lookup the SDK itself uses. `from`
 *  names where the value came from, for the error. */
export function parseChain(raw: string, from = "--chain"): CanonicalChain {
  const ref = /^\d+$/.test(raw) ? Number(raw) : raw;
  try {
    return requireChain(ref);
  } catch (error) {
    throw new UsageError(`${from}: ${(error as Error).message}`);
  }
}

/** Which engine a program is for — the kind of chain it runs on. */
export type Target = CanonicalChain["kind"];

export function parseTarget(raw: string, from = "--target"): Target {
  if (raw !== "evm" && raw !== "svm") {
    throw new UsageError(`${from}: '${raw}' is not a target (evm or svm)`);
  }

  return raw;
}

/** What a program file's header says: its leading `//` lines, `// @chain <c>`, `// @target <t>`. */
export interface ProgramHeader {
  readonly chain?: string;
  readonly target?: string;
}

const HEADER_TAG = /^\/\/\s*@(chain|target)\s+(\S+)\s*$/;

/**
 * The defaults a program file declares for itself, from the `//` comment lines it starts with:
 *
 * ```js
 * // @chain base
 * // Pays RECIPIENT from the Pot.
 * ```
 *
 * The header ends at the first line that is not a `//` comment. A flag overrides what it says.
 */
export function parseHeader(text: string, file: string): ProgramHeader {
  const header: { chain?: string; target?: string } = {};
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line.startsWith("//")) break;
    const tag = HEADER_TAG.exec(line);
    if (tag === null) continue;
    const name = tag[1] as "chain" | "target";
    if (header[name] !== undefined) {
      throw new UsageError(`${file}:${index + 1}: the header gives @${name} twice`);
    }
    header[name] = tag[2]!;
  }

  return header;
}

/** A 20-byte hex address, returned checksummed. */
export function parseAddress(flag: string, raw: string): Address {
  if (!isAddress(raw, { strict: false })) {
    throw new UsageError(`--${flag}: '${raw}' is not an address (20 bytes of hex, 0x-prefixed)`);
  }

  return getAddress(raw);
}

/** A non-negative integer amount in wei: decimal digits, or 0x-prefixed hex. */
export function parseWei(flag: string, raw: string): bigint {
  if (!/^(?:\d+|0x[0-9a-fA-F]+)$/.test(raw)) {
    throw new UsageError(`--${flag}: '${raw}' is not an amount in wei (an integer, e.g. 1000)`);
  }

  return BigInt(raw);
}

/**
 * `--via kitchen|engine`: how a Solana cook reaches the engine — the Kitchen's `cook` on the
 * owner's Pot, or the engine's own paid `cookAndPay`. `from` names where the value came from.
 */
export function parseVia(raw: string, from = "--via"): CookVia {
  if (raw !== "kitchen" && raw !== "engine") {
    throw new UsageError(
      `${from}: '${raw}' is not kitchen (the Kitchen's cook, on the owner's Pot) or engine (the ` +
        "engine's own paid cook, with no Pot)",
    );
  }

  return raw;
}

/** A non-negative amount of lamports that fits a u64: decimal digits, or 0x-prefixed hex. */
export function parseLamports(flag: string, raw: string): bigint {
  if (!/^(?:\d+|0x[0-9a-fA-F]+)$/.test(raw) || BigInt(raw) >= 1n << 64n) {
    throw new UsageError(
      `--${flag}: '${raw}' is not an amount in lamports (an integer below 2^64, e.g. 5000)`,
    );
  }

  return BigInt(raw);
}

/**
 * A Pot's salt: `--salt <label>`, hashed by the SDK's `potSalt`, or `--salt-hex <bytes32>`, exactly
 * 32 bytes — never both. Neither is the zero salt, the one Pot an owner has by default.
 */
export function parseSalt(label: string | undefined, hex: string | undefined): SaltChoice {
  if (label !== undefined && hex !== undefined) {
    throw new UsageError(
      "give --salt or --salt-hex, not both: --salt <label> is hashed into the salt, --salt-hex " +
        "<bytes32> is the salt itself",
    );
  }
  if (label !== undefined) {
    if (label === "") {
      throw new UsageError("--salt: a label cannot be empty; leave --salt out for the default Pot");
    }
    const shown = /^[\w.@:/-]+$/.test(label) ? label : JSON.stringify(label);

    return { salt: potSalt(label), flag: `--salt ${shown}` };
  }
  if (hex !== undefined) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
      throw new UsageError(`--salt-hex: '${hex}' is not exactly 32 bytes of 0x-prefixed hex`);
    }

    return { salt: hex.toLowerCase() as Hex, flag: `--salt-hex ${hex.toLowerCase()}` };
  }

  return { salt: SAUCE_INTENT_POT_SALT };
}

/** A Pot's salt, and the flag that chose it, to repeat in a hint. */
export interface SaltChoice {
  readonly salt: Hex;
  readonly flag?: string;
}

/** How an intent's reward is funded — `routes/portal.ts#IntentFundVia`, spelled the same here. */
export function parseFundVia(raw: string, from = "--intent-fund-via"): IntentFundVia {
  if (!(INTENT_FUND_VIA as readonly string[]).includes(raw)) {
    throw new UsageError(
      `${from}: '${raw}' is not ${INTENT_FUND_VIA.join(" or ")} — transfer pays the reward into ` +
        "the intent's vault and then publishes; publishAndFund approves the Portal, which pulls it",
    );
  }

  return raw as IntentFundVia;
}

/** Absolute Unix seconds. */
export function parseUnixSeconds(flag: string, raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`--${flag}: '${raw}' is not a Unix time in seconds (e.g. 2000000000)`);
  }

  return BigInt(raw);
}

/** A compile-time value: one 256-bit word, or a boolean — what `SauceCompileOptions.defines`
 *  takes. An address is its integer. */
export type DefineValue = bigint | boolean;

/** The literal syntax a define's value takes: a decimal or 0x-hex integer, `_` separators and a
 *  trailing `n` allowed — the spelling the compiler accepts. */
const DEFINE_VALUE = /^(?:\d[\d_]*|0x[0-9a-fA-F][0-9a-fA-F_]*)n?$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const WORD = 1n << 256n;

/**
 * A Solana public key, as the 32-byte big-endian word a program compares an account's `address`
 * with — `undefined` when `raw` is not one. A string of digits alone is read as the integer it also
 * is, so a key that is all digits (the System Program's `1111…`) is given as 0x hex instead.
 */
function solanaKey(raw: string): bigint | undefined {
  if (/^\d+$/.test(raw) || !isSolanaAddress(raw)) return undefined;

  return bytesToBigInt(new Uint8Array(getAddressEncoder().encode(raw)));
}

/** `raw` as a define's value, or a usage error naming `where` it was given. On Solana (`svm`), a
 *  base58 public key is one too. */
function defineValue(raw: unknown, where: string, svm: boolean): DefineValue {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "false") return raw === "true";
  let word: bigint | undefined;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) word = BigInt(raw);
  if (typeof raw === "string" && DEFINE_VALUE.test(raw)) {
    word = BigInt(raw.replace(/_/g, "").replace(/n$/, ""));
  }
  const key = word === undefined && typeof raw === "string" ? solanaKey(raw) : undefined;
  if (key !== undefined) {
    if (!svm) {
      throw new UsageError(
        `${where}: '${String(raw)}' is a Solana public key (base58), which only a program for ` +
          "Solana takes; give an EVM address as 0x hex",
      );
    }
    word = key;
  }
  if (word === undefined) {
    const shown = typeof raw === "string" ? `'${raw}'` : JSON.stringify(raw);
    throw new UsageError(
      `${where}: ${shown} is not a define value: an address or other integer (decimal or 0x hex)` +
        `${svm ? ", a base58 public key" : ""}, true or false`,
    );
  }
  if (word >= WORD) throw new UsageError(`${where}: ${String(raw)} does not fit 256 bits`);

  return word;
}

function defineName(name: string, where: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new UsageError(`${where}: '${name}' is not a name a program can declare`);
  }

  return name;
}

/**
 * `--define NAME=VALUE`, repeated: compile-time values the program reads by name. A define replaces
 * the program's own module-level `const` of that name. A repeated name is refused rather than
 * last-wins, as the compiler refuses it. On a Solana program (`target` svm) a value may also be a
 * base58 public key.
 */
export function parseDefines(
  raws: readonly string[],
  target: Target = "evm",
): Record<string, DefineValue> {
  const defines: Record<string, DefineValue> = {};
  for (const raw of raws) {
    const eq = raw.indexOf("=");
    if (eq < 0) throw new UsageError(`--define: '${raw}' is not NAME=VALUE`);
    const name = defineName(raw.slice(0, eq), "--define");
    if (Object.hasOwn(defines, name)) throw new UsageError(`--define: ${name} is given twice`);
    defines[name] = defineValue(raw.slice(eq + 1), `--define ${name}`, target === "svm");
  }

  return defines;
}

/**
 * `--defines <file.json>`: one JSON object of NAME to value — a string in `--define`'s syntax, a
 * non-negative safe-integer number, or a boolean. `file` is only for the errors.
 */
export function parseDefinesFile(
  text: string,
  file: string,
  target: Target = "evm",
): Record<string, DefineValue> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`--defines ${file}: not JSON (${(error as Error).message})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`--defines ${file}: expected one JSON object of NAME to value`);
  }

  return parseDefineMap(parsed as Record<string, unknown>, `--defines ${file}`, target);
}

/**
 * Defines given as one object of NAME to value, each value as `--defines` takes it: a string in
 * `--define`'s syntax, a non-negative safe-integer number, or a boolean — and on a Solana program
 * (`target` svm) a base58 public key. `where` names where they were given, for the errors.
 */
export function parseDefineMap(
  entries: Readonly<Record<string, unknown>>,
  where: string,
  target: Target = "evm",
): Record<string, DefineValue> {
  const defines: Record<string, DefineValue> = {};
  for (const [name, raw] of Object.entries(entries)) {
    defines[defineName(name, where)] = defineValue(raw, `${where}: ${name}`, target === "svm");
  }

  return defines;
}

/** `flags` as the option lines of a `--help` screen, aligned. */
export function describeFlags(flags: FlagSpecs): string {
  const rows = Object.entries(flags).map(([name, spec]) => {
    const short = spec.short === undefined ? "    " : `-${spec.short}, `;

    return [`${short}--${name}${spec.value === undefined ? "" : ` ${spec.value}`}`, spec.help];
  });
  const width = Math.max(...rows.map(([left]) => left.length));

  return rows.map(([left, help]) => `  ${left.padEnd(width)}  ${help}`).join("\n");
}
