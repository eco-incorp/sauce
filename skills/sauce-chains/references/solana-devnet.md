<!-- Generated from the SDK's registries. Do not edit. -->

# Solana Devnet

**Supported testnet.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet. On Solana Devnet a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them. Solana Devnet is a test network: its coin and tokens have no value.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `solana-devnet`; also `devnet` |
| Chain id | 1399811150 |
| Kind | Solana (SVM) |
| Network | testnet: its coin and tokens have no value |
| Name in a program | `SolanaDevnet` |
| Native coin | not recorded |
| Sauce | the engine and Kitchen programs, the same ids on every cluster: [deployments.json](deployments.json) (`svm`) |

## Notes

Solana's devnet cluster, a chain of its own: a program compiled for it reads its chain id as
1399811150, what the devnet engine reports, and its symbols are devnet's mints. The release's
engine and Kitchen are deployed on devnet, with zero execution fees. Seven venues run here,
each at its devnet program (under Venues below), and a pool by key is derived from devnet's
own configs, not mainnet's. Byreal and Cropper have no program on devnet, so their names are
refused here. PancakeSwap's program is on devnet, but its devnet pools lack the tick arrays a
swap at a price needs, so its name is refused too.

## In a program

Compiled with `--chain solana-devnet`, a program names Solana Devnet's mints with no import: a
symbol is the mint's 32-byte key, a value the `@sauce/token` functions take. A token account
is an `Account` parameter (`sauce-solana`).

```sauce chain=solana-devnet
function main(account: Account): Uint256 {
  // `USDC` is the mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, as the key `0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7`.
  return balanceOf(USDC, account);
}
```

## Tokens

| Symbol | Mint | Key, the value a program holds | Decimals | Token program |
| --- | --- | --- | --- | --- |
| `USDC` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | `0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7` | 6 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |
| `WSOL` | `So11111111111111111111111111111111111111112` | `0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001` | 9 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |

## Venues

Each venue, by the namespace a program swaps at one of its pools with, its protocol then its
program: at a price, `Orca.Whirlpool.swap(pool, tokenIn, tokenOut, amountIn, priceLimit,
minOut)`, which returns 0 having moved nothing where the pool cannot trade and reverts below
`minOut`. Its pool is found by key, `Orca.Whirlpool.pool(USDC, WSOL, 4)`, where the venue finds
pools by one: a key with no pool there is skipped. The pool's accounts, and the
Pot's, are derived when the cook is built (`sauce-swaps`).

| Namespace | Venue | Program | Pool by key |
| --- | --- | --- | --- |
| `Raydium.CLMM` | Raydium CLMM | `DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH` | fee |
| `Stabble.CLMM` | Stabble CLMM | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` | fee |
| `Orca.Whirlpool` | Orca Whirlpools | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | tick spacing |
| `Defituna.Fusion` | DefiTuna | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9` | tick spacing |
| `Crema.CLMM` | Crema | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` | tick spacing |
| `Phoenix.Market` | Phoenix | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` | by its address |
| `Meteora.DLMM` | Meteora DLMM | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | by its address |

`Meteora.DLMM`'s swap is an exact input, its venue's own with no price limit:
`Meteora.DLMM.swap(pool, tokenIn, tokenOut, amountIn, minOut)` pays all of `amountIn` or
fails the cook, and reverts below `minOut`.

## Accounts

The accounts a program writes where it uses them, each added to `main`, derived when the cook
is built (so what it is made of is known then) and checked on chain at the top of `main` to be
the account it names. Each is read-only unless `.writable()` or `.signer()` gives it that role.

| Expression | The account | Derived as |
| --- | --- | --- |
| `Account(key)` | the account at a key | `<key>` |
| `Account.pda(program, [seeds])` | the address program derives for the seeds | `pda:<program>:<seeds>` |
| `Account.systemProgram` | the System Program | `11111111111111111111111111111111` |
| `Account.tokenProgram` | SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| `Account.token2022Program` | Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| `Account.associatedTokenProgram` | the Associated Token Account program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| `Account.memoProgram` | the Memo program | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| `pot` | the Pot, which the program acts with through the Kitchen | `pot` |
| `pot.owner` | the Pot's owner, who signs the cook | `owner` |
| `<Sym>.accountOf(holder)` | the holder's associated account for the token | `<holder>:<Sym>` |
| `<Sym>.mint` | the token's mint | `mint:<Sym>` |
| `<Sym>.tokenProgram` | the token program that owns the mint | `program:<Sym>` |

## Protocols

The registry records no protocol deployment on this chain.
