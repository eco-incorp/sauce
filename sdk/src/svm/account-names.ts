/**
 * An account of a Solana cook named by what it is rather than by its address: the language
 * `sauce --account NAME=<value>` takes, in which the SDK also writes how each account it adds to a
 * program is derived (`CompiledSauceProgram.derivedAccounts`, for the token methods).
 *
 *   pot | owner          the cook's Pot, or its owner (the signer)
 *   self                 the authority the program acts with: the Pot, cooked through the Kitchen;
 *                        the owner, cooked directly on the engine (`via: "engine"`)
 *   <base58>             that address
 *   @<param>             the key given as main's argument `<param>`
 *   <holder>:<token>     the holder's associated token account for the mint, under the token
 *                        program that owns the mint; a holder is `pot`, `owner`, `self`, `@<param>`
 *                        or a base58 address
 *   mint:<token>         the mint
 *   program:<token>      the token program that owns the mint
 *   pda:<program>:<seeds> the address `<program>` (base58, or `@<param>`) derives for the seeds,
 *                        comma-separated, each one of:
 *                          "text", or a bare word that is none of the below: its UTF-8 bytes
 *                          pot | owner | self | @<param> | <base58>: that key's 32 bytes
 *                          mint:<token>: the mint's key
 *                          u8:<n> | u16:<n> | u32:<n> | u64:<n> | u128:<n>: the integer `n` (or
 *                          `@<param>`, main's integer argument), little-endian, in that many bits
 *                          0x<hex>: those bytes
 *
 * A token is a symbol the chain registers (`USDC`, a stock's `TSLAx`, matched without regard to
 * case), a mint's base58 address, or `@<param>`, a mint given as main's argument. A registered
 * mint's program is the registry's; any other is read from the cluster through `programOf`.
 *
 * The derivation is the ADDRESS the transaction attaches; what a program does with the account is
 * its own to check (the token methods check each holder's account on chain).
 */
import { address, getAddressEncoder, isAddress, type Address } from "@solana/kit";

import type { CanonicalChain } from "../chains/canonical.js";
import { svmTokenRows, type SvmTokenRow } from "../routes/token-registry.js";
import { svmTokenAccount } from "./token-accounts.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./token-program.js";
import { memoizedGetProgramDerivedAddress } from "./venues/pda-memo.js";

/** A mint's token program, read from the cluster: the owner of the mint's account. */
export type SvmMintProgramOf = (mint: Address) => Promise<Address>;

/** What `resolveSvmAccountName` resolves names against: the cook, and main's arguments. */
export interface SvmAccountNameContext {
  /** The chain whose registered mints a symbol names. */
  readonly chain: CanonicalChain;
  /** The cook's owner: its signer. */
  readonly owner: Address;
  /** The owner's Pot. */
  readonly pot: Address;
  /** Through the Kitchen on the Pot (the default), or directly on the engine, with no Pot. */
  readonly via?: "kitchen" | "engine";
  /** main's `Address` arguments, by parameter name, as keys. */
  readonly args?: Readonly<Record<string, Address>>;
  /** main's integer arguments, by parameter name: what a `u64:@<param>` seed takes. */
  readonly integers?: Readonly<Record<string, bigint>>;
  /**
   * An unregistered mint's token program, read from the cluster. Without it, a name that needs an
   * unregistered mint's program is refused: nothing assumes one.
   */
  readonly programOf?: SvmMintProgramOf;
}

/** One name, resolved. */
export interface ResolvedSvmAccountName {
  /** `pot` or `owner`, which a cook attaches with their signing roles, or an address. */
  readonly value: "pot" | "owner" | Address;
  /** What the account is, for a person, where the name says more than its address. */
  readonly label?: string;
  readonly kind: "pot" | "owner" | "address" | "account" | "mint" | "program";
  /** A holder's token account: its mint, holder and token program, which create it. */
  readonly account?: {
    readonly mint: Address;
    readonly holder: Address;
    readonly program: Address;
  };
}

/** A name that cannot be resolved; its message reads after the name. */
export class SvmAccountNameError extends Error {
  override readonly name = "SvmAccountNameError";
}

type Holder =
  | { readonly kind: "pot" | "owner" | "self" }
  | { readonly kind: "arg"; readonly param: string }
  | { readonly kind: "address"; readonly key: string };

type Token =
  | { readonly kind: "symbol"; readonly symbol: string }
  | { readonly kind: "address"; readonly key: string }
  | { readonly kind: "arg"; readonly param: string };

