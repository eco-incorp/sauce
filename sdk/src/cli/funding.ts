/**
 * `sauce run --fund`: getting the tokens a program spends into its Pot in the same transaction, so
 * the program itself needs no funding code.
 *
 * The CLI composes a WRAPPER around the file: the file's own `main` is renamed and called from a new
 * `main` with the same signature, which first PULLS each funded token from the owner into the Pot,
 * then runs the program, then — with `--sweep` — sends the Pot's whole balance of each funded token
 * back to the owner. A script gets the pulls after its imports and the sweep after its last
 * statement. One cook. The pulls are `@sauce/token`'s, the functions a hand-written program
 * uses, and every one is a `safeTransferFrom`:
 *
 *   - `permit2` (the default): the owner signs a Permit2 SignatureTransfer for exactly this amount,
 *     to this Pot, with a fresh nonce and a short deadline; `permitTransferFrom` spends it. Permit2
 *     itself moves the tokens with Solmate's `SafeTransferLib.safeTransferFrom`. The one standing
 *     approval is the token's to Permit2, asked for once.
 *   - `permit`: the token's own EIP-2612 `permit`, signed for the Pot, then `transferFrom` — the
 *     SafeERC20 one, as in `allowance`.
 *   - `allowance`: an ERC-20 approval of the Pot for the amount, in a transaction of its own — an
 *     allowance that stands until a cook spends it, warned about — then `transferFrom`.
 *   - `transfer`: a plain transfer to the Pot first, in a transaction of its own; no pull.
 *
 * `ETH:<amount>` (the chain's native currency) needs none of it: it is sent as the cook's value.
 *
 * Signatures are made locally by the signer (EIP-712), and the key is never printed.
 */
