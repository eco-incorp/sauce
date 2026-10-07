/**
 * The intent a program opens, `await Chain.hop({ reward, receive, refundee })` or
 * `Chain.hop({ … }).then(() => { … })`, as data: the fields its one config object takes, what each
 * holds and the per-level option it overrides, and the steps on what `hop` returns.
 *
 * One table, read by everything on the host that has to agree on the syntax: the generator that
 * writes the editor's declarations (`scripts/gen-source-globals.mjs`, `SauceHopConfig` and the
 * types after it) and the docs. In a program the syntax is `@sauce/intents`' classes
 * (`std/intents/intents.evm.js`), whose fields and refusals this table's names and words follow;
 * `routes-intent-portal.test.ts` holds the fields the class reads and the steps it has to this
 * table. The TypeScript builder takes the same object, with `source` and `compile` besides, and
 * refuses any other field (`host-intent.ts`).
 *
 * Data only: no import, so a generator can load it from source.
 */

/** One field of `hop({ … })`'s config. */
export interface HopField {
  readonly doc: string;
  /** Its TypeScript type in the declarations. */
  readonly ts: string;
  /** Every intent gives it: a missing one is refused when the program compiles. */
  readonly required?: true;
  /** The per-level option it overrides (`SauceCompileOptions.intents`' field), where one exists. */
  readonly option?: string;
}

/** One step on what `hop` returns. */
export interface HopStep {
  readonly doc: string;
  readonly params: readonly { readonly name: string; readonly ts: string }[];
  /** The type it returns in the declarations. */
  readonly returns: string;
}

/** What `hop` returns, and what its steps return: a type in the declarations and its steps. */
export interface HopStage {
  readonly doc: string;
  readonly steps: Readonly<Record<string, HopStep>>;
}

const REWARD_ITEM = "SauceIntentTokenAmount | SauceIntentNative";
const DELIVERY_ITEM = "SauceIntentTokenAmount";

export const HOP_FIELDS = {
  reward: {
    ts: `${REWARD_ITEM} | readonly (${REWARD_ITEM})[]`,
    required: true,
    doc:
      "What the program pays the solver, escrowed on the chain it runs on: `{ token, amount }`, " +
      "`{ native: amount }`, or a list of them.",
  },
  receive: {
    ts: `${DELIVERY_ITEM} | readonly ${DELIVERY_ITEM}[]`,
    doc:
      "What the solver delivers on the destination, for the body to run with: `{ token, amount }`, " +
      "or a list of them. Each token is the destination's, looked up again there by its symbol; " +
      "every other value is computed where the intent opens. Left out, nothing is delivered.",
  },
  refundee: {
    ts: "bigint",
    required: true,
    option: "creator",
    doc:
      "Who may reclaim an unearned reward, the reward's `creator` on the Portal: after the reward's " +
      "deadline a refund goes to it, and only it may send the Portal's `refundTo` to redirect one. " +
      "Required on every intent: the Pot a program runs on may be shared.",
  },
  deadline: {
    ts: "bigint | number",
    option: "deadline",
    doc: "The last second the intent may be filled, Unix seconds. Defaults to five minutes past when it opens.",
  },
  rewardDeadline: {
    ts: "bigint | number",
    option: "rewardDeadline",
    doc: "From when an unproven reward may be refunded, Unix seconds. Defaults to seven days past the fill deadline.",
  },
  prover: {
    ts: "bigint",
    option: "prover",
    doc: "The source chain's prover. Defaults to the registry's for the pair.",
  },
  salt: {
    ts: "bigint | number",
    option: "salt",
    doc:
      "The route's salt, used as written. Left out, the compile's salt mixed with how many intents " +
      "the transaction has opened, so two intents built alike are two.",
  },
  fee: {
    ts: "bigint | number",
    option: "executionFee",
    doc:
      "The destination Kitchen's fee the body's cook pays, in wei. Defaults to what the compile is " +
      "given for that destination.",
  },
} as const satisfies Readonly<Record<string, HopField>>;

/** A field of `hop({ … })`. */
export type HopFieldName = keyof typeof HOP_FIELDS;

/** What `hop({ … })` returns, and what `.then` returns, by their types in the declarations. */
export const HOP_STAGES = {
  SauceHop: {
    doc:
      "A hop waiting for its body: `await` it, and the code after it is the body, or give the body " +
      "to `.then(...)`.",
    steps: {
      then: {
        doc:
          "The body: runs on the destination with what was received. It is never invoked here: it " +
          "is compiled for that chain. As in JavaScript, `await x; rest` is `x.then(() => { rest })`.",
        params: [{ name: "body", ts: "() => void" }],
        returns: "SauceHopOpened",
      },
    },
  },
  SauceHopOpened: {
    doc: "A hop with its body.",
    steps: {
      catch: {
        doc:
          "What runs on the destination in the body's place when the body reverts: everything the " +
          "body did is undone, and the fill still succeeds. `e` is what the body reverted with, at " +
          "most its first 256 bytes. EVM destinations only.",
        params: [{ name: "handler", ts: "(e: SauceBytes) => void" }],
        returns: "void",
      },
    },
  },
} as const satisfies Readonly<Record<string, HopStage>>;
