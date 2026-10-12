<!-- Generated from the SDK's registries. Do not edit. -->

# Chains

Every chain the SDK knows, with a file each: whether the initial release supports it, ids, native
coin, intents, its tokens and every protocol recorded there with its addresses. The Sauce
contracts have the same addresses on every EVM chain, and its programs the same ids on Solana:
[deployments.json](deployments.json) lists them once, with the shared intent Pot.

For the initial release, Sauce supports transactions on Ethereum, Base and Solana
(`ethereum`, `base`, `solana`). Every other chain is a preview chain: a program
compiles and simulates there, but the `sauce` command and the MCP server build and send no
transaction, and say so with the supported chains and how to request that chain. To request one,
look among the [existing requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support) and add your use case to the chain's,
or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml) with the chain-support issue form; each preview chain's
file links its own.

| Chain | Slug | Id | Kind | Support | Intents | CCTP | Tokens | Protocols |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Ethereum](ethereum.md) | `ethereum` | 1 | EVM | supported | yes | 0 | 1734 | 98 |
| [Optimism](optimism.md) | `optimism` | 10 | EVM | preview | yes | 2 | 4 | 41 |
| [Cronos](cronos.md) | `cronos` | 25 | EVM | preview | no | — | 0 | 0 |
| [BNB Chain](bsc.md) | `bsc` | 56 | EVM | preview | no | — | 0 | 30 |
| [Gnosis](gnosis.md) | `gnosis` | 100 | EVM | preview | no | — | 0 | 4 |
| [Fuse](fuse.md) | `fuse` | 122 | EVM | preview | no | — | 0 | 0 |
| [Unichain](unichain.md) | `unichain` | 130 | EVM | preview | yes | 10 | 1 | 4 |
| [Polygon](polygon.md) | `polygon` | 137 | EVM | preview | yes | 7 | 4 | 41 |
| [Monad](monad.md) | `monad` | 143 | EVM | preview | yes | 15 | 3 | 9 |
| [Sonic](sonic.md) | `sonic` | 146 | EVM | preview | no | 13 | 0 | 2 |
| [Manta Pacific](manta.md) | `manta` | 169 | EVM | preview | no | — | 0 | 0 |
| [opBNB](opbnb.md) | `opbnb` | 204 | EVM | preview | no | — | 0 | 1 |
| [Fantom](fantom.md) | `fantom` | 250 | EVM | preview | no | — | 0 | 7 |
| [Boba](boba.md) | `boba` | 288 | EVM | preview | no | — | 0 | 0 |
| [zkSync Era](zksync.md) | `zksync` | 324 | EVM | preview | no | — | 0 | 6 |
| [PulseChain](pulsechain.md) | `pulsechain` | 369 | EVM | preview | no | — | 0 | 0 |
| [Metis](metis.md) | `metis` | 1088 | EVM | preview | no | — | 0 | 1 |
| [Core](core.md) | `core` | 1116 | EVM | preview | no | — | 0 | 0 |
| [Moonbeam](moonbeam.md) | `moonbeam` | 1284 | EVM | preview | no | — | 0 | 0 |
| [Sei](sei.md) | `sei` | 1329 | EVM | preview | no | — | 1 | 1 |
| [Ronin](ronin.md) | `ronin` | 2020 | EVM | preview | yes | — | 0 | 0 |
| [Kava](kava.md) | `kava` | 2222 | EVM | preview | no | — | 0 | 0 |
| [Mantle](mantle.md) | `mantle` | 5000 | EVM | preview | no | — | 1 | 0 |
| [Arc](arc.md) | `arc` | 5042 | EVM | preview | yes | 26 | 4 | 24 |
| [ZetaChain](zetachain.md) | `zetachain` | 7000 | EVM | preview | no | — | 0 | 0 |
| [Klaytn](klaytn.md) | `klaytn` | 8217 | EVM | preview | no | — | 0 | 0 |
| [Base](base.md) | `base` | 8453 | EVM | supported | yes | 6 | 69 | 49 |
| [Evmos](evmos.md) | `evmos` | 9001 | EVM | preview | no | — | 0 | 0 |
| [Plasma](plasma.md) | `plasma` | 9745 | EVM | preview | yes | — | 1 | 1 |
| [Mode](mode.md) | `mode` | 34443 | EVM | preview | no | — | 0 | 2 |
| [Arbitrum One](arbitrum.md) | `arbitrum` | 42161 | EVM | preview | yes | 3 | 3 | 61 |
| [Celo](celo.md) | `celo` | 42220 | EVM | preview | no | — | 0 | 2 |
| [Avalanche C-Chain](avalanche.md) | `avalanche` | 43114 | EVM | preview | no | 1 | 0 | 33 |
| [Ink](ink.md) | `ink` | 57073 | EVM | preview | no | — | 1 | 1 |
| [Linea](linea.md) | `linea` | 59144 | EVM | preview | no | 11 | 0 | 8 |
| [Berachain](berachain.md) | `berachain` | 80094 | EVM | preview | no | — | 1 | 0 |
| [Blast](blast.md) | `blast` | 81457 | EVM | preview | no | — | 0 | 5 |
| [Scroll](scroll.md) | `scroll` | 534352 | EVM | preview | no | — | 0 | 8 |
| [Zora](zora.md) | `zora` | 7777777 | EVM | preview | no | — | 0 | 2 |
| [Aurora](aurora.md) | `aurora` | 1313161554 | EVM | preview | no | — | 0 | 0 |
| [Solana](solana.md) | `solana` | 1399811149 | Solana (SVM) | supported | yes | — | 1803 | 0 |
