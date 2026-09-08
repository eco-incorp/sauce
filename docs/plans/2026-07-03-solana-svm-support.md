# Solana (SVM) support for sauce-sdk — implementation plan

Port Solana as a compile + execution target for the TypeScript compiler and SDK, targeting the
**fork-parity SVM engine** (`eco-incorp/sauce` PR #202, branch `feat/svm-v12-port`). Written
2026-07-03; grounded against the Solana MCP docs and the engine as shipped in that PR.

**Work happens in this worktree** (`~/Documents/Projects/sauce-sdk-svm`, branch `feat/svm-support`)
— the main checkout has active unrelated work (`feat/more-liquidity-sources`). The branch is
stacked on `feat/compiler-source-imports` (PR #23), the tip of the compiler stack — this base
includes the v12 bytecode target (PR #18) that Phase A extends; `origin/main` does not have it.

## Status: implemented (2026-07-04)

All five phases landed on this branch. Deliberate deviations from the plan below, with reasons:

- **Target naming**: the repo already used `target: 'v1' | 'v12'`, so SVM is a third value
  `'svm'` (a v12 dialect) rather than a separate `'evm' | 'svm'` axis.
- **No `bindings` array on `AccountPlan`**: account refs are interned first-use during emission,
  so index bytes are final when written — nothing to back-patch, and the ordered `metas` array
  alone is the compiler↔sender contract.
- **Phase D harness**: litesvm **npm** bindings (1.2.x, `@solana/kit`-native) instead of the
  Rust-shim option — zero cross-repo coupling. Cross-engine parity compares svm results against
  the **v1 Solidity interpreter** via the existing anvil/cast harness (local-only: the suite is
  engine.so-gated and skips in CI, which has no SVM build), since the Huff-runtime suites are
  hnc-gated; engine-level v12≡SVM parity is already proven by the 172-vector suite in the
  engine repo.
- **`@solana/kit` pinned `^6.10`**, not 7.x: every `@solana-program/*` client peer-requires
  kit 6 and fails at ESM link against 7.0.
- **Risk 1 resolved**: the account-lock cap is **64** (the 128 feature gate is inactive);
  read-only accounts count. The 4-venue budget fits without ALTs.
- **Phase E**: recipe named `solswap`, runs on LiteSVM with canonical big-endian fixture pools
  and a system-transfer stand-in for the venue CPI (no engine devnet deploy exists yet — risk 2);
  real venue adapters (LE reserve decoding, CLMM) documented as out of v1 scope.
- **Found by executing on the real engine**: two pre-existing v12 emitter bugs — prefix NEG
  encoding for negative literals (unexecutable on any postfix engine) and the smart-MSTORE
  epilogue on void mains (underflows the SVM engine's sentinel-less stack).

---

## 0. Ground truth this plan is built on

### The engine (../sauce, PR #202)

- `svm/` is a Solana program interpreting **the same v12 postfix bytecode** the EVM Huff runtime
  executes — byte-identical opcode table, proven by a 172-vector cross-runtime parity suite
  (`svm/programs/engine/tests/fixtures/parity_vectors.json`, replayed by `src/parity.rs`, drift-
  gated in CI). The authoritative opcode list + intentional divergences: `../sauce/svm/CLAUDE.md`.
- Execute instruction: data = `[8-byte discriminator (sha256("global:execute")[..8]) ‖ bytecode]`;
  accounts = `[stack PDA, heap PDA, frames PDA, ...user accounts]`. PDAs are seeded `"stack"`
  (33,793 B), `"heap"` (65,536 B), `"frames"` (67,585 B) and need one-time `init_*` instructions
  (iterative realloc growth). Discriminator constants are exported from the engine crate.
- **CALL (0xA2) SVM shape**: pops `[target(32-byte program id, top), calldata (Bytes descriptor),
accounts (static ARRAY of u8 account indices)]`, does `invoke()`, pushes returndata Bytes
  descriptor. Account indices index the **user accounts** slice (after the 3 PDAs). Per-CPI cap:
  64 accounts. STATIC (0xA3) is an alias. There is **no value operand** (vs EVM's
  `ternary(CALL, target, value, calldata)`).
- **SLOAD (0x81) SVM shape**: pops `[account_index (top), offset, len]` → pushes Bytes descriptor
  over that slice of the account's data. SSTORE (0xC5) writes analogously (writable account).
  This is the on-chain state-read primitive the quote pattern below is built on.
- **CATCH limitation (platform law)**: only _pre-flight_ CPI failures (unresolvable operands) are
  catchable; once `invoke()` launches, a failing CPI aborts the whole transaction. Programs must
  branch-and-call-the-winner, never try/catch across CPIs.
- Return data ≤ 1024 bytes (platform cap; engine errors loudly above it).
- Unsupported on SVM (loud `UnsupportedOpcode`): CREATE family 0x82–0x87, DELEGATE 0xA4.
  Chain analogs with EVM-identical stack shapes: MSG_SENDER/TX_ORIGIN (first signer),
  BLOCK_NUMBER (slot), TIMESTAMP (Clock), BALANCE/SELF_BALANCE (lamports), CHAIN_ID
  (1399811149 mainnet / 1399811150 devnet), GAS_LEFT (CU), LOG (`sol_log_data`), constants for
  COINBASE/PREVRANDAO/BASE_FEE/GAS_PRICE/BLOCK_HASH/EXT_CODE_HASH/BLOB_*.

### Solana constraints (from MCP docs — verify numbers at implementation time)

- Tx packet: **1232 bytes** total. Bytecode ships _inside_ the tx, so program size competes with
  account count and signatures for the same budget.
- Legacy tx: ~35 accounts practical. **v0 tx + Address Lookup Tables**: up to 256 unique accounts
  (u8 indices). ALT: ≤256 entries, append-only, signers not lookup-able, single-level; created
  from a recent slot; **entries extended in slot N usable from N+1** (warmup) — ALT setup is a
  separate earlier transaction; deactivate+close has a ~513-slot cooldown. Runtime account-lock
  cap exists below 256 (`TooManyAccountLocks`) — confirm the active limit on target cluster.
- All accounts any CPI touches must be declared in the outer tx upfront. No dynamic acquisition.
- CU: 1.4M/tx max. Engine overhead is low (measured: 100-iteration loop ≈ 198k CU, 1KB
  ABI_ENCODE ≈ 50k CU — `tests/cu_budget.rs`).

### The multi-AMM pattern (the motivating use case)

AMMs have **no quote instructions** — a CPI cannot "get a quote" without swapping (no view
functions on Solana). Ecosystem practice (Meteora docs verbatim): _"Quote before CPI — quote
off-chain with the SDK, then pass explicit bounds into your program."_ Jupiter quotes off-chain.

**Sauce's edge**: quote on-chain by _reading pool state_, not by CPI. The program:

1. attaches N pools' state accounts **read-only** (no write locks),
2. `SLOAD`s their reserves/price fields and computes quotes in-VM (`MUL_DIV` etc.),
3. compares and branches (`GT`/`IF`),
4. CPIs **only the winning** AMM's swap with its writable account set.

Budget for 4 AMMs ≈ 4 read-only pool accounts + 1 winner's writable swap set (~12) + 3 engine
PDAs + user ATAs + programs ≈ 25–30 accounts. Feasible without ALTs for constant-product
venues; ALTs make CLMM tick arrays comfortable. **Scope note**: CLMM/DLMM quote math (tick
traversal) in bytecode is heavy — v1 targets constant-product pools on-chain; CLMM quotes come
from the off-chain SDK with the sauce program verifying bounds and routing.

### Prior art in the org (checked — no overlap)

- `../sauce/compiler-rs` (Sammy): from-scratch Rust compiler, EVM+SVM targets, early (M1.x —
  expression lowering). Useful precedents: SVM byte table (PR #197) done before EVM because the
  SVM opcode set is frozen; **MLOAD/MSTORE flagged as a lowering divergence, not a byte
  divergence**. Nothing exists on account planning or tx sending. Design spec:
  `../sauce/compiler-rs/docs/superpowers/specs/2026-07-02-sauce-rust-compiler-design.md`.
- This repo's compiler already has v1 + v12 emitters (`compiler/src/saucer/{saucer,saucer-v12}.ts`,
  `ops.ts`/`ops-v12.ts`), an acorn-based SauceScript processor (`compiler/src/processor/`), and
  EVM-only integration tests driving `cast` (`compiler/integration-test/utils.ts`). CALL today:
  `saucer-v12.ts` (~line 809) `ternary(OPS.CALL, target, value, calldata)`.

---

## 1. Deliverables

| #   | Deliverable                                                                                                                              | Where                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| D1  | `target: 'evm' \| 'svm'` compile option; SVM-aware v12 emission (CALL/SLOAD/SSTORE shapes, chain-op gating)                              | `compiler/`                                |
| D2  | **Account planner**: compile output carries an ordered account plan + index bindings                                                     | `compiler/`                                |
| D3  | `sdk/chains` Solana chain defs + `svm` execution module (PDA bootstrap, v0 tx build, ALT mgmt, ATA prep, compute budget, simulate, send) | `sdk/`                                     |
| D4  | LiteSVM-backed integration harness (SVM twin of the `cast` harness) + parity smoke test reusing the engine's vector fixture              | `compiler/integration-test/`, `dev-tools/` |
| D5  | The 4-AMM quote-and-swap example recipe (devnet-runnable)                                                                                | `sdk/recipes/` or `actions/`               |

## 2. Phase plan

### Phase A — compiler target plumbing (D1)

1. `CompileOptions.target?: 'evm' | 'svm'` (default `'evm'`), threaded through
   `processor/index.ts` → saucer construction.
2. **Opcode gating table** (`compiler/src/saucer/svm-profile.ts`): per-opcode
   `supported | analog | unsupported` for the svm target, generated from
   `../sauce/svm/CLAUDE.md`'s list. Compile-time error for `CREATE*`/`DELEGATE` with a clear
   message; doc-comment analogs (constants) pass through untouched.
3. **CALL lowering divergence** in `saucer-v12.ts`:
   - EVM (unchanged): `[calldata][value][target] CALL`.
   - SVM: `[accounts_desc][calldata][target] CALL` — `accounts_desc` is a static
     `ARRAY(count, elem=1)` literal of u8 account indices emitted inline (fork ISA: inline
     element bytes). No value operand; passing `value` under svm target = compile error.
   - Surface: `contract.call(data, { accounts: [...] })` where entries are **symbolic account
     refs** (see planner) or raw indices for escape-hatch use.
   - Same treatment for STATIC; the existing CATCH-wrapping emission
     (`processor/expression.ts` ~437) stays — semantics documented as pre-flight-only on SVM.
4. **SLOAD/SSTORE shapes**: new svm-target builtins `accountData(ref, offset, len)` /
   `writeAccountData(ref, offset, bytes)` lowering to 0x81/0xC5 with the SVM operand order.
   (EVM target keeps slot semantics; shared name would mislead — keep them distinct builtins.)
5. Unit tests: byte-exact emission fixtures for both targets; gating errors; the account-index
   ARRAY encoding (inline data, pc-advance) — cross-check against
   `../sauce/svm/programs/engine/src/ops/collections.rs` semantics.

### Phase B — account planner (D2). The genuinely new component.

1. New `compiler/src/planner/` producing, per compile:
   ```ts
   type AccountPlan = {
     metas: { ref: string; pubkey?: string; writable: boolean; signer: boolean }[]; // ordered, post-PDA slice
     bindings: { bytecodeOffset: number; ref: string }[]; // where each index byte was emitted
   };
   ```
2. Sources of accounts: `accounts:` lists on calls, `accountData()` refs, plus explicitly
   declared `#account("name", {writable})` pragmas for anything else. Planner dedupes, orders
   (writables first is NOT required — order by first use, stable), assigns indices, back-patches
   the ARRAY literals (or emits after assignment — single pass is fine since ARRAY data is
   inline).
3. Refs may be unresolved at compile time (`pubkey` filled by the send layer — e.g. "the user's
   USDC ATA"). The plan is the contract between compiler and sender.
4. Budget report: accounts used vs lock limit, bytecode bytes vs remaining packet space
   (1232 − signatures − metas − ALT refs), warn at thresholds.
5. Tests: dedup, ordering stability, >64-per-CPI rejection, budget math.

### Phase C — sdk send pipeline (D3)

1. `sdk/chains`: Solana cluster defs (devnet/mainnet, CHAIN_ID constants matching the engine
   feature flags, engine program id per cluster).
2. New `sdk/core/svm/` (published subpath `/svm`), built on `@solana/kit` (new dependency —
   keep `viem` untouched on the EVM side):
   - `bootstrap()` — idempotent `init_stack`/`init_heap`/`init_frames` (discriminators from
     engine exports; frames PDA needs the multi-ix realloc loop; skip if already sized).
   - `resolveAccounts(plan, ctx)` — fills unresolved refs (ATA derivation via
     `findAssociatedTokenAddress`, protocol registry lookups from `sdk/protocols`).
   - `prepend` instruction builders: idempotent ATA creation, wSOL wrap/unwrap, ComputeBudget
     (`SetComputeUnitLimit` from simulation × 1.2, `SetComputeUnitPrice`).
   - `buildExecuteTx(bytecode, plan, opts)` — v0 message, ALT refs, blockhash, signers.
   - `alt` submodule — create/extend/reuse lookup tables keyed by venue set; enforces the
     extend-then-use-next-slot rule; persists table addresses in the protocol registry.
   - `simulate()` (pre-send always; surfaces engine `Error::...` custom codes mapped to names
     from the engine's error enum) and `send()` (returns return-data bytes, ≤1024).
3. Tests: unit (plan resolution, tx size accounting, ALT slot rules mocked) + integration
   against LiteSVM (below) — no live cluster in CI.

### Phase D — test harness + parity smoke (D4)

1. `compiler/integration-test/utils.ts` gains an SVM twin: drive the engine `.so` via LiteSVM.
   Options (decide at implementation): (a) small Rust shim binary in `../sauce/svm` invoked like
   `cast` is today, or (b) `solana-bankrun`/`litesvm` npm bindings if maintained. (a) is zero
   new JS deps and reuses the engine's harness patterns — default choice.
2. **Parity smoke**: compile a curated set of the SDK compiler's own integration programs for
   BOTH targets; run EVM bytes through the existing `cast` path and SVM bytes through LiteSVM;
   assert identical results. (The engine's 172-vector fixture proves engine parity; this proves
   _this compiler_ emits target-correct bytes.)
3. Engine binary acquisition: `SAUCE_ENGINE_SO` env pointing at
   `../sauce/svm/target/deploy/engine.so` locally; CI builds it from the sauce repo pin or
   downloads an artifact (needs a small workflow decision — flag for review).

### Phase E — the 4-AMM recipe (D5), proves the whole stack

1. SauceScript program: `accountData()` reads of 2 constant-product pools (devnet: e.g. Raydium
   CP + Orca token-swap clones or Meteora DAMM), quote math via `MUL_DIV`, comparison, single
   `call()` to winner with `minOut` bound baked in.
2. Off-chain: account plan resolution from the protocol registry, ALT for the venue set, ATA
   prep, simulate, send; assert output balance delta ≥ bound.
3. Stretch (post-v1): 4 venues incl. one CLMM with off-chain quote + on-chain bound-check;
   document the CATCH/abort semantics for recipe authors.

## 3. Sequencing & estimates

A → B are compiler-local and parallelizable after A.1–A.2 land (B needs the option plumbing).
C depends on B's plan type only (can start against a stub). D needs A (bytes) + C (sender).
E last. Rough shape: A ≈ 1 day, B ≈ 1–2 days, C ≈ 2 days, D ≈ 1 day, E ≈ 1–2 days of
agent-driven work with review gates between phases.

## 4. Risks / open questions

1. **Account-lock limit**: confirm current runtime cap (64 vs 128) before sizing the 4-AMM
   account budget — determines whether ALTs are required or merely nice for v1.
2. **Engine program deployment**: no deployed program id exists yet (PR #202 not merged, no
   devnet deploy). Phases A–D run entirely on LiteSVM; E needs a devnet deploy of the engine —
   coordinate with the sauce repo (also needs the `mainnet` feature-flag build story).
3. **Bytecode size vs 1232 B**: the quote program with 4 venues may push the packet. Mitigations
   in order: ALTs (frees ~31 B/account), trim bytecode (compiler already tree-shakes), Jito
   bundles (non-atomic guarantees — avoid), or engine-side "bytecode from account" execution
   mode (engine change — out of scope, note as future).
4. **`@solana/kit` vs web3.js v1**: kit chosen (modern, tree-shakeable, MCP docs recommend);
   confirm no org constraint forces web3.js.
5. **compiler-rs convergence**: Sammy's Rust compiler will eventually own compilation. This TS
   port is the bridge; keep the account-plan JSON shape coordination-friendly (share the type
   with compiler-rs when its lowering lands — flag in PR description).
6. **CLMM on-chain quoting** deliberately out of v1 scope (tick-math CU + complexity).

## 5. References

- Engine: `../sauce` branch `feat/svm-v12-port` (PR #202) — `svm/CLAUDE.md` (opcode list,
  divergences, parity harness), `svm/programs/engine/src/opcode.rs` (dispatch truth),
  `tests/fixtures/parity_vectors.json` (172 vectors), `tests/cu_budget.rs` (CU baselines),
  `script/SvmParityVectors.s.sol` regeneration: add `--gas-limit 100000000000`.
- Engine design docs (session scratchpad, ephemeral — content summarized above): descriptor
  10-byte layout, frames PDA, EVAL/CATCH semantics — all durable in `svm/CLAUDE.md`.
- Sammy's PRs: #192 (compiler-rs scaffold, EVM+SVM targets), #197 (SVM byte table + MLOAD/MSTORE
  lowering-divergence note), #201 (expression lowering), #175 (original CALL opcode).
- Solana facts (MCP-sourced): 1232 B packet; v0+ALT 256-account indexing; ALT append-only +
  next-slot warmup + signer exclusion; CPI 64-account cap (SIMD-0339 context); Meteora
  "quote before CPI" guidance; account-plan tables for DAMM/DLMM swaps (~10–15 accounts).
