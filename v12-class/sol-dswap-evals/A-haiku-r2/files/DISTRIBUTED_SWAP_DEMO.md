# Solana Distributed Swap Demo

A distributed swap program that sells 500 USDC for SOL across multiple Solana venues at a price floor of 0.0084 SOL per USDC.

## Program Overview

**File:** `sauce/solana-distributed-swap.sauce.ts`

The program splits the 500 USDC order across 4 pools:
1. **Orca Whirlpools** — fee 400bp, liquidity 859.58T
2. **Raydium CLMM** — fee 400bp, liquidity 170.67T  
3. **PancakeSwap CLMM** — fee 100bp, liquidity 22.71T
4. **PancakeSwap CLMM** — fee 300bp, liquidity 13.47T

All pools support a sqrt price limit, so each trades only up to the price limit before stopping and leaving the rest for the next pool.

## Parameters

**Trade:** Sell 500 USDC for SOL  
**Price floor:** 0.0084 SOL per USDC (never go below this)  
**maxPrice:** 119047619047619047 (= 1e18 / 0.0084, in base units)  
**budget:** 500000000 (500 USDC, 6 decimals)  
**minTokens:** 4201680672 SOL (4.20168 SOL, from 500e6 * 1e18 / maxPrice, rounded up)  
**maxAvgPrice:** 119750000000000000 (halfway from rehearsal average to maxPrice, after simulation)

## Accounts File

**File:** `sauce/solana-distributed-swap-accounts.json`

Contains all 46 accounts needed for the transaction:
- Authority, source (USDC), output (WSOL), recipient, refund
- USDC and WSOL mints, token programs, memo program
- 4 pool slots (program, pool, config, vaults, tick arrays)

Each slot takes 9 accounts: `[program, pool, config, vaultA, vaultB, extra, ticks[0], ticks[1], ticks[2]]`

## Compilation

The program compiles to Solana bytecode successfully:

```bash
npx sauce compile sauce/solana-distributed-swap.sauce.ts --chain solana
```

**Bytecode size:** ~6.5 KB (staged into a code buffer before execution)

## Rehearsal

To rehearse the program (no keys, no sending):

```bash
# First rehearsal: see what fills and the average price
npx sauce simulate sauce/solana-distributed-swap.sauce.ts --chain solana \
  --owner <your-keypair-pubkey> \
  --accounts sauce/solana-distributed-swap-accounts.json \
  --assume-balance USDC:500 \
  --args 500000000 119047619047619047 0 0
```

**Note:** The simulation reads live pool data from Solana mainnet. The owner's account needs:
- Rent for any new token accounts created
- Transaction + compute fees (typically ~50k lamports)

If the owner doesn't have SOL, provide the key and it will ask you to fund it, or use an owner that already has SOL.

From the rehearsal output, read `main returns { spent, bought, unspent }` and use that to calculate the true average price: `spent * 1e18 / bought`. Then set `maxAvgPrice` to halfway between that average and `maxPrice`.

## Execution

After setting the correct minTokens and maxAvgPrice from a rehearsal:

```bash
npx sauce run sauce/solana-distributed-swap.sauce.ts --chain solana \
  --keypair <your-keypair> \
  --accounts sauce/solana-distributed-swap-accounts.json \
  --args 500000000 119047619047619047 <minTokens> <maxAvgPrice>
```

The program will:
1. Stage itself into a code buffer (~10 transactions)
2. Create an address lookup table for the 46 accounts
3. Send the cook
4. Close the code buffer

## Rules Implemented

- **Skips each pool** that is missing, empty, paused, or already past its own price limit
- **Reads live price, liquidity and fee** from each pool on-chain
- **Adjusts limit per pool** for its fee: `limit ÷ √(1 − fee)` for concentrated-liquidity, `limit ÷ (1 + fee)` for order books
- **Offers each pool the full remaining budget**, up to its adjusted limit
- **Takes only what each pool trades** before reaching its limit (no stranded input)
- **Checks the total**: bought ≥ minTokens, and average ≤ maxAvgPrice
- **Refunds unspent USDC** to the refund account
- **Sends bought SOL** to the recipient account

## Venues Supported

✅ Raydium CLMM  
✅ PancakeSwap CLMM  
✅ Byreal  
✅ Stabble CLMM  
✅ Orca Whirlpools  
✅ Cropper  
✅ DefiTuna  
✅ Crema  
✅ Phoenix (order book)

Each venue's pool layout, account order, and instruction format is baked into the program.

## What Fits in One Transaction

- **The program** is staged separately (too large for one tx)
- **Accounts** go through a lookup table (one byte each vs ~32 for full addresses)
- **4 pools + shared accounts** = ~46 accounts; fits in one transaction with a lookup table
- **Compute:** ~190k baseline + ~210k per pool that trades = ~1.0M compute units for 4 trading pools (limit: 1.4M)

A 5th pool requires a separate transaction.

## Data Sources

Pool data from `npx sauce pools --chain solana USDC WSOL --json`:
- Filtered to pools supporting a sqrt price limit
- Sorted by liquidity at the pool's current price
- Each returned with its 9-account slot for the token paid

Token mints:
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals)
- WSOL: `So11111111111111111111111111111111111111112` (9 decimals)
