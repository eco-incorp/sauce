<!-- Generated from the SDK's registries. Do not edit. -->

# Tokens

**Reference** · [Documentation](../README.md)

> Tokens are the coins a program moves, such as USDC and WETH. In a program you write a token's
> symbol, and Sauce puts in its address on the chain the program runs on. This page lists every
> chain's tokens, the tokenized stocks among them, and the token functions.

A program compiled for a chain names that chain's registered tokens by symbol, with no import
(`USDC.balanceOf(ctx.self())`), and any other ERC-20 as `Token(<address>)`. In TypeScript the
same token is a property of the chain's export, `Base.USDC`, with its `address`, `decimals` and
`symbol`. Amounts are integers in the token's smallest units: nothing scales them by decimals.

On Solana the token methods are the same (`USDC.transfer(to, amount)`): each call's token
accounts are added to `main` and derived when the cook is built, and the symbol alone is the
mint's 32-byte key, a value for the `@sauce/token` functions (`balanceOf(USDC, account)`). Each
Solana mint's token program is legacy SPL Token or Token-2022, whose mints move by the checked
writes.

| Chain | Tokens | Tokenized stocks |
| --- | --- | --- |
| [Ethereum](chains/ethereum.md) | `USDC`, `USDT`, `WETH` | [1731](chains/ethereum-stocks.md) |
| [Optimism](chains/optimism.md) | `USDC`, `USDT`, `USDT0`, `WETH` | — |
| [Unichain](chains/unichain.md) | `USDT0` | — |
| [Polygon](chains/polygon.md) | `USDC`, `USDT0`, `WETH`, `WPOL` | — |
| [Monad](chains/monad.md) | `USDC`, `USDT0`, `WMON` | — |
| [Sei](chains/sei.md) | `USDT0` | — |
| [Mantle](chains/mantle.md) | `USDT0` | — |
| [Arc](chains/arc.md) | `EURC`, `USDC`, `USYC`, `WETH` | — |
| [Base](chains/base.md) | `USDC`, `WETH` | [67](chains/base-stocks.md) |
| [Plasma](chains/plasma.md) | `USDT0` | — |
| [Arbitrum One](chains/arbitrum.md) | `USDC`, `USDT0`, `WETH` | — |
| [Ink](chains/ink.md) | `USDT0` | — |
| [Berachain](chains/berachain.md) | `USDT0` | — |
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
| `USDT0` | `0x01bFF41798a0BcF287b996046Ca68b395DbC1071` | 6 |
| `WETH` | `0x4200000000000000000000000000000000000006` | 18 |

## Unichain

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x9151434b16b9763660705744891fA906F660EcC5` | 6 |

## Polygon

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 |
| `USDT0` | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 |
| `WETH` | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` | 18 |
| `WPOL` | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` | 18 |

## Monad

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 |
| `USDT0` | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 |
| `WMON` | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` | 18 |

## Sei

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x9151434b16b9763660705744891fA906F660EcC5` | 6 |

## Mantle

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 |

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

## Plasma

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` | 6 |

## Arbitrum One

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| `USDT0` | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |
| `WETH` | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | 18 |

## Ink

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x0200C29006150606B650577BBE7B6248F58470c1` | 6 |

## Berachain

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 |

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

| Chain    | Issuers (example symbols)                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ethereum | Backed's xStocks (`TSLAx`, `SPCXx`) and bTokens (`bTSLA`), Ondo Global Markets' (`TSLAon`, `SPCXon`), Mt Pelerin's own shares (`MPS`)                       |
| Base     | Coinbase's (`TSLAc`, `SPCXc`) and Backed's bTokens                                                                                                          |
| Solana   | Backed's xStocks (`TSLAx`), Ondo Global Markets' (`TSLAon`), Backpack Securities' (`NVDA_US`, `SPCX_US`), PreStocks' private companies (`SPACEX`, `OPENAI`) |

- **The symbol is the issuer's own ticker, in its case**: symbols are case-sensitive (`SPCXC` is
  not `SPCXc`), a `.` is written `_` (`BRK.Bx` is `BRK_Bx`, Backpack's `NVDA.US` is `NVDA_US`), and
  PreStocks' symbol is the company's name (`SPACEX`).
- **One company has one token per issuer**: SpaceX is `SPCXx` and `SPCXon` on Ethereum, `SPCXc` on
  Base, and `SPCXx`, `SPCXon`, `SPCX_US` and `SPACEX` on Solana. Find one by name or ticker with
  `sauce globals --chain base --search spacex`, list a chain's with `--stocks`, or read
  [the stock tokens of each chain](#stock-tokens-by-issuer).
- **Buying or selling one needs no account with its issuer**, and any contract can hold one, the
  Pot included; only minting and redeeming with the issuer need KYC.
- **An issuer can pause its token**, and refuses a sanctioned or blocked address.
- **Backed's tokens rebase**: a balance is shares times a multiplier the issuer moves, so it changes
  between transactions, never within one. A transfer can credit one unit less than sent, so paying
  one into a pool that checks what it received can fail; buying one is unaffected.
- **Ondo's keep their balance**: dividends raise the shares each token stands for, so its price
  follows the stock with dividends reinvested.
- **Coinbase's are B20 tokens**, built into the Base node: they run on Base and not in a local copy
  of the chain. Simulate a program that moves one with `sauce simulate` against Base itself; no
  assumed balance can give a Pot one.
- **Each issuer's list is copied from its own published list**, and every row is checked on chain.
  Backpack's mints it has not opened yet, and Superstate's (allowlisted holders only), are not
  registered.

```ts
function main(recipient: Address, amount: Uint256) {
  require(SPCXc.balanceOf(ctx.self()) >= amount, "not enough SPCXc");
  SPCXc.transfer(recipient, amount);
}
```

### On Solana

A stock on Solana is a Token-2022 mint with the same methods: `SPACEX.transfer(to, amount)` lowers
to the checked write, `transferChecked`, with the mint's decimals, and its symbol alone is the
mint's 32-byte key (`balanceOf(TSLAx, account)`). Token-2022 and the accounts it moves through are
[Solana](../guides/solana.md)'s; what is particular to the stocks:

- **Amounts are raw**, in the mint's decimals. The issuer's multiplier, by which a wallet shows
  them, moves for splits and dividends, so a raw unit is not always one share.
- **PreStocks' mints charge a transfer fee**: the recipient gets less than was sent. Measure what
  arrived; [the stock tokens of each chain](#stock-tokens-by-issuer) marks each mint that charges one.
- **Every stock mint has a transfer hook that names no program**, which is no hook.
- **The issuer can pause its mint**, and can hold a permanent delegate that can move or burn any
  balance. A new token account is usable, not frozen.

```ts
function main(recipient: Address, amount: Uint256): Uint256 {
  const before = SPACEX.balanceOf(recipient);
  SPACEX.transfer(recipient, amount);
  return SPACEX.balanceOf(recipient) - before;
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
