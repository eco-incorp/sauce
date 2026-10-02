<!-- Generated from the SDK's registries. Do not edit. -->

# Token globals

A program compiled for a chain names these symbols with no import; each is that chain's token,
and amounts are in its smallest units (its decimals). Their addresses are in the chain's file in
`sauce-chains`. Any other ERC-20 is `Token(<address>)`.

- **Ethereum** (`ethereum`, [addresses](../../sauce-chains/references/ethereum.md)): `USDC` (6), `USDT` (6), `WETH` (18); and 1731 tokenized stocks ([stocks](stocks.md))
- **Optimism** (`optimism`, [addresses](../../sauce-chains/references/optimism.md)): `USDC` (6), `USDT` (6), `USDT0` (6), `WETH` (18)
- **Unichain** (`unichain`, [addresses](../../sauce-chains/references/unichain.md)): `USDT0` (6)
- **Polygon** (`polygon`, [addresses](../../sauce-chains/references/polygon.md)): `USDC` (6), `USDT0` (6), `WETH` (18), `WPOL` (18)
- **Monad** (`monad`, [addresses](../../sauce-chains/references/monad.md)): `USDC` (6), `USDT0` (6), `WMON` (18)
- **Sei** (`sei`, [addresses](../../sauce-chains/references/sei.md)): `USDT0` (6)
- **Mantle** (`mantle`, [addresses](../../sauce-chains/references/mantle.md)): `USDT0` (6)
- **Arc** (`arc`, [addresses](../../sauce-chains/references/arc.md)): `EURC` (6), `USDC` (6), `USYC` (6), `WETH` (18)
- **Base** (`base`, [addresses](../../sauce-chains/references/base.md)): `USDC` (6), `WETH` (18); and 67 tokenized stocks ([stocks](stocks.md))
- **Plasma** (`plasma`, [addresses](../../sauce-chains/references/plasma.md)): `USDT0` (6)
- **Arbitrum** (`arbitrum`, [addresses](../../sauce-chains/references/arbitrum.md)): `USDC` (6), `USDT0` (6), `WETH` (18)
- **Ink** (`ink`, [addresses](../../sauce-chains/references/ink.md)): `USDT0` (6)
- **Berachain** (`berachain`, [addresses](../../sauce-chains/references/berachain.md)): `USDT0` (6)
- **Solana** (`solana`, [addresses](../../sauce-chains/references/solana.md)): `PYUSD` (6), `USDC` (6), `USDT` (6), `WSOL` (9); and 1799 tokenized stocks ([stocks](stocks.md))

On Solana a symbol is the mint's 32-byte key, a value for the `@sauce/token` functions
(`balanceOf(USDC, account)`); the token accounts are `Account` parameters, and the token
methods (`USDC.transfer(...)`) are EVM-only. Devnet's mints, which differ, are in the Solana
file in `sauce-chains`, passed as a define that wins over the symbol. That file also names each
mint's token program: legacy SPL Token, or Token-2022, whose mints a program moves with the
checked writes (`sauce-solana`).

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
