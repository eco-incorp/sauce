// Builds an intent by hand — Base USDC delivered to a recipient, Ethereum USDC as the reward — and
// pins what the skill says of an intent that exists: its hash is the formula the skill gives; the
// IntentPublished log its publication emits rebuilds it, hash checked, as `sauce intent import`
// does; its vault is the Portal's derivation; the shared Pot a program route cooks on is the
// destination Executor's; each step of its life is the Portal call the skill names; and every
// selector and topic references/portal.md gives is the registry's Portal's. Offline: nothing is
// sent.
//
//   node intents.mts --creator <address> --recipient <address>
import { readFileSync } from "node:fs";

import { destinationPot, routes, SAUCE_INTENT_POT_SALT, v12PredictPot } from "@eco-incorp/sauce";
import {
  ecoRoutesExecutor,
  ecoRoutesPortal,
  ecoRoutesProver,
  PortalABI,
} from "@eco-incorp/sauce/protocols/eco-routes";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  keccak256,
  toEventSelector,
  toFunctionSelector,
  type AbiEvent,
  type Hex,
} from "viem";

function flag(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value === undefined) throw new Error(`pass --${name}`);
  return value;
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const creator = getAddress(flag("creator")); // may reclaim an unearned reward
const recipient = getAddress(flag("recipient"));
const ethereum = routes.chain("ethereum").chain;
const base = routes.chain("base").chain;
const usdc = (chain: typeof base) =>
  getAddress(`0x${routes.registryTokenAddress(chain, "USDC")!.toString(16).padStart(40, "0")}`);
const now = BigInt(Math.floor(Date.now() / 1000));

// ---- An intent, as its creator built it: three values.
const intent = routes.assembleIntent(
  ethereum,
  base,
  {
    deadline: now + 3600n, // filled within the hour or not at all
    portal: ecoRoutesPortal("base"),
    tokens: [{ token: usdc(base), amount: 1000000n }],
    calls: [
      {
        target: usdc(base),
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, 1000000n],
        }),
        value: 0n,
      },
    ],
  },
  {
    deadline: now + 7200n, // refundable from here, if no fill is proven
    creator,
    prover: ecoRoutesProver("ethereum", "base"),
    tokens: [{ token: usdc(ethereum), amount: 1010000n }],
  },
);

// ---- Its hash: keccak256(abi.encodePacked(uint64 destination, keccak256(route bytes),
//      keccak256(abi.encode(reward)))), the skill's formula.
const { intentHash, routeHash, rewardHash } = routes.hashIntent(intent);
const routeBytes = routes.encodeRouteEvm(intent.route);
check(routeHash === keccak256(routeBytes), "routeHash is keccak256 of the route's bytes");
check(
  intentHash ===
    keccak256(
      encodePacked(["uint64", "bytes32", "bytes32"], [intent.destination, routeHash, rewardHash]),
    ),
  "intentHash is the skill's formula",
);
// Every field is in it: another deadline is another intent.
const later = { ...intent, route: { ...intent.route, deadline: intent.route.deadline + 1n } };
check(routes.hashIntent(later).intentHash !== intentHash, "a new deadline is a new intent");

// ---- Read back from its publication, as `sauce intent import` does: the IntentPublished log.
const published = PortalABI.find(
  (item) => item.type === "event" && item.name === "IntentPublished",
) as AbiEvent;
const reward = intent.reward;
const toAddress = (universal: Hex) => getAddress(`0x${universal.slice(-40)}`);
const topics = encodeEventTopics({
  abi: [published],
  args: { intentHash, creator: toAddress(reward.creator), prover: toAddress(reward.prover) },
}) as Hex[];
const data = encodeAbiParameters(
  published.inputs.filter((input) => !input.indexed),
  [
    intent.destination,
    routeBytes,
    reward.deadline,
    reward.nativeAmount,
    reward.tokens.map((leg) => ({ token: toAddress(leg.token), amount: leg.amount })),
  ],
);
const imported = routes.intentFromPublished({ topics, data }, BigInt(ethereum.id));
check(imported?.intentHash === intentHash, "the log rebuilds the same intent, hash checked");

