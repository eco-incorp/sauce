# syrupUSDC routing + AlphaQ non-stable pricing (SDK-side venue fixes)

Two SVM venue-coverage fixes root-caused to `@eco-incorp/sauce-sdk`, both driven
by the SAME defect in the AlphaQ adapter.

## Evidence (live mainnet)
- Real **syrupUSDC** mint: `AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj` (legacy
  SPL Token, 6dp, ~1.178 USDC — yield-bearing). A second symbol-collision mint
  (`6yiQ3ZN…`) is **not tradable** — ignore it.
- Jupiter USDC→syrupUSDC: 100k → 84,852 syrup (~0.8485 syrup/USDC) via
  **[Whirlpool `6fteKN…`, AlphaQ `61LMyN…`, Manifest]**; 1m → 848,417 via
  [JupLend AMM `5rozJ…`, Whirlpool, Manifest, Whirlpool]. Sauce delivered ~1
  syrup for 100k USDC.

## Root cause (Items 1 & 2 are one bug)
The AlphaQ adapter (`sdk/src/svm/venues/alphaq/index.ts`) was hard-gated to a
curated `STABLE_MINTS` set **and** priced on a **1:1 parity assumption** (it had
no price oracle — the adapter's own docs admit AlphaQ's real pricing "could not
be identified from the outside"). So:
- The deep **AlphaQ SYRUPU-USDC** market (`61LMyN`, symbol `SYRUPU-USDC`) —
  syrup is not a curated stablecoin — **self-dropped**.
- That left only the shallow Whirlpool `6fteKN` leg (Jupiter routes just a split
  through it). Dumping all 100k USDC through a thin CL pool collapses the output
  → the ~1-unit route. **No Whirlpool decode bug** — the shallow-leg collapse
  fully explains it once the deep AlphaQ leg is gone.
- **JupLend AMM** (`5rozJ…`, owner `jupZ4m2…` = Jupiter Lend) is
  Jupiter-proprietary → an accepted **RFQ-class gap** (cause (c)); not addable.

## The AlphaQ price, reverse-engineered
AlphaQ's live oracle spot is in the market's **336-byte STATS account at offset
56** (`u64` LE, value = price × 1e10, price of mintA in mintB). Recovered by
cross-market correlation of stats@56/1e10 vs live rates across 40 markets — nails
21/40 within a few bps (the misses are bad price-API ground-truth for
illiquid/tokenized-equity markets and the mismatched-decimal SOL markets the
adapter gates out anyway):

| market | stats@56/1e10 | live rate |
|---|---|---|
| SYRUPU-USDC | 1.1783 | 1.1784 |
| MSOL-SOL | 1.3978 | 1.3979 |
| JITOSO-SOL | 1.2954 | 1.2954 |
| JUPSOL-SOL | 1.2032 | 1.2049 |
| every stablecoin pair | ~1.0000 | ~1.0 |

Stable across re-reads (a keeper-cranked oracle field, not a swap-mutated
counter); siblings at +8/+48 read within a bp (bid/ask around the mid).

## Fix (SDK-side)
`fetchAlphaqPoolConfig`:
- Reads `stats@56` → `priceRaw` (config field); classifies `isStablePair`
  (both mints curated-stable).
- **Lifts** the hard STABLE_MINTS-only gate: any **equal-decimal** market with a
  sane oracle price now resolves. A non-stable market with no readable stats
  price self-drops (throws → `resolveSvmPoolSpec` catches) rather than assuming
  parity. The `decimalsA === decimalsB` precondition stays (the stats price is a
  whole-coin rate, usable raw only at equal decimals).

`alphaqQuote` (generalizes the parity `cpQuote`, exported for the reference):
- **Stable pair** → the ORIGINAL parity model, **byte/lamport-identical**
  (regression-guarded by a unit test asserting equality with `cpQuote`).
- **Non-stable pair** → the symmetric CP base scaled by the oracle spot
  (`AtoB` × price, `BtoA` ÷ price), so the curve passes through the real spot at
  x→0 while still understating AlphaQ's (deeper) true depth — the safe
  direction; the on-chain CPI runs AlphaQ's own pricing and the recipe's
  outAta-delta check bounds the fill.

## Result
- syrupUSDC (SYRUPU-USDC, 6/6) now resolves and prices USDC→syrup at ~0.849 —
  matching Jupiter's realized 0.8485, not the old ~1.0. Verified in
  `sdk/test/svm/venues/alphaq.oracle.test.ts` against the live-captured fixture
  `fixtures/alphaq/syrupu-usdc.json`.
- Every non-stable **equal-decimal** AlphaQ market (LSTs, syrupUSDC, etc.) now
  serves; stablecoin pairs unchanged.

## Consumer note (sauce-recipes, on re-pin)
The SDK config now carries `priceRaw` for the off-chain reference/sizing. The
recipe ladder's on-chain fragment should read **stats@56 LIVE** at cook time
(the oracle price drifts between prepare and cook) — attach the stats account to
the quote refs and read the u64 at offset 56, divide by 1e10. The stats account
is already resolved on the config (`statsAccount`) and already rides the swap
CPI account list.

## Not addressed (documented)
- JupLend AMM leg: Jupiter-proprietary, RFQ-class — accepted gap.
- Mismatched-decimal AlphaQ markets (e.g. SOL-USDC 9/6): still gated out (raw
  price only meaningful at equal decimals) — same scope as before.
- The recipe-side live-read fragment change (above) is the consumer's re-pin
  step; this PR is the SDK enabler.
