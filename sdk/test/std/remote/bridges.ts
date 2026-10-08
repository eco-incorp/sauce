/**
 * The four bridges `@sauce/remote` sends over, on local anvils, at the addresses the SDK records for
 * the chain each anvil stands in for, so a program compiled for that chain runs against them with no
 * override. Each is its own code, and only the part a relayer or a prover's operator would do off
 * chain is done here, by the suite:
 *
 *  - HYPERLANE: the real Mailbox (`fixtures/remote/Mailbox.json`), with a NoopIsm as its default ISM
 *    and a TestPostDispatchHook, charging a fee, as its default and required hook. A relay reads the
 *    Mailbox's `Dispatch` on one chain and calls `process` with it on the other, which the ISM
 *    passes with no validator signatures.
 *  - LAYERZERO: the real EndpointV2, with LayerZero's own SimpleMessageLib as the default send and
 *    receive library for the other chain's endpoint id. A relay reads the endpoint's `PacketSent`,
 *    has the library `validatePacket` it (which runs the endpoint's `verify`, and so the receiver's
 *    `allowInitializePath`), and calls the endpoint's `lzReceive` as the executor.
 *  - METALAYER: the real MetalayerRouter behind an ERC1967Proxy, dispatching through a real Mailbox
 *    of its own, with a NoopIsm as the multisig ISM its aggregation names. A relay carries the
 *    router's message between the two mailboxes, as Metalayer's relayers do.
 *  - POLYMER: Polymer's deployed CrossL2ProverV2 runtime, its sequencer rewritten to a key the suite
 *    holds. A proof is built as Polymer's prove API builds one, a membership proof of the log under
 *    the key the prover checks, signed by that sequencer.
 *
 * A contract whose address is recorded is deployed where it lands and then PLANTED at the recorded
 * address: its code and every storage slot it wrote, read from anvil's own state dump. None of them
 * holds its own address.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  concat,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  keccak256,
  pad,
  parseAbi,
  sha256,
  slice,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

import { remoteLink } from "../../../src/routes/remote-link.js";
import { DEPLOYER, type LocalChain } from "../../cli-anvil.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../evm/fixtures/remote");
const fixture = <T = { creationCode: Hex }>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as T;

/** What a bridge charges a message here, in wei: non-zero, so a send provably pays it. */
export const HYPERLANE_FEE = 1_000n;
/** SimpleMessageLib's own native fee, which it charges unless set. */
export const LAYERZERO_FEE = 100n;
export const METALAYER_FEE = 2_000n;

/** A key standing in for Polymer's sequencer. A public test key, local only. */
const SEQUENCER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
export const SEQUENCER = privateKeyToAccount(SEQUENCER_KEY);

export const mailboxAbi = parseAbi([
  "function initialize(address owner, address defaultIsm, address defaultHook, address requiredHook)",
  "function process(bytes metadata, bytes message) payable",
  "function delivered(bytes32 id) view returns (bool)",
  "function dispatch(uint32 destinationDomain, bytes32 recipientAddress, bytes messageBody) payable returns (bytes32)",
  "event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)",
]);
const hookAbi = parseAbi(["function setFee(uint256 fee)"]);
export const endpointAbi = parseAbi([
  "function registerLibrary(address lib)",
  "function setDefaultSendLibrary(uint32 eid, address lib)",
  "function setDefaultReceiveLibrary(uint32 eid, address lib, uint256 gracePeriod)",
  "function lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) origin, address receiver, bytes32 guid, bytes message, bytes extraData) payable",
  "function inboundPayloadHash(address receiver, uint32 srcEid, bytes32 sender, uint64 nonce) view returns (bytes32)",
  "event PacketSent(bytes encodedPayload, bytes options, address sendLibrary)",
]);
export const simpleLibAbi = parseAbi([
  "function validatePacket(bytes packet)",
  "function setMessagingFee(uint256 nativeFee, uint256 lzTokenFee)",
]);
const routerAbi = parseAbi([
  "function initialize(address mailbox, address multisigIsm, address multisigIsmFinalized, address metalayerIsm, uint32[] chains, address[] routers, address owner, address igp)",
  "function mailbox() view returns (address)",
]);
const proverAbi = parseAbi(["function CHAIN_ID() view returns (bytes32)"]);

