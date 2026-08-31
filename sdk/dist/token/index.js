/**
 * `@eco-incorp/sauce-sdk`'s `token` module — the universal token interface.
 *
 * One object, `Token`, exposing `transfer`/`approve`/`balanceOf` — lowered to an ERC20 call on an
 * EVM compile target, and to an SPL Token program CPI on `svm`. Installed as a DEFAULT GLOBAL (zero
 * import, `const Token: TokenApi`) by `sdk/src/routes/globals.ts`; this module is also importable
 * directly as `token.Token` (or any of its named exports) for a caller who prefers not to rely on
 * the global.
 *
 * Compiler-free, like `swap/` and `deposit/`: every function here returns SauceScript SOURCE (or a
 * structured EVM `Call`); the caller runs `compile()` with explicit options. See
 * `sdk/src/token/source.ts` for the per-target emission seam and `sdk/src/token/api.ts` for the
 * `Token`/`TokenCall` builder shape.
 *
 * Two arms, chosen per call (not per accessor): the ERC20 arm (`evm.ts`) emits a typed-binding
 * `IERC20.at(token).transfer(...)` call, identical to how `swap/source.ts`/`deposit/source.ts`
 * already call protocol contracts; the SPL arm (`svm.ts`) emits `svm.call(program, accounts,
 * accounts)` against the SPL Token program, reusing the `svmSettleSource` idiom
 * (`accountData`/`accountUint`, the `le8` u64 byteswap helper, `TransferChecked`/`ApproveChecked`).
 * The two arms are NOT interchangeable at compile time — the compiler rejects a contract binding on
 * `target: 'svm'` and an accounts list on an EVM target (see `sdk/CLAUDE.md`'s E1.3 capability
 * gate) — which is exactly what makes shipping BOTH arms from one generator sound.
 */
export * from "./types.js";
export * from "./params.js";
export * from "./evm.js";
export * from "./svm.js";
export * from "./source.js";
export * from "./api.js";
//# sourceMappingURL=index.js.map