import {
  encodeFunctionData,
  getAddress,
  hashDomain,
  isAddress,
  maxUint256,
  parseAbi,
  parseSignature,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import type { CanonicalChain } from "../chains/canonical.js";
import { addressOn, getDescriptor } from "../descriptors/query.js";
import { Permit2ABI } from "../protocols/permit2/abis.js";
import { mainSignature } from "../routes/entry.js";
import type { AstNode } from "../routes/ast-walk.js";
import { parseSauce } from "../routes/parse.js";
import { blankLiterals } from "../routes/rs-compile.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";
import { CliError, UsageError } from "./args.js";
import { sendAndWait, type Sent, type TxRequest } from "./chain.js";
import { wordsOf } from "./effects.js";
import type { Approver } from "./commands.js";

export const FUND_MODES = ["permit2", "permit", "allowance", "transfer"] as const;
export type FundMode = (typeof FUND_MODES)[number];

/** One `--fund` or `--assume-balance`, as given: the chain's native currency or a token, and an
 *  amount. */
export interface FundRequest {
  readonly raw: string;
  /** `undefined` for the native currency. */
  readonly token?: Address;
  /** What to call it in messages: the symbol given, or the address. */
  readonly label: string;
  /** Registry decimals for a symbol; `undefined` for an address, read from the token. */
  readonly decimals?: number;
  /** The amount: in whole tokens as written (`1.5`), or in base units (`1500000n`). */
  readonly amount: { readonly units: string } | { readonly base: bigint };
  /** The flag it was given with, for what is said about it. */
  readonly flag: string;
}

const NATIVE = /^(eth|native)$/i;

/**
 * `<TOKEN|address>:<amount>`, as `--fund` and `--assume-balance` take it (`flag` names which, for
 * the error). The amount is in whole tokens — `USDC:1.5` is 1.5 USDC, exact through the registry's
 * decimals (or the token's own, for an address) — or, with a trailing `n` as a JavaScript bigint
 * has, a raw integer in base units: `USDC:1500000n`. `ETH:<amount>` (or `native:`) is the chain's
 * native currency, 18 decimals.
 */
export function parseTokenAmount(raw: string, chain: CanonicalChain, flag: string): FundRequest {
  // Solana registers mints by symbol too, but nothing here can pull one: say so, not "unknown".
  if (chain.kind !== "evm") {
    throw new UsageError(
      `${flag} is for EVM chains: on ${chain.slug} a program spends from the accounts it is given`,
    );
  }
  const at = raw.lastIndexOf(":");
  const what = raw.slice(0, at).trim();
  const amount = raw.slice(at + 1).trim();
  if (at <= 0 || amount === "") {
    throw new UsageError(
      `${flag}: expected <TOKEN|address>:<amount>, as USDC:1.5 (whole tokens) or USDC:1500000n ` +
        `(base units); got '${raw}'`,
    );
  }
  const base = /^(\d+)n$/.exec(amount);
  if (base === null && !/^\d+(\.\d+)?$/.test(amount)) {
    throw new UsageError(
      `${flag} ${raw}: '${amount}' is not an amount — whole tokens (1.5) or base units ending in n ` +
        "(1500000n)",
    );
  }

  return tokenRequest(
    raw,
    what,
    chain,
    flag,
    base === null ? { units: amount } : { base: BigInt(base[1]!) },
  );
}

/** The token `what` names on `chain`, with `amount` as given. */
function tokenRequest(
  raw: string,
  what: string,
  chain: CanonicalChain,
  flag: string,
  amount: FundRequest["amount"],
): FundRequest {
  if (NATIVE.test(what)) return { raw, label: what.toUpperCase(), decimals: 18, amount, flag };
  if (isAddress(what, { strict: false })) {
    return { raw, token: getAddress(what), label: getAddress(what), amount, flag };
  }
  // Without regard to case: a stock's symbol is its issuer's ticker (`TSLAx`), not uppercase.
  const row = (TOKEN_REGISTRY[chain.id] ?? []).find(
    (entry) => entry.symbol.toUpperCase() === what.toUpperCase(),
  );
  if (row === undefined) {
    throw new UsageError(
      `${flag} ${raw}: ${what} is not a token ${chain.slug} registers` +
        ` (sauce globals --chain ${chain.slug} --tokens lists them); give its address instead`,
    );
  }

  return {
    raw,
    token: getAddress(row.address),
    label: row.symbol,
    decimals: row.decimals,
    amount,
    flag,
  };
}

/** `--fund <TOKEN|address>:<amount>`: {@link parseTokenAmount}. */
export const parseFund = (raw: string, chain: CanonicalChain): FundRequest =>
  parseTokenAmount(raw, chain, "--fund");

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

/** A funded token, its amount in base units. */
interface Funded {
  readonly request: FundRequest;
  readonly token: Address;
  readonly amount: bigint;
}

export interface FundingInput {
  readonly chain: CanonicalChain;
  readonly client: PublicClient;
  readonly rpcUrl: string;
  /** The Pot's owner, who funds it. */
  readonly owner: Address;
  readonly pot: Address;
  readonly mode: FundMode;
  readonly requests: readonly FundRequest[];
  readonly sweep: boolean;
  /** Who signs and sends; absent for a simulation with no key, which credits the Pot instead of
   *  pulling (`Funding.credit`). */
  readonly account?: PrivateKeyAccount;
  /** Permit2's nonce and the signatures' deadline (unix seconds): fresh and ten minutes out when
   *  not given. */
  readonly nonce?: bigint;
  readonly deadline?: bigint;
  /** May the run approve and transfer before the cook (`run`), or only report (`simulate`)? */
  readonly send: boolean;
  /** Who approves the approvals a send makes first. */
  readonly approver: Approver;
}

/** A transaction `sauce run` sends from the owner before the cook, unsent: what a rehearsal runs
 *  first, in the cook's block. */
export interface BeforeCook {
  /** For a person, as `needs` says it: `approve Permit2 for USDC`. */
  readonly what: string;
  readonly tx: TxRequest;
}

export interface Funding {
  /** The program, wrapped: the pulls, the file's own `main`, the sweep. */
  readonly wrap: (text: string) => string;
  /** Native currency the cook carries on top of the Kitchen's fee. */
  readonly value: bigint;
  /** What was sent before the cook: approvals, transfers. */
  readonly sent: ReadonlyArray<{ readonly what: string; readonly sent: Sent }>;
  /** What the run did or skipped, for the person. */
  readonly notes: readonly string[];
  /** Planned without sending: each approval a run would ask for first (`approve Permit2 for USDC`). */
  readonly needs?: readonly string[];
  /**
   * Planned without sending, with the owner's key: the approvals and transfers `run` would send
   * before the cook, in order, an approval as `forceApprove` sends it. `simulate` runs them first.
   */
  readonly beforeCook?: readonly BeforeCook[];
  /** Whether the owner's key signed the pulls (a Permit2 transfer, a permit). */
  readonly signed?: boolean;
  /**
   * A simulation with no key: the tokens its pulls would have brought, which the rehearsal credits
   * the Pot with through state overrides instead of pulling them.
   */
  readonly credit?: ReadonlyArray<{
    readonly token: Address;
    readonly label: string;
    readonly amount: bigint;
  }>;
}

const read = async <T>(what: string, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    throw new CliError(
      `reading ${what} failed: ${(error as { shortMessage?: string }).shortMessage ?? "the call reverted"}`,
    );
  }
};

