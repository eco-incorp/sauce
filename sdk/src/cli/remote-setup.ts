/**
 * Setting up the Pot a remote message reaches (`@sauce/remote`), on the chain the message runs
 * there: the Pot itself, deployed through the Kitchen when it has no code; the receiver for the
 * message's bridge, installed by the Pot's owner; and what the Pot pays the Kitchen to run the
 * message. These are the steps the command offers before a cook that sends there, each one
 * transaction on that chain.
 *
 * What a program's messages need is read from its compile: `@sauce/remote` gives each program it
 * compiles for another chain a scope saying what it is to a message (`remoteNeeds`).
 *
 * Anyone may deploy a Pot (`Kitchen.deployPot` is permissionless), but only the Pot's owner, or the
 * Pot itself, may install a handler (`Router.setHandler`): the receiver is the owner's own
 * transaction on that chain, and no executor or solver can send it.
 *
 * A step has the shape `approvals.ts`'s `SetupStep` takes, and reaches the chain through what the
 * command's `SetupReach.on` answers, so the command asks about it, plans it and sends it with the
 * rest of its setup.
 */
import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  formatEther,
  getAddress,
  getContractAddress,
  keccak256,
  pad,
  parseAbi,
  toHex,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { chainById, type CanonicalChain } from "../chains/canonical.js";
import { v12EngineAddress, v12KitchenAddress } from "../deployments/v12-addresses.js";
import { v12PredictPot } from "../deployments/pot.js";
import { v12Kitchen, v12Pot } from "../evm/engine.js";
import { encodeEntryArguments } from "../routes/entry.js";
import {
  handlersInstallSource,
  packageHandlers,
  type CompiledHandler,
} from "../routes/handlers.js";
import { remoteLink, type RemoteBridge, type RemoteLink } from "../routes/remote-link.js";
import { compileSauceProgram, type CompiledBody } from "../routes/sauce-route.js";
import { kitchenFee } from "./chain.js";
import { nativeSymbol } from "./effects.js";

/** What a remote message needs where it runs: the chain, the bridge that delivers it there, and for
 *  a round trip the answer the Pot there sends back over the same bridge and pays for. */
export interface DestinationNeed {
  readonly chain: CanonicalChain;
  readonly bridge: RemoteBridge;
  readonly answer?: {
    /** The chain the answer goes to: where the program was cooked. */
    readonly to: CanonicalChain;
    /** The gas the answer's handler is given there (`replyGas`). */
    readonly gas: bigint;
    /** At most how many bytes the answer is, which its fee is quoted for. */
    readonly bytes: number;
  };
}

