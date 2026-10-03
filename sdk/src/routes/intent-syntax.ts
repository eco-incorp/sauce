/**
 * The intent a program opens, `Chain.Portal.send(...).receive(...).then(() => { ... })`, as data:
 * its stages, the methods each stage has, what each takes and returns, and the per-level option a
 * modifier sets.
 *
 * One table, read by everything that has to agree on the syntax: the generator that writes the
 * editor's declarations (`scripts/gen-source-globals.mjs`, `SaucePortal` and the stages after it),
 * the compiler host that opens intents (`intent-host.ts`), which declares each stage as a host type
 * of that name and maps each parameter's `kind` to what it tells the compiler, and the TypeScript
 * builder (`intent-dsl.ts#chainPortal`). A change here is a change to all of them.
 *
 * Data only: no import, so a generator can load it from source.
 */

/** Where a chain of calls stands: at the Portal, after `send`, after `receive`, opened, and with
 *  its body's handler. */
export type IntentStage = "Portal" | "Sent" | "Received" | "Opened" | "Caught";

/** One parameter of a method. */
export interface IntentParam {
  /** Its name in the declarations. */
  readonly name: string;
  /** Its TypeScript type in the declarations; with `rest`, the type of each argument. */
  readonly ts: string;
  /**
   * What it is to the compiler: a value computed where the intent opens (`value`); one computed
   * there whose names resolve on the destination, since the solver delivers it there (`nested`);
   * a closure compiled for the destination, the body (`program`); a closure that runs on the
   * destination in the body's place when the body reverts (`handler`); a closure never compiled,
   * its calls recorded as the route's own, which the Portal's Executor makes (`hook`).
   */
  readonly kind: "value" | "nested" | "program" | "handler" | "hook";
  /** Any number of arguments of this type: `send(a, b)`. One argument that is a list of them is
   *  read the same way, `send([a, b])`. */
  readonly rest?: true;
}

/** One method of a stage. */
export interface IntentMethod {
  readonly doc: string;
  readonly params: readonly IntentParam[];
  /** The stage it returns. A modifier returns its own stage, without itself. */
  readonly returns: IntentStage;
  /** For a modifier: the per-level option it sets (`SauceCompileOptions.intents`' field). */
  readonly option?: string;
  /** For a step that returns its own stage and may be taken again, each time adding to what the
   *  ones before added: it returns its stage with itself. */
  readonly repeats?: true;
}

/** One stage. */
export interface IntentStageSpec {
  /** Its type in the declarations; `void` for an opened intent, which is nothing to use. */
  readonly ts: string;
  readonly doc: string;
  readonly methods: Readonly<Record<string, IntentMethod>>;
  /** Why a chain that stops here opens nothing, as a refusal quotes it after the chain written so
   *  far; `{destination}` is the chain the body runs on. */
  readonly unfinished?: string;
}

const REWARD_ITEM = "SauceIntentTokenAmount | SauceIntentNative";
const DELIVERY_ITEM = "SauceIntentTokenAmount";

