# Swap Parameters Calculation

## Goal
Sell 500 USDC for SOL, never below 0.0084 SOL per USDC

## Tokens
- **Pay:** USDC (6 decimals)
- **Buy:** WSOL (9 decimals)

## Price Floor
```
Floor: minimum 0.0084 SOL per USDC
This means: at most 1/0.0084 USDC per SOL = 119.047619 USDC per SOL
```

## maxPrice Calculation
`maxPrice` = payToken base units per buyToken base unit, times 1e18

For USDC (6) → SOL (9):
```
maxPrice = 1e18 × payDecimals / buyDecimals ÷ floor
         = 1e18 × 10^(6-9) ÷ 0.0084
         = 1e18 × 10^(-3) ÷ 0.0084
         = 1e15 ÷ 0.0084
         = 119047619047619047.62...
         = 119047619047619047 (rounded down)

This means: pay at most 119047619047619047 base units USDC per 1e9 base units SOL
           = 119.047619047... USDC per SOL
           = 0.00840336... SOL per USDC (inverse)
```

The pool's last unit bought costs exactly `maxPrice` base units. Every earlier unit costs less.

## Budget
```
500 USDC = 500 × 10^6 base units = 500000000
```

## minTokens Calculation
If all 500 USDC is spent at `maxPrice`:
```
minTokens = budget × 1e18 ÷ maxPrice
          = 500000000 × 1e18 ÷ 119047619047619047
          = 500000000 × 1000000000000000000 ÷ 119047619047619047
          = 4201680671.999... × 10^9
          ≥ 4201680672 SOL base units (rounded up)

minTokens = 4201680672
In whole SOL: 4.201680672 SOL
```

Set `minTokens` to this value (or less) to ensure the order fills as much as budget allows within the price. If less fills within `maxPrice`, the order reverts unless `minTokens` is adjusted down.

## maxAvgPrice Calculation (after rehearsal)
After a rehearsal, read what `main` returned: `{ spent, bought, unspent }`.

Average price paid:
```
avgPrice = spent × 1e18 ÷ bought
```

Conservative limit (no worse than halfway to maxPrice):
```
maxAvgPrice = (avgPrice + maxPrice) ÷ 2
```

Example: if a rehearsal shows average 119.5 USDC per SOL:
```
avgPrice = 119500000000000000
maxAvgPrice = (119500000000000000 + 119047619047619047) ÷ 2
            = 119273809523809523.5
            ≥ 119273809523809524 (rounded up)

maxAvgPrice = 119273809523809524
```

## Pools Selected

The 4 deepest pools within the price limit, sorted by liquidity:

| Rank | Venue | Pool | Fee | Liquidity | Price (taker) | Within limit? |
|------|-------|------|-----|-----------|---------------|---------------|
| 1 | Orca Whirlpools | Czfq3xZZ… | 400bp | 859.58T | 117.665 USDC | ✅ Yes (117.665 < 119.048) |
| 2 | Raydium CLMM | 3ucNos4N… | 400bp | 170.67T | 117.664 USDC | ✅ Yes |
| 3 | PancakeSwap CLMM | DJNtGuBG… | 100bp | 22.71T | 117.631 USDC | ✅ Yes |
| 4 | PancakeSwap CLMM | 4QU2NpRa… | 300bp | 13.47T | 117.640 USDC | ✅ Yes |

All 4 pools have prices well below the 119.048 limit.

## Execution

### Rehearsal (no key, no sending)
```bash
npx sauce simulate sauce/solana-distributed-swap.sauce.ts --chain solana \
  --owner <your-pubkey-with-SOL> \
  --accounts sauce/solana-distributed-swap-accounts.json \
  --assume-balance USDC:500 \
  --args 500000000 119047619047619047 0 0
```

Read the output:
- **main returns { spent, bought, unspent }** — how much filled
- Calculate true average: `spent * 1e18 / bought`
- Set `maxAvgPrice` to halfway up to `maxPrice`

### Actual execution (signed, sent to chain)
```bash
npx sauce run sauce/solana-distributed-swap.sauce.ts --chain solana \
  --keypair <your-keypair> \
  --accounts sauce/solana-distributed-swap-accounts.json \
  --args 500000000 119047619047619047 4201680672 <maxAvgPrice-from-rehearsal>
```

## Gas & Compute

- **Program size:** 6.5 KB (staged into a code buffer)
- **Staging:** ~10 transactions to load the code buffer
- **Cook:** 1 transaction with a lookup table
- **Compute units:** ~1.0M for 4 trading pools (limit: 1.4M)
- **Execution fee:** Kitchen fee read from cluster (typically 5,000 lamports)

Total cost: staging rent + execution fees + cook transaction fee
