/**
 * E4.2's per-protocol deposit-template registry — the heart of the universal deposit/stake/wrap
 * adapter. See `sdk/src/deposit/index.ts` for the module overview, which protocols were included
 * vs skipped and why, and the native-vs-ERC20 design note.
 *
 * Every ABI-backed template's `signature` is transcribed from the vendored `abis.ts` as-const array
 * named in its `source` field; `sdk/test/deposit.test.ts`'s "registry drift" suite re-derives that
 * signature from the ABI itself and fails if the two ever disagree.
 */
import { toExactBigInt } from "../numeric.js";
import { formatAddressField, formatBigint } from "./format.js";
import type { AmountInput, DepositTemplate, ExtraFieldSpec, NormalizedDeposit } from "./types.js";

function uintExtra(bits: number, defaultValue = 0n): ExtraFieldSpec {
  const max = 2n ** BigInt(bits);
  return {
    defaultValue,
    normalize(value: AmountInput, fieldName: string): bigint {
      const v = typeof value === "number" ? toExactBigInt(value, fieldName) : BigInt(value);
      if (v < 0n || v >= max) {
        throw new Error(`${fieldName}: expected a uint${bits} (0 <= x < ${max}), got ${v}`);
      }
      return v;
    },
  };
}

function addressExtra(defaultValue = 0n): ExtraFieldSpec {
  return {
    defaultValue,
    normalize(value: AmountInput, fieldName: string): bigint {
      if (typeof value === "bigint") return value;
      if (typeof value === "number")
        throw new Error(`${fieldName}: expected an address, got a number`);
      return BigInt(value);
    },
  };
}

function tokenLiteral(d: NormalizedDeposit): string {
  if (d.token === null) throw new Error("deposit template: token is required but was not resolved");
  return formatBigint(d.token);
}

function beneficiaryLiteral(d: NormalizedDeposit): string {
  if (d.beneficiary === null) {
    throw new Error("deposit template: beneficiary is required but was not resolved");
  }
  return formatAddressField(d.beneficiary);
}

/** WETH9's two well-known selectors — there is no vendored SDK ABI for WETH; see the module doc's
 *  `skippedProtocols` note for the full audit establishing that and why these constants are used
 *  instead of inventing a tracked artifact. Pinned against `toFunctionSelector` in `deposit.test.ts`. */
const WETH_DEPOSIT_SELECTOR: readonly number[] = [0xd0, 0xe3, 0x0d, 0xb0]; // deposit()
const WETH_WITHDRAW_SELECTOR: readonly number[] = [0x2e, 0x1a, 0x7d, 0x4d]; // withdraw(uint256)
const LIDO_SUBMIT_SELECTOR: readonly number[] = [0xa1, 0x90, 0x3e, 0xab]; // submit(address)

function bytesLiteral(bytes: readonly number[]): string {
  return `hex\`${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}\``;
}

/**
 * A selector const plus the calldata expression that reads it. The selector is BOUND rather than
 * used inline because a method call directly on a `hex` literal (`hex\`…\`.concat(…)`) is outside
 * the compiler's supported subset. `varSuffix` is the emitting spec's own index, so two deposits of
 * the SAME kind in one program declare two distinct consts instead of colliding on one name.
 */
function calldataLines(
  base: string,
  varSuffix: string,
  selector: readonly number[],
  wordExpr: string | undefined,
): { decl: string; expr: string } {
  const name = `${base}${varSuffix}`;
  const decl = `const ${name} = ${bytesLiteral(selector)};`;

  return { decl, expr: wordExpr === undefined ? name : `${name}.concat(abi.encode(${wordExpr}))` };
}

export type DepositKey =
  | "weth:wrap"
  | "weth:unwrap"
  | "aave-v3:supply"
  | "aave-v3:withdraw"
  | "spark:supply"
  | "spark:withdraw"
  | "compound-v3:supply"
  | "euler-v2:deposit"
  | "erc4626:deposit"
  | "lido:stake"
  | "lido:wrap";

