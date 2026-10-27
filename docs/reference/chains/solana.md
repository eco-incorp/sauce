<!-- Generated from the SDK's registries. Do not edit. -->

# Solana

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Solana: its tokens, and every protocol deployed there with the
> name a program writes for each contract. The `sauce` command builds and sends transactions on
> Solana.

**Supported.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet. On Solana a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `solana`; also `sol`, `mainnet-beta`, `solana-mainnet` |
| Chain id | 1399811149 |
| Kind | Solana (SVM) |
| Name in a program | `Solana` |
| In TypeScript | `import { Solana } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | not recorded |
| Sauce | the engine and Kitchen programs, the same ids on every cluster: [Deployments](../deployments.md) |

## Notes

The release's engine and Kitchen are deployed on mainnet, devnet and testnet. Each test
cluster is a chain of its own: `--chain solana-devnet` and `--chain solana-testnet` resolve the
chain id and token symbols to that cluster's. An endpoint does not change `solana`'s
compile-time chain identity or mainnet token symbols; `ctx.chainId()` reads the running
cluster's chain id. Devnet and testnet report 1399811150, with zero execution fees. Local
simulation selects the released engine build from the endpoint's cluster. The SDK's venues are
mainnet-only; the engine and Kitchen being on a test cluster does not deploy venues.

## In a program

Compiled with `--chain solana`, a program names Solana's mints with no import: a
symbol is the mint's 32-byte key, a value the `@sauce/token` functions take. A token account
is an `Account` parameter ([Solana](../../guides/solana.md)).

```ts
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
they are in [Solana stock tokens](solana-stocks.md), with their mints.

## Venues

Each venue, by the namespace a program swaps at one of its pools with, its protocol then its
program: at a price, `Orca.Whirlpool.swap(pool, tokenIn, tokenOut, amountIn, priceLimit,
minOut)`, which returns 0 having moved nothing where the pool cannot trade and reverts below
`minOut`. Its pool is found by key, `Orca.Whirlpool.pool(USDC, WSOL, 4)`, where the venue finds
pools by one: a key with no pool there is skipped. The pool's accounts, and the
Pot's, are derived when the cook is built ([`@sauce/router` on Solana](../../api/router-solana.md)).

| Namespace | Venue | Program | Pool by key |
| --- | --- | --- | --- |
| `Raydium.CLMM` | Raydium CLMM | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | fee |
| `Pancakeswap.CLMM` | PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` | fee |
| `Byreal.CLMM` | Byreal | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2` | fee |
| `Stabble.CLMM` | Stabble CLMM | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` | fee |
| `Orca.Whirlpool` | Orca Whirlpools | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | tick spacing |
| `Cropper.Whirlpool` | Cropper | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` | tick spacing |
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

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
