/**
 * eco-routes on a local anvil, at the addresses the SDK records, so the `sauce` command runs
 * against it with no override: the real Portal (forge creation code, `evm/fixtures/Portal*.json`),
 * the real HyperProver (`evm/fixtures/HyperProver-2.12.0.json`), and a Hyperlane Mailbox that is
 * real where the prover touches it and MOCKED where Hyperlane's relayers and validators would be
 * (`evm/fixtures/MockMailbox.sol`, whose `process` delivers a message with no ISM).
 *
 * THE PORTAL IS PUT IN PLACE, NOT DEPLOYED THERE. A Portal's address is its deployer's, and three
 * contracts hold each other's addresses as immutables: the Portal's `executor` (its second CREATE),
 * the Executor's `portal`, and the vault implementation's `portal` (its first CREATE), which every
 * intent's vault — a proxy delegating to it — checks its caller against. So the fixture is
 * deployed wherever it lands, and the three runtimes copied to the registry's Portal, the Executor
 * derived from it and (in place) the vault implementation, with exactly those immutables
 * rewritten. The Portal's other immutables are untouched: its chain id (anvil's), the vault
 * implementation's address, and its EIP-712 cache, which recomputes for an address not the cached
 * one. The HyperProver has no immutable naming its own address, so it is constructed for the
 * registry's Portal and Mailbox, and its runtime copied to the registry's prover address.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  pad,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  ecoRoutesContract,
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
} from "../src/protocols/eco-routes/lookup.js";
import type { LocalChain } from "./cli-anvil.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const creation = (name: string): Hex =>
  (
    JSON.parse(readFileSync(join(HERE, `evm/fixtures/${name}.json`), "utf8")) as {
      creationCode: Hex;
    }
  ).creationCode;

/** The Portal releases the suites plant: the one before proven cancellation, and 2.12.0. */
export const PORTAL_FIXTURES = { pre: "Portal-2.10.0", v2_12: "Portal" } as const;

const PORTAL = parseAbi(["function executor() view returns (address)"]);
export const MAILBOX = parseAbi([
  "event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)",
  "event DispatchId(bytes32 indexed messageId)",
  "function process(bytes metadata, bytes message)",
]);

/** `code` with every copy of the 20-byte immutable `from` replaced by `to`. */
export function rewrite(code: Hex, from: Address, to: Address): Hex {
  const needle = from.slice(2).toLowerCase();
  const parts = code.toLowerCase().split(needle);
  if (parts.length < 2) throw new Error(`the runtime holds no copy of ${from}`);

  return parts.join(to.slice(2).toLowerCase()) as Hex;
}

/** The registry's Portal on `local`'s chain, made the fixture `name`'s real code. */
export async function plantPortal(
  local: LocalChain,
  name: (typeof PORTAL_FIXTURES)[keyof typeof PORTAL_FIXTURES] = PORTAL_FIXTURES.v2_12,
): Promise<{ portal: Address; executor: Address; vaultImplementation: Address }> {
  const portal = getAddress(ecoRoutesPortal(local.chain));
  const executor = getAddress(ecoRoutesExecutorOf(portal));
  const deployed = await local.plant(
    `${creation(name)}${encodeAbiParameters([{ type: "address" }], [zeroAddress]).slice(2)}` as Hex,
  );
  const itsExecutor = await local.publicClient.readContract({
    address: deployed,
    abi: PORTAL,
    functionName: "executor",
  });
  // The Portal's first CREATE is its vault implementation (`IntentSource(address(new Vault()), …)`).
  const vaultImplementation = getContractAddress({ from: deployed, nonce: 1n, opcode: "CREATE" });
  const [portalCode, executorCode, vaultCode] = await Promise.all(
    [deployed, itsExecutor, vaultImplementation].map((address) =>
      local.publicClient.getCode({ address }),
    ),
  );
  await local.testClient.setCode({
    address: portal,
    bytecode: rewrite(portalCode!, itsExecutor, executor),
  });
  await local.testClient.setCode({
    address: executor,
    bytecode: rewrite(executorCode!, deployed, portal),
  });
  await local.testClient.setCode({
    address: vaultImplementation,
    bytecode: rewrite(vaultCode!, deployed, portal),
  });

  return { portal, executor, vaultImplementation };
}

/** A Mailbox for `local`'s chain (its domain is the chain id), charging `fee` per message. */
export async function deployMailbox(local: LocalChain, fee: bigint): Promise<Address> {
  return local.plant(
    `${creation("MockMailbox")}${encodeAbiParameters(
      [{ type: "uint32" }, { type: "uint256" }],
      [local.chain.id, fee],
    ).slice(2)}` as Hex,
  );
}

/** The registry's HyperProver on `local`'s chain: the real one, serving the registry's Portal through
 *  `mailbox`, and trusting the registry's HyperProver address on every chain (all share it). */
export async function plantHyperProver(local: LocalChain, mailbox: Address): Promise<Address> {
  const prover = getAddress(ecoRoutesContract(local.chain, "HyperProver"));
  const portal = getAddress(ecoRoutesPortal(local.chain));
  await local.plant(
    `${creation("HyperProver-2.12.0")}${encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "bytes32[]" },
        { type: "tuple[]", components: [{ type: "uint64" }, { type: "uint64" }] },
      ],
      [mailbox, portal, [pad(prover)], []],
    ).slice(2)}` as Hex,
    prover,
  );

  return prover;
}

/**
 * Hyperlane's delivery, MOCKED: every message `mailbox` on `from` dispatched in `txHash`, delivered
 * on `to` by its Mailbox's `process` (no validator signatures, no ISM). The provers on both sides
 * are real: the destination's built and dispatched the proof, and the source's `handle` checks the
 * sender is whitelisted and the header's chain id, and records the proof.
 */
export async function relay(
  from: LocalChain,
  fromMailbox: Address,
  txHash: Hex,
  to: LocalChain,
  toMailbox: Address,
): Promise<number> {
  const receipt = await from.publicClient.getTransactionReceipt({ hash: txHash });
  const messages = receipt.logs
    .filter((log) => getAddress(log.address) === getAddress(fromMailbox))
    .flatMap((log) => {
      try {
        const decoded = decodeEventLog({ abi: MAILBOX, data: log.data, topics: log.topics });

        return decoded.eventName === "Dispatch" ? [decoded.args.message] : [];
      } catch {
        return [];
      }
    });
  for (const message of messages) {
    await to.send(
      to.deployer,
      toMailbox,
      encodeFunctionData({ abi: MAILBOX, functionName: "process", args: ["0x", message] }),
    );
  }

  return messages.length;
}
