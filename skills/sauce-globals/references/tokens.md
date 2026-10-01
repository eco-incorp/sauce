<!-- Generated from the SDK's registries: the names `sauce globals --chain <chain>` lists. Do not edit. -->

# Token globals

A program compiled for a chain names these symbols with no import. Each is that chain's token
address; amounts are in the token's smallest units (its decimals). Any other ERC-20 is
`Token(<address>)`.

## Ethereum (`ethereum`, 1)

- `USDC`: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, 6 decimals
- `USDT`: `0xdAC17F958D2ee523a2206206994597C13D831ec7`, 6 decimals
- `WETH`: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, 18 decimals

## Optimism (`optimism`, 10)

- `USDC`: `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`, 6 decimals
- `USDT`: `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58`, 6 decimals
- `WETH`: `0x4200000000000000000000000000000000000006`, 18 decimals

## Polygon (`polygon`, 137)

- `USDC`: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`, 6 decimals
- `WETH`: `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619`, 18 decimals
- `WPOL`: `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270`, 18 decimals

## Monad (`monad`, 143)

- `USDC`: `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`, 6 decimals
- `WMON`: `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`, 18 decimals

## Arc (`arc`, 5042)

- `EURC`: `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`, 6 decimals
- `USDC`: `0x3600000000000000000000000000000000000000`, 6 decimals
- `USYC`: `0x8a5D989Bbb96929F689B0200f435f53dA42bF490`, 6 decimals
- `WETH`: `0x128cC466B61f542da60c70e3aA11c10e19B84EDB`, 18 decimals

Native coin: USDC is also the ERC-20 `USDC`, one balance: 18 decimals natively, 6 through the ERC-20.

## Base (`base`, 8453)

- `USDC`: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals
- `WETH`: `0x4200000000000000000000000000000000000006`, 18 decimals

## Arbitrum (`arbitrum`, 42161)

- `USDC`: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, 6 decimals
- `WETH`: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`, 18 decimals

## Solana (`solana`, 1399811149)

A symbol is the mint's 32-byte key, a value for the `@sauce/token` functions
(`balanceOf(USDC, account)`); the token accounts are `Account` parameters, and the token
methods (`USDC.transfer(...)`) are EVM-only.

- `USDC`: mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, key `0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61`, 6 decimals
- `USDT`: mint `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, key `0xce010e60afedb22717bd63192f54145a3f965a33bb82d2c7029eb2ce1e208264`, 6 decimals
- `WSOL`: mint `So11111111111111111111111111111111111111112`, key `0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001`, 9 decimals

On devnet, pass a mint that differs as a define, which wins over the symbol
(`--define USDC=<key>`):

- `USDC`: mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, key `0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7`, 6 decimals
- `WSOL`: mint `So11111111111111111111111111111111111111112`, key `0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001`, 9 decimals

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
