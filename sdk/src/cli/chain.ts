/**
 * What the `sauce` command asks of a chain: which endpoint, that it is the chain named, the
 * Kitchen's fee, a Pot's state, a dry run, and a transaction sent and waited for — with a revert
 * reported as its decoded reason rather than as viem's error dump.
 *
 * The endpoint comes from `--rpc-url`, or from the chain's entry in a `--config` file; nothing else.
 * No message here repeats it: a provider URL often carries a key.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  getAddress,
  hexToBytes,
  http,
  parseAbi,
  TransactionReceiptNotFoundError,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import kitchenArtifact from "../artifacts/V12Kitchen.json" with { type: "json" };
import potArtifact from "../artifacts/V12Pot.json" with { type: "json" };
import { resolveChain, type CanonicalChain } from "../chains/canonical.js";
import { v12EngineAddress, v12KitchenAddress } from "../deployments/index.js";
import { v12Pot } from "../evm/engine.js";
import { destinationExecutionFee } from "../evm/execution-fee.js";
import { PortalABI, ProverABI } from "../protocols/eco-routes/abis.js";
import { Permit2ABI } from "../protocols/permit2/abis.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";
import { UsageError } from "./args.js";
import { CliError } from "./args.js";

/** A transaction to send or simulate. */
export interface TxRequest {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

/**
 * The endpoint for `chain`: `--rpc-url`, else the `--config` file's `rpcUrls` entry for the chain's
 * id. `config` is the file's path and text, when one was given.
 */
export function endpointFor(
  chain: CanonicalChain,
  rpcUrl: string | undefined,
  config: { readonly path: string; readonly text: string } | undefined,
): string | undefined {
  if (rpcUrl !== undefined) return rpcUrl;
  if (config === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(config.text);
  } catch {
    throw new UsageError(`--config ${config.path}: not JSON`);
  }
  const urls = (parsed as { rpcUrls?: unknown } | null)?.rpcUrls;
  if (urls === null || typeof urls !== "object" || Array.isArray(urls)) {
    throw new UsageError(
      `--config ${config.path}: expected { "rpcUrls": { "<chain id>": "<url>" } }`,
    );
  }
  const url = (urls as Record<string, unknown>)[String(chain.id)];
  if (url === undefined) {
    throw new UsageError(
      `--config ${config.path} has no rpcUrls entry for ${chain.slug} (chain id ${chain.id})`,
    );
  }
  if (typeof url !== "string" || /^<.*>$/.test(url)) {
    throw new UsageError(
      `--config ${config.path}: rpcUrls["${chain.id}"] is not a URL; replace the placeholder`,
    );
  }

  return url;
}

/** viem's one-line reason for a failed request, never its details, which repeat the URL. */
const reasonOf = (error: unknown): string =>
  (error as { shortMessage?: string }).shortMessage ?? "the request failed";

async function request<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new CliError(`reading ${what} failed: ${reasonOf(error)}`);
  }
}

/** A client for `url`, checked to serve `chain`. */
export async function connect(url: string, chain: CanonicalChain): Promise<PublicClient> {
  const client: PublicClient = createPublicClient({ transport: http(url) });
  const chainId = await request("the chain id", () => client.getChainId());
  if (chainId !== chain.id) {
    throw new CliError(
      `the RPC endpoint serves chain ${chainId}, but ${chain.slug} is ${chain.id}`,
    );
  }

  return client;
}

/**
 * A transaction's receipt, or `undefined` while it has none (pending, or dropped). Any other failure
 * to read it is an error, not a pending transaction.
 */
export async function receiptOf(
  client: PublicClient,
  hash: Hex,
): Promise<TransactionReceipt | undefined> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return undefined;
    throw new CliError(`reading the transaction's receipt failed: ${reasonOf(error)}`);
  }
}

/** The canonical chain `url` serves, for a command given an endpoint and no `--chain`. */
export async function chainServedBy(url: string): Promise<CanonicalChain> {
  const client: PublicClient = createPublicClient({ transport: http(url) });
  const chainId = await request("the chain id", () => client.getChainId());
  const chain = resolveChain(chainId);
  if (chain === undefined) {
    throw new CliError(
      `the RPC endpoint serves chain ${chainId}, which is not a chain Sauce knows`,
    );
  }

  return chain;
}

/** The released Kitchen's current execution fee on the connected chain. */
export async function kitchenFee(client: PublicClient, chain: CanonicalChain): Promise<bigint> {
  const fee = destinationExecutionFee();
  const answer = await request("the Kitchen's executionFee()", () =>
    client.call({ to: fee.to, data: fee.data }),
  );
  if (answer.data === undefined || answer.data === "0x") {
    throw new CliError(
      `the Kitchen ${getAddress(fee.to)} has no code on ${chain.slug}: the released Sauce ` +
        "contracts are not deployed there",
    );
  }

  return fee.decode(answer.data);
}

/** Whether the released Sauce contracts a cook needs are on a chain, and its Kitchen's fee. */
export interface Released {
  readonly engine: { readonly address: Address; readonly deployed: boolean };
  readonly kitchen: {
    readonly address: Address;
    readonly deployed: boolean;
    /** The fee a cook pays, read where the Kitchen is there. */
    readonly executionFee?: bigint;
  };
}