// ---- Its vault, on the source: the Portal's derivation from the hash, there before anything is.
const sourcePortal = { portal: ecoRoutesPortal("ethereum") };
const vault = routes.predictIntentVault(intent, sourcePortal);
const [transfer, publish] = routes.intentSourceTxs(intent, sourcePortal);
check(
  decodeFunctionData({ abi: erc20Abi, data: transfer!.data }).args[0] === vault,
  "funding by transfer pays the vault",
);
check(
  decodeFunctionData({ abi: PortalABI, data: publish!.data }).functionName === "publish",
  "then publish",
);

// ---- The shared Pot a program route cooks on: the destination Executor's, salt zero.
check(
  destinationPot("base") === v12PredictPot(ecoRoutesExecutor("base"), SAUCE_INTENT_POT_SALT),
  "the shared Pot is the Executor's",
);

// ---- Each step of its life is the Portal call the skill names, on the chain it names.
const solver = recipient; // offline, any address stands in for the solver's
const steps: Array<readonly [string, { to: Hex; data: Hex }, Hex]> = [
  ["fulfill", routes.fulfillTx(intent, { claimant: solver }), ecoRoutesPortal("base")],
  ["cancel", routes.cancelTx(intent), ecoRoutesPortal("base")],
  [
    "prove",
    routes.proveTx([intent], {
      prover: ecoRoutesProver("base", "ethereum"),
      sourceDomain: BigInt(ethereum.id),
      data: routes.hyperlaneProverData({ sourceProver: reward.prover }),
      fee: 0n,
    }),
    ecoRoutesPortal("base"),
  ],
  ["withdraw", routes.withdrawTx(intent, sourcePortal), ecoRoutesPortal("ethereum")],
  ["refund", routes.refundTx(intent, sourcePortal), ecoRoutesPortal("ethereum")],
];
for (const [name, tx, portal] of steps) {
  check(
    decodeFunctionData({ abi: PortalABI, data: tx.data }).functionName === name &&
      getAddress(tx.to) === getAddress(portal),
    `${name} is sent to the ${portal === ecoRoutesPortal("base") ? "destination" : "source"} Portal`,
  );
}

// ---- The Portal reference: every selector and topic it gives for something the registry declares
//      is the registry's.
type Param = { type: string; components?: readonly Param[] };
type Entry = { name: string; inputs: readonly Param[] };
const typeOf = (param: Param): string =>
  param.type.startsWith("tuple")
    ? `(${(param.components ?? []).map(typeOf).join(",")})${param.type.slice(5)}`
    : param.type;
const signature = (item: Entry) => `${item.name}(${item.inputs.map(typeOf).join(",")})`;
const reference = readFileSync(new URL("../references/portal.md", import.meta.url), "utf8");
let pinned = 0;
for (const item of PortalABI) {
  if (item.type !== "function" && item.type !== "event" && item.type !== "error") continue;
  // Each entry naming it, to the next list item, table row or paragraph; the one that gives a
  // selector or topic must give the registry's.
  const entries: string[] = [];
  for (let at = reference.indexOf(`\`${item.name}(`); at !== -1;) {
    const ends = ["\n- ", "\n|", "\n\n"]
      .map((end) => reference.indexOf(end, at + 1))
      .filter((i) => i > 0);
    entries.push(reference.slice(at, Math.min(...ends)));
    at = reference.indexOf(`\`${item.name}(`, at + 1);
  }
  const given = entries.filter((entry) => /`0x[0-9a-f]{8}(?:[0-9a-f]{56})?`/.test(entry));
  if (given.length === 0) continue;
  const expected =
    item.type === "event"
      ? toEventSelector(item as AbiEvent)
      : toFunctionSelector(signature(item as Entry));
  check(
    given.every((entry) => entry.includes(expected)),
    `references/portal.md gives ${item.name} as ${expected}`,
  );
  pinned++;
}
check(pinned >= 15, `the reference pins ${pinned} of the Portal's selectors and topics`);

console.log(
  `intent ${intentHash.slice(0, 10)}… from ethereum to base: vault ${vault}, ` +
    `shared Pot on base ${destinationPot("base")}; ${pinned} Portal selectors and topics pinned`,
);
