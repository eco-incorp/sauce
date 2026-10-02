<!-- Generated from the SDK's registries. Do not edit. -->

# Tokens

A program compiled for a chain names that chain's registered tokens by symbol, with no import
(`USDC.balanceOf(ctx.self())`), and any other ERC-20 as `Token(<address>)`. In TypeScript the
same token is a property of the chain's export, `Base.USDC`, with its `address`, `decimals` and
`symbol`. Amounts are integers in the token's smallest units: nothing scales them by decimals.

On Solana a symbol is the mint's 32-byte key, a value for the `@sauce/token` functions
(`balanceOf(USDC, account)`); the token accounts are `Account` parameters, and the token methods
(`USDC.transfer(...)`) are EVM-only. Each Solana mint's token program is legacy SPL Token or
Token-2022, whose mints a program moves with the checked writes.

| Chain | Tokens | Tokenized stocks |
| --- | --- | --- |
| [Ethereum](chains/ethereum.md) | `USDC`, `USDT`, `WETH` | [1731](chains/ethereum-stocks.md) |
| [Optimism](chains/optimism.md) | `USDC`, `USDT`, `WETH` | — |
| [Polygon](chains/polygon.md) | `USDC`, `WETH`, `WPOL` | — |
| [Monad](chains/monad.md) | `USDC`, `WMON` | — |
| [Arc](chains/arc.md) | `EURC`, `USDC`, `USYC`, `WETH` | — |
| [Base](chains/base.md) | `USDC`, `WETH` | [67](chains/base-stocks.md) |
| [Arbitrum One](chains/arbitrum.md) | `USDC`, `WETH` | — |
| [Solana](chains/solana.md) | `PYUSD`, `USDC`, `USDT`, `WSOL` | [1799](chains/solana-stocks.md) |

Every other chain registers no token: a program there uses `Token(<address>)`.

## Ethereum

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| `USDT` | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| `WETH` | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | 18 |

## Optimism

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 |
| `USDT` | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 |
| `WETH` | `0x4200000000000000000000000000000000000006` | 18 |

## Polygon

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 |
| `WETH` | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` | 18 |
| `WPOL` | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` | 18 |

## Monad

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 |
| `WMON` | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` | 18 |

## Arc

| Symbol | Address | Decimals |
| --- | --- | --- |
| `EURC` | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 |
| `USDC` | `0x3600000000000000000000000000000000000000` | 6 |
| `USYC` | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | 6 |
| `WETH` | `0x128cC466B61f542da60c70e3aA11c10e19B84EDB` | 18 |

The native coin is USDC (18 decimals), and `USDC`
is its ERC-20 face (6 decimals): one balance, read at two scales.
[Arc](chains/arc.md) has what that changes.

## Base

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| `WETH` | `0x4200000000000000000000000000000000000006` | 18 |

## Arbitrum One

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| `WETH` | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | 18 |

## Solana

| Symbol | Mint | Key, the value a program holds | Decimals | Token program |
| --- | --- | --- | --- | --- |
| `PYUSD` | `2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo` | `0x1792483b6c8a2a87b7471d814f9591f9395c840a9ce3d9f4d5ba7d3a4b8a749e` | 6 | Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) |
| `USDC` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61` | 6 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |
| `USDT` | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | `0xce010e60afedb22717bd63192f54145a3f965a33bb82d2c7029eb2ce1e208264` | 6 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |
| `WSOL` | `So11111111111111111111111111111111111111112` | `0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001` | 9 | SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |

Devnet's mints differ: [Solana](chains/solana.md) lists them.

## Tokenized stocks

A tokenized stock is a token like any other, named by its symbol with no import:
`SPCXc.balanceOf(ctx.self())`, `SPCXc.transfer(to, amount)`, a value for `@sauce/token`'s
functions, a token a swap buys or sells.

- **Ethereum**: Backed's xStocks (`TSLAx`, `SPCXx`) and bTokens (`bTSLA`), Ondo Global Markets'
  (`TSLAon`, `SPCXon`), and Mt Pelerin's own shares (`MPS`).
- **Base**: Coinbase's (`TSLAc`, `SPCXc`) and Backed's bTokens.
- **Solana**: Backed's xStocks (`TSLAx`), Ondo Global Markets' (`TSLAon`), Backpack Securities'
  (`NVDA_US`, `SPCX_US`) and PreStocks' shares of private companies (`SPACEX`, `OPENAI`), each a
  Token-2022 mint (below).

The symbol is the issuer's own ticker for the token, in its case: symbols are case-sensitive, and
`SPCXC` is not `SPCXc`. A `.` in a ticker is written `_`: `BRK.Bx` is `BRK_Bx`, and Backpack's
`NVDA.US` is `NVDA_US`. PreStocks' symbol is the company's name, `SPACEX`. One company has one token
per issuer: SpaceX is `SPCXx` and `SPCXon` on Ethereum, `SPCXc` on Base, and `SPCXx`, `SPCXon`,
`SPCX_US` and `SPACEX` on Solana. Find one by the company's name or ticker with
`npx sauce globals --chain base --search spacex`, list a chain's with `--stocks`, or read
[the stock tokens of each chain](#stock-tokens-by-issuer).

Buying and selling one on a DEX needs no account with its issuer, and any contract can hold it,
the program's Pot included; only minting and redeeming with the issuer need KYC. What differs from
a plain ERC-20:

- An issuer can pause its token, and refuses a sanctioned or blocked address.
- Backed's tokens rebase: a balance is shares times a multiplier the issuer moves, so it changes
  between transactions, never within one. A transfer can credit one unit less than sent, so paying
  one into a pool that checks what it received can fail; buying one is unaffected.
- Ondo's keep their balance: dividends raise the shares each token stands for (Ondo's multiplier),
  so its price follows the stock with dividends reinvested.