/** `creationCode` with `args` after it. */
const withArgs = (creationCode: Hex, types: string[], values: readonly unknown[]): Hex =>
  concat([
    creationCode,
    encodeAbiParameters(
      types.map((type) => ({ type })),
      values,
    ),
  ]);

/** Deploys `creationCode` where it lands and answers where. */
async function deploy(local: LocalChain, creationCode: Hex): Promise<Address> {
  const hash = await local.deployer.sendTransaction({
    account: DEPLOYER,
    chain: null,
    data: creationCode,
    gas: 15_000_000n,
  });
  const { contractAddress, status } = await local.publicClient.waitForTransactionReceipt({ hash });
  if (status !== "success" || contractAddress == null) throw new Error("a deployment reverted");

  return contractAddress;
}

/** The storage `address` holds, every slot, from anvil's own state dump. */
async function storageOf(local: LocalChain, address: Address): Promise<Record<string, Hex>> {
  const dump = (await local.testClient.request({
    method: "anvil_dumpState" as never,
    params: [] as never,
  })) as Hex;
  const state = JSON.parse(gunzipSync(Buffer.from(dump.slice(2), "hex")).toString("utf8")) as {
    accounts: Record<string, { storage?: Record<string, Hex> }>;
  };
  const account = Object.entries(state.accounts).find(
    ([at]) => at.toLowerCase() === address.toLowerCase(),
  );

  return account?.[1].storage ?? {};
}

/** Puts the contract deployed at `from` at `at`: its code and its storage. */
async function plantAt(local: LocalChain, from: Address, at: Address): Promise<void> {
  const code = await local.publicClient.getCode({ address: from });
  if (code === undefined) throw new Error(`nothing to plant at ${from}`);
  await local.testClient.setCode({ address: at, bytecode: code });
  for (const [slot, value] of Object.entries(await storageOf(local, from))) {
    await local.testClient.setStorageAt({
      address: at,
      index: pad(slot as Hex, { size: 32 }),
      value: pad(value, { size: 32 }),
    });
  }
}

const call = (local: LocalChain, to: Address, data: Hex): Promise<Hex> =>
  local.send(local.deployer, to, data);

/** The bridges planted on one chain, by where the SDK records them. */
export interface Bridges {
  readonly mailbox: Address;
  readonly endpoint: Address;
  readonly simpleLib: Address;
  readonly metalayerRouter: Address;
  readonly metalayerMailbox: Address;
  readonly prover: Address;
}

/**
 * Plants every bridge on `local`, wired to `remote`, the other chain: each at the address the SDK
 * records for `local`'s chain, so the programs compiled for it reach them.
 */