/** One transaction on another chain, as a step sends it. */
export interface DestinationTx {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

/** What the command reaches another chain with: `approvals.ts`'s `ChainReach`. */
export interface DestinationReach {
  readonly chain: CanonicalChain;
  readonly client: PublicClient;
  /** The signer, or the Pot's owner for an unsigned plan. */
  readonly from?: Address;
  /** Signs and sends through the command's own send path; only where the command signs. */
  readonly send?: (tx: DestinationTx) => Promise<unknown>;
}

/** One setup step, as `approvals.ts`'s `SetupStep` takes it. */
export interface DestinationStep {
  readonly action: string;
  readonly reason: string;
  readonly offer: string;
  readonly estimate: string;
  readonly byHand?: string;
  readonly planned: {
    readonly what: string;
    readonly to: Address;
    readonly data: Hex;
    readonly value: string;
    readonly chainId: number;
    /** On a funding step, the answers' fees it includes: quoted, for answers up to `bytes`. */
    readonly quoted?: { readonly answers: number; readonly fee: string; readonly bytes: number };
  };
  readonly send: () => Promise<unknown>;
}

/** What setting up a destination is given beside its needs. */
export interface DestinationSetupOptions {
  /** The Pot's owner and salt: the Pot has the same address on every chain. */
  readonly owner: Address;
  readonly salt: Hex;
  /** Reaches a chain: `SetupReach.on`. */
  readonly reach: (chain: CanonicalChain) => Promise<DestinationReach>;
  /** Prices a transaction: `approvals.ts`'s `gasEstimate`. */
  readonly estimate: (
    client: PublicClient,
    from: Address,
    tx: DestinationTx,
    chain: CanonicalChain,
  ) => Promise<string>;
}

/** The handlers of `@sauce/remote` that receive over each bridge, by the signature the Pot answers. */
const RECEIVERS: Readonly<Record<RemoteBridge, readonly string[]>> = {
  hyperlane: ["handle(uint32,bytes32,bytes)"],
  metalayer: ["handle(uint32,bytes32,bytes,(uint32,address,bytes)[],bytes[])"],
  layerzero: [
    "lzReceive((uint32,bytes32,uint64),bytes32,bytes,address,bytes)",
    "allowInitializePath((uint32,bytes32,uint64))",
    "nextNonce(uint32,bytes32)",
  ],
  polymer: ["deliver(bytes)"],
};

const BRIDGE_NAMES: Readonly<Record<RemoteBridge, string>> = {
  hyperlane: "Hyperlane",
  layerzero: "LayerZero",
  metalayer: "Metalayer",
  polymer: "Polymer",
};

/** Where a Pot's Router keeps its handler records, in the Pot's storage: ERC-7201
 *  `sauce.storage.Handlers`, a mapping from selector to one word. */
export const HANDLERS_LOCATION: Hex =
  "0x3ede71929532386d53b5e25665f65f4ad4a552935973d8ba46f290dd0524c500";

/** The Router's init code for a handler's code contract opens with `PUSH2 <size>` and copies the
 *  rest out: `0x00`, the engine, then the program. */
const COPY_RETURN_TAIL: Hex = "0x80600a3d393df3";

/** The storage slot of `selector`'s record: a `bytes4` key, left-aligned in its word. */
export function handlerRecordSlot(selector: Hex): Hex {
  return keccak256(concat([pad(selector, { dir: "right", size: 32 }), HANDLERS_LOCATION]));
}

/** The code contract a Pot keeps `program` in for `engine`: CREATE2 from the Pot, with salt zero,
 *  of the init code the Router writes, so its address is a function of its bytes. */
export function handlerCodeAddress(pot: Address, engine: Address, program: Uint8Array): Address {
  const initCode = concat([
    "0x61",
    toHex(21 + program.length, { size: 2 }),
    COPY_RETURN_TAIL,
    "0x00",
    engine,
    bytesToHex(program),
  ]);

  return getContractAddress({
    opcode: "CREATE2",
    from: pot,
    salt: zeroHash,
    bytecodeHash: keccak256(initCode),
  });
}

/** Whether `handler` is installed on `pot`: its record names the code contract of `engine` and the
 *  handler's program, and runs it read-only exactly when the handler is. */
export async function handlerInstalled(
  client: PublicClient,
  pot: Address,
  engine: Address,
  handler: CompiledHandler,
): Promise<boolean> {
  const word = BigInt(
    (await client.getStorageAt({ address: pot, slot: handlerRecordSlot(handler.selector) })) ??
      "0x0",
  );
  const code = getAddress(toHex(word & ((1n << 160n) - 1n), { size: 20 }));
  const readOnly = ((word >> 160n) & 0xffn) !== 0n;

  return (
    code === handlerCodeAddress(pot, engine, handler.bytecode) && readOnly === handler.readOnly
  );
}

/** The `@sauce/remote` handlers that receive over `bridges` on `chain`. */
function receivers(chain: CanonicalChain, bridges: ReadonlySet<RemoteBridge>): CompiledHandler[] {
  const wanted = new Set([...bridges].flatMap((bridge) => RECEIVERS[bridge]));

  return packageHandlers(chain.slug, "@sauce/remote").filter((handler) =>
    wanted.has(handler.signature),
  );
}

/** "the Hyperlane receiver", "the Hyperlane and Polymer receivers". */
function receiverName(bridges: ReadonlySet<RemoteBridge>): string {
  const names = [...bridges].map((bridge) => BRIDGE_NAMES[bridge]);
  const joined =
    names.length < 3
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return `the ${joined} receiver${names.length === 1 ? "" : "s"}`;
}

/** What a round trip's answer value is at most when its body declares no static result: the most a
 *  rejection carries (what the body reverted with, at most its first 256 bytes), and the bound
 *  stated for a result of no declared size. */
export const ANSWER_VALUE_BYTES = 256;

const words = (bytes: number): number => Math.ceil(bytes / 32) * 32;

/** The bytes a body's declared result is, when it is one word; else undefined. */
function resultBytes(returns: string | undefined): number | undefined {
  if (returns === "void") return 0;
  return returns !== undefined &&
    /^(U?[Ii]nt\d*|Address|bool|boolean|number|bigint|bytes32)$/.test(returns)
    ? 32
    : undefined;
}

/** A scope's field, where the scope is an object. */
const field = (scope: CompiledBody["scope"], name: string): CompiledBody["scope"] | undefined =>
  typeof scope === "object" && !Array.isArray(scope) ? scope[name] : undefined;

/**
 * What the remote messages a program sends need, from its compile's continuations: each program
 * `@sauce/remote` compiled for another chain names in its scope the bridge (`{ bridge }`), and a
 * round trip's also the chain and gas of its answer (`{ bridge, answer, replyGas }`). An answer is
 * `Message.settle`'s encoding — six words, then the continuation it carries back and the value — so
 * it is at most the largest continuation compiled for that chain and the body's result: one word
 * when the body declares a one-word result, `ANSWER_VALUE_BYTES` when it does not, and never less
 * than what a rejection carries.
 */
export function remoteNeeds(continuations: readonly CompiledBody[]): DestinationNeed[] {
  const needs: DestinationNeed[] = [];
  for (const body of continuations) {
    const remote = field(body.scope, "remote");
    const bridge = field(remote ?? "", "bridge");
    if (typeof bridge !== "string" || !Object.hasOwn(RECEIVERS, bridge)) continue;
    const answer = field(remote!, "answer");
    const to = typeof answer === "bigint" ? chainById(Number(answer)) : undefined;
    if (to === undefined) {
      needs.push({ chain: body.destination, bridge: bridge as RemoteBridge });
      continue;
    }
    const result = continuations.find(
      (inner) => inner.path.includes(body.id) && inner.scope === "body",
    );
    const value = Math.max(resultBytes(result?.returns) ?? ANSWER_VALUE_BYTES, ANSWER_VALUE_BYTES);
    // The continuations `@sauce/async` compiled for the answer's chain, its arguments a word each.
    const back = Math.max(
      0,
      ...continuations
        .filter(
          (other) => other.destination.id === to.id && field(other.scope, "remote") === undefined,
        )
        .map((other) => other.bytecode.length + 32 * other.captures.length),
    );
    const gas = field(remote!, "replyGas");
    needs.push({
      chain: body.destination,
      bridge: bridge as RemoteBridge,
      answer: {
        to,
        gas: typeof gas === "bigint" ? gas : 500_000n,
        bytes: 6 * 32 + 32 + words(back) + 32 + words(value),
      },
    });
  }

  return needs;
}

const MAILBOX = parseAbi([
  "function quoteDispatch(uint32 destinationDomain, bytes32 recipientAddress, bytes messageBody, bytes metadata) view returns (uint256)",
]);
const ENDPOINT = parseAbi([
  "function quote((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) params, address sender) view returns ((uint256 nativeFee, uint256 lzTokenFee))",
]);

/** Hyperlane's standard hook metadata, as `@sauce/remote` writes it: variant 1, the value, the
 *  gas, and who is refunded. */
const hookMetadata = (value: bigint, gas: bigint, refund: Address): Hex =>
  concat([
    "0x0001",
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [value, gas]),
    refund,
  ]);

