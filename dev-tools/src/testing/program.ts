/**
 * A Sauce program as a test names it — a file, or source text — compiled for a chain exactly as the
 * `sauce` command compiles it (`compileSauceProgram`: the chain's token and protocol names, the
 * `@sauce/token` functions and `@sauce/router`), with `main`'s arguments encoded and what it returns
 * decoded as `main` declares it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { address, getAddressEncoder, isAddress } from "@solana/kit";
import type { AccountManifest } from "sauce-compiler";
import { BaseError, bytesToHex, concat, decodeErrorResult, hexToBytes, type Hex } from "viem";

import {
  compileSauceProgram,
  decodeReturned,
  encodeEntryArguments,
  mainReturnType,
  parseEntryType,
  type CanonicalChain,
  type CompiledSauceProgram,
  type EntryType,
  type EntryValue,
  type Returned,
} from "./sdk.js";

/** A program file (a path, relative to the working directory, or a `file:` URL), or its source. */
export type ProgramInput = string | URL | { readonly source: string; readonly path?: string };

/** What `main` returned, as it declares it: integers as `bigint`, addresses and bytes as hex. */
export type Value =
  bigint | boolean | string | readonly Value[] | { readonly [field: string]: Value };

export interface CompiledProgram {
  readonly path: string | undefined;
  readonly source: string;
  readonly chain: CanonicalChain;
  readonly bytecode: Hex;
  /** `main`'s declared parameters, in order. */
  readonly params: ReadonlyArray<{ readonly name: string; readonly type: string }>;
  /** `main`'s declared return type, if it declares one. */
  readonly returnType: string | undefined;
  /** On Solana, the accounts the cook attaches, in order, with the role each needs. */
  readonly manifest?: AccountManifest;
  /**
   * On Solana, the accounts the SDK added to `main` for the token methods and the venues, by name,
   * with how each is derived (`self:USDC`, the Pot's USDC account; `@to:USDC`, that of `main`'s
   * argument `to`). A cook fills each itself.
   */
  readonly derivedAccounts?: Readonly<Record<string, string>>;
  /**
   * On Solana, the values the SDK added to `main` after its accounts, one for each swap at a price:
   * its stop, which a cook works out from the pool (`svmProgramStops`).
   */
  readonly derivedValues?: CompiledSauceProgram["derivedValues"];
  /**
   * The program with `args` encoded after it, and after them each of `derivedValues`' (`stops`, 0
   * for each by default): the `program` of `Pot.cook(engine, program)`.
   */
  payload(args?: readonly EntryValue[], stops?: readonly bigint[]): Hex;
  /** `data`, a cook's return data, read as `main`'s return type. */
  decode(data: Hex): Value | undefined;
}

function load(input: ProgramInput): { source: string; path: string | undefined } {
  if (typeof input === "object" && !(input instanceof URL)) {
    return {
      source: input.source,
      path: input.path === undefined ? undefined : resolve(input.path),
    };
  }
  const path = input instanceof URL ? fileURLToPath(input) : resolve(input);

  return { source: readFileSync(path, "utf8"), path };
}

/** `returned`, read as `type`, as a test value: each integer the type declares as a bigint (it
 *  comes as decimal text), everything else as it is — a string stays a string, digits or not. */
function valueOf(type: EntryType, returned: Returned): Value {
  switch (type.kind) {
    case "uint":
      return BigInt(returned as string);
    case "array":
      return (returned as readonly Returned[]).map((element) => valueOf(type.of, element));
    case "tuple": {
      const record = returned as { readonly [field: string]: Returned };

      return Object.fromEntries(
        type.fields.map((field) => [field.name, valueOf(field.type, record[field.name]!)]),
      );
    }
    default:
      return returned;
  }
}

/**
 * `value`, of `type`, with every `Address` in it as the word the engine reads on Solana: the public
 * key's 32 bytes, whole, where the EVM's ABI encoding keeps 20. A key is given in base58, or as 32
 * bytes of hex.
 */
function keyWords(type: EntryType, value: EntryValue, at: string): EntryValue {
  switch (type.kind) {
    case "address": {
      if (typeof value === "string" && isAddress(value)) {
        return bytesToHex(new Uint8Array(getAddressEncoder().encode(address(value))));
      }
      if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) return value;
      throw new TypeError(
        `${at}: ${JSON.stringify(value)} is not a Solana public key (base58, or 32 bytes of hex)`,
      );
    }
    case "array":
      return Array.isArray(value)
        ? value.map((item: EntryValue, index) => keyWords(type.of, item, `${at}[${index}]`))
        : value;
    case "tuple": {
      if (Array.isArray(value)) {
        return value.map((item: EntryValue, index) =>
          index < type.fields.length
            ? keyWords(type.fields[index]!.type, item, `${at}.${type.fields[index]!.name}`)
            : item,
        );
      }
      if (value === null || typeof value !== "object" || value instanceof Uint8Array) return value;
      const record = value as { readonly [field: string]: EntryValue };

      return Object.fromEntries(
        Object.entries(record).map(([name, item]) => {
          const field = type.fields.find((candidate) => candidate.name === name);

          return [name, field === undefined ? item : keyWords(field.type, item, `${at}.${name}`)];
        }),
      );
    }
    default:
      return value;
  }
}

/**
 * `main`'s arguments encoded after the program, each `Address` on Solana as a whole key, and after
 * them the values the SDK added to it, `stops`.
 */
