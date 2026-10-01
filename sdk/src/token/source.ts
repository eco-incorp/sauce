/**
 * SauceScript SOURCE emission for the universal token interface — pure string templating, no
 * compiler import (matches `swap/source.ts`/`deposit/source.ts`'s posture: every compile option
 * stays explicit at the call site). The `IERC20` ABI an EVM program imports is served by the route
 * compiler itself (`embedded/resolve.ts`), so compiling one needs no resolver option.
 */
import {
  evmApproveStatements,
  evmBalanceExpression,
  evmTransferStatements,
  ERC20_IMPORT_LINE,
} from "./evm.js";
import {
  accountRefsForApprove,
  accountRefsForTransfer,
  newSvmEmitState,
  svmAccountParamList,
  svmApproveLines,
  svmBalanceExpression,
  svmTransferLines,
  type SvmEmitState,
} from "./svm.js";
import {
  assertNoDuplicateSvmRefs,
  isEvmTarget,
  validateApproveSpec,
  validateBalanceSpec,
  validateTransferSpec,
} from "./params.js";
import type { TokenSpec, TokenTarget } from "./types.js";

function validateSpec(spec: TokenSpec, target: TokenTarget): void {
  if (spec.op === "transfer") validateTransferSpec(spec, target);
  else if (spec.op === "approve") validateApproveSpec(spec, target);
  else validateBalanceSpec(spec, target);
}

/** The import lines a `tokenSource(specs, target)` program needs. On an EVM target: `IERC20`, iff
 *  any spec is `transfer`/`approve`/`balanceOf` (always — every op needs the binding). On `svm`:
 *  none (SVM ops use only the built-in `svm.sload`/`svm.call` globals). */
export function tokenImportLines(
  specs: readonly TokenSpec[],
  target: TokenTarget,
): readonly string[] {
  if (!isEvmTarget(target)) return [];
  return specs.length > 0 ? [ERC20_IMPORT_LINE] : [];
}

/** One statement (transfer/approve) or `undefined` (balanceOf has no statement form — see
 *  {@link tokenExpression}) for `spec` on `target`, for splicing into a larger, hand-written
 *  program. Runs the full per-op/per-target validation. `svmState` threads dedup across multiple
 *  ops in one program (`tokenSource`'s own concern) — omit it to get a fresh, single-op program. */
export function tokenCallStatement(
  spec: TokenSpec,
  target: TokenTarget,
  index = 0,
  svmState?: SvmEmitState,
): string {
  validateSpec(spec, target);
  const state = svmState ?? newSvmEmitState();

  if (spec.op === "balanceOf") {
    throw new Error(
      "tokenCallStatement: Token.balanceOf has no statement form — use tokenExpression instead",
    );
  }
  if (isEvmTarget(target)) {
    const prefix = `t${index}_`;
    return (
      spec.op === "transfer"
        ? evmTransferStatements(spec, prefix)
        : evmApproveStatements(spec, prefix)
    ).join("\n");
  }
  const lines =
    spec.op === "transfer"
      ? svmTransferLines(spec, index, state)
      : svmApproveLines(spec, index, state);
  return lines.join("\n");
}

/** The expression form of `Token.balanceOf(spec)` — the only op with one. Throws (named) for
 *  `transfer`/`approve`, which have no meaningful expression form. */
export function tokenExpression(spec: TokenSpec, target: TokenTarget): string {
  if (spec.op !== "balanceOf") {
    throw new Error(
      `tokenExpression: Token.${spec.op} has no expression form — use tokenCallStatement instead`,
    );
  }
  validateSpec(spec, target);
  return isEvmTarget(target) ? evmBalanceExpression(spec) : svmBalanceExpression(spec);
}

/** The account-manifest refs a `transfer`/`approve` spec attaches, in order — mirrors
 *  `svmSettleRefs`. Throws for `balanceOf` (a pure read; its only ref is the caller-supplied
 *  `source`) and for an EVM-target spec (no account manifest on that target). */
export function tokenAccountRefs(spec: TokenSpec, target: TokenTarget): readonly string[] {
  if (isEvmTarget(target)) {
    throw new Error(`tokenAccountRefs: no account manifest on an EVM target`);
  }
  if (spec.op === "balanceOf") return [spec.svm!.source];
  const refs = spec.svm!;
  return spec.op === "transfer" ? accountRefsForTransfer(refs) : accountRefsForApprove(refs);
}

export interface TokenSourceOptions {
  /** Defaults to `"main"`. */
  functionName?: string;
  /** Extra import lines spliced in verbatim, ahead of the generated `main`/`functionName` body. */
  imports?: readonly string[];
}

/**
 * A complete, compilable `function main() { ... }` program: one statement per `transfer`/`approve`
 * spec (in order), plus, if the LAST spec is a `balanceOf`, a trailing `return <expr>;` — because
 * `Token.program`'s only consumer (`V12Pot.cook`) executes the one program it is handed and wants
 * its result, if any, as the return value. A `balanceOf` in any OTHER position is spliced as a discarded
 * expression statement.
 */
export function tokenSource(
  spec: TokenSpec | readonly TokenSpec[],
  target: TokenTarget,
  opts: TokenSourceOptions = {},
): string {
  const specs = Array.isArray(spec) ? spec : [spec as TokenSpec];
  if (specs.length === 0) throw new Error("tokenSource: at least one token spec is required");
  specs.forEach((s) => validateSpec(s, target));
  if (!isEvmTarget(target)) assertNoDuplicateSvmRefs(specs);

  const importLines = [...tokenImportLines(specs, target), ...(opts.imports ?? [])];
  const state = newSvmEmitState();

  const bodyLines = specs.flatMap((s, i) => {
    const isLast = i === specs.length - 1;
    if (s.op === "balanceOf") {
      const expr = tokenExpression(s, target);
      return [isLast ? `return ${expr};` : `${expr};`];
    }
    return [tokenCallStatement(s, target, i, state)];
  });

  const fnName = opts.functionName ?? "main";
  const body = bodyLines
    .map((line) =>
      line
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    )
    .join("\n");

  // Every SVM account is a main() param, in attach order — that declaration IS the manifest.
  const params = isEvmTarget(target) ? "" : svmAccountParamList(specs);
  // SVM consumers compile directly to retain the account manifest. EVM source leaves `main`
  // unannotated: it is compiled through the route compiler, whose adapter supplies the `void`.
  const returnType =
    !isEvmTarget(target) && specs[specs.length - 1]!.op !== "balanceOf" ? ": void" : "";
  const parts = [...importLines, "", `function ${fnName}(${params})${returnType} {`, body, "}", ""];
  return parts.join("\n");
}
