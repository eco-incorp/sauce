/**
 * An Eco intent built in TypeScript:
 *
 *   Base.hop({
 *     source: Ethereum,
 *     send: { token: usdcEthereum, amount: 1_010_000n },
 *     receive: { token: usdcBase, amount: 1_000_000n },
 *     refundee: owner,
 *     fee: kitchenFee,
 *   }).then(() => { USDC.transfer(RECIPIENT, 1000000); });
 *
 * is the statement a program would open the intent with, written out as SauceScript and compiled
 * for the source chain, where a Pot cooks it: the Pot pays the reward into the intent's vault and
 * publishes it. The intent is `@sauce/hop`'s class, the one every program's intents are, so a
 * TypeScript intent and the same statement in a file are the same program. There is no second
 * encoder and no offline hash: the intent's hash is the one the Portal's `IntentPublished` announces,
 * read from the cook's rehearsal or its receipt (`intents(logs)`).
 *
 * The body is a closure whose text is compiled, never run: it captures no JavaScript value, and
 * what it needs from the host it reads as a define (`compile: { defines }`).
 */
import { bytesToHex, getAddress, type Address, type Hex } from "viem";

import { requireChain, type CanonicalChain, type ChainRef } from "../chains/canonical.js";
import { v12PredictPot, SAUCE_INTENT_POT_SALT } from "../deployments/pot.js";
import { v12EngineAddress } from "../deployments/v12-addresses.js";
import { closureText, isSauceClosure, type SauceBody } from "./closure.js";
import { HOP_FIELDS } from "./intent-syntax.js";
import { denormalizeToEvm } from "./encode.js";
import { toBigInt, toUniversalAddress } from "./normalize.js";
import { pascalOfSlug } from "./pascal.js";
import { loggedIntents, type IntentLog, type LoggedIntent } from "./published.js";
import { buildSauceEvmCall, type SauceEvmCall } from "./sauce-calls.js";
import {
  compileSauceProgram,
  type CompiledSauceProgram,
  type SauceProgramOptions,
} from "./sauce-route.js";
import type { AddressInput } from "./types.js";

/** An address, as the host spells it or as a SauceScript value does. */
export type HopAddress = AddressInput | bigint;

/** A token and an amount. */
export interface HopTokenAmount {
  readonly token: HopAddress;
  readonly amount: bigint | number | string;
}

/** One thing a hop's `send` pays: a token and an amount, or native coin as `{ native: amount }`. */
export type HopSendItem = HopTokenAmount | { readonly native: bigint | number | string };

/** A hop's `send`: an item, or a list of them. */
export type HopSend = HopSendItem | readonly HopSendItem[];

/** A hop's `receive`: a token the solver delivers, or a list of them. */
export type HopDelivery = HopTokenAmount | readonly HopTokenAmount[];

/** A chain, as a reference or as a chain export (`Ethereum`). */
export type HopChain = ChainRef | { readonly chain: CanonicalChain };

/**
 * What a hop takes: the fields a program's `hop({ … })` takes (`intent-syntax.ts#HOP_FIELDS`),
 * with `source` and `compile` besides, which only the host has.
 */
export interface HopConfig {
  /** The chain what the hop sends is escrowed on, where the intent is published and the program is
   *  compiled. Required on the host, which runs on no chain to default it to; left out only inside
   *  a typed closure, where the program opens the hop from the chain the body runs on. */
  readonly source?: HopChain;
  /** The source compile's options: defines the body reads, the intents' defaults (the Kitchen fee
   *  as `intents.executionFee`, the Portals), tokens. */
  readonly compile?: SauceProgramOptions;
  /** What leaves the source chain: escrowed there, it pays the solver who fills the intent (the
   *  Portal's reward). Tokens, and native coin as `{ native: amount }`. */
  readonly send: HopSend;
  /** What the solver delivers on the destination, for the body. Left out, nothing. */
  readonly receive?: HopDelivery;
  /** Who may reclaim an unearned reward, the reward's `creator` on the Portal. Required, as on
   *  every intent. */
  readonly refundee: HopAddress;
  /** The last second the intent may be filled, Unix seconds. Defaults to `DEFAULT_FILL_WINDOW`
   *  past when the cook publishes it. */
  readonly deadline?: bigint | number;
  /** From when what was sent, if no fill is proven, may be refunded (the Portal reward's deadline),
   *  Unix seconds. Defaults to the fill deadline plus `DEFAULT_REFUND_WINDOW`. */
  readonly rewardDeadline?: bigint | number;
  /** The source chain's prover. Defaults to the registry's for the pair. */
  readonly prover?: HopAddress;
  /** The route's salt, used as written. Left out, the compile's salt mixed with how many intents
   *  the cook has opened. */
  readonly salt?: Hex | bigint;
  /** The destination Kitchen's fee, in wei, which the body's cook pays: read it with
   *  `destinationExecutionFee()`. Else `intents.executionFee` in `compile`. */
  readonly fee?: bigint | number;
  /** Calls the destination Portal's Executor makes before the delivered tokens move into the Pot,
   *  each one external call, made exactly as written: no delivery, no approve reset. */
  readonly before?: readonly HopHook[];
  /** Calls the destination Portal's Executor makes after the body's cook, as `before`'s are. */
  readonly after?: readonly HopHook[];
}