function aavePoolSupplyTemplate(
  protocol: "aave-v3" | "spark",
  exportName: string,
): DepositTemplate {
  const binding = protocol === "aave-v3" ? "IAavePool" : "ISparkPool";
  return {
    protocol,
    action: "supply",
    source: { module: `protocols/${protocol}/abis.ts`, exportName },
    signature: "supply(address,uint256,address,uint16)",
    selector: "0x617ba037",
    funding: "erc20-approve",
    beneficiary: "supported",
    allowsMaxAmount: false,
    imports: [`import { ${binding} } from "./protocols/${protocol}/${exportName}.json";`],
    binding,
    extras: { referralCode: uintExtra(16, 0n) },
    emit(d, amountExpr) {
      const referral = formatBigint(d.extra.referralCode ?? 0n);
      return [
        `${binding}.at(${formatBigint(d.target)}).supply(${tokenLiteral(d)}, ${amountExpr}, ${beneficiaryLiteral(d)}, ${referral});`,
      ];
    },
  };
}

function aavePoolWithdrawTemplate(
  protocol: "aave-v3" | "spark",
  exportName: string,
): DepositTemplate {
  const binding = protocol === "aave-v3" ? "IAavePool" : "ISparkPool";
  return {
    protocol,
    action: "withdraw",
    source: { module: `protocols/${protocol}/abis.ts`, exportName },
    signature: "withdraw(address,uint256,address)",
    selector: "0x69328dec",
    funding: "none",
    beneficiary: "supported",
    allowsMaxAmount: true,
    imports: [`import { ${binding} } from "./protocols/${protocol}/${exportName}.json";`],
    binding,
    extras: {},
    emit(d, amountExpr) {
      return [
        `${binding}.at(${formatBigint(d.target)}).withdraw(${tokenLiteral(d)}, ${amountExpr}, ${beneficiaryLiteral(d)});`,
      ];
    },
  };
}