/** One seed of a program-derived address. */
type Seed =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "key"; readonly holder: Holder }
  | { readonly kind: "mint"; readonly token: Token }
  | { readonly kind: "integer"; readonly bits: number; readonly value: bigint | string }
  | { readonly kind: "bytes"; readonly hex: string };

type Parsed =
  | { readonly kind: "holder"; readonly holder: Holder }
  | { readonly kind: "account"; readonly holder: Holder; readonly token: Token }
  | { readonly kind: "mint" | "program"; readonly token: Token }
  | {
      readonly kind: "pda";
      readonly program: Holder;
      readonly seeds: readonly Seed[];
      readonly text: string;
    };

const PARAM = /^@([A-Za-z_$][A-Za-z0-9_$]*)$/;
const SYMBOL = /^[A-Za-z0-9_]+$/;

function parseHolder(text: string): Holder | undefined {
  if (text === "pot" || text === "owner" || text === "self") return { kind: text };
  const param = PARAM.exec(text);
  if (param !== null) return { kind: "arg", param: param[1]! };

  return isAddress(text) ? { kind: "address", key: text } : undefined;
}

function parseToken(text: string): Token | undefined {
  const param = PARAM.exec(text);
  if (param !== null) return { kind: "arg", param: param[1]! };
  if (isAddress(text)) return { kind: "address", key: text };

  return SYMBOL.test(text) ? { kind: "symbol", symbol: text } : undefined;
}

const INTEGER = /^u(8|16|32|64|128):(?:(\d+)|@([A-Za-z_$][A-Za-z0-9_$]*))$/;
const WORD = /^[A-Za-z0-9_.-]+$/;

function parseSeed(text: string): Seed | undefined {
  if (/^"[^"]*"$/.test(text)) return { kind: "text", text: text.slice(1, -1) };
  const holder = parseHolder(text);
  if (holder !== undefined) return { kind: "key", holder };
  if (text.startsWith("mint:")) {
    const token = parseToken(text.slice("mint:".length));
    return token === undefined ? undefined : { kind: "mint", token };
  }
  const integer = INTEGER.exec(text);
  if (integer !== null) {
    return {
      kind: "integer",
      bits: Number(integer[1]),
      value: integer[2] === undefined ? integer[3]! : BigInt(integer[2]),
    };
  }
  if (/^0x(?:[0-9a-fA-F]{2})*$/.test(text)) return { kind: "bytes", hex: text.slice(2) };

  return WORD.test(text) && !/^u\d+:/.test(text) ? { kind: "text", text } : undefined;
}

/** `a,"b,c",d` split at the commas outside quotes. */
function seedTexts(text: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === "," && !quoted) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));

  return parts;
}

function parsePda(value: string): Parsed | undefined {
  const rest = value.slice("pda:".length);
  const at = rest.indexOf(":");
  if (at <= 0) return undefined;
  const program = parseHolder(rest.slice(0, at));
  if (program === undefined || (program.kind !== "address" && program.kind !== "arg")) {
    return undefined;
  }
  const text = rest.slice(at + 1);
  if (text === "") return undefined;
  const seeds = seedTexts(text).map(parseSeed);
  if (seeds.some((seed) => seed === undefined)) return undefined;

  return { kind: "pda", program, seeds: seeds as Seed[], text };
}

function parse(value: string): Parsed | undefined {
  const holder = parseHolder(value);
  if (holder !== undefined) return { kind: "holder", holder };
  if (value.startsWith("pda:")) return parsePda(value);
  const at = value.indexOf(":");
  if (at <= 0) return undefined;
  const head = value.slice(0, at);
  const token = parseToken(value.slice(at + 1));
  if (token === undefined) return undefined;
  if (head === "mint" || head === "program") return { kind: head, token };
  const of = parseHolder(head);

  return of === undefined ? undefined : { kind: "account", holder: of, token };
}

/** Whether `value` is a name this language has (it says nothing of whether it resolves). */
export function isSvmAccountName(value: string): boolean {
  return parse(value) !== undefined;
}

/** The name a person reads for a token program. */
const programName = (program: Address): string =>
  program === TOKEN_2022_PROGRAM_ID ? "Token-2022" : "SPL Token";

/** main's argument `param`, as a key. */
function argument(param: string, ctx: SvmAccountNameContext): Address {
  const key = ctx.args?.[param];
  if (key === undefined) {
    throw new SvmAccountNameError(
      `the account is derived from main's argument \`${param}\`, which was not given: pass ` +
        "main's arguments",
    );
  }

  return key;
}