/** A hook: a closure whose body is one external call, written into the program as it is declared
 *  (`() => Permit2.approve(USDC, spender, amount, 0)`), or that call's own text. */
export type HopHook = SauceBody;

/** A hop waiting for its body. Its `then` is the intent's, not a promise's: `await` on it is
 *  refused on the host. */
export interface HostHop {
  /** The body that runs on the destination: an arrow function, or the statements of one. */
  then(body: SauceBody): HopOpened;
}

/** The Pot a cook runs on: its address, or its owner and salt (zero by default). */
export type PotTarget = AddressInput | { readonly owner: AddressInput; readonly salt?: Hex };

/** An intent built in TypeScript: the program that opens it, and its cook. */
export interface HostIntent {
  /** The program, as SauceScript: the statement that opens the intent. */
  readonly source: string;
  /** It, compiled for the source chain. */
  readonly program: CompiledSauceProgram;
  /**
   * The cook that publishes the intent from `target`'s Pot on the source chain: `Pot.cook(engine,
   * program)`, sent by the Pot's owner, `value` the source Kitchen's fee. The Pot pays the reward
   * into the intent's vault, so it must hold it (send it there first, or have `sauce run --fund`
   * pull it in the same cook), and must be deployed (`sauceEvmDeployPotCall`).
   */
  cook(target: PotTarget, value: bigint | number): SauceEvmCall;
  /** The intents `logs` show the source chain's Portal publishing — the cook's rehearsal's or its
   *  receipt's — each rebuilt from `IntentPublished` and held to the hash it announces. */
  intents(logs: readonly IntentLog[]): readonly LoggedIntent[];
}

/**
 * The built intent, and inside a typed closure, the handler of its body: `.then(() => { … })
 * .catch((e) => { … })` in a program, where the compiler builds the two as one program. On the host
 * `.catch(...)` is refused: write the intent in the program a Pot runs.
 */
export type HopOpened = HostIntent & {
  /** What runs on the destination in the body's place when the body reverts, `e` what it reverted
   *  with: written in a program, never called on the host. */
  catch(handler: (e: HopCaughtBytes) => void): void;
};

/**
 * What a handler's `e` is in a typed closure: SauceScript `bytes`, the shape
 * `source-globals.generated.ts`'s `SauceBytes` has, written out so this module declares no globals.
 */
export interface HopCaughtBytes {
  readonly length: bigint;
  [index: number]: bigint;
  slice(start: bigint, end: bigint): HopCaughtBytes;
  toBe(): bigint;
  toLe(): bigint;
}

/** A chain's `hop`, opening an intent whose body runs on that chain. */
export type ChainHop = (config: HopConfig) => HostHop;

/** The fields a hop takes on the host: a program's, and the source and its compile. */
const HOP_CONFIG: ReadonlySet<string> = new Set(["source", "compile", ...Object.keys(HOP_FIELDS)]);

const isNative = (value: unknown): boolean =>
  typeof value === "function" && Function.prototype.toString.call(value).includes("[native code]");

/** A chain export (`Ethereum`, carrying `.chain`) rather than a reference. */
function isChainExport(value: HopChain): value is { readonly chain: CanonicalChain } {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null && "chain" in value
  );
}

/** An address the host spells any way, as an EVM address. */
const evmAddress = (address: AddressInput): Address =>
  getAddress(denormalizeToEvm(toUniversalAddress(address)));

/** An address as SauceScript writes it: a hex literal. */
const addressLiteral = (address: HopAddress): string =>
  typeof address === "bigint"
    ? `0x${address.toString(16).padStart(40, "0")}`
    : evmAddress(address).toLowerCase();

/** A whole number as SauceScript writes it: plainly. */
const integer = (value: bigint | number | string): string => toBigInt(value).toString();

/** A token amount, or native coin, as a SauceScript item. */
function itemLiteral(item: HopSendItem): string {
  return "native" in item
    ? `{ native: ${integer(item.native)} }`
    : `{ token: ${addressLiteral(item.token)}, amount: ${integer(item.amount)} }`;
}

/** One item, or a list of them, as SauceScript writes it. */
function itemsLiteral(given: HopSendItem | readonly HopSendItem[]): string {
  return Array.isArray(given)
    ? `[${(given as readonly HopSendItem[]).map(itemLiteral).join(", ")}]`
    : itemLiteral(given as HopSendItem);
}

/**
 * The `hop` of `chain`: `hop({ source, send, receive, refundee, … }).then(body)` writes the
 * statement a program opens that intent with, compiles it for the source chain, and returns the
 * program and its cook.
 */
