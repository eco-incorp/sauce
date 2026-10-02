<!-- Generated from the SDK's registries. Do not edit. -->

# Chain globals

A chain name opens an intent from inside a program
(`Ethereum.Portal.send({ token, amount }).receive({ token, amount }).then(() => { ... })`), and
qualifies a contract address (`Ethereum.UniswapV4.UniversalRouter`). An intent needs both chains
to take intents; each line says whether its chain does. Each line also says whether the initial
release supports the chain: a program compiles and simulates on every chain, and its transactions
are built and sent only on a supported one; on a preview chain the `sauce` command and the MCP
server refuse them. Each chain's file in `sauce-chains` has the rest, and how to request a
preview chain.

- `Ethereum`: `ethereum`, 1, EVM, takes intents, supported
- `Optimism`: `optimism`, 10, EVM, takes intents, preview
- `Cronos`: `cronos`, 25, EVM, no intents, preview
- `Bsc`: `bsc`, 56, EVM, no intents, preview
- `Gnosis`: `gnosis`, 100, EVM, no intents, preview
- `Fuse`: `fuse`, 122, EVM, no intents, preview
- `Unichain`: `unichain`, 130, EVM, takes intents, preview
- `Polygon`: `polygon`, 137, EVM, takes intents, preview
- `Monad`: `monad`, 143, EVM, takes intents, preview
- `Sonic`: `sonic`, 146, EVM, no intents, preview
- `Manta`: `manta`, 169, EVM, no intents, preview
- `Opbnb`: `opbnb`, 204, EVM, no intents, preview
- `Fantom`: `fantom`, 250, EVM, no intents, preview
- `Boba`: `boba`, 288, EVM, no intents, preview
- `Zksync`: `zksync`, 324, EVM, no intents, preview
- `Pulsechain`: `pulsechain`, 369, EVM, no intents, preview
- `Metis`: `metis`, 1088, EVM, no intents, preview
- `Core`: `core`, 1116, EVM, no intents, preview
- `Moonbeam`: `moonbeam`, 1284, EVM, no intents, preview
- `Sei`: `sei`, 1329, EVM, no intents, preview
- `Ronin`: `ronin`, 2020, EVM, takes intents, preview
- `Kava`: `kava`, 2222, EVM, no intents, preview
- `Mantle`: `mantle`, 5000, EVM, no intents, preview
- `Arc`: `arc`, 5042, EVM, takes intents, preview
- `Zetachain`: `zetachain`, 7000, EVM, no intents, preview
- `Klaytn`: `klaytn`, 8217, EVM, no intents, preview
- `Base`: `base`, 8453, EVM, takes intents, supported
- `Evmos`: `evmos`, 9001, EVM, no intents, preview
- `Plasma`: `plasma`, 9745, EVM, takes intents, preview
- `Mode`: `mode`, 34443, EVM, no intents, preview
- `Arbitrum`: `arbitrum`, 42161, EVM, takes intents, preview
- `Celo`: `celo`, 42220, EVM, no intents, preview
- `Avalanche`: `avalanche`, 43114, EVM, no intents, preview
- `Ink`: `ink`, 57073, EVM, no intents, preview
- `Linea`: `linea`, 59144, EVM, no intents, preview
- `Berachain`: `berachain`, 80094, EVM, no intents, preview
- `Blast`: `blast`, 81457, EVM, no intents, preview
- `Scroll`: `scroll`, 534352, EVM, no intents, preview
- `Zora`: `zora`, 7777777, EVM, no intents, preview
- `Aurora`: `aurora`, 1313161554, EVM, no intents, preview
- `Solana`: `solana`, 1399811149, SVM, takes intents, supported