- Coinbase's are B20 tokens, built into the Base node: they run on Base, and not in a local copy of
  the chain. Rehearse a program that moves one with `sauce simulate` against Base itself; no assumed
  balance can give a Pot one, since no state override reaches a B20 balance.

Each issuer's list is copied from the issuer's own published list, and every row is checked on
chain. Backpack lists mints it has not opened yet, and Superstate's can be held only by an
allowlisted holder: neither is registered.

```ts
function main(recipient: Address, amount: Uint256) {
  require(SPCXc.balanceOf(ctx.self()) >= amount, "not enough SPCXc");
  SPCXc.transfer(recipient, amount);
}
```

### On Solana

A stock on Solana is a Token-2022 mint, and its symbol is the mint's 32-byte key, a value for
`@sauce/token`'s functions: `balanceOf(TSLAx, account)`. A program moves one with the checked
writes, `transferChecked` and `approveChecked`, which take the mint's token program, the mint and
its decimals beside the token accounts (`transfer` and `approve` take legacy SPL Token mints only).
`sauce` names each of those accounts by the symbol: `program:TSLAx` the token program,
`mint:TSLAx` the mint, `pot:TSLAx` the Pot's token account and `owner:TSLAx` the owner's.

- Amounts are raw, in the mint's decimals. The issuer's multiplier, by which a wallet shows them,
  moves for splits and dividends, so a raw unit is not always one share.
- PreStocks' mints charge a transfer fee: the token program keeps part of every transfer, so the
  recipient gets less than was sent. Measure what arrived, as below; the references mark each mint
  that charges one.
- Every stock mint has a transfer hook that names no program, which is no hook. `@sauce/token`
  refuses a mint whose hook names a program (`transfer hook`), and no registered mint has one.
- The issuer can pause its mint, and can hold a permanent delegate, which can move or burn any
  balance. A new token account is usable, not frozen.

```ts
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  mint: Account,
  destination: Account<Writable>,
  pot: Account<Signer>,
  amount: Uint256,
): Uint256 {
  const before = balanceOf(SPACEX, destination);
  transferChecked(SPACEX, tokenProgram, source, mint, destination, pot, amount, 9n);
  return balanceOf(SPACEX, destination) - before;
}
```

### Stock tokens by issuer

| Chain | Issuer | Tokens | For example |
| --- | --- | --- | --- |
| [Ethereum](chains/ethereum-stocks.md) | Backed | 1280 | `TSLAx`, `bTSLA`, `SPCXx` |
| [Ethereum](chains/ethereum-stocks.md) | Ondo Global Markets | 450 | `TSLAon`, `SPCXon`, `NVDAon` |
| [Ethereum](chains/ethereum-stocks.md) | Mt Pelerin | 1 | `MPS` |
| [Base](chains/base-stocks.md) | Coinbase | 58 | `TSLAc`, `SPCXc`, `NVDAc` |
| [Base](chains/base-stocks.md) | Backed | 9 | `bTSLA`, `bNVDA`, `bCOIN` |
| [Solana](chains/solana-stocks.md) | Backed | 1271 | `TSLAx`, `SPCXx`, `NVDAx` |
| [Solana](chains/solana-stocks.md) | Ondo Global Markets | 450 | `TSLAon`, `SPCXon`, `NVDAon` |
| [Solana](chains/solana-stocks.md) | Backpack Securities | 69 | `SPCX_US`, `NVDA_US`, `MSTR_US` |
| [Solana](chains/solana-stocks.md) | PreStocks | 9 | `ANDURIL`, `ANTHROPIC`, `FIGUREAI` |

## Token functions

Every program can call these `@sauce/token` functions with no import. The EVM writes are
SafeERC20: a token that returns nothing works, and one that returns `false` reverts.

On EVM chains:

- `balanceOf(token: Address, account: Account): Uint256`
- `totalSupply(token: Address): Uint256`
- `decimals(token: Address): Uint256`
- `allowance(token: Address, owner: Address, spender: Address): Uint256`
- `transfer(token: Address, to: Address, amount: Uint256): void`
- `transferFrom(token: Address, from: Address, to: Address, amount: Uint256): void`
- `approve(token: Address, spender: Address, amount: Uint256): void`
- `permit(token: Address, owner: Address, spender: Address, value: Uint256, deadline: Uint256, v: Uint256, r: Uint256, s: Uint256): void`
- `permitTransferFrom(token: Address, owner: Address, amount: Uint256, nonce: Uint256, deadline: Uint256, signature: bytes, permit2: Address): void`

On Solana:

- `balanceOf(token: Address, account: Account): Uint256`
- `ownerOf(token: Address, account: Account): Address`
- `totalSupply(token: Account): Uint256`
- `decimals(token: Account): Uint256`
- `allowance(token: Address, account: Account, spender: Address): Uint256`
- `transfer(token: Address, tokenProgram: Account, source: Account, dest: Account, authority: Account, amount: Uint256): void`
- `transferFrom(token: Address, tokenProgram: Account, source: Account, dest: Account, authority: Account, amount: Uint256): void`
- `approve(token: Address, tokenProgram: Account, source: Account, delegate: Account, authority: Account, amount: Uint256): void`
- `transferChecked(token: Address, tokenProgram: Account, source: Account, mint: Account, dest: Account, authority: Account, amount: Uint256, decimals: Uint256): void`
- `approveChecked(token: Address, tokenProgram: Account, source: Account, mint: Account, delegate: Account, authority: Account, amount: Uint256, decimals: Uint256): void`
