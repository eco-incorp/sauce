<!-- Generated from the SDK's registries. Do not edit. -->

# Solana

**Supported.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana. On
Solana a program compiles and simulates, and the `sauce` command and the MCP server build
its transactions and send them.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `solana`; also `sol`, `mainnet-beta`, `solana-mainnet` |
| Chain id | 1399811149 |
| Kind | Solana (SVM) |
| Name in a program | `Solana` |
| Native coin | not recorded |
| Sauce | the engine and Kitchen programs, the same ids on every cluster: [deployments.json](deployments.json) (`svm`) |
| Intents (eco-routes) | takes intents; Portal `EcoowmRRrMyYtQCuh5fCvMDWcD6B9ZDZkpgedf2bWKXi` (key `0xca542f97103ea70daa48b4a15f9fd1c0a21a50bfac60a57717fc305f495f5245`) |

## In a program

Compiled with `--chain solana`, a program names Solana's mints with no import: a
symbol is the mint's 32-byte key, a value the `@sauce/token` functions take. A token account
is an `Account` parameter (`sauce-solana`).

```sauce chain=solana
function main(account: Account): Uint256 {
  // `USDC` is the mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, as the key `0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61`.
  return balanceOf(USDC, account);
}
```

## Tokens

| Symbol | Mint | Key, the value a program holds | Decimals | Token program |
| --- | --- | --- | --- | --- |
| `PYUSD` | `2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo` | `0x1792483b6c8a2a87b7471d814f9591f9395c840a9ce3d9f4d5ba7d3a4b8a749e` | 6 | Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) |
| `USDC` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61` | 6 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |
| `USDT` | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | `0xce010e60afedb22717bd63192f54145a3f965a33bb82d2c7029eb2ce1e208264` | 6 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |
| `WSOL` | `So11111111111111111111111111111111111111112` | `0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001` | 9 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |

And 1799 tokenized stocks, each a Token-2022 mint named by its symbol in the same way:
they are in [solana-stocks.md](solana-stocks.md), with their mints.

On devnet these mints differ: a program for devnet takes its mint as an `Address` parameter
of `main`, given to `--args` as the mint's base58 address:

| Symbol | Mint | Key, the value a program holds | Decimals | Token program |
| --- | --- | --- | --- | --- |
| `USDC` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | `0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7` | 6 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |
| `WSOL` | `So11111111111111111111111111111111111111112` | `0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001` | 9 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |

## Venues

Each venue whose swap a price limit stops, by the namespace a program swaps at one of its pools
with: `<Venue>.swap(pool, tokenIn, tokenOut, amountIn, maxPrice, minOut)`, or `trySwap(…)`,
which returns 0 where `swap` reverts. The pool's accounts, and the Pot's, are derived when the
cook is built (`sauce-swaps`).

| Namespace | Venue | Program |
| --- | --- | --- |
| `RaydiumClmm` | Raydium CLMM | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` |
| `PancakeswapClmm` | PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` |
| `Byreal` | Byreal | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2` |
| `StabbleClmm` | Stabble CLMM | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` |
| `OrcaWhirlpool` | Orca Whirlpools | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| `Cropper` | Cropper | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` |
| `Defituna` | DefiTuna | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9` |
| `Crema` | Crema | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` |
| `Phoenix` | Phoenix | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` |

## Protocols

The registry records no protocol deployment on this chain.