export async function plantBridges(local: LocalChain, remote: LocalChain): Promise<Bridges> {
  const here = remoteLink(local.chain);
  const there = remoteLink(remote.chain);
  if (
    here.hyperlane === undefined ||
    here.layerzero === undefined ||
    here.metalayer === undefined ||
    here.polymer === undefined ||
    there.layerzero === undefined ||
    there.metalayer === undefined
  ) {
    throw new Error(`${local.chain.slug} lacks a bridge the suite plants`);
  }
  const noop = await deploy(local, fixture("NoopIsm").creationCode);
  /** A hook charging `fee`: the interchain gas payment's stand-in. */
  const hookCharging = async (fee: bigint): Promise<Address> => {
    const hook = await deploy(local, fixture("TestPostDispatchHook").creationCode);
    await call(
      local,
      hook,
      encodeFunctionData({ abi: hookAbi, functionName: "setFee", args: [fee] }),
    );

    return hook;
  };
  // A Mailbox for `domain`, initialized: its default hook charges `fee`, its required one nothing.
  const newMailbox = async (domain: number, fee: bigint): Promise<Address> => {
    const mailbox = await deploy(
      local,
      withArgs(fixture("Mailbox").creationCode, ["uint32"], [domain]),
    );
    await call(
      local,
      mailbox,
      encodeFunctionData({
        abi: mailboxAbi,
        functionName: "initialize",
        args: [DEPLOYER.address, noop, await hookCharging(fee), await hookCharging(0n)],
      }),
    );

    return mailbox;
  };

  // Hyperlane: a Mailbox for this chain's domain at the recorded Mailbox.
  const mailbox = getAddress(here.hyperlane.mailbox);
  await plantAt(local, await newMailbox(here.hyperlane.domain, HYPERLANE_FEE), mailbox);

  // LayerZero: the endpoint at the recorded address, then its library, which reads the endpoint's
  // id when it is constructed.
  const endpoint = getAddress(here.layerzero.endpoint);
  await plantAt(
    local,
    await deploy(
      local,
      withArgs(
        fixture("EndpointV2").creationCode,
        ["uint32", "address"],
        [here.layerzero.eid, DEPLOYER.address],
      ),
    ),
    endpoint,
  );
  const simpleLib = await deploy(
    local,
    withArgs(
      fixture("SimpleMessageLib").creationCode,
      ["address", "address"],
      [endpoint, DEPLOYER.address],
    ),
  );
  for (const data of [
    encodeFunctionData({ abi: endpointAbi, functionName: "registerLibrary", args: [simpleLib] }),
    encodeFunctionData({
      abi: endpointAbi,
      functionName: "setDefaultSendLibrary",
      args: [there.layerzero.eid, simpleLib],
    }),
    encodeFunctionData({
      abi: endpointAbi,
      functionName: "setDefaultReceiveLibrary",
      args: [there.layerzero.eid, simpleLib, 0n],
    }),
  ]) {
    await call(local, endpoint, data);
  }

  // Metalayer: its own mailbox, and the router's proxy, initialized, at the recorded router, which
  // trusts the router at the same address on the other chain.
  // Its gas payment is the hook the router names, `igp`, which charges the fee.
  const metalayerMailbox = await newMailbox(here.metalayer.domain, 0n);
  const metalayerHook = await hookCharging(METALAYER_FEE);
  const metalayerRouter = getAddress(here.metalayer.router);
  const implementation = await deploy(local, fixture("MetalayerRouter").creationCode);
  const proxy = await deploy(
    local,
    withArgs(
      fixture("ERC1967Proxy").creationCode,
      ["address", "bytes"],
      [
        implementation,
        encodeFunctionData({
          abi: routerAbi,
          functionName: "initialize",
          args: [
            metalayerMailbox,
            noop,
            noop,
            noop,
            [there.metalayer.domain],
            [getAddress(there.metalayer.router)],
            DEPLOYER.address,
            metalayerHook,
          ],
        }),
      ],
    ),
  );
  await plantAt(local, proxy, metalayerRouter);

  // Polymer: the deployed prover, its sequencer the suite's key.
  const polymer = fixture<{
    runtimeCode: Hex;
    sequencer: Address;
    clientTypeSlot: Hex;
    clientType: Hex;
  }>("CrossL2ProverV2");
  const prover = getAddress(here.polymer.prover);
  const sequencer = polymer.sequencer.slice(2).toLowerCase();
  const runtime = polymer.runtimeCode.toLowerCase();
  if (runtime.split(sequencer).length !== 3) {
    throw new Error("the prover's runtime holds its sequencer other than twice");
  }
  await local.testClient.setCode({
    address: prover,
    bytecode: runtime.split(sequencer).join(SEQUENCER.address.slice(2).toLowerCase()) as Hex,
  });
  await local.testClient.setStorageAt({
    address: prover,
    index: pad(polymer.clientTypeSlot, { size: 32 }),
    value: polymer.clientType,
  });

  return { mailbox, endpoint, simpleLib, metalayerRouter, metalayerMailbox, prover };
}

