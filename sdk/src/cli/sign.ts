/**
 * `sauce sign`: a cook the owner of a Private Pot signs for anyone (or one named account) to submit
 * with the Pot's own `cookSigned`. The command compiles the file with `main`'s arguments as `tx`
 * does and prints the EIP-712 typed data the owner signs (`evm/engine.ts#signedCookTypedData`:
 * engine, program, value, fee ceiling, nonce, deadline, submitter, under the Pot's domain); with a
 * signer (the Pot's owner) it signs it, and with a signature made elsewhere it checks it, and either
 * way builds `cook`: `cookSigned(…)` as `{ chainId, to: the Pot, data, value }`, for the submitter
 * to send with exactly the signed value. The Pot pays the Kitchen's fee itself, out of its balance.
 *
 * With an endpoint the Pot is read (`checkSignedCookPot`): one with no code that the owner and salt
 * name still signs, and the result carries `deployPot`, the Kitchen call any account sends first; a
 * Pot minted before signed cooks, a Shared Pot or a contract that is not a Pot is refused. `--offline`
 * reads nothing. `--cancel <nonce>` builds the owner's `invalidateNonces` per nonce word, and with a
 * signer and an endpoint sends them through `chain.ts#sendAndWait`.
 *
 * Every byte of calldata is the SDK's: `encodeCookSigned`, `encodeInvalidateNonces` and
 * `v12Kitchen.encodeDeployPot`.
 */