/**
 * What the Pot on `from` pays `bridge` to send an answer of `bytes` bytes to itself on `to`, given
 * `gas` there, quoted from the bridge on `from` as `@sauce/remote` quotes it when it sends: a
 * Polymer answer is a log and costs nothing.
 */
export async function answerFee(
  client: PublicClient,
  bridge: RemoteBridge,
  from: RemoteLink,
  to: RemoteLink,
  pot: Address,
  gas: bigint,
  bytes: number,
): Promise<bigint> {
  const message = bytesToHex(new Uint8Array(bytes));
  const recipient = pad(pot);
  if (bridge === "hyperlane") {
    return client.readContract({
      address: from.hyperlane!.mailbox,
      abi: MAILBOX,
      functionName: "quoteDispatch",
      args: [to.hyperlane!.domain, recipient, message, hookMetadata(0n, gas, pot)],
    });
  }
  if (bridge === "metalayer") {
    return client.readContract({
      address: from.metalayer!.router,
      abi: MAILBOX,
      functionName: "quoteDispatch",
      args: [to.metalayer!.domain, recipient, message, hookMetadata(10n ** 36n, gas, pot)],
    });
  }
  if (bridge === "layerzero") {
    const { nativeFee } = await client.readContract({
      address: from.layerzero!.endpoint,
      abi: ENDPOINT,
      functionName: "quote",
      args: [
        {
          dstEid: to.layerzero!.eid,
          receiver: recipient,
          message,
          options: concat(["0x000301001101", toHex(gas, { size: 16 })]),
          payInLzToken: false,
        },
        pot,
      ],
    });

    return nativeFee;
  }

  return 0n;
}