export function chainHop(chain: ChainRef): ChainHop {
  const destination = requireChain(chain);
  const name = `${pascalOfSlug(destination.slug)}.hop`;

  return (config) => {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      throw new TypeError(
        `${name}(...) takes one object: \`${name}({ source, send, receive, refundee })\``,
      );
    }
    const unknown = Object.keys(config).filter((field) => !HOP_CONFIG.has(field));
    if (unknown.length > 0) {
      throw new TypeError(
        `${name}(...) takes no ${unknown.map((field) => `\`${field}\``).join(", ")}: its fields ` +
          `are ${[...HOP_CONFIG].map((field) => `\`${field}\``).join(", ")}` +
          (unknown.includes("reward") ? "; what the source sends is `send`" : ""),
      );
    }

    return {
      // Not `then(body)`: a promise's resolution calls it with two native functions, and that call
      // has to be told apart from the intent's own.
      then(...args: unknown[]): HopOpened {
        const [body] = args;
        if (args.length !== 1 || isNative(body)) {
          throw new TypeError(
            `${name}({ … }) is not a promise: \`.then(...)\` takes the intent's body, ` +
              "`.then(() => { … })`, and returns the intent. It was called as a promise's `then` " +
              "— by `await`, or by returning it from an async function — which would build " +
              "nothing. Call `.then(() => { … })` and use the intent it returns.",
          );
        }
        const built = hostIntent(destination, name, config, body as SauceBody);
        return Object.defineProperty(built, "catch", {
          value: () => {
            throw new TypeError(
              `${name}({ … }).then(body).catch(handler) handles a body inside a program, where ` +
                "the compiler builds the two as one: open the intent in the program a Pot runs.",
            );
          },
        }) as HopOpened;
      },
    };
  };
}

/** A hook list as the program writes it: each closure's own text, or a call's text in one. */
const hooksLiteral = (hooks: readonly HopHook[]): string =>
  `[${hooks.map((hook) => (isSauceClosure(hook) ? closureText(hook) : `() => ${hook}`)).join(", ")}]`;

/** `chainHop`'s `then`: the statement written out, compiled for the source chain. */
function hostIntent(
  destination: CanonicalChain,
  name: string,
  config: HopConfig,
  given: SauceBody,
): HostIntent {
  const sourceRef = config.source;
  if (sourceRef === undefined) {
    throw new TypeError(
      `${name}({ … }) needs a \`source\`: the chain what it sends is escrowed on, where the intent ` +
        "is published and the program that opens it is compiled",
    );
  }
  const source = requireChain(isChainExport(sourceRef) ? sourceRef.chain : sourceRef);
  if (source.kind !== "evm") {
    throw new TypeError(
      `${name}: an intent is published from an EVM chain, through its eco-routes Portal, and ` +
        `${source.slug} is not one`,
    );
  }

  const salt = (value: Hex | bigint): string =>
    typeof value === "bigint" ? `0x${value.toString(16).padStart(64, "0")}` : value;
  // Each field given, as the program's `hop({ … })` takes it; one left out is the program's to
  // default or refuse, in its own words.
  const fields: (readonly [string, string | undefined])[] = [
    ["send", config.send === undefined ? undefined : itemsLiteral(config.send)],
    ["receive", config.receive === undefined ? undefined : itemsLiteral(config.receive)],
    ["refundee", config.refundee === undefined ? undefined : addressLiteral(config.refundee)],
    ["deadline", config.deadline === undefined ? undefined : integer(config.deadline)],
    [
      "rewardDeadline",
      config.rewardDeadline === undefined ? undefined : integer(config.rewardDeadline),
    ],
    ["prover", config.prover === undefined ? undefined : addressLiteral(config.prover)],
    ["salt", config.salt === undefined ? undefined : salt(config.salt)],
    ["fee", config.fee === undefined ? undefined : integer(config.fee)],
    ["before", config.before === undefined ? undefined : hooksLiteral(config.before)],
    ["after", config.after === undefined ? undefined : hooksLiteral(config.after)],
  ];
  const body = isSauceClosure(given) ? closureText(given) : `() => {\n${given}\n}`;
  const options = config.compile ?? {};

  const text =
    `${pascalOfSlug(destination.slug)}.hop({\n` +
    fields
      .filter((field): field is readonly [string, string] => field[1] !== undefined)
      .map(([field, value]) => `  ${field}: ${value},\n`)
      .join("") +
    `}).then(${body});\n`;
  const program = compileSauceProgram(source, text, options);
  const portal = options.intents?.sourcePortal;

  return {
    source: text,
    program,
    cook: (target, value) =>
      buildSauceEvmCall({
        pot: potOf(target),
        engine: options.intents?.engine ?? (v12EngineAddress() as Hex),
        program: bytesToHex(program.bytecode),
        value: toBigInt(value),
      }),
    intents: (logs) =>
      loggedIntents(source, logs, portal === undefined ? undefined : evmAddress(portal)),
  };
}

/** The Pot `target` names. */
function potOf(target: PotTarget): Address {
  if (typeof target === "object" && target !== null && "owner" in target) {
    return getAddress(
      v12PredictPot(evmAddress(target.owner), target.salt ?? SAUCE_INTENT_POT_SALT),
    );
  }

  return evmAddress(target as AddressInput);
}