export const INTENT_STAGES = {
  Portal: {
    ts: "SaucePortal",
    doc:
      "A chain's Portal in compiled source, opening an intent whose body runs on that chain: " +
      "`Base.Portal.send({ token, amount }).receive({ token, amount }).then(() => { ... })`. After " +
      "`send` come the reward's modifiers, after `receive` the route's, each at most once and in " +
      "any order; each left out but the refundee has its default. Among the route's, any number " +
      "of hooks: `before` and `after`, calls the Portal's Executor makes around the body.",
    methods: {
      send: {
        doc:
          "The reward: what the program pays the solver, escrowed on the chain the program runs " +
          "on. Each item an argument, `{ token, amount }` or `{ native: amount }`, the tokens " +
          "also as one list of them.",
        params: [
          {
            name: "reward",
            ts: `${REWARD_ITEM} | readonly ${DELIVERY_ITEM}[]`,
            kind: "value",
            rest: true,
          },
        ],
        returns: "Sent",
      },
    },
  },
  Sent: {
    ts: "SauceIntentSent",
    doc: "An intent with its reward: the reward's modifiers not given yet, then `receive`.",
    unfinished:
      "stops before `.receive(...)`, which every intent has: what the solver delivers on " +
      "{destination}, `.receive({ token, amount })`, or `.receive()` for nothing, then the body " +
      "that runs there with it, `.then(() => { … })`",
    methods: {
      refundee: {
        doc:
          "Who may reclaim an unearned reward, the reward's `creator` on the Portal: after the " +
          "deadline a refund goes to it, and only it may send the Portal's `refundTo` to " +
          "redirect one. Required on every intent a program opens, since the Pot it runs on may " +
          "be shared; only a top-level intent a wallet publishes itself defaults to that wallet.",
        params: [{ name: "address", ts: "bigint", kind: "value" }],
        returns: "Sent",
        option: "creator",
      },
      deadline: {
        doc:
          "From when an unproven reward may be refunded, Unix seconds. Defaults to seven days " +
          "past the route's deadline.",
        params: [{ name: "seconds", ts: "bigint | number", kind: "value" }],
        returns: "Sent",
        option: "rewardDeadline",
      },
      prover: {
        doc: "The source chain's prover. Defaults to the registry's for the pair.",
        params: [{ name: "address", ts: "bigint", kind: "value" }],
        returns: "Sent",
        option: "prover",
      },
      receive: {
        doc:
          "What the solver delivers on the destination, for the body to run with: each item an " +
          "argument, `{ token, amount }`, or one list of them. With none, a body of token writes " +
          "is delivered what it moves, and a program nothing.",
        params: [
          {
            name: "delivery",
            ts: `${DELIVERY_ITEM} | readonly ${DELIVERY_ITEM}[]`,
            kind: "nested",
            rest: true,
          },
        ],
        returns: "Received",
      },
    },
  },
  Received: {
    ts: "SauceIntentReceived",
    doc:
      "An intent waiting for its body: the route's modifiers not given yet, its hooks, then " +
      "`then`.",
    unfinished:
      "has no body. Finish it with `.then(() => { … })`: the code that runs on {destination} " +
      "with what was received",
    methods: {
      deadline: {
        doc:
          "The last second the intent may be filled, Unix seconds. Defaults to five minutes past " +
          "when it opens.",
        params: [{ name: "seconds", ts: "bigint | number", kind: "value" }],
        returns: "Received",
        option: "deadline",
      },
      salt: {
        doc: "The route's salt. Defaults to 32 random bytes, picked when the intent is built.",
        params: [{ name: "salt", ts: "bigint | number", kind: "value" }],
        returns: "Received",
        option: "salt",
      },
      fee: {
        doc:
          "The destination Kitchen's fee the body's cook pays, in wei, for a body that is a " +
          "program: known when the intent is built. Defaults to what the compile is given for " +
          "that destination.",
        params: [{ name: "wei", ts: "bigint | number", kind: "value" }],
        returns: "Received",
        option: "executionFee",
      },
      before: {
        doc:
          "Calls the Portal's Executor makes on the destination before the body runs: the " +
          "closure is never compiled, each statement a call of a token, recorded as a route call " +
          "of its own. The Executor is the caller; the arguments are fixed when the intent is " +
          "published. A hook that reverts reverts the fill, `.catch(...)` or not. Any number, in " +
          "the order written. EVM destinations only.",
        params: [{ name: "hook", ts: "() => void", kind: "hook" }],
        returns: "Received",
        repeats: true,
      },
      after: {
        doc:
          "Calls the Portal's Executor makes on the destination after the body has run, as " +
          "`.before(...)` records them: never compiled, the Executor the caller, the arguments " +
          "fixed when the intent is published, a revert reverting the fill. What the body holds " +
          "in its Pot is not the Executor's to spend. Any number, in the order written. EVM " +
          "destinations only.",
        params: [{ name: "hook", ts: "() => void", kind: "hook" }],
        returns: "Received",
        repeats: true,
      },
      then: {
        doc:
          "The body: runs on the destination with what was received. It is never invoked here: " +
          "it is compiled for that chain. As in JavaScript, `await x; rest` is " +
          "`x.then(() => { rest })`.",
        params: [{ name: "body", ts: "() => void", kind: "program" }],
        returns: "Opened",
      },
    },
  },
  Opened: {
    ts: "SauceIntentOpened",
    doc: "An opened intent: a statement of its own, or one with a handler for its body.",
    methods: {
      catch: {
        doc:
          "What runs on the destination in the body's place when the body reverts: everything " +
          "the body did is undone, and the fill still succeeds. `e` is what the body reverted " +
          "with, at most its first 256 bytes. EVM destinations only.",
        params: [{ name: "handler", ts: "(e: SauceBytes) => void", kind: "handler" }],
        returns: "Caught",
      },
    },
  },
  Caught: { ts: "void", doc: "An opened intent with its handler: nothing to use.", methods: {} },
} as const satisfies Readonly<Record<IntentStage, IntentStageSpec>>;

/** The modifiers of `stage`: its methods that set an option, in table order. */
type ModifiersOf<S extends IntentStage> = {
  [
    M in keyof (typeof INTENT_STAGES)[S]["methods"]
  ]: (typeof INTENT_STAGES)[S]["methods"][M] extends {
    readonly option: string;
  }
    ? M
    : never;
}[keyof (typeof INTENT_STAGES)[S]["methods"]];

export type RewardModifier = ModifiersOf<"Sent">;
export type RouteModifier = ModifiersOf<"Received">;

const modifiersOf = <S extends IntentStage>(stage: S): readonly ModifiersOf<S>[] =>
  Object.entries(INTENT_STAGES[stage].methods as Readonly<Record<string, IntentMethod>>)
    .filter(([, method]) => method.option !== undefined)
    .map(([name]) => name as ModifiersOf<S>);

/** What follows `send(...)`: the reward's refundee, its deadline (from when an unproven reward may
 *  be refunded), and the prover that accepts the proof of the fill. */
export const REWARD_MODIFIERS: readonly RewardModifier[] = modifiersOf("Sent");
/** What follows `receive(...)`: the route's deadline (the last second it may be filled), its salt,
 *  and the destination Kitchen's fee its program's cook pays. */
export const ROUTE_MODIFIERS: readonly RouteModifier[] = modifiersOf("Received");

/** The steps after `receive(...)` that take a hook: calls the Executor makes around the body. */
export type RouteHook = {
  [
    M in keyof (typeof INTENT_STAGES)["Received"]["methods"]
  ]: (typeof INTENT_STAGES)["Received"]["methods"][M] extends {
    readonly params: readonly [{ readonly kind: "hook" }];
  }
    ? M
    : never;
}[keyof (typeof INTENT_STAGES)["Received"]["methods"]];

/** `before` and `after`, in table order: the route's calls are the first's, the body's, the
 *  second's. */
export const ROUTE_HOOKS: readonly RouteHook[] = Object.entries(
  INTENT_STAGES.Received.methods as Readonly<Record<string, IntentMethod>>,
)
  .filter(([, method]) => method.params.some((param) => param.kind === "hook"))
  .map(([name]) => name as RouteHook);