/** A token's mint and its row, when the chain registers it. */
function mintOf(
  token: Token,
  whose: string,
  ctx: SvmAccountNameContext,
  rows: readonly SvmTokenRow[],
): { readonly mint: Address; readonly row?: SvmTokenRow; readonly what: string } {
  if (token.kind === "symbol") {
    // Without regard to case: a stock's symbol is its issuer's ticker (`TSLAx`), not uppercase.
    const upper = token.symbol.toUpperCase();
    const row = rows.find((candidate) => candidate.symbol.toUpperCase() === upper);
    if (row === undefined) {
      // The chain's other mints by name, its tokenized stocks by count: there are over a thousand.
      const listed = rows.filter((candidate) => candidate.stock === undefined);
      const stocks = rows.length - listed.length;
      throw new SvmAccountNameError(
        `${token.symbol} is not a mint ${ctx.chain.slug} registers ` +
          `(${listed.map((candidate) => candidate.symbol).join(", ") || "none"}` +
          (stocks > 0
            ? `, and ${stocks} stock tokens: sauce globals --chain ${ctx.chain.slug} --stocks`
            : "") +
          `): give the mint's base58 address, ${whose}:<mint>`,
      );
    }

    return { mint: address(row.mint), row, what: row.symbol };
  }
  const mint = token.kind === "arg" ? argument(token.param, ctx) : address(token.key);
  const row = rows.find((candidate) => candidate.mint === mint);

  return { mint, ...(row === undefined ? {} : { row }), what: row?.symbol ?? `mint ${mint}` };
}

/**
 * An unregistered mint's token program, from the cluster: SPL Token or Token-2022, and nothing
 * else. FAILS CLOSED: with no way to read it, or a read that fails or finds another owner, the name
 * is refused — an assumed program would derive the wrong token account, or attach the wrong program.
 */
async function programOfMint(mint: Address, ctx: SvmAccountNameContext): Promise<Address> {
  if (ctx.programOf === undefined) {
    throw new SvmAccountNameError(
      `mint ${mint} is not one ${ctx.chain.slug} registers, and its token program can only be ` +
        "read from the cluster, which this resolution has no way to do",
    );
  }
  let program: Address;
  try {
    program = await ctx.programOf(mint);
  } catch (error) {
    throw new SvmAccountNameError(
      `the token program of mint ${mint} could not be read: ${(error as Error).message}`,
    );
  }
  if (program !== TOKEN_PROGRAM_ID && program !== TOKEN_2022_PROGRAM_ID) {
    throw new SvmAccountNameError(
      `mint ${mint} is owned by ${program}, neither SPL Token nor Token-2022`,
    );
  }

  return program;
}

/** Who a holder is: the Pot or the owner by role, else a key; and how a person reads it. */
function holderOf(
  holder: Holder,
  ctx: SvmAccountNameContext,
  token: string,
): { readonly key: Address; readonly whose: string } {
  const engine = ctx.via === "engine";
  switch (holder.kind) {
    case "pot":
      if (engine) {
        throw new SvmAccountNameError(
          "--via engine cooks with no Pot, so there is no Pot's token account to pass: give the " +
            `account the program reads by its address (owner:${token} for the owner's), or cook ` +
            "through the Kitchen",
        );
      }
      return { key: ctx.pot, whose: "the Pot's" };
    case "owner":
      return { key: ctx.owner, whose: "the owner's" };
    case "self":
      return engine
        ? { key: ctx.owner, whose: "the owner's" }
        : { key: ctx.pot, whose: "the Pot's" };
    case "arg":
      return { key: argument(holder.param, ctx), whose: `main's argument ${holder.param}'s` };
    case "address":
      return { key: address(holder.key), whose: `${holder.key}'s` };
  }
}

/**
 * Resolves one name to the account a cook attaches. `pot` and `owner` stay as they are (and `self`
 * becomes one of them), so the cook gives each its signing role; every other name becomes an
 * address. Throws `SvmAccountNameError` for a name the language does not have, a symbol the chain
 * does not register, the Pot's token account cooked with no Pot, or an argument not given.
 */