import {
  formatEther,
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import type { CanonicalChain } from "../chains/canonical.js";
import { v12EngineAddress } from "../deployments/index.js";
import { v12PredictPot } from "../deployments/pot.js";
import { nativeSymbol } from "../evm/effects.js";
import {
  checkSignedCookPot,
  cookNonceMasks,
  encodeCookSigned,
  encodeInvalidateNonces,
  randomCookNonce,
  signedCookDigest,
  signedCookTypedData,
  signedCookTypedDataJson,
  v12Kitchen,
  verifySignedCook,
  type SignedCookExecution,
} from "../evm/engine.js";
import { CliError, UsageError } from "./args.js";
import {
  connect,
  kitchenFee,
  POT_UNCHECKED,
  reasonOf,
  requirePot,
  sendAndWait,
  type Sent,
} from "./chain.js";
import {
  compileProgram,
  kitchenAddress,
  payloadOf,
  type ArgsInput,
  type CliFiles,
  type CommandOutput,
  type PotInput,
  type ProgramInput,
} from "./commands.js";
import { hexQuantity } from "./handoff.js";
import { linkLines, txLinks } from "./links.js";
import { guardOf } from "./policy.js";
import { requireSupported } from "./support.js";

export interface SignInput extends ProgramInput {
  readonly target: PotInput;
  /** Values for `main`'s parameters; required exactly when it declares some. */
  readonly args?: ArgsInput;
  /** What the submitter sends with the cook, in wei, signed: `0n` when left out. */
  readonly value?: bigint;
  /** The most of the Kitchen's fee the Pot pays: the fee read from the chain when left out. */
  readonly maxExecutionFee?: bigint;
  /** A random one when left out. */
  readonly nonce?: bigint;
  /** The last second it runs (unix, inclusive); else now plus `within`. */
  readonly deadline?: bigint;
  /** Seconds from now (the chain's latest block, else this clock): 3600 when left out. */
  readonly within?: bigint;
  /** The only account that may submit it; anyone when left out. */
  readonly submitter?: Address;
  /** The owner's signature, made elsewhere: checked, then the cook built. */
  readonly signature?: Hex;
  /** An endpoint for the chain: the Pot, the fee and the time are read there. */
  readonly rpcUrl?: string;
}

export interface CancelInput {
  readonly chain: CanonicalChain;
  readonly target: PotInput;
  readonly nonces: readonly bigint[];
  readonly rpcUrl?: string;
}

/** What `--within` is when neither it nor `--deadline` is given. */
export const DEFAULT_WITHIN = 3600n;

const UINT256 = (1n << 256n) - 1n;

/** An unsigned 256-bit integer flag: decimal digits, or 0x hex. */
export function parseUint256(flag: string, raw: string): bigint {
  if (!/^(?:\d+|0x[0-9a-fA-F]+)$/.test(raw) || BigInt(raw) > UINT256) {
    throw new UsageError(
      `--${flag}: '${raw}' is not an unsigned integer (decimal digits or 0x hex, below 2^256)`,
    );
  }

  return BigInt(raw);
}

/** Why a Solana chain refuses `sauce sign`, and its `--cancel`. */
export const SIGNED_COOKS_ARE_EVM =
  "signed cooks are the EVM Pot's (Pot.cookSigned): on Solana the owner signs the cook " +
  "transaction itself, and any fee payer may sponsor it (sauce tx's feePayer)";

/**
 * What `sauce sign` refuses before it compiles, reads a chain or unlocks a key: Solana, both
 * deadlines, a signer beside a signature made elsewhere, and no fee ceiling with no endpoint to
 * read the fee from. `signed`: a signer is given.
 */
export function refuseSignInput(
  input: Pick<
    SignInput,
    "chain" | "within" | "deadline" | "signature" | "maxExecutionFee" | "rpcUrl"
  >,
  signed: boolean,
): void {
  if (input.chain.kind !== "evm") throw new UsageError(SIGNED_COOKS_ARE_EVM);
  if (input.within !== undefined && input.deadline !== undefined) {
    throw new UsageError("give --within or --deadline, not both");
  }
  if (signed && input.signature !== undefined) {
    throw new UsageError(
      "give a signer or --signature, not both: a signer signs the cook here, and --signature " +
        "is one the owner made elsewhere",
    );
  }
  if (input.maxExecutionFee === undefined && input.rpcUrl === undefined) {
    throw new UsageError(
      "missing --max-fee <wei>: the most of the Kitchen's fee the Pot pays for this cook, which " +
        "the owner signs. Pass it, or an RPC endpoint (--rpc-url or --config) to read the fee.",
    );
  }
}

/** A unix time as a reader takes it, where a date can hold it. */
const when = (seconds: bigint): string =>
  seconds <= 8_640_000_000_000n
    ? `${seconds} (${new Date(Number(seconds) * 1000).toISOString()})`
    : seconds.toString();

/** `amount` wei, in the chain's native coin too. */
const wei = (amount: bigint, chain: CanonicalChain): string =>
  `${amount} wei (${formatEther(amount)} ${nativeSymbol(chain)})`;

/** The Pot's code on the chain: whether it has any. */
async function hasCode(client: PublicClient, pot: Address): Promise<boolean> {
  try {
    const code = await client.getCode({ address: pot });

    return code !== undefined && code !== "0x";
  } catch (error) {
    throw new CliError(`reading the Pot's code: ${reasonOf(error)}`);
  }
}

/** Refuses a Pot the chain shows cannot take a signed cook, naming why; its owner otherwise. */
async function signedCookOwner(client: PublicClient, pot: Address): Promise<Address> {
  const check = await checkSignedCookPot(client, pot).catch((error: unknown) => {
    throw new CliError(`reading Pot ${pot}: ${reasonOf(error)}`);
  });
  if (!check.ok) throw new CliError(`Pot ${pot} takes no signed cook: ${check.reason}`);

  return check.owner;
}

/** `sauce sign`: the typed data, and with a signer (or a signature) the cook anyone submits. */
export async function signCommand(
  input: SignInput,
  files: CliFiles,
  signer?: PrivateKeyAccount,
): Promise<CommandOutput> {
  const chain = input.chain;
  refuseSignInput(input, signer !== undefined);
  const compiled = compileProgram(input, files);
  requireSupported("signing a cook", [chain]);
  const program = payloadOf(compiled, input.args);
  const target = input.target;
  const pot =
    "pot" in target ? getAddress(target.pot) : getAddress(v12PredictPot(target.owner, target.salt));
  const named = "owner" in target ? getAddress(target.owner) : undefined;
  if (signer !== undefined && named !== undefined && getAddress(signer.address) !== named) {
    throw new UsageError(
      `${signer.address} does not own the Pot: only its owner, ${named}, signs the cooks it runs`,
    );
  }
  // A wallet's policy, before anything is read: what a signed cook moves is not measurable now.
  if (signer !== undefined) guardOf(signer.address)?.authorizeSignedCook(chain, pot);

  // The Pot, the fee and the time, where the command reaches the chain.
  const client = input.rpcUrl === undefined ? undefined : await connect(input.rpcUrl, chain);
  let owner = named;
  let deployPot: { chainId: number; to: Address; data: Hex; value: Hex } | undefined;
  let read: { fee: bigint; balance: bigint; now: bigint } | undefined;
  if (client !== undefined) {
    const deployed = await hasCode(client, pot);
    if (!deployed && !("owner" in target)) {
      throw new CliError(
        `Pot ${pot} has no code on ${chain.slug}, and --pot does not say whose it is: name it by ` +
          "--owner (and --salt), so the result carries its deployment",
      );
    }
    await requirePot(client, chain, { ...target, pot, deployed });
    if (deployed) {
      owner = await signedCookOwner(client, pot);
    } else if ("owner" in target) {
      deployPot = {
        chainId: chain.id,
        to: kitchenAddress(),
        data: v12Kitchen.encodeDeployPot(target.owner, target.salt),
        value: hexQuantity(0n),
      };
    }
    if (signer !== undefined && owner !== undefined && getAddress(signer.address) !== owner) {
      throw new CliError(
        `${signer.address} does not own Pot ${pot}: only its owner, ${owner}, signs the cooks it runs`,
      );
    }
    const [fee, balance, block] = await Promise.all([
      kitchenFee(client, chain),
      client.getBalance({ address: pot }),
      client.getBlock({ blockTag: "latest" }),
    ]).catch((error: unknown) => {
      if (error instanceof CliError) throw error;
      throw new CliError(`reading ${chain.slug}: ${reasonOf(error)}`);
    });
    read = { fee, balance, now: block.timestamp };
  }

  const now = read?.now ?? BigInt(Math.floor(Date.now() / 1000));
  const deadline = input.deadline ?? now + (input.within ?? DEFAULT_WITHIN);
  if (deadline < now) {
    throw new UsageError(
      `--deadline ${deadline} has passed: it is ${now} now (${read === undefined ? "this clock" : `${chain.slug}'s latest block`})`,
    );
  }
  const value = input.value ?? 0n;
  const maxExecutionFee = input.maxExecutionFee ?? read!.fee;
  const nonce = input.nonce ?? randomCookNonce();
  const submitter = input.submitter === undefined ? zeroAddress : getAddress(input.submitter);
  const execution: SignedCookExecution = {
    chainId: chain.id,
    pot,
    engine: getAddress(v12EngineAddress()),
    program,
    value,
    maxExecutionFee,
    nonce,
    deadline,
    submitter,
  };
  const typedData = signedCookTypedDataJson(execution);
  const digest = signedCookDigest(execution);

  let signature: Hex | undefined;
  if (signer !== undefined) {
    signature = await signer.signTypedData(signedCookTypedData(execution));
  } else if (input.signature !== undefined) {
    if (owner === undefined) {
      throw new UsageError(
        "a signature is checked against the Pot's owner: give --owner (and --salt), or an RPC " +
          "endpoint to read the owner from the Pot",
      );
    }
    const valid = await verifySignedCook(
      { ...execution, signature: input.signature, owner },
      client,
    );
    if (!valid) {
      throw new CliError(
        `the signature given is not ${owner}'s over this cook (digest ${digest}): the Pot would ` +
          "refuse it with BadSignature. Every field is signed: the program and its arguments, " +
          "value, the fee ceiling, nonce, deadline and submitter must be what the owner signed" +
          (client === undefined
            ? "; an owner that is a contract wallet is checked only with an endpoint"
            : ""),
      );
    }
    signature = input.signature;
  }
  const call = signature === undefined ? undefined : encodeCookSigned({ ...execution, signature });

  const json = {
    chainId: chain.id,
    pot,
    ...(owner === undefined ? {} : { owner }),
    engine: execution.engine,
    program,
    value: value.toString(),
    maxExecutionFee: maxExecutionFee.toString(),
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    submitter,
    typedData,
    digest,
    ...(signature === undefined ? {} : { signature }),
    ...(call === undefined
      ? {}
      : {
          cook: { chainId: chain.id, to: call.to, data: call.data, value: hexQuantity(call.value) },
        }),
    ...(deployPot === undefined ? {} : { deployPot }),
  };
  const who = submitter === zeroAddress ? "Anyone" : `Only ${submitter}`;
  const notes = [
    `Pot ${pot}${owner === undefined ? "" : `, owned by ${owner}`}: ${who} may submit this cook, ` +
      `once (nonce ${nonce}), until ${when(deadline)}, unix seconds, inclusive.`,
    ...(deployPot === undefined
      ? []
      : [
          `Pot ${pot} has no code yet: send deployPot first (Kitchen.deployPot; any account may ` +
            "send it, and the Pot is its owner's either way), then the cook.",
        ]),
    call === undefined
      ? "No signer was given: sign typedData with the Pot's owner (eth_signTypedData_v4), then " +
        "build the cook with that signature (--signature <hex>), or sign here with --wallet, " +
        "--keystore or --private-key."
      : `Send cook from ${submitter === zeroAddress ? "any account" : submitter} with exactly ` +
        `${value} wei of value, and nothing more (the Pot hashes the value it is sent): sign it ` +
        "with any wallet and broadcast it (sauce send <signed transaction>), or pass it to a " +
        "wallet's send tool. The submitter pays gas, and nothing else.",
    read === undefined
      ? `The Pot pays the Kitchen's fee itself, from its balance, up to ${wei(maxExecutionFee, chain)}; ` +
        "nothing was read (no endpoint): the Pot must be a Private Pot minted under this release " +
        "(an older one has no cookSigned), deployed, and hold the fee when the cook lands."
      : `The Pot pays the Kitchen's fee itself, from its balance and the cook's value: the fee is ` +
        `${wei(read.fee, chain)} now, the signed ceiling ${wei(maxExecutionFee, chain)}, and the ` +
        `Pot holds ${wei(read.balance, chain)}.`,
    ...(read !== undefined && read.balance + value < read.fee
      ? [
          `warning: the Pot's balance and the cook's value (${read.balance + value} wei) do not ` +
            "cover the Kitchen's fee: fund the Pot before the cook is submitted, or it reverts " +
            "with FeeNotPaid.",
        ]
      : []),
    ...(read !== undefined && maxExecutionFee < read.fee
      ? [
          `warning: the signed fee ceiling ${maxExecutionFee} is below the Kitchen's fee ` +
            `${read.fee}: the cook reverts with FeeNotPaid unless the fee comes down.`,
        ]
      : []),
    ...(call === undefined
      ? []
      : [
          `Whoever holds the signature may submit it until the deadline${submitter === zeroAddress ? "" : `, from ${submitter}`}. ` +
            `Cancel it before then with sauce sign --cancel ${nonce} --chain ${chain.slug}, ` +
            "signed by the owner. A cook that reverts leaves its nonce unused, so the same " +
            "signature can be submitted again until the deadline.",
        ]),
    ...(read === undefined ? [POT_UNCHECKED] : []),
  ];

  return { text: JSON.stringify(json, null, 2), json, notes };
}

/** One sent cancellation's report. */
const sentEntry = (
  chain: CanonicalChain,
  what: string,
  word: bigint,
  mask: bigint,
  sent: Sent,
): Record<string, unknown> => ({
  what,
  word: word.toString(),
  mask: mask.toString(),
  hash: sent.hash,
  ...txLinks(chain, sent.hash),
  status: sent.status,
  gasUsed: sent.gasUsed.toString(),
  blockNumber: sent.blockNumber.toString(),
  ...(sent.reason === undefined ? {} : { reason: sent.reason }),
});

/**
 * `sauce sign --cancel <nonce>…`: one `invalidateNonces(word, mask)` per nonce word, on the Pot,
 * from its owner. With a signer (the owner) and an endpoint they are sent, each through
 * `sendAndWait`; without a signer they come back unsigned.
 */
export async function cancelCommand(
  input: CancelInput,
  signer?: PrivateKeyAccount,
): Promise<CommandOutput> {
  const chain = input.chain;
  if (chain.kind !== "evm") throw new UsageError(SIGNED_COOKS_ARE_EVM);
  if (input.nonces.length === 0) throw new UsageError("missing --cancel <nonce>: what to cancel");
  requireSupported("cancelling signed cooks", [chain]);
  const target = input.target;
  const pot =
    "pot" in target ? getAddress(target.pot) : getAddress(v12PredictPot(target.owner, target.salt));
  const named = "owner" in target ? getAddress(target.owner) : undefined;
  if (signer !== undefined && named !== undefined && getAddress(signer.address) !== named) {
    throw new UsageError(
      `${signer.address} does not own the Pot: only its owner, ${named}, cancels its nonces`,
    );
  }
  if (signer !== undefined && input.rpcUrl === undefined) {
    throw new UsageError(
      "sending the cancellation needs an RPC endpoint (--rpc-url or --config): leave out the " +
        "signer to print it unsigned instead",
    );
  }
  const nonces = [...new Set(input.nonces)];
  const transactions = cookNonceMasks(nonces).map(({ word, mask }) => {
    const covered = nonces.filter((nonce) => nonce >> 8n === word);

    return {
      word,
      mask,
      what:
        `invalidateNonces(${word}, ${mask}) on Pot ${pot}: cancels nonce` +
        `${covered.length === 1 ? "" : "s"} ${covered.join(", ")}`,
      data: encodeInvalidateNonces(word, mask),
    };
  });
  let owner = named;
  const client = input.rpcUrl === undefined ? undefined : await connect(input.rpcUrl, chain);
  if (client !== undefined) {
    // Sent to an address with no code, a call "succeeds" and cancels nothing.
    if (!(await hasCode(client, pot))) {
      throw new CliError(`Pot ${pot} has no code on ${chain.slug}: it has no nonce to cancel`);
    }
    owner = await signedCookOwner(client, pot);
    if (signer !== undefined && getAddress(signer.address) !== owner) {
      throw new CliError(
        `${signer.address} does not own Pot ${pot}: only its owner, ${owner}, cancels its nonces`,
      );
    }
  }
  if (signer === undefined || client === undefined || input.rpcUrl === undefined) {
    const json = {
      chainId: chain.id,
      pot,
      ...(owner === undefined ? {} : { owner }),
      nonces: nonces.map(String),
      transactions: transactions.map((tx) => ({
        what: tx.what,
        chainId: chain.id,
        to: pot,
        data: tx.data,
        value: hexQuantity(0n),
        word: tx.word.toString(),
        mask: tx.mask.toString(),
      })),
    };

    return {
      text: JSON.stringify(json, null, 2),
      json,
      notes: [
        `Send ${transactions.length === 1 ? "it" : `these ${transactions.length}`} from the Pot's ` +
          `owner${owner === undefined ? "" : `, ${owner}`}: only the owner (or the Pot itself, ` +
          "from a cook) sets a nonce. Sign and broadcast with sauce send <signed transaction>.",
        "A nonce once set stays set: a signature for it never runs, and cancelling it again " +
          "changes nothing.",
      ],
    };
  }
  const sent: Record<string, unknown>[] = [];
  const lines: string[] = [];
  let failed = false;
  for (const tx of transactions) {
    const result = await sendAndWait(client, input.rpcUrl, signer, {
      to: pot,
      data: tx.data,
      value: 0n,
    });
    sent.push(sentEntry(chain, tx.what, tx.word, tx.mask, result));
    lines.push(
      `${tx.what}: ${result.hash} ${result.status}, gas used ${result.gasUsed}, block ` +
        `${result.blockNumber}${result.reason === undefined ? "" : `, reverted: ${result.reason}`}`,
      ...linkLines(txLinks(chain, result.hash)),
    );
    if (result.status !== "success") {
      failed = true;
      break;
    }
  }

  return {
    text: lines.join("\n"),
    json: {
      chainId: chain.id,
      pot,
      from: signer.address,
      nonces: nonces.map(String),
      sent,
    },
    ...(failed ? { exitCode: 1 } : {}),
  };
}
