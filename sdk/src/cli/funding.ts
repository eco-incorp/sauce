/**
 * `sauce run --fund`: getting the tokens a program spends into its Pot in the same transaction, so
 * the program itself needs no funding code.
 *
 * The CLI composes a WRAPPER around the file: the file's own `main` is renamed and called from a new
 * `main` with the same signature, which first PULLS each funded token from the owner into the Pot,
 * then runs the program, then — with `--sweep` — sends the Pot's whole balance of each funded token
 * back to the owner. One cook. The pulls are `@sauce/token`'s, the functions a hand-written program
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
import { blankLiterals } from "../routes/rs-compile.js";
import { wrapSauceBody } from "../routes/sauce-route.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";
import { CliError, UsageError } from "./args.js";
import { sendAndWait, type Sent } from "./chain.js";
import type { Confirm } from "./commands.js";

export const FUND_MODES = ["permit2", "permit", "allowance", "transfer"] as const;
export type FundMode = (typeof FUND_MODES)[number];

/** One `--fund`, as given: the chain's native currency or a token, and an amount. */
export interface FundRequest {
  readonly raw: string;
  /** `undefined` for the native currency. */
  readonly token?: Address;
  /** What to call it in messages: the symbol given, or the address. */
  readonly label: string;
  /** Registry decimals for a symbol; `undefined` for an address, read from the token. */
  readonly decimals?: number;
  /** The amount in base units (`…n`), or as written, in whole units. */
  readonly amount: { readonly base: bigint } | { readonly units: string };
}

const NATIVE = /^(eth|native)$/i;

/**
 * `--fund <TOKEN|address>:<amount>`. The amount is in whole units — `USDC:1.5` is 1.5 USDC, by the
 * registry's decimals (or the token's own, for an address) — or, ending in `n`, in base units, as a
 * SauceScript integer is written: `USDC:1500000n`. `ETH:<amount>` (or `native:`) is the chain's
 * native currency, 18 decimals.
 */
export function parseFund(raw: string, chain: CanonicalChain): FundRequest {
  const at = raw.lastIndexOf(":");
  const what = raw.slice(0, at).trim();
  const amount = raw.slice(at + 1).trim();
  if (at <= 0 || amount === "") {
    throw new UsageError(
      `--fund: expected <TOKEN|address>:<amount>, as USDC:1.5 or USDC:1500000n; got '${raw}'`,
    );
  }
  const parsed = /^\d+n$/.test(amount)
    ? { base: BigInt(amount.slice(0, -1)) }
    : /^\d+(\.\d+)?$/.test(amount)
      ? { units: amount }
      : undefined;
  if (parsed === undefined) {
    throw new UsageError(
      `--fund ${raw}: '${amount}' is not an amount — whole units (1.5) or base units ending in n ` +
        "(1500000n)",
    );
  }
  if (NATIVE.test(what)) return { raw, label: what.toUpperCase(), decimals: 18, amount: parsed };
  if (isAddress(what, { strict: false })) {
    return { raw, token: getAddress(what), label: getAddress(what), amount: parsed };
  }
  const row = (chain.kind === "evm" ? (TOKEN_REGISTRY[chain.id] ?? []) : []).find(
    (entry) => entry.symbol === what.toUpperCase(),
  );
  if (row === undefined) {
    throw new UsageError(
      `--fund ${raw}: ${what} is not a token ${chain.slug} registers` +
        ` (sauce globals --chain ${chain.slug} --tokens lists them); give its address instead`,
    );
  }

  return {
    raw,
    token: getAddress(row.address),
    label: row.symbol,
    decimals: row.decimals,
    amount: parsed,
  };
}

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
  /** Who signs and sends; absent for a simulation with no key, which then skips the funding. */
  readonly account?: PrivateKeyAccount;
  /** Permit2's nonce and the signatures' deadline (unix seconds): fresh and ten minutes out when
   *  not given. */
  readonly nonce?: bigint;
  readonly deadline?: bigint;
  /** May the run approve and transfer before the cook (`run`), or only report (`simulate`)? */
  readonly send: boolean;
  readonly yes: boolean;
  readonly confirm: Confirm;
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

