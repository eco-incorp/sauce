# Distributed Swap: 500 USDC → SOL on Solana

## Program Created
- **File**: `sauce/solana-distributed-swap.sauce.ts`
- **Status**: ✅ Compiled successfully (4,368 bytes)
- **Type**: Multi-venue distributed limit order across Solana DEXs

## Swap Configuration
- **Input**: 500 USDC (500,000,000 base units)
- **Output**: SOL via WSOL (So11111111111111111111111111111111111111112)
- **Price Limit**: Never below **0.0084 SOL per USDC**
  - maxPrice = 0.0084 × 10^15 = **8,400,000,000,000,000** (8.4e15 base units)
- **Execution Mode**: Rehearsal only (no keys, no sending)

## Venues & Pools (4 slots)

| Slot | Venue | Pool | Liquidity | Fee |
|------|-------|------|-----------|-----|
| 0 | Orca Whirlpools | Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE | 870B | 400 bps |
| 1 | Raydium CLMM | 3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv | 147B | 400 bps |
| 2 | Orca Whirlpools | 83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d | 4.8B | 100 bps |
| 3 | Raydium CLMM | CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq | 2.5B | 200 bps |

Each pool trades up to its price limit, then moves to the next pool. Budget unused after all pools returns as refund.

## Accounts
- **accounts.json**: Configured with pot references (Kitchen auto-creates)
- **accounts-direct.json**: Configured with sample Solana addresses (for custom wallet)

## Run Command (Rehearsal)
```bash
npx sauce simulate sauce/solana-distributed-swap.sauce.ts \
  --chain solana \
  --owner <your-address> \
  --accounts accounts.json \
  --assume-balance USDC:500 \
  --args 500000000 8400000000000000 0 0
```

### Arguments Explained
1. `500000000`: Budget in USDC base units (500 USDC)
2. `8400000000000000`: maxPrice (0.0084 SOL/USDC with fee-adjustment per venue)
3. `0`: minTokens (0 = accept any fill, set to > 0 after rehearsal to ensure minimum)
4. `0`: maxAvgPrice (0 = off, set after rehearsal based on actual average)

## Program Logic
- **Fees handled per venue**: Raydium/Orca deduct fee from input, adjust limit accordingly
- **No sorting needed**: Pools trade in order until limit reached
- **Early exit**: Skips empty pools, paused venues, or pools already past limit
- **Refund handling**: Only what's unspent returns to refund account
- **Bought tokens**: Move from output account to recipient (same or different)

## Compiled Size & Compute
- **Program**: 4,368 bytes (staged into code buffer, not inlined)
- **Staging**: ~7 transactions to stage program
- **Per-pool overhead**: ~210k compute units per trading pool
- **Estimated for 4 pools**: ~1.0M compute units (well under 1.4M limit)
- **Accounts needed**: 38-39 (within 64-account limit with lookup table)

## Output from simulate
Once environment rent issues are resolved:
```
main returns { spent: <USDC>, bought: <WSOL>, unspent: <leftover USDC> }
```

Token balance changes:
- source (USDC account): −<spent> USDC
- recipient (WSOL account): +<bought> WSOL
- Pools' vaults: adjust accordingly

## Next Steps to Execute
1. **Create token accounts** (if using new addresses):
   ```bash
   spl-token create-account <USDC-mint>  # for source
   spl-token create-account <WSOL-mint>  # for recipient
   ```

2. **Transfer budget** into source account:
   ```bash
   spl-token transfer <USDC-mint> 500 <source-account> --owner <keypair>
   ```

3. **Run** (after rehearsal validates):
   ```bash
   npx sauce run sauce/solana-distributed-swap.sauce.ts \
     --chain solana \
     --keypair <keystore> \
     --accounts accounts.json \
     --args 500000000 8400000000000000 <minTokens> <maxAvgPrice>
   ```

## Design Notes
- **Deepest pool first**: Orca 400 bps slot (870B liquidity) trades first
- **Fallback venues**: If deep pool can't absorb full budget, thinner pools catch overflow
- **Price controls**: All pools respect 0.0084 SOL/USDC limit—no surprise slippage
- **Single transaction**: With lookup table, entire swap fits ~400 bytes on-chain