/**
 * A request's amount in base units, a token's decimals read from it when not registered, and a note
 * when a bare integer of whole tokens reads like base units: at or above 10^decimals (`USDC:1500000`,
 * 1.5 million USDC), which a program's habit of base units makes easy to write by mistake. A note,
 * not a refusal: it may be meant, and base units have their own spelling (`1500000n`).
 */
export async function baseUnits(
  client: PublicClient,
  request: FundRequest,
): Promise<{ readonly amount: bigint; readonly note?: string }> {
  if ("base" in request.amount) return { amount: request.amount.base };
  const units = request.amount.units;
  const decimals =
    request.decimals ??
    Number(
      await read(`${request.label}'s decimals()`, () =>
        client.readContract({ address: request.token!, abi: ERC20, functionName: "decimals" }),
      ),
    );
  const amount = parseUnits(units, decimals);
  if (units.includes(".") || decimals === 0 || BigInt(units) < 10n ** BigInt(decimals)) {
    return { amount };
  }

  return {
    amount,
    note:
      `${request.flag} ${request.raw}: that is ${wordsOf(units)} ${request.label}; for base ` +
      `units write ${units}n`,
  };
}

/** Every request's amount in base units, and what is said of them. */
async function amounts(
  input: FundingInput,
): Promise<{ tokens: Funded[]; native: bigint; notes: string[] }> {
  const tokens: Funded[] = [];
  const notes: string[] = [];
  let native = 0n;
  for (const request of input.requests) {
    const { amount, note } = await baseUnits(input.client, request);
    if (note !== undefined) notes.push(note);
    if (request.token === undefined) native += amount;
    else tokens.push({ request, token: request.token, amount });
  }

  return { tokens, native, notes };
}

/** The registry's Permit2 on `chain`. */
export function permit2On(chain: CanonicalChain): Address {
  const descriptor = getDescriptor("permit2", "Permit2");
  const at = descriptor === undefined ? undefined : addressOn(descriptor, chain);
  if (at === undefined) {
    throw new UsageError(
      `Permit2 is not registered on ${chain.slug}: fund with --fund-mode permit, allowance or transfer`,
    );
  }

  return getAddress(at);
}

/** Asks before a transaction the run needs and the person may not expect, as the Pot prompt does. */
async function agreed(
  input: FundingInput,
  action: string,
  question: string,
  refused: string,
): Promise<void> {
  const answer = await input.approver.approve(action, `${question} [y/N] `);
  if (answer === true) return;
  throw new CliError(
    answer === undefined
      ? `${refused}, or pass --auto-approve to let the run do it`
      : `${refused}; nothing was sent`,
  );
}

/**
 * Sets `spender`'s allowance to `amount` from the signer, as SafeERC20's `forceApprove` would: a
 * smaller nonzero allowance is reset to zero first (USDT refuses nonzero to nonzero), and a token
 * that answers `false` is refused.
 */
async function forceApprove(
  input: FundingInput,
  funded: Funded,
  spender: Address,
  amount: bigint,
  current: bigint,
): Promise<Array<{ what: string; sent: Sent }>> {
  const sent: Array<{ what: string; sent: Sent }> = [];
  const approve = async (value: bigint): Promise<void> => {
    const answer = await read(`a rehearsal of ${funded.request.label}.approve`, () =>
      input.client.call({
        account: input.account!.address,
        to: funded.token,
        data: encodeApprove(spender, value),
      }),
    );
    refuseFalse(funded.request.label, "approve", answer.data);
    const result = await sendAndWait(input.client, input.rpcUrl, input.account!, {
      to: funded.token,
      data: encodeApprove(spender, value),
      value: 0n,
    });
    if (result.status !== "success") {
      throw new CliError(
        `approving ${spender} for ${funded.request.label} reverted in ${result.hash}`,
      );
    }
    sent.push({
      what:
        value === 0n
          ? `reset ${funded.request.label}'s allowance to ${spender}`
          : `approve ${funded.request.label} to ${spender}`,
      sent: result,
    });
  };
  if (current > 0n) await approve(0n);
  await approve(amount);

  return sent;
}