export async function resolveSvmAccountName(
  value: string,
  ctx: SvmAccountNameContext,
): Promise<ResolvedSvmAccountName> {
  const parsed = parse(value);
  if (parsed === undefined) {
    throw new SvmAccountNameError(
      `'${value}' is not an address, pot, owner, self, @<argument>, or a token's account: ` +
        "pot:USDC is the Pot's own USDC account (pot:<mint> for any mint), owner:USDC the " +
        "owner's, @to:USDC main's argument to's, mint:USDC the mint, program:USDC its token " +
        'program, and pda:<program>:"seed",@to,u64:7 an address a program derives',
    );
  }
  if (parsed.kind === "holder") {
    const { holder } = parsed;
    switch (holder.kind) {
      case "pot":
        return { value: "pot", kind: "pot" };
      case "owner":
        return { value: "owner", kind: "owner" };
      case "self":
        return ctx.via === "engine"
          ? { value: "owner", kind: "owner" }
          : { value: "pot", kind: "pot" };
      case "arg":
        return {
          value: argument(holder.param, ctx),
          label: `main's argument ${holder.param}`,
          kind: "address",
        };
      case "address":
        return { value: address(holder.key), kind: "address" };
    }
  }

  const rows = svmTokenRows(ctx.chain);
  if (parsed.kind === "pda") return resolvePda(parsed, ctx, rows);
  const tokenText = value.slice(value.indexOf(":") + 1);
  const whose = value.slice(0, value.indexOf(":"));
  const { mint, row, what } = mintOf(parsed.token, whose, ctx, rows);
  if (parsed.kind === "mint") return { value: mint, label: `the ${what} mint`, kind: "mint" };
  const program = row !== undefined ? address(row.tokenProgram) : await programOfMint(mint, ctx);
  if (parsed.kind !== "account") {
    return {
      value: program,
      label: `${what}'s token program, ${programName(program)}`,
      kind: "program",
    };
  }
  const holder = holderOf(parsed.holder, ctx, tokenText);
  const account = await svmTokenAccount({ mint, tokenProgram: program }, holder.key);

  return {
    value: account,
    label: `${holder.whose} ${what} account`,
    kind: "account",
    account: { mint, holder: holder.key, program },
  };
}

/** main's integer argument `param`. */
function integerArgument(param: string, ctx: SvmAccountNameContext): bigint {
  const value = ctx.integers?.[param];
  if (value === undefined) {
    throw new SvmAccountNameError(
      `the account is derived from main's argument \`${param}\`, which was not given: pass ` +
        "main's arguments",
    );
  }

  return value;
}

/** A program-derived address, its seeds made from the cook and main's arguments. */
async function resolvePda(
  parsed: Extract<Parsed, { kind: "pda" }>,
  ctx: SvmAccountNameContext,
  rows: readonly SvmTokenRow[],
): Promise<ResolvedSvmAccountName> {
  const encoder = getAddressEncoder();
  const keyOf = (holder: Holder): Address => {
    switch (holder.kind) {
      case "pot":
        return ctx.pot;
      case "owner":
        return ctx.owner;
      case "self":
        return ctx.via === "engine" ? ctx.owner : ctx.pot;
      case "arg":
        return argument(holder.param, ctx);
      case "address":
        return address(holder.key);
    }
  };
  const program = keyOf(parsed.program);
  const seeds = parsed.seeds.map((seed): Uint8Array => {
    switch (seed.kind) {
      case "text":
        return new TextEncoder().encode(seed.text);
      case "key":
        return new Uint8Array(encoder.encode(keyOf(seed.holder)));
      case "mint":
        return new Uint8Array(encoder.encode(mintOf(seed.token, "mint", ctx, rows).mint));
      case "bytes":
        return Uint8Array.from(seed.hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
      case "integer": {
        const value =
          typeof seed.value === "bigint" ? seed.value : integerArgument(seed.value, ctx);
        const width = seed.bits / 8;
        if (value >= 1n << BigInt(seed.bits)) {
          throw new SvmAccountNameError(
            `seed u${seed.bits}:${value} does not fit ${width} byte${width === 1 ? "" : "s"}`,
          );
        }
        return Uint8Array.from({ length: width }, (_, i) =>
          Number((value >> BigInt(8 * i)) & 0xffn),
        );
      }
    }
  });
  const long = seeds.findIndex((seed) => seed.length > 32);
  if (long >= 0) {
    throw new SvmAccountNameError(
      `seed ${long + 1} is ${seeds[long]!.length} bytes; a seed is at most 32`,
    );
  }
  if (seeds.length > 16) {
    throw new SvmAccountNameError(`${seeds.length} seeds; an address derives from at most 16`);
  }
  const value = await memoizedGetProgramDerivedAddress(program, seeds);

  return { value, label: `the address ${program} derives for ${parsed.text}`, kind: "address" };
}
