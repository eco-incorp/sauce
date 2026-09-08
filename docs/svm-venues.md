# SVM venue facts

Normative reference for the **12 venue adapters** in `sdk/src/svm/venues/` — **seven v1 (solswap)
adapters** (raydium-cp-swap, raydium-amm-v4, pumpswap, orca-legacy-token-swap, meteora-damm-v2,
saber-stableswap, meteora-damm-v1-stable) plus **five ladder-only EcoSwapSVM v2 families**: the
tick-walk CLMMs orca-whirlpool and raydium-clmm, the bin-walk meteora-dlmm, the CLOB manifest, and
the oracle-anchored prop-AMM obric-v2. Every byte offset, quote formula, rounding rule, gate and
pinned constant that the adapters and their test suites cite lives here. The adapters were written
against the venues' published sources and deployed mainnet binaries; this document is regenerated
from that code and its fixtures and is the companion the adapter doc comments point at. The
EcoSwapSVM recipe that composes these adapters into one atomic multi-venue split is documented in
`sdk/src/recipes/ecoswap/svm/README.md`.

## How quoting works

Solana has no view functions, so the recipe quotes **inside the VM**: each venue's pool
state accounts are attached to the execute instruction **read-only**, and the adapter's
`emitQuote` fragment (v1) / `emitQuoteCall` + `emitLadderQuote` (the ladder-only v2 families) reads
live fields with `accountUint(ref, offset, width)` — a little-endian unsigned read, mirrored
off-chain by `readUintLE` in `sdk/src/svm/venues/math.ts`. All venues are pure little-endian;
big-endian never occurs. Anything that is a compile-time constant
for a fixed `amountIn` (immutable fee rates, multipliers, direction branches) is folded off-chain
at generation time; anything trade- or admin-mutable (reserves, live fee rates, pause bytes) stays
a live in-VM read. The quote and the swap execute in the same instruction against the same account
state, so there is no staleness between them.

**Exactness criterion.** An adapter ships only when its in-VM quote equals the venue program's
realized output **bit-exact** over the supported pool class — same integer operations, same
floor/ceil sides, same guard order as the venue's own execution path. Pools whose output cannot be
reproduced from account reads alone (amount-dependent fee schedulers, slot-gated activation,
transfer-fee mints, unverified fee routing) are rejected at `fetchPoolConfig` time with a named
gate error; a gated pool never reaches the generator. Each venue's triangle —
`emitQuote` on the real engine == `referenceQuote` in TS == the pinned worked example below — is
asserted in `sdk/test/svm/venue-triangle.e2e.test.ts`, and `referenceQuote` is deliberately
derived from this document's formulas, never from the emitted SauceScript, so a shared bug cannot
self-verify.

**Fixture provenance.** All pinned worked examples run over real mainnet account dumps
(2026-07-03/04 snapshots unless a venue section says otherwise), stored one account per JSON file
under `sdk/test/svm/fixtures/<slug>/` as `{ address, owner, base64Data }`.

## Exclusions

- **CLMM / BIN venues**: quoting requires a tick/bin walk across a data-dependent account set, which
  does not fit the one-adapter-one-pool v1 shape — no v1 adapter for any of them. **Orca Whirlpools
  and Raydium CLMM (tick walks) and Meteora DLMM (bin walk) are covered as LADDER-ONLY families**
  (adapter contract v2, EcoSwapSVM — see their sections below).
- **CLOB venues**: an order-book quote is a best-first tree walk over resting orders, likewise
  data-dependent and unfit for the v1 shape. **Manifest is covered as a LADDER-ONLY family**
  (adapter contract v2 — see its section below); other CLOBs (Phoenix, OpenBook) are future
  candidates on the same order-window pattern.
- **Proprietary AMMs** (SolFi, HumidiFi, BisonFi, ZeroFi, Tessera, AlphaQ, GoonFi, Aquifer, ...):
  ~50% of SOL–stable volume, mostly closed-source. Their integrability is NOT uniform — the barrier
  is layout/CPI-acceptance, not READING (reads are permissionless). A prepare-time CPI-acceptance
  probe (`sdk/src/svm/cpi-probe.ts`) sorts them into tiers **P-A / P-B / P-C** — see the ranked
  ledger in the `obric-v2` section below. **Obric v2 is BUILT as tier P-A** (the oracle-anchored
  ladder family — separate readable Pyth-v2-relay feed, permissionless 12-account swap, known SDK
  math); the rest are documented (P-B: internal-oracle prop-AMMs whose mid field is locatable but
  the layout is undocumented/mutable; P-C: introspecting swaps that carry the Instructions sysvar —
  external-quote-lane or drop). The external-quote path (`quoteViaSimulation` + the recipe's
  post-swap delta check) remains the fallback for P-C and any un-probed venue.
- **Lifinity** (v2): prices from a live oracle with proactive inventory shifts, so a baked in-VM
  quote is stale by construction; the protocol wound down its DEX liquidity in 2025-12. No
  adapter.
- **Sanctum Infinity**: open math and grounded — the research is adapter-ready — but LST pricing
  runs through per-LST pricing programs plus the stake-pool rate, a multi-program account graph
  that the one-pool adapter shape does not carry yet. Planned follow-up; until then route Sanctum
  through the external-quote path.

---

## raydium-cp-swap

Constant-product CPMM (non-OpenBook). Program `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`;
source-verified against `raydium-io/raydium-cp-swap` commit `78f254e`. Vault/LP-mint authority is
the constant PDA `["vault_and_lp_mint_auth_seed"]` = `GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL`.

### PoolState account (637 bytes, Anchor)

Discriminator `sha256("account:PoolState")[0..8]` = `f7 ed e3 f5 d7 c3 de 46`. Offsets are byte
sums over the declared field order (`repr(C, packed)`).

| field                 | offset | encoding                                           |
| --------------------- | ------ | -------------------------------------------------- |
| amm_config            | 8      | pubkey (32B)                                       |
| token_0_vault         | 72     | pubkey                                             |
| token_1_vault         | 104    | pubkey                                             |
| token_0_mint          | 168    | pubkey                                             |
| token_1_mint          | 200    | pubkey                                             |
| token_0_program       | 232    | pubkey                                             |
| token_1_program       | 264    | pubkey                                             |
| observation_key       | 296    | pubkey                                             |
| status                | 329    | u8 bitfield (bit 2 = swap disabled)                |
| protocol_fees_token_0 | 341    | u64 LE                                             |
| protocol_fees_token_1 | 349    | u64 LE                                             |
| fund_fees_token_0     | 357    | u64 LE                                             |
| fund_fees_token_1     | 365    | u64 LE                                             |
| open_time             | 373    | u64 LE (unix seconds)                              |
| creator_fee_on        | 389    | u8 (0 = BothToken, 1 = OnlyToken0, 2 = OnlyToken1) |
| enable_creator_fee    | 390    | u8 bool                                            |
| creator_fees_token_0  | 397    | u64 LE                                             |
| creator_fees_token_1  | 405    | u64 LE                                             |

AmmConfig account (236 bytes, discriminator `da f4 21 68 cb cb 2b 6f`): `trade_fee_rate` u64 LE
@12, `creator_fee_rate` u64 LE @108 — both parts-per-1e6. Vaults are SPL token accounts (classic
or Token-2022): mint @0, amount u64 LE @64.

### Quote (exactIn, both directions)

```
reserve_side = vault.amount − protocol_fees_side − fund_fees_side − creator_fees_side
```

Fee rates are admin-mutable (`update_amm_config`), so the fragment reads them live from AmmConfig;
`creator_fee_on` / `enable_creator_fee` are pool-creation-time constants and the fee-side branch is
resolved at generation time. `enable_creator_fee == 0` zeroes the effective creator rate. With
`ceil(x) = (x + 999999) / 1e6`:

- creator fee on the **input** side (`creator_fee_on` 0, or 1 with token_0 in, or 2 with token_1
  in): `fee = ceil(amountIn * (trade_rate + creator_rate))`, `net = amountIn − fee`,
  `out = floor(net * reserveOut / (reserveIn + net))`.
- creator fee on the **output** side: `fee = ceil(amountIn * trade_rate)`, `net = amountIn − fee`,
  `outSwapped = floor(net * reserveOut / (reserveIn + net))`,
  `out = outSwapped − ceil(outSwapped * creator_rate)`.

Pools created before the creator-fee upgrade carry zeroed creator fields, so the unified formula is
safe everywhere. Overflow bound: every product is (u64) × (u64 or 1e6 rate) < 2^128, matching the
program's own u128 curve math.

Gates (fetch time): PoolState/AmmConfig size + discriminator, status bit 2, `now < open_time`,
each vault exists and holds the declared mint, and a Token-2022 mint with a TransferFeeConfig
extension (TLV type 1) on either side is rejected — a transfer-fee mint changes wire amounts on
that leg.

### Swap instruction: `swap_base_input`