const encodeApprove = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, amount] });

/** The approvals {@link forceApprove} would send, unsent: a standing allowance reset to zero
 *  first, then `amount`. */
function approvalsBefore(
  funded: Funded,
  spender: Address,
  amount: bigint,
  current: bigint,
  what: string,
): BeforeCook[] {
  const approve = (value: bigint): TxRequest => ({
    to: funded.token,
    data: encodeApprove(spender, value),
    value: 0n,
  });

  return [
    ...(current > 0n
      ? [{ what: `reset ${funded.request.label}'s allowance to ${spender}`, tx: approve(0n) }]
      : []),
    { what, tx: approve(amount) },
  ];
}

/** SafeERC20 on the client's side: empty returndata or a word equal to 1; `false` is refused. */
function refuseFalse(label: string, method: string, data: Hex | undefined): void {
  if (data === undefined || data === "0x") return;
  if (BigInt(data.slice(0, 66)) !== 1n) {
    throw new CliError(
      `${label}.${method} answered false: the token refuses it, so nothing was sent`,
    );
  }
}

/** A random Permit2 nonce the owner has not spent (SignatureTransfer nonces are unordered). */
async function freshNonce(input: FundingInput, permit2: Address): Promise<bigint> {
  for (;;) {
    const nonce = BigInt(
      `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}`,
    );
    const word = await read("Permit2's nonce bitmap", () =>
      input.client.readContract({
        address: permit2,
        abi: Permit2ABI,
        functionName: "nonceBitmap",
        args: [input.owner, nonce >> 8n],
      }),
    );
    if (((word >> (nonce & 255n)) & 1n) === 0n) return nonce;
  }
}

/** The EIP-712 domain of an EIP-2612 token, checked against its `DOMAIN_SEPARATOR()`. */
async function permitDomain(
  input: FundingInput,
  funded: Funded,
): Promise<{ name: string; version: string; chainId: number; verifyingContract: Address }> {
  const call = <T>(functionName: "name" | "version" | "DOMAIN_SEPARATOR"): Promise<T | undefined> =>
    input.client
      .readContract({ address: funded.token, abi: ERC20, functionName })
      .then((value) => value as T)
      .catch(() => undefined);
  const [name, version, separator] = await Promise.all([
    call<string>("name"),
    call<string>("version"),
    call<Hex>("DOMAIN_SEPARATOR"),
  ]);
  const domain = {
    name: name ?? "",
    version: version ?? "1",
    chainId: input.chain.id,
    verifyingContract: funded.token,
  };
  const matches =
    separator !== undefined &&
    name !== undefined &&
    hashDomain({
      domain: { ...domain, chainId: BigInt(domain.chainId) },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    }) === separator;
  if (!matches) {
    throw new CliError(
      `${funded.request.label} does not support EIP-2612 permit (no DOMAIN_SEPARATOR matching its ` +
        "name, version and address): fund it with --fund-mode permit2, allowance or transfer",
    );
  }

  return domain;
}

const literal = (value: bigint): string => `${value}n`;
const word = (value: bigint): string => `0x${value.toString(16)}n`;

/**
 * The funding a run with `--fund` needs: balances checked, approvals asked for and sent, signatures
 * made, and the wrapper that pulls, runs and sweeps.
 */