/** The released engine and Kitchen on the connected chain: whether each has code, and the fee. */
export async function releasedContracts(client: PublicClient): Promise<Released> {
  const engine = getAddress(v12EngineAddress());
  const kitchen = getAddress(v12KitchenAddress());
  const hasCode = async (address: Address, what: string): Promise<boolean> => {
    const code = await request(what, () => client.getCode({ address }));

    return code !== undefined && code !== "0x";
  };
  const [engineThere, kitchenThere] = await Promise.all([
    hasCode(engine, "the engine's code"),
    hasCode(kitchen, "the Kitchen's code"),
  ]);
  let executionFee: bigint | undefined;
  if (kitchenThere) {
    const fee = destinationExecutionFee(kitchen);
    const answer = await request("the Kitchen's executionFee()", () =>
      client.call({ to: fee.to, data: fee.data }),
    );
    executionFee = answer.data === undefined ? undefined : fee.decode(answer.data);
  }

  return {
    engine: { address: engine, deployed: engineThere },
    kitchen: {
      address: kitchen,
      deployed: kitchenThere,
      ...(executionFee === undefined ? {} : { executionFee }),
    },
  };
}

/** Whether `pot` is deployed, and whose it is. */
export async function potState(
  client: PublicClient,
  pot: Address,
): Promise<{ readonly deployed: boolean; readonly owner?: Address }> {
  const code = await request("the Pot's code", () => client.getCode({ address: pot }));
  if (code === undefined || code === "0x") return { deployed: false };
  const owner = await request("the Pot's owner()", () =>
    client.readContract({ address: pot, abi: v12Pot.abi, functionName: "owner" }),
  );

  return { deployed: true, owner };
}

/**
 * Waits, briefly, until the endpoint's latest block is `block` or later — so what the command
 * reads next (an allowance it just approved, a Pot it just deployed) is read from state that has
 * the transaction in it. It never fails: a node that stays behind is caught by the read that
 * depends on it (`awaitPot`), or by the rehearsal of the transaction after it.
 */
export async function caughtUp(
  client: PublicClient,
  block: bigint,
  wait: { readonly tries: number; readonly delayMs: number } = POT_WAIT,
): Promise<void> {
  for (let attempt = 0; attempt < wait.tries; attempt++) {
    const latest = await client.getBlockNumber({ cacheTime: 0 }).catch(() => undefined);
    if (latest !== undefined && latest >= block) return;
    await new Promise((resolve) => setTimeout(resolve, wait.delayMs));
  }
}

/** How long {@link awaitPot} waits for a lagging endpoint, and how often it asks. */
export const POT_WAIT = { tries: 30, delayMs: 500 };

/**
 * Waits until the endpoint's latest state has `pot`'s code, after a deployment that succeeded in
 * `block`. A receipt is not proof the node answering the next request has that block: behind a
 * load balancer, the node that served the receipt and the one asked for the code can differ, so
 * an immediate `getCode` may read a Pot that is there as missing — and a cook simulated on that
 * state "succeeds" on an address without code. This asks again until it sees the code, and fails,
 * saying so, when it never does.
 */
export async function awaitPot(
  client: PublicClient,
  pot: Address,
  block: bigint,
  wait: { readonly tries: number; readonly delayMs: number } = POT_WAIT,
): Promise<void> {
  for (let attempt = 0; attempt < wait.tries; attempt++) {
    // A node behind the deployment fails or answers empty: both mean "not yet".
    const code = await client.getCode({ address: pot }).catch(() => undefined);
    if (code !== undefined && code !== "0x") return;
    await new Promise((resolve) => setTimeout(resolve, wait.delayMs));
  }
  throw new CliError(
    `the Pot ${pot} was deployed in block ${block}, but the endpoint still shows no code there ` +
      `after ${(wait.tries * wait.delayMs) / 1000}s: it is behind the chain. Run the command again ` +
      "once it has caught up; the deployment is not repeated.",
  );
}

/** ERC-20's standard errors (EIP-6093), which OpenZeppelin's tokens revert with. */
const ERC20_ERRORS = parseAbi([
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidSpender(address spender)",
]);

/** The errors a cook or a publish can revert with by name: the Pot's, the Kitchen's, Permit2's
 *  (which `--fund` pulls through), whatever the registry's Portal and prover ABIs declare, and
 *  ERC-20's standard ones. */
const ERRORS = [
  ...potArtifact.abi,
  ...kitchenArtifact.abi,
  ...Permit2ABI,
  ...PortalABI,
  ...ProverABI,
  ...ERC20_ERRORS,
].filter((item) => item.type === "error") as Abi;

/** The revert data somewhere in viem's error chain, if the node returned any. */
function revertData(error: unknown): Hex | undefined {
  for (let at: unknown = error; at !== undefined && at !== null;) {
    const data = (at as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]*$/.test(data) && data.length > 2) {
      return data as Hex;
    }
    if (data !== null && typeof data === "object") {
      const inner = (data as { data?: unknown }).data;
      if (typeof inner === "string" && /^0x[0-9a-fA-F]+$/.test(inner)) return inner as Hex;
    }
    at = (at as { cause?: unknown }).cause;
  }

  return undefined;
}