/** The Mailbox `Dispatch`es `receipt` holds, from `mailbox`: the messages to carry. */
function dispatched(receipt: TransactionReceipt, mailbox: Address): Hex[] {
  return receipt.logs
    .filter((log) => getAddress(log.address) === getAddress(mailbox))
    .flatMap((log) => {
      try {
        const event = decodeEventLog({ abi: mailboxAbi, data: log.data, topics: log.topics });
        return event.eventName === "Dispatch" ? [event.args.message] : [];
      } catch {
        return [];
      }
    });
}

/** Carries every Hyperlane message `receipt` dispatched to `to`, as a relayer does. */
export async function relayHyperlane(
  receipt: TransactionReceipt,
  from: Bridges,
  to: LocalChain,
  toBridges: Bridges,
): Promise<Hex[]> {
  const hashes: Hex[] = [];
  for (const message of dispatched(receipt, from.mailbox)) {
    hashes.push(
      await to.send(
        to.deployer,
        toBridges.mailbox,
        encodeFunctionData({ abi: mailboxAbi, functionName: "process", args: ["0x", message] }),
      ),
    );
  }

  return hashes;
}

/** Carries every Metalayer message `receipt` dispatched: through Metalayer's own mailboxes, with
 *  the aggregation metadata that names the one ISM it holds, with nothing to check. */
export async function relayMetalayer(
  receipt: TransactionReceipt,
  from: Bridges,
  to: LocalChain,
  toBridges: Bridges,
): Promise<Hex[]> {
  // One range, [8, 8): present (its start is non-zero) and empty.
  const metadata = encodePacked(["uint32", "uint32"], [8, 8]);
  const hashes: Hex[] = [];
  for (const message of dispatched(receipt, from.metalayerMailbox)) {
    hashes.push(
      await to.send(
        to.deployer,
        toBridges.metalayerMailbox,
        encodeFunctionData({ abi: mailboxAbi, functionName: "process", args: [metadata, message] }),
      ),
    );
  }

  return hashes;
}

/** One LayerZero packet (`PacketV1Codec`), its header read. */
export interface Packet {
  readonly encoded: Hex;
  readonly nonce: bigint;
  readonly srcEid: number;
  readonly sender: Hex;
  readonly receiver: Address;
  readonly guid: Hex;
  readonly message: Hex;
}

/** The packets `receipt` sent through `from`'s endpoint. */
export function packets(receipt: TransactionReceipt, from: Bridges): Packet[] {
  return receipt.logs
    .filter((log) => getAddress(log.address) === getAddress(from.endpoint))
    .flatMap((log) => {
      try {
        const event = decodeEventLog({ abi: endpointAbi, data: log.data, topics: log.topics });
        if (event.eventName !== "PacketSent") return [];
        const encoded = event.args.encodedPayload;
        // version (1) | nonce (8) | srcEid (4) | sender (32) | dstEid (4) | receiver (32) | guid (32)
        // | message
        return [
          {
            encoded,
            nonce: BigInt(slice(encoded, 1, 9)),
            srcEid: Number(BigInt(slice(encoded, 9, 13))),
            sender: slice(encoded, 13, 45),
            receiver: getAddress(slice(encoded, 61, 81)),
            guid: slice(encoded, 81, 113),
            message: slice(encoded, 113),
          },
        ];
      } catch {
        return [];
      }
    });
}

/** Has the library verify `packet` on `to`: the endpoint's `verify`, which asks the receiver's
 *  `allowInitializePath` before a path's first message. */