function encodeArguments(
  compiled: CompiledSauceProgram,
  args: readonly EntryValue[],
  stops: readonly bigint[],
): Uint8Array {
  if (compiled.chain.kind !== "svm") return encodeEntryArguments(compiled, args);
  const params = compiled.entryParams;
  const added = compiled.derivedValues ?? [];
  if (args.length !== params.length) return encodeEntryArguments(compiled, args);

  return encodeEntryArguments(
    {
      ...compiled,
      entryParams: [
        ...params.map((param) => ({
          ...param,
          type: param.type.replace(/\bAddress\b/g, "Uint256"),
        })),
        ...added.map(({ name, type }) => ({ name, type })),
      ],
    },
    [
      ...args.map((value, index) =>
        keyWords(parseEntryType(params[index]!.type), value, params[index]!.name),
      ),
      ...added.map((_, index) => stops[index] ?? 0n),
    ],
  );
}

export function compileProgram(input: ProgramInput, chain: CanonicalChain): CompiledProgram {
  const { source, path } = load(input);
  // Relative imports resolve beside the file, or the working directory for source text.
  const dir = path === undefined ? process.cwd() : dirname(path);
  let compiled: ReturnType<typeof compileSauceProgram>;
  try {
    compiled = compileSauceProgram(chain, source, {
      resolve: (spec: string) => {
        const file = resolve(dir, spec);
        return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
      },
    });
  } catch (error) {
    const name = path ?? "the program";
    throw new Error(
      `${name} does not compile for ${chain.slug}: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
  const returnType = mainReturnType(compiled.source) ?? mainReturnType(source);
  const bytecode = bytesToHex(compiled.bytecode);

  return {
    path,
    source,
    chain,
    bytecode,
    params: compiled.entryParams.map(({ name, type }) => ({ name, type })),
    returnType,
    ...(compiled.manifest === undefined ? {} : { manifest: compiled.manifest }),
    ...(compiled.derivedAccounts === undefined
      ? {}
      : { derivedAccounts: compiled.derivedAccounts }),
    ...(compiled.derivedValues === undefined ? {} : { derivedValues: compiled.derivedValues }),
    payload(args = [], stops = []) {
      if (
        args.length === 0 &&
        compiled.entryParams.length === 0 &&
        (compiled.derivedValues ?? []).length === 0
      )
        return bytecode;

      return concat([bytecode, bytesToHex(encodeArguments(compiled, args, stops))]);
    },
    decode(data) {
      if (returnType === undefined) return undefined;
      const returned = decodeReturned(returnType, data, chain);

      return returned === undefined ? undefined : valueOf(parseEntryType(returnType), returned);
    },
  };
}

/** Thrown by a cook that reverts, with the reason when the revert data carries one. */
export class CookReverted extends Error {
  /** On Solana, the transaction's program logs, which say where it failed. */
  readonly logs?: readonly string[];

  constructor(
    /** The decoded reason (`require`'s message, a panic, a custom error's name), if any. */
    readonly reason: string | undefined,
    /** The raw revert data. */
    readonly data: Hex | undefined,
    options?: { cause?: unknown; logs?: readonly string[]; note?: string },
  ) {
    super(
      `the cook reverted${reason === undefined ? "" : `: ${reason}`}` +
        (options?.note === undefined ? "" : ` (${options.note})`),
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "CookReverted";
    if (options?.logs !== undefined) this.logs = options.logs;
  }
}

/**
 * The reason in `data`: a Sauce program's `require(cond, "msg")` and `throw` revert with the
 * message's own bytes; a contract it called, with an `Error(string)` or a `Panic(uint256)`.
 * Undefined when `data` is none of those.
 */
export function reasonOf(data: Hex | undefined): string | undefined {
  if (data === undefined || data === "0x") return undefined;
  try {
    const decoded = decodeErrorResult({ abi: [], data });
    if (decoded.errorName === "Error") return String(decoded.args[0]);
    if (decoded.errorName === "Panic") return `panic 0x${(decoded.args[0] as bigint).toString(16)}`;
  } catch {
    // Not an ABI-encoded error.
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(data));
    // Printable text: no control character but a tab or a line break.
    const printable = [...text].every((char) => {
      const code = char.codePointAt(0)!;
      return code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0x7f);
    });
    if (text.length > 0 && printable) return text;
  } catch {
    // Not text either.
  }

  return undefined;
}

/** A viem error as `CookReverted`, its revert data dug out of whichever cause carries it. */
export function revertOf(error: unknown): CookReverted {
  let data: Hex | undefined;
  let reason: string | undefined;
  if (error instanceof BaseError) {
    // The revert data rides on one of the causes, as `data` or — from a node's JSON-RPC error —
    // as `data.data`.
    const hexOf = (value: unknown): Hex | undefined =>
      typeof value === "string" && value.startsWith("0x")
        ? (value as Hex)
        : typeof value === "object" && value !== null
          ? hexOf((value as { data?: unknown }).data)
          : undefined;
    const carrier = error.walk((cause) => hexOf((cause as { data?: unknown }).data) !== undefined);
    data = carrier === null ? undefined : hexOf((carrier as { data?: unknown }).data);
    // Else the node's own wording: "execution reverted: <reason>".
    reason =
      reasonOf(data) ??
      /reverted(?: with reason)?:\s*(.+?)\.?$/i.exec(error.details ?? "")?.[1] ??
      /reverted with reason:\s*(.+?)\.?$/i.exec(error.shortMessage)?.[1];
  }

  return new CookReverted(reason, data, { cause: error });
}