/**
 * The steps that make the Pot of `options.owner` and `options.salt` ready, on every chain in
 * `needs`, for the remote messages a program sends there: on each chain, the Pot deployed when it
 * has no code, the receiver of each bridge a message there takes installed by its owner where its
 * record is not the one it would write, and the Pot funded when it cannot pay the Kitchen's fee
 * for each message it will run. A chain that is ready gives none.
 */
export async function destinationSetup(
  needs: readonly DestinationNeed[],
  options: DestinationSetupOptions,
): Promise<DestinationStep[]> {
  const byChain = new Map<
    number,
    { chain: CanonicalChain; bridges: Set<RemoteBridge>; needs: DestinationNeed[] }
  >();
  for (const need of needs) {
    const entry = byChain.get(need.chain.id) ?? {
      chain: need.chain,
      bridges: new Set<RemoteBridge>(),
      needs: [],
    };
    entry.bridges.add(need.bridge);
    entry.needs.push(need);
    byChain.set(need.chain.id, entry);
  }

  const pot = getAddress(v12PredictPot(options.owner, options.salt));
  const engine = getAddress(v12EngineAddress());
  const kitchen = getAddress(v12KitchenAddress());
  const steps: DestinationStep[] = [];
  for (const { chain, bridges, needs: here } of byChain.values()) {
    const messages = here.length;
    const there = await options.reach(chain);
    const from = there.from ?? options.owner;
    const reason = `Your Pot on ${chain.name} can't receive this message yet`;
    const price = (tx: DestinationTx, unpriced: string): Promise<string> =>
      options.estimate(there.client, from, tx, chain).catch(() => unpriced);
    const step = (
      what: string,
      action: string,
      offer: string,
      tx: DestinationTx,
      estimate: string,
      byHand?: string,
      quoted?: DestinationStep["planned"]["quoted"],
    ): DestinationStep => ({
      action,
      reason,
      offer,
      estimate,
      ...(byHand === undefined ? {} : { byHand }),
      planned: {
        what,
        to: tx.to,
        data: tx.data,
        value: tx.value.toString(),
        chainId: chain.id,
        ...(quoted === undefined ? {} : { quoted }),
      },
      send: () => {
        if (there.send === undefined) {
          throw new Error(`${action}: the command has no signer for ${chain.name}`);
        }
        return there.send(tx);
      },
    });

    const deployed = ((await there.client.getCode({ address: pot })) ?? "0x") !== "0x";
    if (!deployed) {
      const tx = {
        to: kitchen,
        data: v12Kitchen.encodeDeployPot(options.owner, options.salt),
        value: 0n,
      };
      steps.push(
        step(
          "deployPot",
          `deploy your Pot on ${chain.name}`,
          "Deploy it now",
          tx,
          await price(tx, "gas not estimated"),
          `sauce pot --deploy --owner ${options.owner} --chain ${chain.slug} --wallet <name>`,
        ),
      );
    }

    const handlers = receivers(chain, bridges);
    const missing = deployed
      ? (
          await Promise.all(
            handlers.map(async (handler) =>
              (await handlerInstalled(there.client, pot, engine, handler)) ? undefined : handler,
            ),
          )
        ).filter((handler): handler is CompiledHandler => handler !== undefined)
      : handlers;
    const fee = await kitchenFee(there.client, chain);
    if (missing.length > 0) {
      // The bridges whose receivers are not all there.
      const named = new Set(
        [...bridges].filter((bridge) =>
          missing.some((handler) => RECEIVERS[bridge].includes(handler.signature)),
        ),
      );
      const program = compileSauceProgram(
        chain.slug,
        handlersInstallSource(missing, "@sauce/remote"),
      );
      const input = concat([program.bytecode, encodeEntryArguments(program, [])]);
      const tx = { to: pot, data: v12Pot.encodeCook(engine, bytesToHex(input)), value: fee };
      steps.push(
        step(
          "install",
          `install ${receiverName(named)} on your Pot on ${chain.name}`,
          "Install it now",
          tx,
          // A Pot deployed by the step before has no code to rehearse the cook on yet.
          deployed
            ? await price(tx, "gas not estimated")
            : "gas estimated once the Pot is deployed",
          `sauce run @sauce/remote --chain ${chain.slug} --wallet <name>`,
        ),
      );
    }

    // The Pot pays the Kitchen's fee for each delivery its receiver runs, and a round trip's
    // bridge for the answer it sends back, quoted for the answer's most bytes: that, less what it
    // holds. What is left over stays in the Pot, which is the owner's.
    const link = remoteLink(chain);
    const answers = here.filter((need) => need.answer !== undefined);
    let answered = 0n;
    for (const need of answers) {
      answered += await answerFee(
        there.client,
        need.bridge,
        link,
        remoteLink(need.answer!.to),
        pot,
        need.answer!.gas,
        need.answer!.bytes,
      );
    }
    const needed = fee * BigInt(messages) + answered;
    const balance = await there.client.getBalance({ address: pot });
    if (balance < needed) {
      const tx = { to: pot, data: "0x" as Hex, value: needed - balance };
      const symbol = nativeSymbol(chain);
      const bytes = Math.max(0, ...answers.map((need) => need.answer!.bytes));
      const bridgeNames = [...new Set(answers.map((need) => BRIDGE_NAMES[need.bridge]))].join(
        " and ",
      );
      const why = [
        `${messages} ${messages === 1 ? "delivery" : "deliveries"} × the Kitchen fee`,
        ...(answers.length === 0
          ? []
          : [
              answers.length === 1
                ? ` + the answer's ${bridgeNames} fee, quoted for up to ${bytes} bytes`
                : ` + ${answers.length} answers' ${bridgeNames} fees, quoted for up to ${bytes} bytes each`,
            ]),
        balance === 0n ? "" : `, less the ${formatEther(balance)} ${symbol} it holds`,
      ].join("");
      steps.push(
        step(
          "fund",
          `fund your Pot on ${chain.name} with ${formatEther(tx.value)} ${symbol} (${why})`,
          "Fund it now",
          tx,
          await price(tx, "gas not estimated"),
          undefined,
          answers.length === 0
            ? undefined
            : { answers: answers.length, fee: answered.toString(), bytes },
        ),
      );
    }
  }

  return steps;
}