Data (24 bytes): discriminator `sha256("global:swap_base_input")[0..8]` =
`[143, 190, 90, 218, 196, 30, 51, 222]`, then `amount_in` u64 LE, then `minimum_amount_out` u64 LE
(always 1 — the recipe's post-swap outAta delta check enforces the real bound).

| #   | account                   | flags    |
| --- | ------------------------- | -------- |
| 0   | payer (user owner)        | signer   |
| 1   | authority PDA `GpMZ…xFbL` |          |
| 2   | amm_config                |          |
| 3   | pool_state                | writable |
| 4   | user input token account  | writable |
| 5   | user output token account | writable |
| 6   | input vault               | writable |
| 7   | output vault              | writable |
| 8   | input token program       |          |
| 9   | output token program      |          |
| 10  | input token mint          |          |
| 11  | output token mint         |          |
| 12  | observation_state         | writable |

### Pinned worked example

Mainnet WSOL/USDC pool `7JuwJuNU88gurFnyWeiyGKbFmExMWcmRZntn9imEzdny`, snapshot 2026-07-04
(`sdk/test/svm/fixtures/raydium-cp-swap/`): vault_0 amount 1_927_052_254, vault_1 amount
146_870_650; protocol fees 69_220_427 / 869_850, fund fees 86_140_625 / 1_264_457, creator fees
0 / 0; `trade_fee_rate` 2500, `creator_fee_rate` 500 (creator fee disabled); open_time
1_715_746_443.

- reserves: 1_771_691_202 WSOL-side, 144_736_343 USDC-side.
- 1_000_000 WSOL lamports in: fee ceil(1e6 · 2500 / 1e6) = 2500, out = **81_443** USDC raw.
- reverse (token_1 in): 1_000_000 USDC in → **12_126_640** lamports.

### Caveats

- Quote-account refs are the base58 addresses themselves: unique across pools and venues, and
  shared reads (two pools on one AmmConfig) dedupe in the plan.
- `fetchPoolConfig` snapshots the fee rates for reference math, but the emitted quote re-reads
  them live.

---

## raydium-amm-v4

Legacy hybrid AMM, constant-product quoting for its non-orderbook statuses. Program
`675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`; source-verified against
`raydium-io/raydium-amm` (`state.rs`, `math.rs`, `processor.rs`) and the deployed mainnet binary.

### AmmInfo account (752 bytes)

`#[repr(C, packed)]`, **no discriminator** — all offsets absolute from byte 0, all integers
little-endian.

| field                         | offset | encoding               |
| ----------------------------- | ------ | ---------------------- |
| status                        | 0      | u64 LE (AmmStatus)     |
| coin_decimals                 | 32     | u64 LE                 |
| pc_decimals                   | 40     | u64 LE                 |
| fees.swap_fee_numerator       | 176    | u64 LE (default 25)    |
| fees.swap_fee_denominator     | 184    | u64 LE (default 10000) |
| state_data.need_take_pnl_coin | 192    | u64 LE                 |
| state_data.need_take_pnl_pc   | 200    | u64 LE                 |
| state_data.pool_open_time     | 224    | u64 LE (unix seconds)  |
| coin_vault                    | 336    | pubkey                 |
| pc_vault                      | 368    | pubkey                 |
| coin_mint                     | 400    | pubkey                 |
| pc_mint                       | 432    | pubkey                 |

Vaults are 165-byte SPL token accounts: mint @0, amount u64 LE @64.

### Quote (exactIn, direction = `inputIsCoin`)

Scope gate: ONLY status 6 (SwapOnly) and 7 (WaitingTrade) are quotable. For those the program uses
`calc_total_without_take_pnl_no_orderbook` (math.rs:322):

```
reserve_side = vault.amount − need_take_pnl_side
```

— bit-exact from three accounts, no Serum open-orders term. Status 1/5 (orderbook enabled) fold in
open-orders totals plus an event-queue walk and are rejected; status 2/3/4 have no swap
permission. Status-7 pools additionally reject swaps while `now < pool_open_time` — gated at
fetch (wall clock) and re-checked in `referenceQuote` against the live state snapshot.

Fee is **ceil-charged on the input** (`checked_ceil_div`, processor.rs:2396-2400):

```
inAfterFee = amountIn − ceil(amountIn · swap_fee_numerator / swap_fee_denominator)
out        = floor(reserveOut · inAfterFee / (reserveIn + inAfterFee))    (math.rs:373)
```

The fee side is all compile-time constants, so it folds off-chain; the fragment reads only the two
vault amounts and the two `need_take_pnl` fields. All operands are u64, so
`reserveOut · inAfterFee < 2^128` — matching the program's U128 floor division exactly.

### Swap instruction: `swap_base_in_v2`

Data (17 bytes): tag byte `0x10`, `amount_in` u64 LE, `minimum_amount_out` u64 LE (always 1). No
Serum market accounts — the instruction enforces the same non-orderbook restriction on-chain. The
program infers direction from the user token account mints, so the account list is
direction-independent.

| #   | account                                                      | flags    |
| --- | ------------------------------------------------------------ | -------- |
| 0   | SPL token program                                            |          |
| 1   | amm pool (AmmInfo)                                           | writable |
| 2   | amm authority `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1` |          |
| 3   | amm coin vault                                               | writable |
| 4   | amm pc vault                                                 | writable |
| 5   | user token source                                            | writable |
| 6   | user token destination                                       | writable |
| 7   | user source owner                                            | signer   |

The authority is `create_program_address([b"amm authority", [nonce]], programId)` — one PDA for
the whole program (`AUTHORITY_AMM`, processor.rs:111), pinned above.

### Pinned worked example

Mainnet SOL/USDC pool `58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`, snapshot 2026-07-04
(`sdk/test/svm/fixtures/raydium-amm-v4/`): status 6, fees 25/10000, coin vault amount
66_599_328_743_661, decimals 9/6.

- 1 SOL (1_000_000_000) in: fee 2_500_000, out = **81_386_311** (81.386311 USDC).
- 1 USDC (1_000_000) in: fee 2_500, out = **12_225_534** (0.012225534 SOL).

### Caveats

- `inputIsCoin` defaults true from `fetchPoolConfig`; flip a config copy for pc→coin — only the
  quote math flips, `buildSwap` is direction-independent.
- The status gate re-runs in `referenceQuote` against the live snapshot (a pool can be disabled
  after fetch).

---

## pumpswap

pump.fun AMM, constant product over **raw** SPL vault balances — nothing subtracted:
protocol/creator/buyback fees leave to their own ATAs at swap time and the LP fee stays in the
vault. Program `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`; fee program
`pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`. Layouts follow the official Anchor IDL, quote math
the official SDK, both verified byte-exact against recorded mainnet BuyEvent/SellEvent
simulations.

### Pool account

Discriminator `[241, 154, 109, 4, 17, 177, 109, 188]`. Core fields run through `lp_supply` at
203..211; observed sizes vary — pools shorter than 243 bytes predate `coin_creator`, which then
reads as `Pubkey::default`.

| field                    | offset | encoding                   |
| ------------------------ | ------ | -------------------------- |
| creator                  | 11     | pubkey                     |
| base_mint                | 43     | pubkey                     |
| quote_mint               | 75     | pubkey                     |
| pool_base_token_account  | 139    | pubkey                     |
| pool_quote_token_account | 171    | pubkey                     |
| lp_supply                | 203    | u64 LE                     |
| coin_creator             | 211    | pubkey (when length ≥ 243) |
| is_mayhem_mode           | 243    | u8 bool (when present)     |
| is_cashback_coin         | 244    | u8 bool (when present)     |

GlobalConfig `ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw` (discriminator
`[149, 8, 156, 202, 160, 252, 176, 217]`): `disable_flags` u8 @56 (bit 3 disables buys, bit 4
sells), `protocol_fee_recipients[0]` pubkey @57, `buyback_fee_recipients[0]` pubkey @643.

FeeConfig `5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx` under the fee program (discriminator
`[143, 52, 146, 187, 219, 123, 76, 155]`): flat fees lp/protocol/creator u64 LE @41/@49/@57; fee
tier vec count u32 LE @65, then 40-byte borsh entries at 69 + i·40: `market_cap_threshold` u128 LE,
`lp_fee_bps` u64 LE, `protocol_fee_bps` u64 LE, `creator_fee_bps` u64 LE.

### Fee selection (at fetch time)

A pool is **canonical** iff `pool.creator == pda(['pool-authority', base_mint])` under the pump
bonding program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`. Canonical pools pay the market-cap
tier: `mc = quote_reserve · base_mint_supply / base_reserve` (mint supply u64 LE @36 of the base
mint); below `tiers[0].threshold` pick `tiers[0]`, otherwise the highest tier whose threshold `mc`
clears. Non-canonical pools pay `flat_fees`. `creator_fee_bps` is zeroed when `coin_creator` is
`Pubkey::default`. Fees are re-read on every `fetchPoolConfig` (admin-mutable) and the selected
tier is **baked** into the emitted quote — staleness across a tier boundary is covered by the
recipe's post-swap outAta delta check. Observed 2026-07 tiers (verified on-chain): tier 0 =
2/93/30 bps below a 420-SOL market cap, tier 1 = 20/5/95 bps up to the 1470-SOL threshold.

### Quote (exactIn, both directions), BPS = 10000

Buy (`quoteToBase`, instruction `buy_exact_quote_in`) — the fee arithmetic strips the fee share
off the spendable budget, ceil-rounding each component separately, then corrects any over-budget:

```
eff  = floor(spend · BPS / (BPS + lp + protocol + creator))
fees = ceil(eff·lp/BPS) + ceil(eff·protocol/BPS) + ceil(eff·creator/BPS)
eff -= max(0, eff + fees − spend);   require eff ≥ 2
out  = floor(base_reserve · (eff − 1) / (quote_reserve + (eff − 1)))
```

The `eff − 1` is the program's own on-chain adjustment. The `eff ≥ 2` guard covers an edge that is
unverified on-chain (see caveats). All fee terms are compile-time constants, so the fragment reads
exactly two accounts: base and quote vault amounts (u64 LE @64).

Sell (`baseToQuote`, instruction `sell`) — fees are per-component ceilDiv on the **output**:

```
quoteOut = floor(quote_reserve · baseIn / (base_reserve + baseIn))
out      = quoteOut − ceil(quoteOut·lp/BPS) − ceil(quoteOut·protocol/BPS) − ceil(quoteOut·creator/BPS)
```

Gates: pool/GlobalConfig/FeeConfig discriminators, pool length ≥ 211, `is_mayhem_mode` (mayhem fee
routing is unverified), `is_cashback_coin` (cashback swaps need user-derived remaining accounts),
buys disabled (`disable_flags` bit 3; bit 4 blocks `buildSwap` for sells), and a Token-2022 mint
carrying a TransferFeeConfig extension. Token program detection is by mint data alone: exactly 82
bytes = classic Tokenkeg (an extensionless Token-2022 mint is indistinguishable, and every pump
Token-2022 mint carries extensions), longer = Token-2022 TLV.

### Swap instructions

Buy `buy_exact_quote_in` (25 bytes): discriminator `[198, 46, 21, 82, 180, 217, 232, 112]`,
`spendable_quote_in` u64 LE, `min_base_amount_out` u64 LE (1), `track_volume` OptionBool `0x00`.
Sell (24 bytes): discriminator `[51, 230, 133, 164, 1, 127, 131, 173]`, `base_amount_in` u64 LE,
`min_quote_amount_out` u64 LE (1).

Ordered accounts (buy; sell drops the two volume accumulators):

| #   | account                                                                  | flags                               |
| --- | ------------------------------------------------------------------------ | ----------------------------------- |
| 0   | pool                                                                     | writable                            |
| 1   | user                                                                     | writable, signer                    |
| 2   | global config                                                            |                                     |
| 3   | base mint                                                                |                                     |
| 4   | quote mint                                                               |                                     |
| 5   | user base token account                                                  | writable                            |
| 6   | user quote token account                                                 | writable                            |
| 7   | pool base vault                                                          | writable                            |
| 8   | pool quote vault                                                         | writable                            |
| 9   | protocol fee recipient                                                   |                                     |
| 10  | protocol fee recipient quote ATA                                         | writable                            |
| 11  | base token program                                                       |                                     |
| 12  | quote token program                                                      |                                     |
| 13  | system program                                                           |                                     |
| 14  | associated token program                                                 |                                     |
| 15  | event authority `GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR`           |                                     |
| 16  | amm program                                                              |                                     |
| 17  | coin creator vault ATA                                                   | writable                            |
| 18  | coin creator vault authority                                             |                                     |
| 19  | global volume accumulator `C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw` | buy only                            |
| 20  | user volume accumulator                                                  | writable, buy only, caller-resolved |
| 21  | fee config                                                               |                                     |
| 22  | fee program                                                              |                                     |

Remaining accounts, in order: the `['pool-v2', base_mint]` PDA when `coin_creator` is set, then
**always** the buyback fee recipient + its quote ATA (writable) — omitting the pair fails with
error 6058. The user volume accumulator is `['user_volume_accumulator', user]` under the amm
program — a PDA over the user's own wallet, so the adapter attaches it as the caller-resolved ref
`pumpswap-user-volume-accumulator`. Coin creator vault authority is
`['creator_vault', coin_creator]` under the amm program.

### Pinned worked examples

Mainnet-simulation-verified vectors (PUMP/USDC pool
`2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd`, non-canonical, flat fees 25/5/0 bps):

- buy: reserves base 4_154_251_682_177_570 / quote 6_515_063_678_232, spend 1_000_000_000 →
  **635_633_459_193** (matches the recorded BuyEvent).
- sell: reserves base 4_153_516_048_718_377 / quote 6_516_220_452_584, baseIn 50_000_000_000 →
  **78_205_951** (matches the recorded SellEvent).

Untouched fixture snapshot (`sdk/test/svm/fixtures/pumpswap/`, vaults 4_144_782_727_340_999 /
6_530_283_775_547, dumped 2026-07-03/04; quotes recomputed from the formulas above outside the
package): buy 1e9 → **632_706_768_908**; sell 50e9 → **78_539_874**. The canonical fixture pool
`GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J` pins the tier selection (market cap ~220 SOL →
tier 0, fees 2/93/30).

### Caveats

- The fee tier is a fetch-time snapshot; the emitted quote does not re-read FeeConfig.
- The `eff < 2` throw guards an on-chain edge that was never observed in simulation — kept
  conservative rather than risking a divergent tiny-input quote.
- `referenceQuote` is written from the formulas above and deliberately does not share the
  `emitQuote` fee fold, keeping the two independently derived.

---

## orca-legacy-token-swap

Orca's v2 fork of the SPL token-swap program (layout/math per `spl-token-swap`
token-swap-v2.1.0). Program `9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP`; the v1 deployment
(`DjVE6…`) is deprecated and out of scope. Constant-product (`curve_type == 0`) pools only —
Orca's fork also ran stable pools (nonzero curve_type, amp in the calculator blob), which are
gated.

### SwapV1 pool account (324 bytes)

`SwapVersion::pack`: version byte at 0, then the 323-byte SwapV1 body — manual Pack, no
discriminator, no padding.

| field                       | offset | encoding                   |
| --------------------------- | ------ | -------------------------- |
| version                     | 0      | u8 (= 1)                   |
| is_initialized              | 1      | u8 bool                    |
| bump_seed                   | 2      | u8                         |
| token_program_id            | 3      | pubkey                     |
| token_a (vault)             | 35     | pubkey                     |
| token_b (vault)             | 67     | pubkey                     |
| pool_mint                   | 99     | pubkey                     |
| token_a_mint                | 131    | pubkey                     |
| token_b_mint                | 163    | pubkey                     |
| pool_fee_account            | 195    | pubkey                     |
| trade_fee_numerator         | 227    | u64 LE                     |
| trade_fee_denominator       | 235    | u64 LE                     |
| owner_trade_fee_numerator   | 243    | u64 LE                     |
| owner_trade_fee_denominator | 251    | u64 LE                     |
| curve_type                  | 291    | u8 (= 0, constant product) |

### Quote (exactIn, A → B)

Reserves ARE the raw vault balances — both fees stay in the vaults as tokens; the owner fee is
compensated by minting LP tokens to `pool_fee_account`. Fees are charged on the **input** with the
floor-min-1 rule (`fees.rs calculate_fee`): zero when the rate or the amount is zero, otherwise
`max(1, floor(x · n / d))`.

```
netIn = amountIn − tradeFee − ownerFee        (throws when ≤ 0)
out   = rsOut − ceil(rsIn · rsOut / (rsIn + netIn))
```

The curve ceiling rounds against the trader. On-chain `checked_ceil_div` maps a zero
floor-quotient to failure before ceiling, and a zero `out` also fails — `referenceQuote` mirrors
both. All arithmetic is u128 on-chain; reserves are u64, so `rsIn · rsOut ≤ 2^128` and nothing
approaches the engine's 256-bit wrap. Fee rates are immutable SwapV1 fields and are baked; the
fragment reads only the two vault amounts.

The swap authority is `create_program_address([pool, [bump_seed @2]], program)` with the
**stored** bump — the pool may have been initialized with a non-canonical nonce, so find-style
derivation is wrong. No on-curve rejection: the pool exists on-chain with this bump.

### Swap instruction: `SwapInstruction::Swap`

Data (17 bytes): tag `0x01`, `amount_in` u64 LE, `minimum_amount_out` u64 LE (1). Accounts
(instruction.rs list 0–9; the optional host fee account 10 is omitted):

| #   | account                        | flags    |
| --- | ------------------------------ | -------- |
| 0   | swap (pool state)              |          |
| 1   | swap authority                 |          |
| 2   | user transfer authority        | signer   |
| 3   | user source token account      | writable |
| 4   | pool source vault              | writable |
| 5   | pool destination vault         | writable |
| 6   | user destination token account | writable |
| 7   | pool mint                      | writable |
| 8   | pool fee account               | writable |
| 9   | token program                  |          |

### Pinned worked example

Mainnet SOL/USDC pool `EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U`
(`sdk/test/svm/fixtures/orca-legacy-token-swap/`, dumped 2026-07-03/04): reserves
16_016_066_895_173 / 1_306_595_296_770; fees 25/10000 trade + 5/10000 owner; bump_seed 252 →
authority `JU8kmKzDHF9sXWsnoznaFDFezLsE5uomX2JkRMbmsQP` (derivation verified:
`sha256(pool || 0xFC || program || 'ProgramDerivedAddress')`).

- 1 SOL in: tradeFee 2_500_000, ownerFee 500_000, netIn 997_000_000 → **81_330_481** USDC raw.
- 10 SOL in → **812_849_439**.
- dust 1000 in: tradeFee 2, ownerFee floors to 0 → min 1, netIn 997 → **81**.

### Caveats

- Quote direction is token A → token B (matching the pinned example); the reverse direction needs
  the roles swapped by the caller.
- The emitted ceiling is spelled `(rIn·rOut + rIn + netIn − 1) / (rIn + netIn)`.

---

## orca-whirlpool (ladder-only)

Orca Whirlpools CLMM — the first tick-walk family, EcoSwapSVM adapter contract v2 ONLY (no v1
adapter, not in the v1 registry: the account set depends on the price path). Program
`whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`; source-verified against
`github.com/orca-so/whirlpools` `programs/whirlpool/src` (state/{whirlpool,tick,
fixed_tick_array}.rs, math/{tick_math,token_math,bit_math,swap_math}.rs,
manager/swap_manager.rs, util/{swap_tick_sequence,sparse_swap}.rs) and a mainnet dump
(`sdk/test/svm/fixtures/orca-whirlpool/`, snapshot slot 431094837).

### Whirlpool account (653 bytes, Anchor)

Discriminator `sha256("account:Whirlpool")[0..8]` = `3f 95 d1 0c e1 80 63 09`. All integers LE.

| field                         | offset    | encoding                                           |
| ----------------------------- | --------- | -------------------------------------------------- |
| tick_spacing                  | 41        | u16 LE                                             |
| fee_tier_index_seed           | 43        | u16 LE (== tick_spacing for static-fee pools)      |
| fee_rate                      | 45        | u16 LE (hundredths of a bp, denominator 1e6)       |
| protocol_fee_rate             | 47        | u16 LE (bps of the fee — never reaches the trader) |
| liquidity                     | 49        | u128 LE                                            |
| sqrt_price                    | 65        | u128 LE (Q64.64)                                   |
| tick_current_index            | 81        | i32 LE two's-complement                            |
| token_mint_a / token_vault_a  | 101 / 133 | pubkey                                             |
| token_mint_b / token_vault_b  | 181 / 213 | pubkey                                             |
| reward_last_updated_timestamp | 261       | u64 LE (swap clock must exceed it)                 |

### TickArray account (FixedTickArray, 9988 bytes)

Discriminator `sha256("account:TickArray")[0..8]` = `45 61 bd be 6e 07 42 bb`. Layout:
start_tick_index i32 LE @8; ticks[88] @12, 113 bytes each — `initialized` u8 @+0,
`liquidity_net` **i128 LE two's-complement** @+1, `liquidity_gross` u128 LE @+17 (rest is fee/
reward growth); whirlpool pubkey @9956. PDA `['tick_array', whirlpool, ascii(start_tick_index)]`
— the seeds PIN the start index, which is what makes a shipped (array, offset) → tick mapping
drift-invariant. `DynamicTickArray` (variable size, discriminator
`sha256("account:DynamicTickArray")[0..8]` = `11 d8 f6 8e e1 c7 da 38`) cannot be read at fixed
offsets and truncates the readable window at prepare.

### The prepare-declared window

The swap instruction takes exactly three TickArray PDAs; the program derives their expected
start indexes from the LIVE tick (sparse_swap.rs `get_start_tick_indexes`): `base =
floor(tick / (88*ts)) * (88*ts)`, offsets `[0,-1,-2]` for aToB, `[0,1,2]` for bToA — shifted to
`[1,2,3]` when `tick + ts >= base + 88*ts`. Uninitialized PDAs are proxied as zeroed arrays
(sparse swap), so real capacity is always >= the modeled window.

Because a live per-slot flag scan plus in-VM `sqrt_price_from_tick_index` bit ladders is
unaffordable on the interpreter (measured ~8k CU per scanned slot, ~54k per tick-sqrt),
prepare walks the arrays OFF-CHAIN and ships up to **4 boundaries** per direction (biased
tick, array index, offset, Q64.64 sqrt price — the sqrt is a pure function of the PDA-pinned
tick) plus the swap-sequence EDGE (last readable array's start for aToB / start + 88*ts − 1
for bToA, clamped to ±443636; shipped only when the boundary scan exhausted the window rather
than hitting the 4-boundary cap). Everything value-bearing is read LIVE in-VM: pool sqrt_price
/ tick / liquidity / fee_rate, and each boundary's initialized flag + liquidity_net. Boundaries
behind the live tick are skipped in-VM (aToB keeps tick <= live — the venue's inclusive
down-search; bToA keeps tick > live), flag-0 boundaries are skipped (the venue no longer steps
there), and a live tick past the whole shipped set self-deactivates the venue (quote 0 — no
out-of-window fallback exists). The one non-exact drift case: a tick NEWLY initialized inside a
shipped gap adds a step (and liquidity) the model misses — added liquidity only improves the
realized output, and the terminal outAta delta still enforces minOut.

### Quote (exactIn, both directions — the venue's compute_swap loop)

Per step toward the next boundary target, with `fn = 1e6 − fee_rate`:

```
amount_calc = floor(remaining * fn / 1e6)
fixed       = delta_in(curr, target, L, CEIL)          (SENT sentinel when the venue would refuse)
full step (fixed <= amount_calc): in = fixed; fee = ceil(in * fee_rate / fn);
     out += delta_out(curr, target, L, FLOOR); remaining -= in + fee; cross liquidity_net
partial   : next = next_sqrt_price(curr, L, amount_calc); in = delta_in(curr, next, CEIL);
     fee = remaining - in; out += delta_out(curr, next, FLOOR); remaining = 0
```

with `delta_a = ceil_or_floor((L*(hi−lo) << 64) / (hi*lo))`, `delta_b = (L*(hi−lo)) >> 64`
(round-up on the low 64 bits), `next_sqrt_from_a = ceil((L*sp << 64)/((L << 64) + calc*sp))`,
`next_sqrt_from_b = sp + floor((calc << 64)/L)` — token_math.rs exactly. Crossing applies
`-liquidity_net` going down / `+liquidity_net` going up over the raw two's-complement word.
Every venue abort (delta > u64::MAX on a taken step, L*ds >= 2^192 U256 shift overflow,
liquidity over/underflow on a cross, amount_remaining underflow) maps to a conservative clamp:
the walk marks itself exhausted and the quote past that point is 0 — a clamped ladder rung
reports the previous cumulative output (dOut 0, never elected) and a clamped final quote skips
the CPI. Protocol fees split off the fee and never affect the trader.

### Swap instruction: `swap` (v1, Tokenkeg-only)

Data (34 bytes): discriminator `sha256("global:swap")[0..8]` =
`[248, 198, 158, 145, 225, 117, 135, 200]`, `amount` u64 LE (runtime-patched),
`other_amount_threshold` u64 LE = 1, `sqrt_price_limit` u128 LE = 0 (NO_EXPLICIT — the program
substitutes the global MIN/MAX bound; the capacity clamp keeps the walk inside the window),
`amount_specified_is_input` = 1, `a_to_b`.

| #   | account                                                                 | flags    |
| --- | ----------------------------------------------------------------------- | -------- |
| 0   | token program (Tokenkeg)                                                |          |
| 1   | token authority (user owner)                                            | signer   |
| 2   | whirlpool                                                               | writable |
| 3   | token_owner_account_a (user in for aToB, out for bToA)                  | writable |
| 4   | token_vault_a                                                           | writable |
| 5   | token_owner_account_b (user out for aToB, in for bToA)                  | writable |
| 6   | token_vault_b                                                           | writable |
| 7-9 | tick_array_0..2 (window PDAs, nearest first)                            | writable |
| 10  | oracle PDA `['oracle', whirlpool]` (uninitialized for static-fee pools) |          |

Gates (fetch time): size/discriminator; **adaptive-fee pools** (`fee_tier_index !=
tick_spacing` — the effective fee depends on Oracle volatility state the fragment does not
read); **non-Tokenkeg mints** (the v1 swap is classic-SPL only; Token-2022 pools need swap_v2 —
follow-up); a direction with no shipped boundaries and no edge.

### Pinned worked examples

SOL/USDC 0.04% ts=4 pool `Czfq3xZZ...` at snapshot slot 431094837 (sqrt_price
5244461737044097829, tick -25156, liquidity 832740502930995) — pinned from an INDEPENDENT
direct port of the whirlpool sources (`test/svm/venues/orca-whirlpool.test.ts` header):

- aToB 1 SOL -> **80_795_746** USDC raw; 100 SOL -> **8_079_301_632** (crosses tick -25156);
  1000 SOL -> **80_768_189_284** (walks to tick -25163); 10_000 SOL -> 0 (past the 4-boundary
  window capacity — self-deactivation).
- bToA 81 USDC -> **1_001_725_479** lamports; 81_000 USDC -> **1_001_383_338_471** (walks to
  tick -25149).
- The 100-SOL vector is also the real-binary quadrilateral pin (realized on the dumped mainnet
  program, tick crossed, 814k CU total).

### Caveats

- Boundary count is `WHIRLPOOL_MAX_BOUNDARIES = 4` per direction (each crossed boundary is
  ~45k CU in a walk; each rung is a full cold walk) — deep trades self-cap at the shipped
  window and the merge reroutes the tail. Raising it costs 3 cfg words + one walk iteration
  per boundary and must move in lockstep with the fragment's unrolled setup and the mirror.
- The ladder mirror (`referenceQuote`/`referenceLadderQuotes`) models the FRAGMENT given the
  prepare-time cfg + params over live bytes — mirror a drifted execution with the ORIGINAL
  prepared cfg/params, not a refetched one.
- CU is state-dependent (crossing depth): calibrated at 100 SOL / one crossing; a
  four-crossing walk runs ~130k CU hotter — headroom absorbs it (see budget.ts).

---

## manifest (ladder-only)

Manifest CLOB — the first order-book family, EcoSwapSVM adapter contract v2 ONLY (no v1
adapter, not in the v1 registry: the account set is one market, but the quote is a tree walk).
Program `MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms`; source-verified against
`github.com/CKS-Systems/manifest` `programs/manifest/src` (state/{market,resting_order}.rs,
program/{instruction,processor/swap}.rs, quantities.rs) + `lib/src/red_black_tree.rs`, and a
mainnet dump of the SOL/USDC market `ENhU8LsaR7...` (`sdk/test/svm/fixtures/manifest/`,
2026-07-06). **Zero taker fee.**

### MarketFixed account (256-byte header + dynamic hypertree)

The whole order book lives in ONE market account: a 256-byte `MarketFixed` header then a dynamic
byte array of 80-byte blocks (a 16-byte red-black-tree node overhead + a 64-byte `RestingOrder`
or `ClaimedSeat` payload), interleaved as three RB trees (bids, asks, seats) + a free list — the
"hypertree". Discriminant (u64 LE @0) = `4859840929024028656`. All integers LE.

| field                             | offset    | encoding                               |
| --------------------------------- | --------- | -------------------------------------- |
| discriminant                      | 0         | u64 LE = 4859840929024028656           |
| base_mint_decimals                | 9         | u8                                     |
| quote_mint_decimals               | 10        | u8                                     |
| base_mint / quote_mint            | 16 / 48   | pubkey                                 |
| base_vault / quote_vault          | 80 / 112  | pubkey (PDA `['vault', market, mint]`) |
| bids_root_index / bids_best_index | 156 / 160 | DataIndex (u32; NIL = u32::MAX)        |
| asks_root_index / asks_best_index | 164 / 168 | DataIndex                              |

A `DataIndex` is a **byte offset into the dynamic region** (`get_helper` reads `dynamic[idx..]`),
so a block sits at absolute `256 + DataIndex`.

### RBNode + RestingOrder block (80 bytes)

Node overhead @ block base: `left` u32 @0, `right` u32 @4, `parent` u32 @8, `color` u8 @12,
`payload_type` u8 @13, padding @14. `RestingOrder` payload @ block+16: `price`
QuoteAtomsPerBaseAtom (u128 LE) @+0, `num_base_atoms` u64 @+16, `sequence_number` u64 @+24,
`trader_index` u32 @+32, `last_valid_slot` u32 @+36, `is_bid` u8 @+40, `order_type` u8 @+41. So
for an order at DataIndex `ix`: price @ `ix+272`, size @ `ix+288`, seq @ `ix+296`.

The price `inner` is a u128 = **quote_atoms_per_base_atom × 1e18** (`from_mantissa_and_exponent`:
`inner = mantissa × 10^(18+exp)`). `order_type`: 0 Limit, 1 IOC, 2 PostOnly, 3 Global, 4 Reverse,
5 ReverseTight. `sequence_number` is a monotonic per-order id (survives partial fills, unique
across free-list reuse) — the drift-invariant identity anchor.

### The prepare-declared order window

The taker match walks best-first: `bids_best_index` / `asks_best_index` (the header points at the
best order) then `get_next_lower_index` (the in-order predecessor — because the tree's Ord makes
the MAX the best order, its predecessor is the next-worse). This successor walk chases
parent/child pointers with a data-dependent inner loop — **unbounded and unaffordable in-VM**, the
same class as whirlpool's rejected tick discovery. So prepare walks the tree OFF-CHAIN and ships up
to **`MANIFEST_MAX_ORDERS = 16`** price levels per direction as `(DataIndex, sequence_number)` cfg
params; the fragment reads each shipped order's price + size LIVE. It **STOPS the off-chain walk at
the first Global order** (a taker IOC halts there without the global accounts — `place_order` /
`impact_base_atoms`) and at the first order with `last_valid_slot != 0` (the in-VM model carries no
clock). Global orders draw from a separate global account the swap would need extra accounts for —
they are gated out this way; Reverse / PostOnly makers ARE takeable and are shipped.

Drift is handled by the live seq check per order: the fragment reads each shipped order's live
`sequence_number` and **STOPS on the first mismatch** (the block was filled/cancelled + reused —
self-deactivation from that level). A shipped order partially filled since prepare keeps its seq and
is priced on its live (smaller) size — exact. A NEW better order inside the shipped range is missed
(favorable — a better price only improves the realized output, minOut enforced). A new better Global
that halts the venue's taker early is the one adverse case, caught by the terminal minOut.

### Quote (exactIn, both directions — the venue's taker match)

Price levels ARE the ladder: each shipped order is a discrete step, capacity = its size, marginal
price = its listed price, zero fee. Conversions (quantities.rs), `inner = price × 1e18`:

```
quote_for_base(base, up) = round(inner * base / 1e18)     // checked_quote_for_base
base_for_quote(quote, up) = round(1e18 * quote / inner)   // checked_base_for_quote
```

- **baseIn** (sell base, matches BIDS, `place_order`): per maker, `traded = min(remaining_base,
size)`; a full fill rounds quote **UP** (taker favor), the marginal partial rounds **DOWN**
  (`round_up = is_bid != did_fully_match`, `is_bid=false`). Output = Σ quote.
- **quoteIn** (buy base, matches ASKS, `impact_base_atoms`): per maker, `base_limit =
floor(1e18 * remaining_quote / price)`; full when `base_limit >= size` (consume `size` base,
  subtract `floor(price*size/1e18)` quote — round DOWN), else the marginal partial takes
  `base_limit` and stops. Output = Σ base.

A conversion the venue would reject (u128 product overflow / a u64-exceeding result) surfaces as
the SENT sentinel (2^65) and the walk clamps — the merge patches a smaller fill that never triggers
the abort. The quote saturates (no out-of-window fallback) once the shipped depth is exhausted.

### Swap instruction: `Swap` (disc 4, Tokenkeg-only, walletless direct-settlement)

Data (19 bytes): a 1-byte instruction discriminant `4` then Borsh `SwapParams { in_atoms u64 LE
(runtime-patched), out_atoms u64 LE = 1, is_base_in u8, is_exact_in u8 = 1 }`. The swap claims a
temporary seat for the owner (if none), virtually credits `in_atoms`, matches, settles the real
token transfers, and releases the seat — no pre-existing deposit needed. `out_atoms` (min out) = 1;
the recipe's terminal outAta delta enforces the real bound.

| #     | account                                                             | flags            |
| ----- | ------------------------------------------------------------------- | ---------------- |
| 0     | owner (== payer; the single-account form, market is manifest-owned) | signer, writable |
| 1     | market                                                              | writable         |
| 2     | system program (for the temp-seat / reverse-order expansion)        |                  |
| 3     | trader_base (base-in: user in; quote-in: user out)                  | writable         |
| 4     | trader_quote (base-in: user out; quote-in: user in)                 | writable         |
| 5 / 6 | base_vault / quote_vault                                            | writable         |
| 7     | token program (Tokenkeg)                                            |                  |

Optional accounts 8-12 (base/quote mints for Token-2022, global + global_vault) are omitted for the
classic-SPL, no-global class. Gates (fetch time): size / discriminant; non-classic-SPL mints (the
Swap ix is Tokenkeg-only here); a direction with no shippable levels.

### Pinned worked examples

SOL/USDC market `ENhU8LsaR7...` (2026-07-06 dump) — pinned from an INDEPENDENT direct port of the
venue's taker math (`test/svm/venues/manifest.test.ts` header), K = 16 shipped levels:

- **quoteIn** (USDC in -> SOL out): 1 USDC -> **12_445_225** SOL raw; 100 USDC -> **1_244_522_576**;
  1000 USDC -> **12_381_694_976**; 5000 USDC -> **36_607_379_770** (saturates the 16-level ask
  window).
- **baseIn** (SOL in -> USDC out): 1 SOL -> **80_216_939** USDC raw; 5 SOL -> **401_084_700**;
  10 SOL -> **801_614_101**; 50 SOL -> **3_361_566_055** (saturates the bid side).
- The 1-SOL baseIn vector is also the real-binary quadrilateral pin (realized on the dumped mainnet
  program through the real CLOB taker match, a reverse maker crossed, ~827k CU total).

### Caveats

- Shipped depth is `MANIFEST_MAX_ORDERS = 16` levels per direction — a trade beyond top-of-book
  depth saturates and the merge reroutes the tail. The setup (16 unrolled live reads over the whole
  book account) is a heavy fixed cost, so a manifest slot is a degrade-first 'stable'-class family
  (2-rung default) like whirlpool; the slot CU term scales with the shipped-order count.
- The ladder mirror (`referenceQuote`) models the FRAGMENT given the prepare-time cfg + params over
  live bytes — mirror a drifted execution with the ORIGINAL prepared params, not a refetched one.
- The recipe's taker owns no resting orders on the market (self-trade is out of scope for a router).

---

## raydium-clmm (ladder-only)

Raydium concentrated liquidity — the second tick-walk family, EcoSwapSVM adapter contract v2 ONLY
(no v1 adapter). Program `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`; source-verified against
`github.com/raydium-io/raydium-clmm` `programs/amm/src` (states/{pool,tick_array,config,pool_fee}.rs,
libraries/{tick_math,sqrt_price_math,liquidity_math,swap_math}.rs, instructions/swap.rs) and a
mainnet dump (`sdk/test/svm/fixtures/raydium-clmm/`, SOL/USDC 0.04% ts=1 pool
`3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv`, snapshot slot ~431198953).

### PoolState account (1544 bytes, Anchor zero_copy)

Discriminator `sha256("account:PoolState")[0..8]` = `f7 ed e3 f5 d7 c3 de 46` — **shared with
raydium-cp-swap**; the 1544-byte size and the CAMM program owner discriminate. All integers LE.

| field                         | offset (abs, +8 disc) | encoding                                |
| ----------------------------- | --------------------- | --------------------------------------- |
| amm_config                    | 9                     | pubkey                                  |
| token_mint_0 / token_mint_1   | 73 / 105              | pubkey                                  |
| token_vault_0 / token_vault_1 | 137 / 169             | pubkey                                  |
| observation_key               | 201                   | pubkey                                  |
| tick_spacing                  | 235                   | u16 LE                                  |
| liquidity                     | 237                   | u128 LE                                 |
| sqrt_price_x64                | 253                   | u128 LE (Q64.64)                        |
| tick_current                  | 269                   | i32 LE                                  |
| status                        | 389                   | u8 (bit 4 = swap disabled)              |
| fee_on                        | 390                   | u8 (0 = FromInput, 1/2 = Token0/1 only) |
| open_time                     | 1080                  | u64 LE                                  |
| dynamic_fee_info              | 1096                  | 80-byte struct (all-zero = classic)     |

AmmConfig (117 bytes, discriminator `da f4 21 68 cb cb 2b 6f`): `trade_fee_rate` u32 LE @47 (per
1e6). TickArrayState (10240 bytes, discriminator `c0 9b 55 cd 31 f9 81 2a`): pool_id @8,
start_tick_index i32 @40, ticks[60] @44 (168 bytes each — tick i32 @+0, liquidity_net i128 @+4,
liquidity_gross u128 @+20). A tick is **initialized iff liquidity_gross != 0** (no per-tick byte).
Tick array PDA `['tick_array', pool, start_tick_index.to_be_bytes()]` (4-byte **big-endian** — unlike
whirlpool's ascii). Bitmap-extension PDA `['pool_tick_array_bitmap_extension', pool]`.

### The prepare-declared window + quote

The whirlpool WINDOW pattern retargeted: prepare ships up to **4 initialized-tick boundaries** per
direction (biased tick, array cell, Q64.64 sqrt price) + the sequence edge; the fragment re-reads
sqrt_price_x64/tick/liquidity live from the pool, trade_fee_rate live from the AmmConfig, and each
boundary's liquidity_gross + liquidity_net live. The walk is the CLASSIC Uniswap-V3 exact-in
compute_swap loop the program runs when `get_dynamic_fee_info()` is None: `zero_for_one` (0to1, price
down) jumps to the next initialized tick below (inclusive down-search), fee on the input, static
trade_fee_rate; crossing applies `-liquidity_net` down / `+liquidity_net` up (add_delta over the raw
two's-complement word). It is structurally identical to whirlpool's loop; the primitives differ:
`get_delta_amount_1_unsigned` and `get_next_sqrt_price_from_amount_0` are bit-identical to whirlpool's
`wpDB`/`wpNxA`, `get_delta_amount_0_unsigned` uses NESTED rounding `round(round(L<<64·(b−a)/b)/a)`,
and `get_sqrt_price_at_tick` is the STANDARD Uniswap-V3 magic-constant ladder in Q64.64 (MAX_SQRT_PRICE
`79226673521066979257578248091` differs from Orca's — separate tick math). Every venue abort maps to
the conservative self-deactivation clamp (SENT = 2^65).

### Swap instruction: `swap_v2` (Tokenkeg + Token-2022 aware)

Data (33 bytes): discriminator `sha256("global:swap_v2")[0..8]` = `[43, 4, 237, 11, 26, 201, 30, 98]`,
`amount` u64 LE (runtime-patched), `other_amount_threshold` u64 LE = 1, `sqrt_price_limit_x64` u128
LE = 0, `is_base_input` = 1. Accounts: payer(signer), amm_config, pool(w), user_in(w), user_out(w),
input_vault(w), output_vault(w), observation(w), token_program, token_program_2022, memo_program,
input_vault_mint, output_vault_mint, then remaining `[bitmap_extension, tick_array_0..2]`.

### Gates (fetch time)

size/discriminator; `fee_on != 0`; a nonzero `dynamic_fee_info` (the dynamic-fee spacing-bounded
volatility walk is unsupported); swap-disabled status bit; non-classic-SPL mints (transfer-fee mints
break the realized-delta bound); a direction with no shipped boundaries.

### Pinned worked examples

SOL/USDC ts=1 pool `3ucNos4N...` at slot ~431198953 (tick -25038, sqrt_price 5283... , classic
dynamic_fee_info) — pinned from the adapter mirror (the venue transcription), cross-checked in-VM by
the lamport-exact engine gate:

- 0to1 (SOL -> USDC): 1 SOL -> **81_759_001** USDC raw; 10 SOL -> **817_570_824**; 100 SOL -> 0
  (beyond the 4-boundary window capacity — self-deactivation).
- 1to0 (USDC -> SOL): 82 USDC -> **1_002_140_234** lamports; 8_200 USDC -> **100_188_087_624**.

### Caveats

- Boundary count is 4 per direction; the mirror models the FRAGMENT given the prepare-time cfg/params
  over live bytes (mirror a drifted execution with the ORIGINAL prepared params).
- Real-binary verification is the env-gated quadrilateral lane (`raydium-clmm.so`); the default suites
  prove the split + the fragment==mirror gate.

---

## meteora-dlmm (ladder-only)

Meteora DLMM / Liquidity Book — the first BIN family, EcoSwapSVM adapter contract v2 ONLY. Program
`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`; source-verified against `github.com/MeteoraAg/dlmm-sdk`
(idls/dlmm.json + commons/src/{quote,extensions/{bin,lb_pair},math/*}.rs) and a mainnet dump
(`sdk/test/svm/fixtures/meteora-dlmm/`, SOL/USDC bin_step=4 pair
`5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`, snapshot slot ~431198953).

### LbPair account (904 bytes, Anchor) + BinArray (10136 bytes)

LbPair discriminator `sha256("account:LbPair")[0..8]` = `21 0b 31 62 b5 65 b1 0d`. All integers LE.

| field                                                         | offset (abs, +8 disc) | encoding                 |
| ------------------------------------------------------------- | --------------------- | ------------------------ |
| base_factor / filter_period / decay_period / reduction_factor | 8 / 10 / 12 / 14      | u16 (StaticParameters)   |
| variable_fee_control / max_volatility_accumulator             | 16 / 20               | u32                      |
| base_fee_power_factor / function_type / collect_fee_mode      | 34 / 35 / 36          | u8                       |
| volatility_accumulator / volatility_reference                 | 40 / 44               | u32 (VariableParameters) |
| index_reference                                               | 48                    | i32                      |
| last_update_timestamp                                         | 56                    | i64                      |
| pair_type / active_id / bin_step / status                     | 75 / 76 / 80 / 82     | u8 / i32 / u16 / u8      |
| activation_type                                               | 86                    | u8                       |
| token_x_mint / token_y_mint                                   | 88 / 120              | pubkey                   |
| reserve_x / reserve_y                                         | 152 / 184             | pubkey                   |
| reward_infos[0/1] mint                                        | 264 / 408             | pubkey                   |
| oracle                                                        | 552                   | pubkey                   |
| activation_point                                              | 816                   | u64                      |
| token_mint_x/y_program_flag                                   | 880 / 881             | u8 (0 = Tokenkeg)        |

BinArray (discriminator `5c 8e 5c dc 05 94 46 b5`): index i64 @8, lb_pair @24, bins[70] @56 (144
bytes each — amount_x u64 @+0, amount_y u64 @+8, price u128 @+16). Bin array PDA `['bin_array',
lb_pair, bin_array_index.to_le_bytes()]` (8-byte LE i64; `index = floor(bin_id / 70)`).

### The prepare-declared bin window + quote

Bins are discrete buckets `price = (1 + bin_step/1e4)^bin_id` in Q64.64 (`get_price_from_id` via the
u64x64 `pow` — drift-invariant, shipped as a param; equals the stored `bin.price` for any liquid
bin). Prepare walks bins from active_id in the swap direction and ships up to **8 liquid bins**
(biased id, array cell, price). Direction (VERIFIED against `get_bin_array_pubkeys_for_swap`
increment −1 and `advance_active_bin`): **swap_for_y (xToY, X in / Y out) walks DOWN in bin id
consuming amount_y**; !swap_for_y (yToX) walks UP consuming amount_x. The fragment reads active_id +
the volatility v_parameters live from the LbPair and each shipped bin's amount live from its bin
array. Per bin (quote_exact_in, MM-only, fee-on-input): the total fee is base + a volatility term,
a full bin drains at ceil'd max-input + exclusive fee, the marginal bin takes the remaining input net
of its inclusive fee; bins behind the live active_id are skipped (re-anchor), a bin drained to 0 is
skipped, an exhausted window self-deactivates.

Amount conversions (SCALE_OFFSET 64): swap_for_y out = `round(price·x / 2^64)`, in =
`round(y·2^64 / price)`; !swap_for_y out = `round(x·2^64 / price)`, in = `round(y·price / 2^64)`.

### The VARIABLE FEE (venue-exact, live)

`base_fee = base_factor · bin_step · 10 · 10^base_fee_power_factor` (immutable). The volatility term
is dynamic: the fragment replicates `update_references(clock)` (if `elapsed >= filter_period`:
index_reference = active_id, and volatility_reference = `elapsed < decay_period ?
volatility_accumulator·reduction_factor/1e4 : 0`) then per bin
`vacc = min(volatility_reference + |index_reference − bin_id|·1e4, max_volatility_accumulator)`,
`variable_fee = ceil(variable_fee_control·(vacc·bin_step)² / 1e11)`,
`total_fee = min(base_fee + variable_fee, MAX_FEE_RATE=1e8)` over FEE_PRECISION 1e9. Because the
fragment reads the LIVE volatility state + clock and the mirror mirrors it, the fee is venue-exact
per bin (not a prepare snapshot); `now` feeds it like meteora-damm-v2's stored-volatility policy.

### Swap instruction: `swap` (Tokenkeg-only class)

Data (24 bytes): discriminator `sha256("global:swap")[0..8]` = `[248, 198, 158, 145, 225, 117, 135,
200]`, `amount_in` u64 LE (runtime-patched), `min_amount_out` u64 LE = 1. Accounts: lb_pair(w),
bin_array_bitmap_extension(optional), reserve_x(w), reserve_y(w), user_token_in(w), user_token_out(w),
token_x_mint, token_y_mint, oracle(w), host_fee_in(optional → program placeholder), user(signer),
token_x_program, token_y_program, event_authority `['__event_authority']`, program, then remaining
`[bin_array_0..2]`.

### Gates (fetch time)

size/discriminator; non-Enabled status; `collect_fee_mode != 0` (only InputOnly is walked);
`is_support_limit_order` pairs (LimitOrder function_type, or Undetermined with a set reward mint — the
limit-order fill layers are unsupported); Token-2022 mints (program flags != 0); a slot-typed
activation with a nonzero point; a direction with no shippable liquid bins.

### Pinned worked examples

SOL/USDC bin_step=4 pair `5rCf1DM8...` at slot ~431198953 (active_id -6260), clock 1783355400 (54s
past last_update — inside the decay window, so the volatility term is live) — pinned from the mirror,
cross-checked in-VM by the lamport-exact engine gate:

- xToY (SOL -> USDC): 1 SOL -> **81_732_707** USDC raw; 5 SOL -> **408_662_622**.
- yToX (USDC -> SOL): 100 USDC -> **1_222_030_256** lamports; 1_000 USDC -> **12_220_302_614**.

### Caveats

- The variable fee is time-dependent via `update_references`; the mirror evaluates at `config.now` and
  the fragment reads the real Clock — the e2e gate pins both. Out of the decay window the volatility
  term is 0 (base fee only).
- The shift_active_bin_if_empty_gap edge (active bin array with no liquidity at active_id) is not
  modeled — a rare re-anchoring case, covered by the terminal minOut like whirlpool's newly-init tick.

---

## meteora-damm-v2

cp-amm, sqrt-price quoting from the Pool account **only**. Program
`cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`; source-verified against
`github.com/MeteoraAg/damm-v2`. Vault balances must never enter the quote: they overstate reserves
by unclaimed LP/protocol fees, and for concentrated pools the virtual reserves differ from real
reserves.

### Pool account (1112 bytes)

8-byte discriminator `sha256('account:Pool')[0..8]` = `f1 9a 6d 04 11 b1 6d bc` + 1104-byte
zero-copy struct.

| field                                        | offset | encoding                                       |
| -------------------------------------------- | ------ | ---------------------------------------------- |
| pool_fees.base_fee.cliff_fee_numerator       | 8      | u64 LE                                         |
| pool_fees.base_fee.base_fee_mode             | 16     | u8                                             |
| pool_fees.base_fee.period_frequency          | 24     | u64 LE                                         |
| pool_fees.dynamic_fee.initialized            | 56     | u8 bool                                        |
| pool_fees.dynamic_fee.variable_fee_control   | 68     | u32 LE                                         |
| pool_fees.dynamic_fee.bin_step               | 72     | u16 LE                                         |
| pool_fees.dynamic_fee.volatility_accumulator | 120    | u128 LE                                        |
| token_a_mint                                 | 168    | pubkey                                         |
| token_b_mint                                 | 200    | pubkey                                         |
| token_a_vault                                | 232    | pubkey                                         |
| token_b_vault                                | 264    | pubkey                                         |
| liquidity                                    | 360    | u128 LE                                        |
| sqrt_min_price                               | 424    | u128 LE                                        |
| sqrt_max_price                               | 440    | u128 LE                                        |
| sqrt_price                                   | 456    | u128 LE                                        |
| activation_point                             | 472    | u64 LE                                         |
| activation_type                              | 480    | u8 (0 = slot, 1 = unix timestamp)              |
| pool_status                                  | 481    | u8 (0 = enabled)                               |
| token_a_flag                                 | 482    | u8 (0 = Tokenkeg, 1 = Token-2022)              |
| token_b_flag                                 | 483    | u8                                             |
| collect_fee_mode                             | 484    | u8 (0 = BothToken, 1 = OnlyB, 2 = compounding) |
| fee_version selector                         | 486    | u8 (0 → cap 5e8, else cap 9.9e8)               |

### Quote (exactIn, fee denominator 1e9)

```
total_fee = min(cliff_fee_numerator + variable_fee, max_fee_numerator)
variable_fee = ceil((volatility_accumulator · bin_step)² · variable_fee_control / 1e11)   when initialized
```

The variable term uses the **stored** volatility accumulator — exact only within `filter_period`
(the program refreshes volatility references from elapsed time pre-swap). Base fee numerator,
liquidity and sqrt_price change under trading, so the fragment reads them live; band bounds and
dynamic-fee config are immutable pool parameters and are baked as literals.

- **aToB**: `next = ceil(L · sp / (L + dIn · sp))` (price moves down, rounds up); when
  `next < sqrt_min_price` the quote is **clamped to 0** (fragment and `referenceQuote` alike) so
  the other venues in a multi-venue program stay quotable; `gross = floor(L · (sp − next) / 2^128)`
  (delta_b); fee is **always on the output** for aToB: `out = gross − ceil(gross · fee / 1e9)`.
- **bToA**: `next = sp + floor(dIn · 2^128 / L)` (price moves up, rounds down); when
  `next > sqrt_max_price` the quote is clamped to 0 likewise;
  `gross = floor(L · (next − sp) / (sp · next))` (delta_a); fee on the **input**
  (`dIn = amountIn − ceil(amountIn · fee / 1e9)`) when `collect_fee_mode == 1` (OnlyB), on the
  output when it is 0.

Gates: size/discriminator, `pool_status != 0`, `collect_fee_mode == 2` (compounding pools quote
x·y=k on `token_a_amount`/`token_b_amount` instead — different math, not supported),
`base_fee_mode ≥ 2` (rate-limiter/market-cap schedulers are amount-dependent),
`period_frequency != 0` (time-scheduled fees need a clock the in-VM quote lacks),
`cliff_fee_numerator` above the version cap, sqrt price band escapes
`[4295048016, 79226673521066979257578248091]` or `sqrt_price` outside its own band, zero
liquidity, unknown token flags, Token-2022 transfer-fee mints, and a nonzero **slot-typed**
`activation_point` (`activation_type == 0` — the fragment has no slot read, so slot-gated pools
are out of scope, mirroring meteora-damm-v1-stable). Re-checking the bands makes the in-VM
overflow bound unconditional: sqrt prices < 2^97, so `L · sqrt_price < 2^225`,
`amount_in << 128 < 2^192` — all below the engine's 2^256 wrap, no `Math.mulDiv` needed (a
band-violating bToA `sp · next` may wrap, but every such quote is clamped to 0 before use).

**v1 (`emitQuote`/`referenceQuote`, the best-of-N solswap surface) vs v2 (the EcoSwapSVM ladder
fragment, `ladder.ts`)** quote the SAME formula above but differ past the band: v1 stays
clamped-to-0 (correct there — solswap compares ONE quote per venue at a fixed amount, never
differences a grid, and a full-amount CPI past the band would revert anyway, so losing the
election is the right outcome). The v2 ladder instead SATURATES: `emitLadderQuote`/
`emitFinalQuote`/`referenceQuote` evaluate the quote at `min(x, C)` for the closed-form capacity
`C` (the largest gross input the live band absorbs — aToB inverts `next(x) >= sqrt_min_price`
directly, bToA inverts `next(din) <= sqrt_max_price` in fee-adjusted `din`-space and, when
`collect_fee_mode == 1`, inverts the fee-adjustment itself), and `capacityInputVar`/
`referenceCapacities` fold each ladder rung's `dIn` to `min(x, C)` too. A raw pointwise
clamp-to-0 differenced across a rung that straddles `C` manufactures a negative `dOut`, which the
plain-bigint mirror and the on-chain u256-wrapping merge read differently — a real, engine-measured
gate divergence (see `ecoswap/svm` in the recipes repo). Saturating instead keeps the ladder
non-decreasing, matching the adapter contract every other capacity-aware ladder family
(orca-whirlpool/raydium-clmm/meteora-dlmm/manifest) already implements.

### Swap instruction

Data (24 bytes): discriminator `sha256('global:swap')[0..8]` =
`[248, 198, 158, 145, 225, 117, 135, 200]`, `amount_in` u64 LE, `minimum_amount_out` u64 LE (1).

| #   | account                                                                                      | flags    |
| --- | -------------------------------------------------------------------------------------------- | -------- |
| 0   | pool authority `HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC` (PDA `['pool_authority']`)     |          |
| 1   | pool                                                                                         | writable |
| 2   | user input token account                                                                     | writable |
| 3   | user output token account                                                                    | writable |
| 4   | token_a_vault                                                                                | writable |
| 5   | token_b_vault                                                                                | writable |
| 6   | token_a_mint                                                                                 |          |
| 7   | token_b_mint                                                                                 |          |
| 8   | user owner                                                                                   | signer   |
| 9   | token_a program                                                                              |          |
| 10  | token_b program                                                                              |          |
| 11  | program id (Anchor-optional referral placeholder)                                            |          |
| 12  | event authority `3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet` (PDA `['__event_authority']`) |          |
| 13  | program id                                                                                   |          |

### Pinned worked example

Mainnet WSOL/USDC pool `8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie`
(`sdk/test/svm/fixtures/meteora-damm-v2/`, dumped 2026-07-03/04): liquidity
127_981_592_641_713_518_779_758_772_562_077, sqrt_price 5_268_463_945_783_193_101, cliff fee
400_000 (0.04%), fee_version 0 (cap 5e8), collect_fee_mode 0, activation_point 1_754_985_927
(unix), evaluated at clock 1_780_000_000.

- 1 SOL aToB: next_sqrt_price 5_268_247_074_206_624_762, gross 81_566_288, output fee 32_627 →
  **81_533_661** (81.533661 USDC).
- 100 USDC bToA: gross 1_225_884_357, output fee ceil(gross · 4e5 / 1e9) = 490_354 →
  **1_225_394_003**.
- 100 USDC bToA with `collect_fee_mode = 1`: dIn 99_960_000, gross returned unfeed →
  **1_225_394_028**.

The compounding fixture pool `HybT1fLHfZDjQVnfBdFh9qT8kjPfb6wJCkKkoLZKqunm` pins the
collect_fee_mode gate on real bytes.

### Caveats

- Activation: slot-typed (`activation_type == 0`) pools with a nonzero `activation_point` are
  rejected at fetch. Timestamp-typed (`activation_type == 1`) nonzero points gate in-fragment on
  `block.timestamp` (quote 0 before activation); `referenceQuote` throws pre-activation, with
  `now` in unix seconds.
- Band violations quote 0 (fragment and `referenceQuote` alike) instead of throwing, so the other
  venues in a multi-venue solswapBest program stay quotable.
- Direction defaults to `aToB` from `fetchPoolConfig` (it cannot see the trade); callers flip to
  `bToA` when the input mint is token_b — the mints are exposed for that decision.

---

## saber-stableswap

Two-coin stableswap. Program `SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ` (same address on
mainnet-beta and devnet). Non-Anchor: no 8-byte discriminators anywhere. Layouts and math verified
against `saber-hq/stable-swap` sources: `stable-swap-client/src/state.rs` (SwapInfo), `fees.rs`
(Fees, 8 × u64 LE), `instruction.rs` (SwapInstruction tag 1, account order),
`stable-swap-math/src/curve.rs` (`compute_d` / `compute_y_raw` / `swap_to`).

### SwapInfo account (395 bytes, program_pack)

| field                            | offset | encoding              |
| -------------------------------- | ------ | --------------------- |
| is_initialized                   | 0      | u8 bool               |
| is_paused                        | 1      | u8 bool               |
| nonce                            | 2      | u8                    |
| initial_amp_factor               | 3      | u64 LE                |
| target_amp_factor                | 11     | u64 LE                |
| start_ramp_ts                    | 19     | i64 LE, read unsigned |
| stop_ramp_ts                     | 27     | i64 LE, read unsigned |
| token_a.reserves (vault A)       | 107    | pubkey                |
| token_b.reserves (vault B)       | 139    | pubkey                |
| token_a.mint                     | 203    | pubkey                |
| token_b.mint                     | 235    | pubkey                |
| token_a.admin_fees               | 267    | pubkey                |
| token_b.admin_fees               | 299    | pubkey                |
| fees.admin_trade_fee_numerator   | 331    | u64 LE                |
| fees.admin_trade_fee_denominator | 339    | u64 LE                |
| fees.trade_fee_numerator         | 363    | u64 LE                |
| fees.trade_fee_denominator       | 371    | u64 LE                |

### Quote (exactIn, A → B)

Reserves are the **live raw** SPL vault balances (amount u64 LE @64): admin fees are transferred
out of the destination vault in the same swap instruction, so `vault.amount` is directly the
quotable reserve — nothing to subtract.

Amp (`compute_amp_factor`): linear interpolation while `now < stop_ramp_ts` (floor division),
otherwise — including `stop_ramp_ts == 0` — the target. The interpolation direction depends only
on compile-time constants, so the fragment bakes the up- or down-ramp branch behind a
`block.timestamp < stop_ramp_ts` check.

Invariant and destination balance are Newton iterations shared with meteora-damm-v1-stable
(`stableD` / `stableY`, declared once by the generator: `ann = amp · 2` inside, ≤ 256 iterations,
converged when successive estimates differ by ≤ 1, floor division throughout — on-chain U192,
exact in bigint because `d ≤ xa + xb < 2^65` keeps d³-scale intermediates below 2^192 for u64
reserves).

```
d  = stableD(amp, srcRes, dstRes)
y  = stableY(amp, srcRes + amountIn, d)
dy = dstRes − y − 1                          (the −1 rounding buffer)
out = dy − floor(dy · trade_fee_num / trade_fee_den)   (fee on the OUTPUT)
```

The fragment reads the live `is_paused` byte and quotes 0 when paused or when `dstRes ≤ y`
(mirroring the on-chain checked_subs — without the guard a paused/dust quote would wrap and
falsely win the best scan). `referenceQuote` returns 0 for `amount_in == 0` (on-chain no-op
success) and throws on an empty reserve (`compute_d` divides by each balance; on-chain
CalculationFailure).

The swap authority is `create_program_address([pool, [nonce @2]], program)` with the **stored**
nonce (find-style would be wrong for non-canonical bumps); an on-curve derivation is rejected.

Gates: size 395, initialized, not paused, positive `trade_fee_denominator` (a zero denominator
fails on-chain with CalculationFailure and aborts the engine's mulDiv).

### Swap instruction

Data (17 bytes): tag `0x01`, `amount_in` u64 LE, `minimum_amount_out` u64 LE (1).

| #   | account                                                     | flags    |
| --- | ----------------------------------------------------------- | -------- |
| 0   | swap info (pool)                                            |          |
| 1   | swap authority                                              |          |
| 2   | user transfer authority                                     | signer   |
| 3   | user source token account                                   | writable |
| 4   | vault A                                                     | writable |
| 5   | vault B                                                     | writable |
| 6   | user destination token account                              | writable |
| 7   | admin fee account of the OUTPUT token (admin_fee_b for A→B) | writable |
| 8   | token program (Tokenkeg — Saber predates Token-2022)        |          |

### Pinned worked example

Mainnet USDC/USDT pool `YAkoNb6HKmSxQN9L8hiBE5tPJRsniSSMzND1boHmZxe`
(`sdk/test/svm/fixtures/saber-stableswap/`, dumped from mainnet): reserves 203_694_923_631 /
905_506_529_186; amp ramp 8000 → 5000 over 1_747_460_323..1_747_719_515 (finished 2025-05-20), so
any later clock quotes at amp 5000; trade fee 1/10000; nonce 255 → authority
`5C1k9yV7y4CjMnKv8eGYDgWND8P89Pdfj79Trk2qmfGo`.

- 1.0 USDC at now 1_751_500_000: D 1_109_127_433_350, y 905_505_528_482, dy 1_000_703, fee 100 →
  **1_000_603** (1.000603 USDT).
- mid-ramp at start + 100_000: amp = 8000 − floor(3000 · 100000 / 259192) = 6843 → **1_000_413**.

### Caveats

- Quote/swap direction is A → B; B → A is the same math with the roles swapped (the adapter
  interface carries no direction flag).
- `start_ramp_ts`/`stop_ramp_ts` are i64 read unsigned — the sign bit is never set for real
  timestamps.

---

## meteora-damm-v1-stable

Meteora DAMM v1 (Dynamic AMM, ex-Mercurial), stable curve. Program
`Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB`; dynamic-vault program
`24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi`. Quotes exact-in A → B (the pool's canonical
direction).

Reserves do NOT come from the pool account nor from raw SPL vault balances: pool funds live inside
two dynamic-vault accounts (lending aggregator), so the quote runs vault share math with
locked-profit decay.

### Pool account

Discriminator `sha256("account:Pool")[0..8]` = `f1 9a 6d 04 11 b1 6d bc`; borsh, no padding;
content ends at 925 of the over-allocated 1387-byte account.

| field                          | offset | encoding                          |
| ------------------------------ | ------ | --------------------------------- |
| token_a_mint                   | 40     | pubkey                            |
| token_b_mint                   | 72     | pubkey                            |
| a_vault                        | 104    | pubkey                            |
| b_vault                        | 136    | pubkey                            |
| a_vault_lp                     | 168    | pubkey                            |
| b_vault_lp                     | 200    | pubkey                            |
| enabled                        | 233    | u8 bool                           |
| protocol_token_a_fee           | 234    | pubkey                            |
| protocol_token_b_fee           | 266    | pubkey                            |
| trade_fee_numerator            | 330    | u64 LE                            |
| trade_fee_denominator          | 338    | u64 LE                            |
| protocol_trade_fee_numerator   | 346    | u64 LE                            |
| protocol_trade_fee_denominator | 354    | u64 LE                            |
| activation_point               | 403    | u64 LE                            |
| activation_type                | 475    | u8 (0 = slot, 1 = unix timestamp) |
| curve_type tag                 | 874    | u8 (1 = Stable)                   |
| amp                            | 875    | u64 LE                            |
| token_a_multiplier             | 883    | u64 LE                            |
| token_b_multiplier             | 891    | u64 LE                            |
| depeg_type                     | 916    | u8 (0 = None)                     |

### Dynamic-vault account (≥ 1227 bytes)

Discriminator `sha256("account:Vault")[0..8]` = `d3 08 e8 2b 02 98 75 77`; borsh (`total_amount`
at 11 is unaligned).

| field                                            | offset | encoding |
| ------------------------------------------------ | ------ | -------- |
| total_amount                                     | 11     | u64 LE   |
| token_vault                                      | 19     | pubkey   |
| lp_mint                                          | 115    | pubkey   |
| locked_profit_tracker.last_updated_locked_profit | 1203   | u64 LE   |
| locked_profit_tracker.last_report                | 1211   | u64 LE   |
| locked_profit_tracker.locked_profit_degradation  | 1219   | u64 LE   |

SPL satellites: token account amount u64 LE @64, mint supply u64 LE @36.

### Quote (exactIn, A → B, 8 steps)

1. **Unlocked amounts** at the cluster clock t (`block.timestamp` in-VM): locked profit decays
   linearly at `locked_profit_degradation` per second since `last_report`, denominator 1e12;
   `ratio = (t − last_report) · degradation`; when `ratio > 1e12` the locked profit is 0:
   `unlocked = total_amount − locked_profit · (1e12 − ratio) / 1e12`.
2. **Reserves via share math** (never raw balances):
   `reserve_x = floor(x_vault_lp.amount · unlocked_x / x_lp_mint.supply)`.
3. **Trade fee on the INPUT token** (`calculate_fee`): 0 when the numerator or amount is 0, else
   `max(1, floor(x · n / d))` — the minimum fee of 1 native unit is deliberate conservative
   rounding.
4. **Protocol fee** = same rule applied to the trade fee; `tradeFee −= protocolFee`;
   `inNet = amountIn − protocolFee`.
5. **Vault deposit simulation**: `inLp = floor(inNet · aSup / aUnl)`;
   `afterTotal = floor((inLp + aLpAmt) · (aUnl + inNet) / (aSup + inLp))` (unlocked' = unlocked +
   inNet because total' = total + inNet while locked_profit(t) is unchanged);
   `srcNet = afterTotal − reserveIn − tradeFee`.
6. **Stable curve on multiplier-upscaled reserves** (multipliers immutable, baked; amp re-read
   live — it is admin-adjustable), same `stableD`/`stableY` helpers as saber:
   `d = stableD(amp, rIn·multA, rOut·multB)`; `y = stableY(amp, (rIn + srcNet)·multA, d)`;
   `dest = floor((rOut·multB − y − 1) / multB)` (dy carries the −1 guard).
7. **Vault withdraw simulation** (two more floors): `outLp = floor(dest · bSup / bUnl)`;
   `out = floor(outLp · bUnl / bSup)`.
8. **Strict idle-float bound**: funds deployed to lending strategies are not withdrawable inside
   swap, so `out < b_token_vault.amount` (strict). The fragment clamps to 0 instead of throwing so
   the other venues in a multi-pool program stay quotable; `referenceQuote` throws.

Fees and amp are re-read at quote time (admin-mutable). The deposit/withdraw simulations capture
the 1–2 native units of extra rounding loss the program realizes on each side. Timestamp
activation gates ride in the fragment (`out = 0` before `activation_point` when
`activation_type == 1`).

Gates: discriminators, pool length ≥ 925, vault length ≥ 1227, enabled, curve tag 1 (Stable),
`depeg_type != 0` (depeg pools are out of scope), slot-based activation (`activation_type == 0`
with a nonzero point cannot be evaluated against the unix clock; every settled pool carries 0).

Overflow bounds: every in-fragment product is at most u64 × u64 or u64 × 1e12 < 2^128; the curve
intermediates for stable pairs stay under D < 2^100 (u128 suffices; amp ≤ 10000, 6-decimal
magnitudes), so no fragment product approaches 2^256.

### Swap instruction

Data (24 bytes): discriminator `sha256("global:swap")[0..8]` = `f8 c6 9e 91 e1 75 87 c8`,
`in_amount` u64 LE, `minimum_out_amount` u64 LE (1). Same 15-account list for both directions;
A → B puts inAta on the source side and the A-side protocol fee account at index 11.

| #   | account                                                      | flags    |
| --- | ------------------------------------------------------------ | -------- |
| 0   | pool                                                         | writable |
| 1   | user source token account                                    | writable |
| 2   | user destination token account                               | writable |
| 3   | a_vault                                                      | writable |
| 4   | b_vault                                                      | writable |
| 5   | a token_vault (vault's idle SPL float)                       | writable |
| 6   | b token_vault                                                | writable |
| 7   | a lp_mint                                                    | writable |
| 8   | b lp_mint                                                    | writable |
| 9   | a_vault_lp                                                   | writable |
| 10  | b_vault_lp                                                   | writable |
| 11  | protocol_token_a_fee                                         | writable |
| 12  | user owner                                                   | signer   |
| 13  | vault program `24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi` |          |
| 14  | token program                                                |          |

### Pinned worked example

Mainnet USDC/USDT pool `32D4zRxNc1EssbJieVHfPhZM3rH6CzfUPrWUuWxD9prG`
(`sdk/test/svm/fixtures/meteora-damm-v1-stable/`, observed state 2026-07-04): trade fee
100/1_000_000 (0.01%), protocol fee 0/1_000_000, amp 8000, multipliers 1/1, vault_a last_report
1_783_173_885.

- 1_000_000_000 uUSDC at the exact snapshot clock t = 1_783_175_236 → **1_000_605_351** uUSDT.

### Caveats

- The quote attaches 8 read-only accounts (pool, both vaults, both vault-LP token accounts, both
  LP mints, and only the OUT-side token_vault for the idle-float bound); t comes from the Clock
  sysvar.
- `a_lp_mint`/`b_lp_mint` are read from the vault account @115 — NOT reliably the canonical PDA.
- `t < last_report` cannot happen on-chain (the vault crank stamps last_report from the same
  clock); if it ever wrapped, the ratio would exceed 1e12 and the fragment falls back to
  `total_amount`. `referenceQuote` throws on it instead.

## obric-v2 (prop-AMM oracle-anchored, tier P-A)

Obric V2 is the FIRST prop-AMM family: an oracle-priced shifted-constant-product AMM whose
fast-moving price LEVEL lives in a **separate, live-readable oracle account** (a Pyth-v2-format
relay) the swap already passes in, while the drift-invariant SHAPE (the bigK curve, reserves, fee)
is baked. This is the SVM analog of the EVM net-cache: **bake the shape, read the level** — the
fragment reads the oracle mid live in-VM every execution and re-anchors the virtual-reserve curve
to it. Program `obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y`; verified against the obric-solana
IDL + a real mainnet dump of pool `AJ5HfGY32igLgUbDtfNRdrkjTSYkCVKdhmnFFfcZMJ1E` (27G8/USDC).

### SSTradingPair account (666 bytes, Anchor)

Discriminator `3bde0fec62665ae0` (`sha256("account:SSTradingPair")[..8]`), then (offsets absolute,
LE):

| field                       | offset    | type   | role                                                             |
| --------------------------- | --------- | ------ | ---------------------------------------------------------------- |
| isInitialized               | 8         | u8     | gate                                                             |
| xPriceFeedId                | 9         | pubkey | oracle account for X (read live)                                 |
| yPriceFeedId                | 41        | pubkey | oracle account for Y                                             |
| reserveX (vault)            | 73        | pubkey | SPL token acct; `amount`@64 read live                            |
| reserveY (vault)            | 105       | pubkey | "                                                                |
| protocolFeeX / protocolFeeY | 137 / 169 | pubkey | output-side fee vault = swap acct #7                             |
| mintX / mintY               | 202 / 234 | pubkey | classic Tokenkeg only                                            |
| bigK                        | 274       | u128   | virtual-reserve product (curve depth) — baked hi/lo              |
| targetX                     | 290       | u64    | oracle-target inventory — baked                                  |
| multX / multY               | 306 / 314 | u64    | STORED oracle-scaled prices (last swap) — the sanity-band anchor |
| feeMillionth                | 322       | u64    | fee, parts per 1e6 (e.g. 150 = 1.5 bps) — baked                  |
| rebatePercentage            | 330       | u64    | rebalancing-trade fee rebate (OMITTED — conservative)            |
| protocolFeeShareThousandth  | 338       | u64    | fee split (irrelevant to the swap OUTPUT)                        |
| version                     | 474       | u8     |                                                                  |
| mintSslpX / mintSslpY       | 482 / 514 | pubkey | (present → confirms the whole layout, ends at 666)               |

### Oracle feed (the LEVEL, read live)

Each pool names its own feed accounts and the swap passes them, so the fragment reads whatever the
pool points at. Obric migrated off canonical Pyth onto **per-pair relay programs** (verified on real
pools): a **Pyth-v2-format relay** (owner `Feed29Bg…`, 3312 B, magic `0xa1b2c3d4`: expo i32 @20,
agg.price i64 @208, agg.status u32 @224 — the documented, live-readable layout the adapter admits),
plus **Doves** (`DoVEsk76…`, 283 B) and **Minimox** (`Minimox7…`, 240 B) with proprietary layouts
(NOT pinned → gated as P-B). The mult scaling reproduces the SDK's `getPrice` (scale to expo −3) ×
`decimalMult`: `mult = floor(rawPrice / divX) * mulX`, cross-checked on the real pool — the USDC
feed reports `1e10` @ expo −8 → `÷1e5 = 100000`, EXACTLY the pool's stored multY. Prepare bakes
`(divX, mulX, divY, mulY, priceOffX, priceOffY)` per pool.

### Quote (exactIn, both directions — SDK V2Pool.quoteXToY, rebate omitted)

```
multX = floor(rawPriceX / divX) * mulX          # read live from the feed
multY = floor(rawPriceY / divY) * mulY
targetXK  = isqrt(bigK * multY / multX)          # the LIVE re-anchor (Math.sqrt in-VM)
currentXK = targetXK − targetX + reserveX        # reserveX read live from the vault
currentYK = bigK / currentXK
xToY:  out = currentYK − bigK / (currentXK + x)  # Y from the curve
yToX:  out = currentXK − bigK / (currentYK + x)  # X from the curve
out −= floor(out * feeMillionth / 1e6)           # fee on OUTPUT
clamp: out > reserveOut ⇒ the venue reverts "Insufficient active"
```

Both directions collapse to one form via `(cIn, cOut, reserveOut)`: xToY = `(currentXK, currentYK,
reserveY)`, yToX = `(currentYK, currentXK, reserveX)`. **Capacity handling** (like the CLMM
window): the LADDER rung reports the last-good value once the walk passes capacity (`out >
reserveOut`) — monotone, dOut 0 there, so the merge never over-fills obric — while the COLD final
quote clamps to 0 past capacity (skips the CPI). **SANITY BAND** (self-deactivation): the live
oracle-derived mult ratio is compared vs the pool's stored multX/multY (the program's own last-swap
values); out of band by more than `bandBps` (default 25% — a wide gross-corruption guard for the
documented feed), or a zero/halted mid, ⇒ the slot quotes 0 and the merge redistributes
in-instruction. **Conservative fee**: the rebalancing REBATE is omitted (full feeMillionth
charged), so predicted ≤ realized — one-sided safe for the terminal minOut; `rebatePercentage=0`
pools are exact.

### Swap instruction: `swap` (unified, 12 accounts, Tokenkeg)

`swap` — discriminator `f8c69e91e17587c8` (`sha256("global:swap")`); args `isXToY: bool, inputAmt:
u64, minOutputAmt: u64`. Accounts: `0 tradingPair(w) · 1 mintX · 2 mintY · 3 reserveX(w) · 4
reserveY(w) · 5 userTokenAccountX(w) · 6 userTokenAccountY(w) · 7 protocolFee(w = output side) · 8
xPriceFeed · 9 yPriceFeed · 10 user(signer) · 11 tokenProgram`. **No Instructions sysvar, no oracle-
writer signer, no maker seat** → structurally permissionless CPI. The ladder template is `patch:'in'`
(`prefix = disc ++ isXToY`, `suffix = minOut(=1) LE`).

### Gates (fetch time)

Wrong size/disc; uninitialized; **bigK=0** (drained/never-seeded — Obric's real inventory is thin,
concentrated in one USDC/USDT pool `BWBHrYqfcjAh…` ≈ $489k; the SOL/USDC pools are empty); a feed
pointing at the **Instructions sysvar** (an introspecting newer pool — tier P-C); a **non-Pyth-v2
feed** (Doves/Minimox magic — tier P-B, layout not pinned); token-2022 mints. A drained pool also
drops out of the relative-depth filter (vault-balance depth = 0).

### Pinned worked example

Mainnet 27G8/USDC pool `AJ5HfGY32igLgUbDtfNRdrkjTSYkCVKdhmnFFfcZMJ1E`
(`sdk/test/svm/ecoswap-svm.fixtures.ts` `OBRIC_FIXTURES`, real dump) — decoded layout: `bigK`
6_725_685_088_743_750_000_000_000_000, `targetX` 0, `feeMillionth` 150 (1.5 bps), classified P-A
(12-account swap, no Instructions sysvar). The oracle scaling reproduces from the real feeds: both
mints are 6-decimal at expo −8, so `getPrice` scales to expo −3 (`÷1e5`, decimalMult 1) → the USDC
feed's `1e10` gives **multY = 100000**, EXACTLY the pool's stored multY (the live-derived 27G8 mult
is 330596). Because Obric bakes the shape and reads the mid live, the quote is a closed-form
re-anchor; on symmetric reserves `reserveX = reserveY = 1e12` (the `referenceQuote` cell in
`ecoswap-svm.obric.oracles.test.ts`, matching the independently-transcribed `sdkQuoteXToY`):

- `targetXK = isqrt(bigK · 100000 / 330596)` = 45_104_457_861_101; `currentXK = targetXK + reserveX`
  = 46_104_457_861_101.
- xToY 1_000_000 (27G8 in) → **3_163_629** USDC raw; 1_000_000_000 → **3_163_560_330**;
  5_000_000_000 → **15_816_429_454** (each `out − floor(out · 150 / 1e6)`, monotone).

The real on-chain AJ5 vaults are **empty**, so against un-doctored mainnet bytes the
Insufficient-active guard quotes **0** (self-deactivation) — Obric's real depth lives in the one
USDC/USDT pool `BWBHrYqfcjAh…`. A live mid drift of ~5% (still inside the 25% band) re-anchors the
curve center and moves the quote, staying bit-exact vs the SDK mirror (the `LIVE mid re-anchors`
cell). The full realized-binary quadrilateral is the deferred `.so` follow-up (see the caveat
below).

### Honest venue-exactness caveat

The lamport-exact gate (fragment == referenceQuote) is UNCONDITIONAL. Venue-exactness (predicted ==
the real program's realized output) additionally rests on (a) the SDK==program oracle-derivation
assumption — the program is closed-source; the stored-mult cross-check and the terminal minOut
backstop it — and (b) the conservative-fee under-quote. Closing the derivation (dumping the `.so` +
a live-simulation quadrilateral) would upgrade Obric to a full deterministic quote (meteora-damm-v2
class). Real-world caveat: **thin current on-chain inventory** — deep only in one stable pool.

## The CPI-acceptance probe + the ranked prop-AMM ledger

`sdk/src/svm/cpi-probe.ts` classifies a venue P-A / P-B / P-C BEFORE any adapter effort — the SVM
analog of the EVM Metric/Tessera probing discipline; it never lands a swap.

1. **Static screen** (free, from the swap's account list): the **Instructions sysvar**
   (`Sysvar1nstructions…`) ⇒ the program introspects the enclosing transaction (router / anti-
   sandwich / caller gating) ⇒ hard **P-C**. A non-user signer (maker seat / oracle writer) ⇒ P-C
   candidate. `absent` is necessary-but-not-sufficient — the simulation confirms.
2. **Unrecognized-caller simulation** (definitive): build the swap from an address the venue has
   never seen (a non-router caller), tiny input, `minOut=1`, and `simulateTransaction`
   (`sigVerify:false`, `replaceRecentBlockhash`). Classify by the out-ATA delta: **ACCEPT** (delta >
   0 ⇒ P-A/P-B), **REJECT** (custom error / caller/owner/missing-acct ⇒ P-C), **DEGRADE** (succeeds
   but materially below the venue's own quote ⇒ P-C-with-penalty, external-lane only).
3. **CU probe** (feeds the budgeter) + **oracle-freshness probe** (derives the sanity-band staleness
   bound). The terminal realized-delta minOut backstops ALL tiers.

**Ranked ledger (on-chain-verified, mid-2026 — RE-PULL DefiLlama at commit time; rankings churn
quarterly).** The decisive discriminant is the Instructions sysvar in a captured swap:

| venue        | program     | pool size (accts) | swap accts               | instr-sysvar                       | oracle model                                                      | tier                             |
| ------------ | ----------- | ----------------- | ------------------------ | ---------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| **Obric V2** | `obriQD1z…` | 666 B (37)        | **12, no introspection** | **absent**                         | separate readable feed (Doves / Pyth-v2 relay / Minimox per pair) | **P-A (BUILT)**                  |
| Aquifer      | `AQU1FRd7…` | 1056 B (41)       | 5, no introspection      | absent                             | separate relay feed (`fastC7g…`, 128 B)                           | P-A/P-B                          |
| HumidiFi     | `9H6tua7j…` | 1728 B (92)       | 3, no introspection      | absent                             | internal mid pushed into the pool acct                            | P-B                              |
| BisonFi      | `BiSoNHVp…` | 2048 B (23)       | 3, no introspection      | absent                             | internal push-oracle mid (NOT an on-chain book)                   | P-B                              |
| SolFi (v1)   | `SoLFiHG9…` | 2800 B (40)       | 3, no introspection      | absent                             | internal mid in the pool acct                                     | P-B                              |
| Tessera V    | `TessVdML…` | 1264 B (24)       | 2, no introspection      | absent                             | internal (Wintermute), opaque                                     | P-B (hard)                       |
| ZeroFi       | `ZERor4xh…` | 1072 B+38 KB      | 14                       | **PRESENT (fee tier, NOT a gate)** | separate readable feed (128 B, `W1LDCARDa…`), f64 mid             | **P-A (curve open)** — see below |
| GoonFi V2    | `goonuddt…` | 2048 B+719 KB     | 14                       | **PRESENT**                        | internal + introspection gate                                     | P-C                              |
| AlphaQ       | `ALPHAQme…` | 336/672 B (41)    | 14                       | **PRESENT**                        | internal + introspection gate                                     | P-C                              |
| SolFi V2     | `SV2EYYJy…` | 1728 B+1 MB       | 13                       | **PRESENT**                        | internal + introspection gate                                     | P-C                              |
| Lifinity     | `2wT8Y…`    | —                 | —                        | —                                  | oracle + proactive inventory; DEX wound down 2025-12              | P-C / drop                       |

- **P-A built now: Obric V2** — all three barriers fall (readable feed, permissionless swap, known
  math), CPI-integrated by third-party routers. The one gap (the closed-source oracle→mult scaling)
  is sidestepped by bake-shape/read-level + minOut.
- **P-B (build if the mid field is locatable + stable): Aquifer, then HumidiFi + BisonFi.** All
  CPI-open (no introspection); the work is empirically locating the internal/relay mid + slot field
  (diff the account bytes across consecutive oracle-update txs), reading it live with the sanity
  band, baking the spread shape. HumidiFi/BisonFi are the highest-volume prizes but the layout is
  undocumented and mutable — real ongoing maintenance risk, so documented-not-built here.
  (Correction to the working hypothesis: **BisonFi is NOT an on-chain 10-level order book** — its
  10-level book is an off-chain pricing construct pushed to the chain as a compact oracle payload;
  on-chain it is a 3-account push-oracle swap like HumidiFi/SolFi.)
- **P-C (external best-scan or drop): SolFi V2, GoonFi V2, AlphaQ** carry the Instructions
  sysvar (introspecting); **Tessera V** is P-B but maximally opaque; **Lifinity** wound down. Reach
  them only through `quoteViaSimulation` if the probe returns ACCEPT.
- **ZeroFi is NOT P-C — the reclassification is measured, see the section below.** Its Instructions
  sysvar read is a _caller fee tier_, not an accept/reject gate: an unrecognized caller's CPI
  succeeds and just pays the worst tier. The static screen's "Instructions sysvar ⇒ hard P-C" rule
  produced a false negative here; **treat sysvar-presence as P-C-_candidate_ and let step 2's
  unrecognized-caller simulation decide**, exactly as the probe's own text says for `absent`.

### ZeroFi (`ZERor4xh…`) — gate opened, quote path executed, curve still OPEN

Everything here is measured in-process against the real mainnet `.so` in LiteSVM (mainnet account
dumps, 5 pools). It supersedes the earlier "internal + introspection gate / P-C" row.

**1. The `swap_v4` prologue `Custom(5)` is a cluster-restart guard, not introspection.** At `.text`
`0x1ce78`–`0x1ced8` the handler calls a helper (`0x16818`) that does
`sol_get_sysvar(SysvarLastRestartS1ot…, offset 0, len 8)` and requires the result to **equal** a u64
stored in the pool account at `+0x1910`; mismatch returns `5`. Every synthetic transaction failed it
because LiteSVM defaults `last_restart_slot` to 0 while mainnet (and the pool field) hold
`246464040`. `svm.setLastRestartSlot(<mainnet value>)` opens it — the quote path then runs, ~24.7k CU
small / ~37k CU large. Nothing about the enclosing transaction is inspected for this check. A real
adapter must treat a _stale_ pool value as a **self-drop**, not a revert: the pool refuses to quote
after a cluster restart until the operator refreshes it.

**2. CPI from an unknown program SUCCEEDS.** A throwaway stub program CPI-ing `swap_v4` fills
normally. The Instructions sysvar (account 13, required — a bogus account there yields
`InvalidArgument`) is read to identify the **outermost** instruction's program id and select a fee
tier. Measured on one pool/size: Jupiter v6 `164858917` > OKX `164851728` > DFlow `164835240` >
ZeroFi-as-top-level `164829633` > **every unrecognized caller `164807704`** — 8 random ids and a
one-bit-apart pair all landed on that single value at an identical 31218 CU (a full no-match scan).
So **Sauce deterministically gets the worst tier, which is the conservative side**: whitelisting can
only improve the realized fill relative to a model built on the default tier.

**3. The quote's causal input set is tiny and fully enumerated** (per-8-byte-word perturbation scans
with both an integer-sized `+1` and an f64-mantissa-sized `+2^32` delta, at flat _and_ impacted
sizes, in both directions):

- oracle account `+0x30` — **f64 mid**, pass-through exactly 1 (residual < 1 wei over a ±100 bps sweep);
- oracle account `+0x38` / `+0x3c` — two u32 spreads in units of 1e-7, selected by **canonical**
  direction (`[0]` for side0→side1, `[1]` for side1→side0);
- in-side account `+0x360` and out-side account `+0x364` — i32 skews, also 1e-7 units;
- the **out-vault balance**, which acts purely as a cap (the fill **saturates** at it — it never
  collapses to zero);
- **all 4772 words of the 38 KB pool account are causally inert**, and the in-vault balance is inert.

**4. What is closed.** On the reference SOL/USDC pool, in the flat region, the default (Sauce) tier is
wei-exact over a wide synthetic parameter sweep (30/30, including asymmetric skews):

```
sk   = skewIn0 + min(skewOut1, 0)            // out-side skew counts only when negative
sk   = clamp(sk, -8000, POSCAP)              // floor is on the SUM, not per-term
dev  = -(2000 + 2*spr[dir]) + sk             // units of 1e-7; 2000 == the 2 bps default-tier fee
out  = floor(amountIn * rate * (1e7 + dev) / 1e7)     // rate = mid or 1/mid, exact rational from the f64 bits
```

With every parameter zeroed, `out == floor(amountIn * rate)` exactly — **there is no base protocol
fee**; the whole spread is the oracle's `spr` plus the skews plus the caller tier.

**5. What is NOT closed — do not ship an adapter.** Two independent gaps:

- a **notional-slice impact term** above roughly $300–$500 of notional, visible as a CU ladder
  (24.7k → 27k → 30k → 33k → 37k → 43k) that no readable account word controls. The fields that
  plausibly drive it (the in-side ladder at `+0x88/+0x98/+0x1d8/+0x1e0/+0x208/+0x210/+0x230…+0x288`)
  reject every perturbation with `Custom(10)`, so they are cross-validated and were not identifiable
  by perturbation.
- the flat form **does not generalize across pools with live parameters**: of 3 pools quoting in both
  directions it holds on 1, and on a wide-spread pool (`spr=10490`, `skewOut1=-8132`) it over-quotes
  from `amountIn=50` upward — so at least the `-8000` floor and `POSCAP` are per-pool, not constants.

A favourable model error on a venue quoting a few bps of spread manufactures a head that wins
elections it should lose, so the bar is **zero over-quotes or no adapter**. The remaining work is
localized: defeat the `Custom(10)` cross-check on the in-side ladder (or disassemble the impact loop)
and re-run the multi-pool exactness sweep.
