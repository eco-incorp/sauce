/**
 * Normalization core for E4.2's universal deposit adapter — `toDeposit`. See
 * `sdk/src/deposit/index.ts` for the module overview.
 */
import { chains, getAllChainIds, nativeErc20 } from "../chains/index.js";
import { toExactBigInt } from "../numeric.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";
import { depositTemplateFor } from "./templates.js";
import type {
  AddressInput,
  AmountInput,
  ApprovalPolicy,
  DepositSpec,
  NormalizedDeposit,
} from "./types.js";

function toAddressBigint(value: AddressInput, _label: string): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(value);
}

/**
 * The WETH9 templates are chain-agnostic, so they cannot see which chain they run on, but they can
 * see a target that is certainly not a WETH9. On a chain whose native coin is itself an ERC-20
 * (Arc) there is no canonical wrapped native, and a `deposit()`/`withdraw()` sent to its native ERC-20
 * (`0x3600…0000`) or to a registry token there — `WETH` included, which on Arc is bridged ETH —
 * wraps nothing. Reject those by address instead of emitting the call.
 *
 * Built once from the static chain and token registries: address -> why it is not a WETH9. An
 * address that is such a token on more than one chain (Arc's and Arc Testnet's native USDC share
 * `0x3600…0000`) gives each chain's reason, the lowest chain id first.
 */
const NOT_A_WRAPPER: ReadonlyMap<bigint, string> = (() => {
  const reasons = new Map<bigint, string[]>();
  for (const chainId of getAllChainIds().sort((a, b) => a - b)) {
    const erc20 = nativeErc20(chainId);
    if (erc20 === undefined) continue;
    const { name, nativeCurrency } = chains[chainId]!;
    const why = (what: string) =>
      `${what} on ${name} (chain ${chainId}), which is not a WETH9. ${name} has no canonical ` +
      `wrapped native: its native ${nativeCurrency.symbol} is already the ERC-20 at ` +
      `${erc20.address}, so there is nothing to wrap or unwrap there`;
    const onChain = new Map<bigint, string>();
    for (const row of TOKEN_REGISTRY[chainId] ?? [])
      onChain.set(BigInt(row.address), why(row.symbol));
    // Set last: the native ERC-20 is also a registry row (`USDC`), and this names it better.
    onChain.set(BigInt(erc20.address), why(`the native ${nativeCurrency.symbol} ERC-20`));
    for (const [address, reason] of onChain)
      reasons.set(address, [...(reasons.get(address) ?? []), reason]);
  }
  return new Map([...reasons].map(([address, each]) => [address, each.join("; and ")]));
})();

function rejectNonWrapperTarget(action: string, target: bigint): void {
  const reason = NOT_A_WRAPPER.get(target);
  if (reason !== undefined) throw new Error(`toDeposit: weth:${action} targets ${reason}`);
}

function toBigIntStrict(value: AmountInput, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return toExactBigInt(value, label);
  if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    throw new Error(
      `toDeposit: ${label} ${JSON.stringify(value)} is not an integer, "balance" or "max"`,
    );
  }
  return BigInt(value);
}

/**
 * The whole normalization/defaulting/guard decision: lowers a chain-agnostic {@link DepositSpec}
 * into a fully normalized {@link NormalizedDeposit} — plain bigints (+ the `"pot"` sentinel for a
 * defaulted `beneficiary`), with its resolved {@link DepositTemplate} attached.
 *
 * `spec.amount` may be `"balance" | "max"` — see {@link DepositSourceSpec} — in which case it
 * passes through unresolved (the caller, `depositCallStatement`, decides the actual amount
 * EXPRESSION; this function only validates every OTHER field and, for `"max"`,
 * checks `allowsMaxAmount`).
 *
 * Throws (never emits a program that would misbehave on-chain) for: an unknown `protocol:action`;
 * `token` supplied to a raw-call template or omitted from a typed-ABI template;
 * `beneficiary` supplied to a `beneficiary: "unsupported"` template; `amount: "max"` on a template
 * with `allowsMaxAmount: false`; an unrecognized `extra` field name; an `amount` given as a `number`
 * that is not a safe integer (past 2^53-1 pass a bigint or a string, since the double has already
 * been rounded); a `weth` template whose `target` is known not to be a WETH9 (a chain's native
 * ERC-20, or a registry token on a chain with no canonical wrapped native — Arc); and whatever the field's
 * own `ExtraFieldSpec.normalize` throws for an out-of-range extra value.
 */
export function toDeposit(
  spec: DepositSpec | (Omit<DepositSpec, "amount"> & { amount: "balance" | "max" }),
): NormalizedDeposit {
  const template = depositTemplateFor(spec.protocol, spec.action);

  // A raw-call template (`binding === null`: weth:wrap, weth:unwrap, lido:stake) operates
  // directly on `target` via a hand-built calldata word — there is no separate ERC20 asset
  // address at all, so "token" must be omitted. Every typed-ABI template (`binding !== null`)
  // requires one, regardless of its `funding` (even a "none"-funded typed withdraw like
  // aave-v3:withdraw still names an `asset` argument).
  if (template.binding === null) {
    if (spec.token !== undefined) {
      throw new Error(
        `toDeposit: ${spec.protocol}:${spec.action} has no separate asset parameter, so "token" must be omitted; use "target" for the called contract`,
      );
    }
  } else if (spec.token === undefined) {
    throw new Error(
      `toDeposit: ${spec.protocol}:${spec.action} requires "token" (the asset being approved/supplied/withdrawn)`,
    );
  }

  if (template.beneficiary === "unsupported" && spec.beneficiary !== undefined) {
    throw new Error(
      `toDeposit: ${spec.protocol}:${spec.action} does not support a beneficiary — it always credits msg.sender; passing one would silently be ignored on-chain`,
    );
  }

  const amount: bigint | "balance" | "max" =
    spec.amount === "balance" || spec.amount === "max"
      ? spec.amount
      : toBigIntStrict(spec.amount, "amount");

  if (amount === "max" && !template.allowsMaxAmount) {
    throw new Error(
      `toDeposit: ${spec.protocol}:${spec.action} does not document a uint256-max sentinel — "max" is only accepted where allowsMaxAmount is true`,
    );
  }

  const extraInput = spec.extra ?? {};
  for (const name of Object.keys(extraInput)) {
    if (!(name in template.extras)) {
      const known = Object.keys(template.extras).sort().join(", ") || "(none)";
      throw new Error(
        `toDeposit: ${spec.protocol}:${spec.action} has no extra field "${name}". Known: ${known}`,
      );
    }
  }
  const extra: Record<string, bigint> = {};
  for (const [name, fieldSpec] of Object.entries(template.extras)) {
    const raw = extraInput[name];
    extra[name] =
      raw !== undefined ? fieldSpec.normalize(raw, `extra.${name}`) : fieldSpec.defaultValue;
  }

  const approvalPolicy: ApprovalPolicy = spec.approvalPolicy ?? "exact";
  const target = toAddressBigint(spec.target, "target");
  if (spec.protocol === "weth") rejectNonWrapperTarget(spec.action, target);

  return {
    template,
    target,
    token: template.binding === null ? null : toAddressBigint(spec.token as AddressInput, "token"),
    amount,
    beneficiary:
      template.beneficiary === "unsupported"
        ? null
        : spec.beneficiary !== undefined
          ? toAddressBigint(spec.beneficiary, "beneficiary")
          : "pot",
    approvalPolicy,
    extra,
  };
}