/** `data` as the text a program's `throw "…"` reverts with — its UTF-8 bytes, nothing else — or
 *  `undefined` when it is not printable text. */
function thrownText(data: Hex): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(data));

    return /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Why a call reverted: the Pot's, Kitchen's and Permit2's errors by name (`FeeNotPaid(1234, 0)`,
 * `NotOwner()`, `InvalidNonce()`), a contract's `require` message, a panic as its code, the message a program
 * `throw`s — else the raw data, else viem's own one line.
 */
export function revertReason(error: unknown): string {
  const data = revertData(error);
  if (data === undefined) return reasonOf(error);
  try {
    const decoded = decodeErrorResult({ abi: ERRORS, data });
    const args = (decoded.args ?? []).map((arg) => String(arg));
    if (decoded.errorName === "Error") return JSON.stringify(args[0] ?? "");

    return `${decoded.errorName}(${args.join(", ")})`;
  } catch {
    // A program's `throw "message"` reverts with the message's bytes as they are.
    const thrown = thrownText(data);

    return thrown === undefined
      ? `revert data ${data}`
      : `the program threw ${JSON.stringify(thrown)}`;
  }
}

/** A dry run of `tx` from `from`: what it returns and the gas it needs, or why it reverts. */
export async function simulate(
  client: PublicClient,
  from: Address,
  tx: TxRequest,
): Promise<
  | { readonly ok: true; readonly returns: Hex; readonly gas: bigint }
  | { readonly ok: false; readonly reason: string }
> {
  try {
    const { data } = await client.call({ account: from, ...tx });
    const gas = await client.estimateGas({ account: from, ...tx });

    return { ok: true, returns: data ?? "0x", gas };
  } catch (error) {
    return { ok: false, reason: revertReason(error) };
  }
}

export interface Sent {
  readonly hash: Hex;
  readonly status: "success" | "reverted";
  readonly gasUsed: bigint;
  readonly blockNumber: bigint;
  /** The logs it emitted, as the receipt holds them. */
  readonly logs: ReadonlyArray<{
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
  }>;
  /** When it reverted: why, replayed at its block. */
  readonly reason?: string;
  /** The receipt it landed with: what it cost, and its logs. */
  readonly receipt?: TransactionReceipt;
}

/**
 * Signs `tx` as `account`, sends it through `url`, and waits for its receipt. It is simulated
 * first, so a transaction that would revert is refused with its reason and never sent.
 */
export async function sendAndWait(
  client: PublicClient,
  url: string,
  account: PrivateKeyAccount,
  tx: TxRequest,
): Promise<Sent> {
  const rehearsal = await simulate(client, account.address, tx);
  if (!rehearsal.ok) throw new CliError(`not sent — it would revert: ${rehearsal.reason}`);
  const wallet = createWalletClient({ account, transport: http(url) });
  let hash: Hex;
  try {
    hash = await wallet.sendTransaction({ chain: null, ...tx, gas: (rehearsal.gas * 12n) / 10n });
  } catch (error) {
    throw new CliError(`sending failed: ${reasonOf(error)}`);
  }
  const receipt = await request(`the receipt of ${hash}`, () =>
    client.waitForTransactionReceipt({ hash }),
  );
  const sent = {
    hash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    logs: receipt.logs.map((log) => ({
      address: getAddress(log.address),
      topics: log.topics as readonly Hex[],
      data: log.data,
    })),
    receipt,
  };
  if (receipt.status === "success") {
    await caughtUp(client, receipt.blockNumber);

    return sent;
  }
  const replay = await client
    .call({ account: account.address, ...tx, blockNumber: receipt.blockNumber - 1n })
    .then(
      () => "it succeeds when replayed, so the state it ran on changed",
      (error: unknown) => revertReason(error),
    );

  return { ...sent, reason: replay };
}

const BALANCE_OF = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** One registered token's balance; `null` where the token could not be read on this chain. */
export interface RegisteredBalance {
  readonly symbol: string;
  readonly address: Address;
  readonly decimals: number;
  readonly balance: bigint | null;
}

/** `holder`'s native balance, and its balance of every token `chain` registers by symbol. */
export async function registeredBalances(
  client: PublicClient,
  chain: CanonicalChain,
  holder: Address,
): Promise<{ readonly native: bigint; readonly tokens: readonly RegisteredBalance[] }> {
  const native = await request("the native balance", () => client.getBalance({ address: holder }));
  const tokens = await Promise.all(
    (TOKEN_REGISTRY[chain.id] ?? []).map(async (row) => {
      const token = getAddress(row.address);
      const balance = await client
        .readContract({
          address: token,
          abi: BALANCE_OF,
          functionName: "balanceOf",
          args: [holder],
        })
        .catch(() => null);

      return { symbol: row.symbol, address: token, decimals: row.decimals, balance };
    }),
  );

  return { native, tokens };
}