export const DEPOSIT_TEMPLATES: Readonly<Record<DepositKey, DepositTemplate>> = {
  "aave-v3:supply": aavePoolSupplyTemplate("aave-v3", "PoolABI"),
  "aave-v3:withdraw": aavePoolWithdrawTemplate("aave-v3", "PoolABI"),
  "spark:supply": aavePoolSupplyTemplate("spark", "SparkPoolABI"),
  "spark:withdraw": aavePoolWithdrawTemplate("spark", "SparkPoolABI"),

  "compound-v3:supply": {
    protocol: "compound-v3",
    action: "supply",
    source: { module: "protocols/compound-v3/abis.ts", exportName: "CometABI" },
    signature: "supplyTo(address,address,uint256)",
    selector: "0x4232cd63",
    funding: "erc20-approve",
    beneficiary: "supported",
    allowsMaxAmount: false,
    imports: [`import { IComet } from "./protocols/compound-v3/CometABI.json";`],
    binding: "IComet",
    extras: {},
    emit(d, amountExpr) {
      return [
        `IComet.at(${formatBigint(d.target)}).supplyTo(${beneficiaryLiteral(d)}, ${tokenLiteral(d)}, ${amountExpr});`,
      ];
    },
  },

  "euler-v2:deposit": {
    protocol: "euler-v2",
    action: "deposit",
    source: { module: "protocols/euler-v2/abis.ts", exportName: "EVaultABI" },
    signature: "deposit(uint256,address)",
    selector: "0x6e553f65",
    funding: "erc20-approve",
    beneficiary: "supported",
    allowsMaxAmount: false,
    imports: [`import { IEVault } from "./protocols/euler-v2/EVaultABI.json";`],
    binding: "IEVault",
    extras: {},
    emit(d, amountExpr) {
      return [
        `IEVault.at(${formatBigint(d.target)}).deposit(${amountExpr}, ${beneficiaryLiteral(d)});`,
      ];
    },
  },

  "erc4626:deposit": {
    protocol: "erc4626",
    action: "deposit",
    source: { module: "protocols/erc4626/abis.ts", exportName: "VaultABI" },
    signature: "deposit(uint256,address)",
    selector: "0x6e553f65",
    funding: "erc20-approve",
    beneficiary: "supported",
    allowsMaxAmount: false,
    imports: [`import { IERC4626Vault } from "./protocols/erc4626/VaultABI.json";`],
    binding: "IERC4626Vault",
    extras: {},
    emit(d, amountExpr) {
      return [
        `IERC4626Vault.at(${formatBigint(d.target)}).deposit(${amountExpr}, ${beneficiaryLiteral(d)});`,
      ];
    },
  },

  "lido:wrap": {
    protocol: "lido",
    action: "wrap",
    source: { module: "protocols/lido/abis.ts", exportName: "WstETHABI" },
    signature: "wrap(uint256)",
    selector: "0xea598cb0",
    funding: "erc20-approve",
    beneficiary: "unsupported",
    allowsMaxAmount: false,
    imports: [`import { IWstETH } from "./protocols/lido/WstETHABI.json";`],
    binding: "IWstETH",
    extras: {},
    emit(d, amountExpr) {
      return [`IWstETH.at(${formatBigint(d.target)}).wrap(${amountExpr});`];
    },
  },

  "lido:stake": {
    protocol: "lido",
    action: "stake",
    source: { module: "protocols/lido/abis.ts", exportName: "LidoABI" },
    signature: "submit(address)",
    selector: "0xa1903eab",
    funding: "native-value",
    beneficiary: "unsupported",
    allowsMaxAmount: false,
    imports: [],
    binding: null,
    extras: { referral: addressExtra(0n) },
    emit(d, amountExpr, varSuffix) {
      const referral = d.extra.referral ?? 0n;
      const { decl, expr } = calldataLines(
        "dSubmit",
        varSuffix,
        LIDO_SUBMIT_SELECTOR,
        formatBigint(referral),
      );
      return [decl, `evm.call(${formatBigint(d.target)}, ${amountExpr}, ${expr});`];
    },
  },

  "weth:wrap": {
    protocol: "weth",
    action: "wrap",
    source: null,
    signature: "deposit()",
    selector: "0xd0e30db0",
    funding: "native-value",
    beneficiary: "unsupported",
    allowsMaxAmount: false,
    imports: [],
    binding: null,
    extras: {},
    emit(d, amountExpr, varSuffix) {
      const { decl, expr } = calldataLines("dWrap", varSuffix, WETH_DEPOSIT_SELECTOR, undefined);
      return [decl, `evm.call(${formatBigint(d.target)}, ${amountExpr}, ${expr});`];
    },
  },

  "weth:unwrap": {
    protocol: "weth",
    action: "unwrap",
    source: null,
    signature: "withdraw(uint256)",
    selector: "0x2e1a7d4d",
    funding: "none",
    beneficiary: "unsupported",
    allowsMaxAmount: false,
    imports: [],
    binding: null,
    extras: {},
    emit(d, amountExpr, varSuffix) {
      const { decl, expr } = calldataLines(
        "dUnwrap",
        varSuffix,
        WETH_WITHDRAW_SELECTOR,
        amountExpr,
      );
      return [decl, `evm.call(${formatBigint(d.target)}, 0n, ${expr});`];
    },
  },
};

/** Looks up a template by `protocol:action`, throwing (and listing every registered key) rather
 *  than letting a caller emit a program that would misbehave on-chain. */
export function depositTemplateFor(protocol: string, action: string): DepositTemplate {
  const key = `${protocol}:${action}` as DepositKey;
  const template = DEPOSIT_TEMPLATES[key];
  if (!template) {
    const known = Object.keys(DEPOSIT_TEMPLATES).sort().join(", ");
    throw new Error(
      `depositTemplateFor: no deposit template registered for "${key}". Known: ${known}`,
    );
  }
  return template;
}

export function listDepositTemplates(): readonly DepositTemplate[] {
  return Object.values(DEPOSIT_TEMPLATES);
}
