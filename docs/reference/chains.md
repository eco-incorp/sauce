<!-- Generated from the SDK's registries. Do not edit. -->

# Chains

**Reference** · [Documentation](../README.md)

> Sauce knows 41 chains. On Ethereum, Base, Arc and Solana, the `sauce` command builds and sends
> transactions. Every other chain is a preview chain: programs compile there and the reads work, and
> simulate runs wherever the release is deployed, but no transaction is built or sent. Each chain
> has a page with its tokens and the protocols a program can call on it.

Every chain the SDK knows, with a page each: whether Sauce supports transactions on it, ids, native
coin, its tokens and every protocol recorded there with its addresses. The Sauce
contracts have the same addresses on every EVM chain, and its programs the same ids on Solana:
[Deployments](deployments.md) lists them once.

Sauce supports transactions on Ethereum, Base, Arc and Solana (`ethereum`, `base`, `arc`, `solana`); every other chain is a preview chain, as the last
section says.

| Chain | Slug | Id | Kind | Support | CCTP | Tokens | Protocols |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Ethereum](chains/ethereum.md) | `ethereum` | 1 | EVM | supported | 0 | 1734 | 96 |
| [Optimism](chains/optimism.md) | `optimism` | 10 | EVM | preview | 2 | 4 | 40 |
| [Cronos](chains/cronos.md) | `cronos` | 25 | EVM | preview | — | 0 | 0 |
| [BNB Chain](chains/bsc.md) | `bsc` | 56 | EVM | preview | — | 0 | 29 |
| [Gnosis](chains/gnosis.md) | `gnosis` | 100 | EVM | preview | — | 0 | 4 |
| [Fuse](chains/fuse.md) | `fuse` | 122 | EVM | preview | — | 0 | 0 |
| [Unichain](chains/unichain.md) | `unichain` | 130 | EVM | preview | 10 | 1 | 3 |
| [Polygon](chains/polygon.md) | `polygon` | 137 | EVM | preview | 7 | 4 | 39 |
| [Monad](chains/monad.md) | `monad` | 143 | EVM | preview | 15 | 3 | 8 |
| [Sonic](chains/sonic.md) | `sonic` | 146 | EVM | preview | 13 | 0 | 2 |
| [Manta Pacific](chains/manta.md) | `manta` | 169 | EVM | preview | — | 0 | 0 |
| [opBNB](chains/opbnb.md) | `opbnb` | 204 | EVM | preview | — | 0 | 1 |
| [Fantom](chains/fantom.md) | `fantom` | 250 | EVM | preview | — | 0 | 7 |
| [Boba](chains/boba.md) | `boba` | 288 | EVM | preview | — | 0 | 0 |
| [zkSync Era](chains/zksync.md) | `zksync` | 324 | EVM | preview | — | 0 | 6 |
| [PulseChain](chains/pulsechain.md) | `pulsechain` | 369 | EVM | preview | — | 0 | 0 |
| [Metis](chains/metis.md) | `metis` | 1088 | EVM | preview | — | 0 | 1 |
| [Core](chains/core.md) | `core` | 1116 | EVM | preview | — | 0 | 0 |
| [Moonbeam](chains/moonbeam.md) | `moonbeam` | 1284 | EVM | preview | — | 0 | 0 |
| [Sei](chains/sei.md) | `sei` | 1329 | EVM | preview | — | 1 | 1 |
| [Ronin](chains/ronin.md) | `ronin` | 2020 | EVM | preview | — | 0 | 0 |
| [Kava](chains/kava.md) | `kava` | 2222 | EVM | preview | — | 0 | 0 |
| [Mantle](chains/mantle.md) | `mantle` | 5000 | EVM | preview | — | 1 | 0 |
| [Arc](chains/arc.md) | `arc` | 5042 | EVM | supported | 26 | 4 | 23 |
| [ZetaChain](chains/zetachain.md) | `zetachain` | 7000 | EVM | preview | — | 0 | 0 |
| [Klaytn](chains/klaytn.md) | `klaytn` | 8217 | EVM | preview | — | 0 | 0 |
| [Base](chains/base.md) | `base` | 8453 | EVM | supported | 6 | 69 | 45 |
| [Evmos](chains/evmos.md) | `evmos` | 9001 | EVM | preview | — | 0 | 0 |
| [Plasma](chains/plasma.md) | `plasma` | 9745 | EVM | preview | — | 1 | 0 |
| [Mode](chains/mode.md) | `mode` | 34443 | EVM | preview | — | 0 | 2 |
| [Arbitrum One](chains/arbitrum.md) | `arbitrum` | 42161 | EVM | preview | 3 | 3 | 59 |
| [Celo](chains/celo.md) | `celo` | 42220 | EVM | preview | — | 0 | 2 |
| [Avalanche C-Chain](chains/avalanche.md) | `avalanche` | 43114 | EVM | preview | 1 | 0 | 33 |
| [Ink](chains/ink.md) | `ink` | 57073 | EVM | preview | — | 1 | 1 |
| [Linea](chains/linea.md) | `linea` | 59144 | EVM | preview | 11 | 0 | 8 |
| [Berachain](chains/berachain.md) | `berachain` | 80094 | EVM | preview | — | 1 | 0 |
| [Blast](chains/blast.md) | `blast` | 81457 | EVM | preview | — | 0 | 5 |
| [Scroll](chains/scroll.md) | `scroll` | 534352 | EVM | preview | — | 0 | 8 |
| [Zora](chains/zora.md) | `zora` | 7777777 | EVM | preview | — | 0 | 2 |
| [Aurora](chains/aurora.md) | `aurora` | 1313161554 | EVM | preview | — | 0 | 0 |
| [Solana](chains/solana.md) | `solana` | 1399811149 | Solana (SVM) | supported | — | 1803 | 0 |

## Supported and preview chains

Every chain but Ethereum, Base, Arc and Solana is a preview chain:
a program compiles and the reads work there, and `sauce simulate` runs wherever the release is
deployed on the chain, but the `sauce` command and the MCP server build and
send no transaction, and say so with the supported chains and how to request that chain. To
request one, look among the [existing requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support) and add your use case to
the chain's, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml) with the chain-support issue form; each
preview chain's page links its own.

On a preview chain the `sauce` command and the MCP server still compile and read: `sauce
compile`, `sauce globals`, `sauce price`, `sauce pools` and `sauce pot`'s prediction. `sauce
simulate` does not depend on the label: it runs wherever the release is deployed on the
chain, and says so where it is not. What they refuse there, before any endpoint is reached or any
key is read, is building or sending a transaction;
[the command's](../guides/cli.md#supported-and-preview-chains) and
[the server's](../guides/mcp-tools.md#supported-and-preview-chains) lists name each one. Every
refusal names the supported chains, and the MCP server's `sauce_chains` gives each chain's
support.

The TypeScript SDK is not gated: its builders take every chain below and build its
transactions, and an integrator who submits one on a preview chain does so at their own risk.

A chain-support request gives the chain and its id, what you want to run there, the protocols
and tokens it needs, the volume you expect and from when, and optionally how to reach you. Where
a request for the chain exists, add your use case to it as a comment instead of opening another.
A refusal links both, prefilled for the chain it refused.

## Next

- [Tokens](tokens.md): every chain's tokens, by the symbol a program writes.
- [Protocols](protocols.md): every protocol a program can call by name.
- [Names and registries](../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../concepts/glossary.md): the words these pages use, in plain terms.