/** Every request's amount in base units, a token's decimals read from it when not registered. */
async function amounts(input: FundingInput): Promise<{ tokens: Funded[]; native: bigint }> {
  const tokens: Funded[] = [];
  let native = 0n;
  for (const request of input.requests) {
    let decimals = request.decimals;
    if (decimals === undefined && "units" in request.amount) {
      decimals = Number(
        await read(`${request.label}'s decimals()`, () =>
          input.client.readContract({
            address: request.token!,
            abi: ERC20,
            functionName: "decimals",
          }),
        ),
      );
    }
    const amount =
      "base" in request.amount ? request.amount.base : parseUnits(request.amount.units, decimals!);
    if (request.token === undefined) native += amount;
    else tokens.push({ request, token: request.token, amount });
  }

  return { tokens, native };
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
async function agreed(input: FundingInput, question: string, refused: string): Promise<void> {
  const answer = input.yes ? true : await input.confirm(`${question} [y/N] `);
  if (answer === true) return;
  throw new CliError(
    answer === undefined
      ? `${refused}, or pass --yes to let the run do it`
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
    sent.push({ what: `approve ${funded.request.label} to ${spender}`, sent: result });
  };
  if (current > 0n) await approve(0n);
  await approve(amount);

  return sent;
}

const encodeApprove = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, amount] });

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
  const { tokens, native } = await amounts(input);
  const notes: string[] = [];
  const sent: Array<{ what: string; sent: Sent }> = [];
  const pulls: string[] = [];
  const imports = new Set<string>();
  const owner = input.owner;

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
      throw new CliError(
        `${owner} holds ${balance} of ${funded.request.label} (base units), below the ` +
          `${funded.amount} --fund ${funded.request.raw} needs`,
      );
    }
  }
  if (native > 0n) {
    const balance = await input.client.getBalance({ address: owner });
    if (balance < native) {
      throw new CliError(
        `${owner} holds ${balance} wei, below the ${native} --fund sends with the cook`,
      );
    }
  }
  if (input.account === undefined && tokens.length > 0) {
    // A simulation with no key: it cannot sign the pull, so it rehearses the program on the Pot as
    // it stands.
    notes.push(
      `funding skipped: pulling ${tokens.map((t) => t.request.label).join(", ")} needs the owner's ` +
        "signature (--keystore or --private-key); the rehearsal runs on the Pot as it is",
    );

    return { wrap: (text) => text, value: native, sent, notes };
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
          notes.push(
            `${funded.request.label}: Permit2 (${permit2}) may not move your tokens yet; sauce run ` +
              "would ask to approve it",
          );
        } else {
          await agreed(
            input,
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
          notes.push(
            `${funded.request.label}: the Pot may not pull it yet; sauce run would ask to approve it`,
          );
        } else {
          await agreed(
            input,
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
      if (!input.send) {
        notes.push(`${funded.request.label}: sauce run would transfer it to the Pot first`);
        continue;
      }
      const data = encodeFunctionData({
        abi: ERC20,
        functionName: "transfer",
        args: [input.pot, funded.amount],
      });
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

  const sweeps: string[] = [];
  if (input.sweep) {
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
  }

  return {
    wrap: (text) =>
      pulls.length === 0 && sweeps.length === 0 ? text : wrapProgram(text, imports, pulls, sweeps),
    value: native,
    sent,
    notes,
  };
}

/**
 * The file's program inside the funding wrapper: its `main` renamed `__sauce_program` and called,
 * with `main`'s own parameters, from a new `main` that pulls before it and sweeps after it. The
 * wrapper is the file's own source with a few lines around it, not an import of the file: the
 * chain's names and the token syntax are rewritten in the source compiled, and an imported module
 * would get none of that.
 */
export function wrapProgram(
  text: string,
  imports: ReadonlySet<string>,
  pulls: readonly string[],
  sweeps: readonly string[],
): string {
  const program = wrapSauceBody(text);
  const signature = mainSignature(program);
  if (signature === undefined) throw new Error("internal: a wrapped program has a main");
  const { open, close, params, returns, names, returnsValue } = signature;
  const nameAt = blankLiterals(program).lastIndexOf("main", open);
  // A helper with no return annotation must return a value, where `main` need not: one that
  // returns nothing is declared `: void` once it is not `main`.
  const renamed =
    `${program.slice(0, nameAt)}__sauce_program${program.slice(nameAt + "main".length, close + 1)}` +
    `${returns.trim() === "" && !returnsValue ? ": void" : ""}${program.slice(close + 1)}`;
  // The wrapper's `main` takes exactly what the program's did, and returns what it returned.
  const call = `__sauce_program(${names.join(", ")})`;

  return [
    ...(imports.size === 0 ? [] : [`import { ${[...imports].join(", ")} } from "@sauce/token";`]),
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