export async function planFunding(input: FundingInput): Promise<Funding> {
  const { tokens, native, notes } = await amounts(input);
  const needs: string[] = [];
  const beforeCook: BeforeCook[] = [];
  const sent: Array<{ what: string; sent: Sent }> = [];
  const pulls: string[] = [];
  const imports = new Set<string>();
  const owner = input.owner;

  // With no key (a simulation), a shortfall is what `run` would refuse, said rather than refused:
  // the rehearsal does not spend the owner's balance.
  const keyless = input.account === undefined;
  const short = (message: string): void => {
    if (!keyless) throw new CliError(message);
    notes.push(`${message}: sauce run would refuse it`);
  };
  for (const funded of tokens) {
    const balance = await read(`${funded.request.label}'s balanceOf`, () =>
      input.client.readContract({
        address: funded.token,
        abi: ERC20,
        functionName: "balanceOf",
        args: [owner],
      }),
    );
    if (balance < funded.amount) {
      short(
        `${owner} holds ${balance} of ${funded.request.label} (base units), below the ` +
          `${funded.amount} --fund ${funded.request.raw} needs`,
      );
    }
  }
  if (native > 0n) {
    const balance = await input.client.getBalance({ address: owner });
    if (balance < native) {
      short(`${owner} holds ${balance} wei, below the ${native} --fund sends with the cook`);
    }
  }
  if (keyless && tokens.length > 0) {
    // A simulation with no key cannot sign the pulls. It credits the Pot with what they would
    // bring instead (state overrides, `simulateCommand`), and keeps the sweep.
    notes.push(
      `--fund without a key: pulling ${tokens.map((t) => t.request.label).join(", ")} needs the ` +
        "owner's signature (--keystore or --private-key), so the pulls are not rehearsed; the Pot " +
        "is credited what they would bring, for this rehearsal only",
    );
    const sweeps = input.sweep ? sweepLines(tokens, native, owner, imports) : [];

    return {
      wrap: (text) => (sweeps.length === 0 ? text : wrapProgram(text, imports, [], sweeps)),
      value: native,
      sent,
      notes,
      credit: tokens.map((funded) => ({
        token: funded.token,
        label: funded.request.label,
        amount: funded.amount,
      })),
    };
  }
  const latest = await read("the latest block", () => input.client.getBlock());
  const deadline = input.deadline ?? latest.timestamp + 600n;

  if (input.mode === "permit2") {
    const permit2 = permit2On(input.chain);
    for (const funded of tokens) {
      const allowed = await read(`${funded.request.label}'s allowance to Permit2`, () =>
        input.client.readContract({
          address: funded.token,
          abi: ERC20,
          functionName: "allowance",
          args: [owner, permit2],
        }),
      );
      if (allowed < funded.amount) {
        if (!input.send) {
          const what = `approve Permit2 for ${funded.request.label}`;
          needs.push(what);
          beforeCook.push(...approvalsBefore(funded, permit2, maxUint256, allowed, what));
          notes.push(
            `${funded.request.label}: Permit2 (${permit2}) may not move your tokens yet: sauce run ` +
              "asks to approve it first (--auto-approve approves it), and the rehearsal runs that " +
              "approval before the cook",
          );
        } else {
          await agreed(
            input,
            `approve Permit2 for ${funded.request.label}`,
            `Permit2 (${permit2}) may move ${allowed} of your ${funded.request.label} (base units), ` +
              `and this run needs ${funded.amount}. Approve Permit2 for ${funded.request.label} now?`,
            `${funded.request.label} is not approved to Permit2: approve it`,
          );
          sent.push(...(await forceApprove(input, funded, permit2, maxUint256, allowed)));
          notes.push(
            `approved Permit2 for ${funded.request.label}: a standing approval, as Permit2 is meant to ` +
              "have; each spend still needs your signature, for one amount, to one spender, once",
          );
        }
      }
      const nonce = input.nonce ?? (await freshNonce(input, permit2));
      const signature = await input.account!.signTypedData({
        domain: { name: "Permit2", chainId: input.chain.id, verifyingContract: permit2 },
        types: {
          PermitTransferFrom: [
            { name: "permitted", type: "TokenPermissions" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
          TokenPermissions: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
          ],
        },
        primaryType: "PermitTransferFrom",
        message: {
          permitted: { token: funded.token, amount: funded.amount },
          spender: input.pot,
          nonce,
          deadline,
        },
      });
      imports.add("permitTransferFrom as __sauce_fund_permit2");
      pulls.push(
        `__sauce_fund_permit2(${word(BigInt(funded.token))}, ${word(BigInt(owner))}, ` +
          `${literal(funded.amount)}, ${literal(nonce)}, ${literal(deadline)}, ` +
          `hex\`${signature.slice(2)}\`, ${word(BigInt(permit2))});`,
      );
    }
  } else if (input.mode === "permit") {
    for (const funded of tokens) {
      const domain = await permitDomain(input, funded);
      const nonce = await read(`${funded.request.label}'s nonces`, () =>
        input.client.readContract({
          address: funded.token,
          abi: ERC20,
          functionName: "nonces",
          args: [owner],
        }),
      );
      const signature = await input.account!.signTypedData({
        domain,
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: { owner, spender: input.pot, value: funded.amount, nonce, deadline },
      });
      const { r, s, v, yParity } = parseSignature(signature);
      imports.add("permit as __sauce_fund_permit");
      imports.add("transferFrom as __sauce_fund_pull");
      pulls.push(
        `__sauce_fund_permit(${word(BigInt(funded.token))}, ${word(BigInt(owner))}, ctx.self(), ` +
          `${literal(funded.amount)}, ${literal(deadline)}, ${literal(v ?? BigInt(27 + (yParity ?? 0)))}, ` +
          `${word(BigInt(r))}, ${word(BigInt(s))});`,
        `__sauce_fund_pull(${word(BigInt(funded.token))}, ${word(BigInt(owner))}, ctx.self(), ${literal(funded.amount)});`,
      );
    }
  } else if (input.mode === "allowance") {
    for (const funded of tokens) {
      const allowed = await read(`${funded.request.label}'s allowance to the Pot`, () =>
        input.client.readContract({
          address: funded.token,
          abi: ERC20,
          functionName: "allowance",
          args: [owner, input.pot],
        }),
      );
      if (allowed < funded.amount) {
        if (!input.send) {
          const what = `approve the Pot for ${funded.amount} ${funded.request.label}`;
          needs.push(what);
          beforeCook.push(...approvalsBefore(funded, input.pot, funded.amount, allowed, what));
          notes.push(
            `${funded.request.label}: the Pot may not pull it yet: sauce run asks to approve it ` +
              "first (--auto-approve approves it), and the rehearsal runs that approval before the " +
              "cook",
          );
        } else {
          await agreed(
            input,
            `approve the Pot for ${funded.amount} ${funded.request.label}`,
            `The Pot ${input.pot} may pull ${allowed} of your ${funded.request.label} (base units), ` +
              `and this run needs ${funded.amount}. Approve the Pot for ${funded.amount}?`,
            `${funded.request.label} is not approved to the Pot: approve it`,
          );
          sent.push(...(await forceApprove(input, funded, input.pot, funded.amount, allowed)));
          notes.push(
            `warning: the Pot's allowance over your ${funded.request.label} was set in a ` +
              "transaction of its own, and stands until a cook spends it — for good if this one " +
              "does not. --fund-mode permit2 (the default) gives the Pot no allowance at all.",
          );
        }
      } else {
        notes.push(
          `warning: the Pot holds a standing allowance of ${allowed} over your ` +
            `${funded.request.label} (base units); this cook spends ${funded.amount} of it and the ` +
            "rest stands. --fund-mode permit2 (the default) gives the Pot no allowance at all.",
        );
      }
      imports.add("transferFrom as __sauce_fund_pull");
      pulls.push(
        `__sauce_fund_pull(${word(BigInt(funded.token))}, ${word(BigInt(owner))}, ctx.self(), ${literal(funded.amount)});`,
      );
    }
  } else {
    for (const funded of tokens) {
      const data = encodeFunctionData({
        abi: ERC20,
        functionName: "transfer",
        args: [input.pot, funded.amount],
      });
      if (!input.send) {
        beforeCook.push({
          what: `transfer ${funded.amount} ${funded.request.label} to the Pot`,
          tx: { to: funded.token, data, value: 0n },
        });
        notes.push(
          `${funded.request.label}: sauce run transfers it to the Pot first, and the rehearsal ` +
            "runs that transfer before the cook",
        );
        continue;
      }
      const answer = await read(`a rehearsal of ${funded.request.label}.transfer`, () =>
        input.client.call({ account: owner, to: funded.token, data }),
      );
      refuseFalse(funded.request.label, "transfer", answer.data);
      const result = await sendAndWait(input.client, input.rpcUrl, input.account!, {
        to: funded.token,
        data,
        value: 0n,
      });
      if (result.status !== "success") {
        throw new CliError(
          `transferring ${funded.request.label} to the Pot reverted in ${result.hash}`,
        );
      }
      sent.push({
        what: `transfer ${funded.amount} ${funded.request.label} to the Pot`,
        sent: result,
      });
    }
  }

  const sweeps = input.sweep ? sweepLines(tokens, native, owner, imports) : [];

  return {
    wrap: (text) =>
      pulls.length === 0 && sweeps.length === 0 ? text : wrapProgram(text, imports, pulls, sweeps),
    value: native,
    sent,
    notes,
    needs,
    ...(beforeCook.length === 0 ? {} : { beforeCook }),
    signed: tokens.length > 0 && (input.mode === "permit2" || input.mode === "permit"),
  };
}

/** `--sweep`: the lines that send the Pot's whole balance of each funded token (and of the native
 *  currency, when it is funded) back to the owner, with the imports they need. */
function sweepLines(
  tokens: readonly Funded[],
  native: bigint,
  owner: Address,
  imports: Set<string>,
): string[] {
  const sweeps: string[] = [];
  imports.add("balanceOf as __sauce_fund_balance");
  imports.add("transfer as __sauce_fund_push");
  tokens.forEach((funded, index) => {
    sweeps.push(
      `const __sauce_left${index} = __sauce_fund_balance(${word(BigInt(funded.token))}, ctx.self());`,
      `if (__sauce_left${index} > 0n) {`,
      `  __sauce_fund_push(${word(BigInt(funded.token))}, ${word(BigInt(owner))}, __sauce_left${index});`,
      "}",
    );
  });
  if (native > 0n) {
    sweeps.push(
      "if (ctx.selfBalance() > 0n) {",
      `  evm.call(${word(BigInt(owner))}, ctx.selfBalance(), hex\`\`);`,
      "}",
    );
  }

  return sweeps;
}

/**
 * The file's program inside the funding wrapper. A module's `main` is renamed `__sauce_program`
 * and called, with `main`'s own parameters, from a new `main` that pulls before it and sweeps
 * after it. A script's entry is its top-level statements, so the pulls go after its imports and
 * before its first statement, and the sweeps after its last. The wrapper is the file's own source
 * with a few lines around it, not an import of the file: the chain's names and the token syntax
 * are rewritten in the source compiled, and an imported module would get none of that.
 */
export function wrapProgram(
  text: string,
  imports: ReadonlySet<string>,
  pulls: readonly string[],
  sweeps: readonly string[],
): string {
  const head =
    imports.size === 0 ? [] : [`import { ${[...imports].join(", ")} } from "@sauce/token";`];
  const signature = mainSignature(text);
  if (signature === undefined) {
    // A script's imports lead it (the compiler takes no import after other code).
    let end = 0;
    for (const node of (parseSauce(text) as unknown as { body: AstNode[] }).body) {
      if (node.type !== "ImportDeclaration") break;
      end = node.end;
    }

    return [
      ...head,
      ...(end === 0 ? [] : [text.slice(0, end)]),
      ...pulls,
      text
        .slice(end)
        .replace(/^\r?\n/, "")
        .trimEnd(),
      ...sweeps,
      "",
    ].join("\n");
  }
  const { open, close, params, returns, names, returnsValue } = signature;
  const nameAt = blankLiterals(text).lastIndexOf("main", open);
  // A helper with no return annotation must return a value, where `main` need not: one that
  // returns nothing is declared `: void` once it is not `main`.
  const renamed =
    `${text.slice(0, nameAt)}__sauce_program${text.slice(nameAt + "main".length, close + 1)}` +
    `${returns.trim() === "" && !returnsValue ? ": void" : ""}${text.slice(close + 1)}`;
  // The wrapper's `main` takes exactly what the program's did, and returns what it returned.
  const call = `__sauce_program(${names.join(", ")})`;

  return [
    ...head,
    renamed,
    "",
    `function main(${params})${returns} {`,
    ...pulls.map((line) => `  ${line}`),
    returnsValue ? `  const __sauce_result = ${call};` : `  ${call};`,
    ...sweeps.map((line) => `  ${line}`),
    ...(returnsValue ? ["  return __sauce_result;"] : []),
    "}",
    "",
  ].join("\n");
}