export const verifyPacket = (packet: Packet, to: LocalChain, toBridges: Bridges): Promise<Hex> =>
  to.send(
    to.deployer,
    toBridges.simpleLib,
    encodeFunctionData({
      abi: simpleLibAbi,
      functionName: "validatePacket",
      args: [packet.encoded],
    }),
  );

/** Delivers a verified `packet` on `to`, as LayerZero's executor does. */
export const executePacket = (packet: Packet, to: LocalChain, toBridges: Bridges): Promise<Hex> =>
  to.send(
    to.deployer,
    toBridges.endpoint,
    encodeFunctionData({
      abi: endpointAbi,
      functionName: "lzReceive",
      args: [
        { srcEid: packet.srcEid, sender: packet.sender, nonce: packet.nonce },
        packet.receiver,
        packet.guid,
        packet.message,
        "0x",
      ],
    }),
  );

/** Carries every LayerZero packet `receipt` sent: verified, then executed. */
export async function relayLayerZero(
  receipt: TransactionReceipt,
  from: Bridges,
  to: LocalChain,
  toBridges: Bridges,
): Promise<Hex[]> {
  const hashes: Hex[] = [];
  for (const packet of packets(receipt, from)) {
    await verifyPacket(packet, to, toBridges);
    hashes.push(await executePacket(packet, to, toBridges));
  }

  return hashes;
}

/** keccak256("RemoteMessage(uint256,bytes)"), the topic of the log a Pot sends a Polymer message by. */
export const REMOTE_MESSAGE_TOPIC = keccak256(toHex("RemoteMessage(uint256,bytes)"));

/**
 * A Polymer proof of `receipt`'s log at `index` (of all its logs), as the prove API answers one: the
 * log's place and the log, a membership proof of the log's hash under the key the prover checks
 * (`chain/<id>/storedLogs/<client>/<block>/<receipt>/<log>`), and the sequencer's signature over the
 * root it proves to.
 */
export async function polymerProof(
  from: LocalChain,
  receipt: TransactionReceipt,
  index: number,
  to: LocalChain,
  toBridges: Bridges,
): Promise<Hex> {
  const log = receipt.logs[index]!;
  const block = await from.publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const receiptIndex = block.transactions.indexOf(receipt.transactionHash);
  const rawEvent = concat([log.address, ...log.topics, log.data]);
  // The log's index in its receipt.
  const key = toHex(
    `chain/${from.chain.id}/storedLogs/proof_api/${receipt.blockNumber}/${receiptIndex}/${index}`,
  );
  // No sibling on the path: the root is the leaf's own hash, after a one-byte prefix.
  const prefix = "0x00" as Hex;
  const root = sha256(concat([prefix, key, "0x20", sha256(keccak256(rawEvent))]));
  const membership = concat([toHex(0, { size: 1 }), toHex(2 + 1, { size: 1 }), prefix]);
  const height = 7n;
  const chainId = await to.publicClient.readContract({
    address: toBridges.prover,
    abi: proverAbi,
    functionName: "CHAIN_ID",
  });
  const digest = keccak256(
    concat([
      pad("0x00", { size: 32 }),
      chainId,
      keccak256(encodePacked(["bytes32", "uint64"], [root, height])),
    ]),
  );
  const signature = await sign({ hash: digest, privateKey: SEQUENCER_KEY, to: "object" });
  const eventEnd = 128 + (rawEvent.length - 2) / 2;

  return concat([
    root,
    signature.r,
    signature.s,
    toHex(Number(signature.v ?? 27n), { size: 1 }),
    toHex(from.chain.id, { size: 4 }),
    toHex(height, { size: 8 }),
    toHex(receipt.blockNumber, { size: 8 }),
    toHex(receiptIndex, { size: 4 }),
    toHex(index, { size: 4 }),
    toHex(log.topics.length, { size: 1 }),
    toHex(eventEnd, { size: 2 }),
    rawEvent,
    membership,
  ]);
}
