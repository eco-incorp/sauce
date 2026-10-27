<!-- Generated from the SDK's registries. Do not edit. -->

# Solana Testnet

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Solana Testnet: its tokens, and every protocol deployed there
> with the name a program writes for each contract. The `sauce` command builds and sends
> transactions on Solana Testnet.

**Supported testnet.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet. On Solana Testnet a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them. Solana Testnet is a test network: its coin and tokens have no value.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `solana-testnet`; also `testnet` |
| Chain id | 1399811151, the SDK's key for the chain; a program reads 1399811150 (`chainId`, `ctx.chainId()`) |
| Kind | Solana (SVM) |
| Network | testnet: its coin and tokens have no value |
| Name in a program | `SolanaTestnet` |
| In TypeScript | `import { SolanaTestnet } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | not recorded |
| Sauce | the engine and Kitchen programs, the same ids on every cluster: [Deployments](../deployments.md) |

## Notes

Solana's testnet cluster, a chain of its own. Testnet runs devnet's engine build, so a program
compiled for it reads its chain id as 1399811150, as on devnet; 1399811151 is the SDK's key for
the chain, which names it to the command and the Pot store and which no program reads. Its
symbols are testnet's mints: the wrapped native alone, as Circle publishes no testnet USDC. The
release's engine and Kitchen are deployed on testnet, with zero execution fees. Its endpoint
must serve testnet: one of another cluster is refused. The Solana venues are mainnet's
programs and pools, so a venue name is refused here.

## In a program

Compiled with `--chain solana-testnet`, a program names Solana Testnet's mints with no import: a
symbol is the mint's 32-byte key, a value the `@sauce/token` functions take. A token account
is an `Account` parameter ([Solana](../../guides/solana.md)).

```ts
function main(account: Account): Uint256 {
  // `WSOL` is the mint `So11111111111111111111111111111111111111112`, as the key `0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001`.
  return balanceOf(WSOL, account);
}
```

## Tokens

| Symbol | Mint | Key, the value a program holds | Decimals | Token program |
| --- | --- | --- | --- | --- |
| `WSOL` | `So11111111111111111111111111111111111111112` | `0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001` | 9 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |

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
