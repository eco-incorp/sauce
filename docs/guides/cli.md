# The sauce command

[Documentation](../README.md) · [Compiling programs](compiling.md) · [Create an intent](intents.md)

`@eco-incorp/sauce` installs a `sauce` command. It compiles a program file exactly as the SDK
compiles a route body, deploys the Pot the program runs on, rehearses the cook, signs it, sends it
and waits for it — on an EVM chain or on Solana — and takes transactions and programs back apart
afterwards. It needs no other tool and no configuration: it reads no environment variables, and
reads a chain through a built-in public endpoint unless you give it
[your own](#your-own-endpoints).

| Command          | What it does                                                                      |
| ---------------- | --------------------------------------------------------------------------------- |
| `sauce compile`  | Compile a program file; print its bytecode, or with `--json` what it takes        |
| `sauce actions`  | Lower a JSON actions document for a chain; print the SauceScript and its bytecode |
| `sauce simulate` | Rehearse the cook with no key, no deployed Pot and assumed balances: what it did  |
| `sauce run`      | Compile, sign, send and wait for the cook on your Pot                             |
| `sauce intent`   | Publish, fill, prove, claim, refund and cancel cross-chain intents                |
| `sauce tx`       | Print the unsigned cook transaction, for a wallet to sign                         |
| `sauce pot`      | Predict a Pot's address, and deploy it or print the transaction that does         |
| `sauce globals`  | List the tokens, protocols and other names a program on a chain can use           |
| `sauce price`    | Turn a price into a pool's `sqrtPriceX96`, a swap's limit and average-price floor |
| `sauce pools`    | List a pair's price-limit pools on a chain, deepest first, with their prices      |
| `sauce inspect`  | Take a cook, a Kitchen or Portal call, a program or a file apart                  |
| `sauce verify`   | Check that a payload, cook, intent or transaction runs the audited settle program |
| `sauce init`     | Scaffold a project that uses this package                                         |
| `sauce skills`   | Install, update or check this package's agent skills in a project                 |
| `sauce update`   | Update this `sauce` command to the latest release, the way it was installed       |

Every command takes `--help`. A mistyped invocation exits 2. A program that does not compile, a
cook that reverts, a rejected settle, an outdated skills install and a transaction on a
[preview chain](#supported-and-preview-chains) exit 1. For the initial release, transactions are
built and sent on Ethereum, Base and Solana only.

## Install

```sh
npm i -g @eco-incorp/sauce
sauce --version
```

Node.js 24 or newer. Every command in this guide is written as `sauce …`, the global install.

`sauce update` upgrades it to the latest release (or `--version <version>`), the way it was
installed: a global install by npm, pnpm, yarn or bun is installed again by that manager, and skills
installed in the current directory are then updated by the new `sauce`. A project's own copy is
the project's to update, so `sauce update` prints the command its package manager takes and changes
nothing; a copy in npx's cache prints the `npx -y` command. `sauce update --check` says which
version is installed and which is the latest, and installs nothing. It reads the npm registry, and
only then: `sauce` never checks for updates by itself.

Two other ways run the same command:

- **A project's pinned copy.** In a project that depends on the package (one `sauce init` wrote, or
  `npm i -D -E @eco-incorp/sauce`), `npx sauce <command>` runs the version its `package.json` pins.
  A global `sauce` there runs the global version, and `sauce skills status` reports skills installed
  from another version than the command's.
- **No install.** `npx -y @eco-incorp/sauce <command>` fetches the package and runs it. Never run
  a bare `npx sauce` outside a project that depends on the package: npx then fetches and runs npm's
  unrelated `sauce` package instead.

To start a new project, let the command scaffold it:

```sh
sauce init my-app
cd my-app
npm install
```

`sauce init` writes a `package.json` that pins `@eco-incorp/sauce` to exactly the version that ran
it and `viem` to exactly the version installed beside it (with `@types/node` for the skills'
TypeScript runners): a TypeScript project using the SDK depends on `@eco-incorp/sauce` and `viem`,
whose types its API is written in, and a package manager that does not hoist dependencies (pnpm)
resolves only a project's own. It also writes an `AGENTS.md` with the project's instructions for coding agents, a `.gitignore` that keeps
local configuration out of git, `sauce.config.example.json`, and `programs/tsconfig.json`
([In an editor](#in-an-editor)), and then installs the agent skills ([Agent skills](skills.md)). `init` refuses to overwrite a file that already has other content,
and lists it, unless you pass `--force`. It runs no package manager unless you pass `--install`.

## Endpoints and signers

A command that reads a chain needs no endpoint from you: it reads the chain through a built-in
public endpoint — one to three keyless ones per chain, each checked to serve the chain and state
overrides, the next taking over when one cannot be reached, refuses, rate-limits or fails — and
says so on stderr. Public endpoints can be slow or rate-limited; Kava, ZetaChain and Evmos have
none. `--offline` reads no chain at all: `sauce tx` then needs `--value`, and `sauce pot` only
predicts.

### Your own endpoints

Optional, and faster:

- `--rpc-url <url>`, the chain's endpoint; or
- `--config <file>`, a JSON file of endpoints by chain id, used for whichever chain the command is
  for (a chain it does not name is read through the built-in endpoint):

  ```json
  { "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
  ```

  `sauce init` writes `sauce.config.example.json` with `<…>` placeholders; copy it to
  `sauce.config.json`, which its `.gitignore` keeps out of git. A placeholder left in is refused.

The command checks that an EVM endpoint serves the chain you named. It never prints your URL: a
provider URL often carries a key.

### Signers

Nothing is signed without one of these, and the signer is always the Pot's owner (on Solana with
`--via engine`, which uses no Pot, the signer is the program's authority):

- `--wallet <name>`: a wallet `sauce wallet` keeps, EVM or Solana ([Agent wallets](#agent-wallets)).
- `--keystore <path>`: a JSON keystore (Web3 Secret Storage v3, scrypt or PBKDF2, as `cast wallet`
  and geth write).
- `--private-key <hex>`: works, with a warning: it lands in your shell history.
- `--keypair <path>`, on Solana: a keypair file, the JSON array of 64 bytes `solana-keygen` writes.

A wallet's or a keystore's password comes from one source you name, or else it is asked for at the
terminal without echo:

- `--password-env <NAME>`: the environment variable NAME, and no other.
- `--password-file <path>`: the file's text, one trailing newline dropped. A file that anyone but
  you can read or write is refused: `chmod 600` it.
- `--password-command "<command>"`: what the command prints, one trailing newline dropped. A secret
  manager's CLI (`pass show sauce`, `op read op://…`) fits. It runs with no stdin, and if it fails,
  the error gives its exit status and never its output.

There is no `--password <value>`: a value on the command line lands in shell history and the
process list. `--password-env` is the command's one read of the environment, and only of the
variable you name. Keys are read from the paths and wallets named only, never from the config file,
and no command prints one or a password: everything a command writes passes through a filter that
removes any secret it was given, error messages included.

## Supported and preview chains

For the initial release, the command builds and sends transactions on three chains: **Ethereum**,
**Base** and **Solana**. Every other chain it knows is a **preview chain**, where it compiles,
rehearses and reads but builds no transaction. [Chains](../reference/chains.md) has the policy:
which chains a cook, a publish and each step after it are held to, and every chain's support.

| On a preview chain                                                                                                                  | Does                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `compile`, `actions`, `simulate`, `globals`, `price`, `pools`, `inspect`, `verify`, `intent status`, `intent import`, `intent list` | What it does everywhere                                                        |
| `intent publish --dry-run`, `intent fill` without `--send`                                                                          | Rehearses, sending nothing                                                     |
| `pot`                                                                                                                               | Predicts the Pot, and with an endpoint reads it, but leaves the deployment out |
| `tx`, `run`, `pot --deploy`, `pot --format cast`                                                                                    | Refused                                                                        |
| `intent publish`, also with `--format`; `intent fill --send`; `intent prove`, `claim`, `refund`, `cancel`                           | Refused                                                                        |

The refusal comes before the command reaches an endpoint or reads a key. The command exits 1 and
says why, which chains are supported, and how to ask for the one it refused:

```text
sauce tx: building the cook transaction is refused: it involves optimism (Optimism, chain id 10), a preview chain. For the initial release, the sauce command and its MCP server build and send transactions only on Ethereum, Base and Solana. On a preview chain a program still compiles, and simulate and dry runs rehearse it.
To ask for Optimism: add your use case to its request if there is one (https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Optimism%22), or open one (https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Optimism+%2810%29&chain=Optimism&chain-id=10).
```

The first link searches the chain-support requests already filed for that chain; the second opens
a new one from the issue form, its title (`Chain support: <name> (<id>)`), chain and chain id
filled in.

`sauce pot` on a preview chain prints the Pot's address, owner, salt and Kitchen with no `to`,
`data` or `value`, and adds `refused` to its JSON — the same refusal as an object: `code`
(`"preview-chain"`), `action`, `message`, `supportedChains` and `previewChains`, each with its
`request`. `sauce --help` and the `--help` of every refused command say the same. There is no flag
that lifts the refusal.

## The flow on an EVM chain

A program runs as a **Pot**: a contract you own that holds what the program spends and calls
`cook(engine, program)` on the released engine. `cook` is `onlyOwner`, and pays the Kitchen's
execution fee as its value. The program here is `pay.sauce.ts`, whose inputs are `main`'s
parameters:

```js
// Pays `recipient` `amount` of the chain's USDC from the Pot.
function main(recipient: Address, amount: Uint256) {
  USDC.transfer(recipient, amount);
}
```

```sh
# 1. The names a program on Base can use: tokens, protocol contracts, functions.
sauce globals --chain base

# 2. Check that the program compiles.
sauce compile pay.sauce.ts --chain base

# 3. Deploy your Pot (once). Its address is known before it exists.
sauce pot --deploy --chain base --keystore ~/.keys/me.json

# 4. Fund the Pot with what the program spends: send its address the tokens, from any wallet —
#    or let `sauce run --fund` pull them in with the cook (see "Funding a run" below).

# 5. Rehearse the cook from the Pot's owner: no key, nothing sent. It can come first: a Pot not
#    deployed yet is deployed in the rehearsal, and --assume-balance gives it what it spends.
sauce simulate pay.sauce.ts --chain base --owner 0xYou \
  --assume-balance USDC:1 --args 0x… 1000000

# 6. Run it.
sauce run pay.sauce.ts --chain base --keystore ~/.keys/me.json \
  --args 0x… 1000000
```

`sauce run` compiles, rehearses the cook, signs it, sends it and waits for the receipt, then prints
the hash, the status and the gas used, what the cook cost, and what it moved:

```text
cook 0x5f…: success, gas used 184211, block 21004500
cost 0.000187 ETH: gas 184211 at 1000000 wei = 0.000184 ETH, L1 data 0.0000018 ETH, value 0.000001 ETH (the Kitchen's fee and any native the program spends)
Token transfers:
  1 USDC: 0x8a… (the Pot) -> 0x66…
Net balance changes:
  0x8a… (the Pot): -1 USDC
  0x66…: +1 USDC
```

The cost is the gas at the price the receipt records, an OP-stack chain's L1 data fee where the
receipt carries one, and the value the cook carried. What moved is read from the receipt's logs by
the decoder `simulate` uses: token transfers, approvals and each address's net change. `--json`
carries both under `cook.cost` and `cook.effects`.

A cook that would revert is not sent: the run stops with the decoded reason — a Pot or Kitchen
error by name, `Error(string)`, or `the program threw "…"` for a SauceScript `throw` — and exits 1.
The value defaults to the Kitchen's execution fee, read from the chain; pass `--value <wei>` when
the program also spends native currency (a `--value` below the fee is refused, since the cook would
revert).

If the Pot is not deployed yet, `run` asks first:

```text
Pot 0x8a… (owner 0xYou, salt 0x00…00) is not deployed on base. Deploy it now? [y/N]
```

`y` deploys it in a transaction of its own and then cooks; anything else sends nothing.

Every transaction a run sends before its cook is asked about like this: deploying a missing Pot (on
Solana, creating it), approving Permit2 for a token `--fund` pulls, and approving the Pot for an
amount under `--fund-mode allowance`. `--auto-approve` approves each of them without asking and
says so for each, as `auto-approved: deploy Pot 0x…` or `auto-approved: approve Permit2 for USDC`.
With no terminal to ask on (CI, a pipe), the run sends nothing: it names every action it would need
approved and stops, until it is given `--auto-approve`.

### A program from stdin

Any command that takes a program file takes `-` for one read from stdin, and so does every command
that takes an [actions document](#an-actions-document-instead-of-a-program):

```sh
cat pay.sauce.ts | sauce compile - --chain base --args 0x… 1
sauce inspect - --chain base < cook.hex
```

Stdin is read only when the file is `-`, never because a file is missing: a command whose stdin is
held open (an agent's shell, a CI step) would otherwise wait on it forever. `inspect -` reads hex, a
transaction hash or a program, whichever stdin carries, and `inspect --source -` the program.

A program from stdin has no directory of its own, so its relative imports
(`import { fee } from "./lib/fee.js"`) resolve against the current directory, or the one
`--source-dir <dir>` names; a compile error from one says so. The package's own modules — the
`./artifacts/*.json` and `./protocols/*` ABIs, `@sauce/token` — resolve as they always do.

Stdin carried the program, so it cannot answer questions too. They go to the terminal the command
runs in (`/dev/tty`) when there is one, so a program piped in at a terminal is still asked about.
With no terminal at all — or on Windows, which has no `/dev/tty` — a run sends nothing until
`--auto-approve` approves what it needs, and a keystore needs `--password-file`. Neither ever waits
on a stdin that is spent.

### Rehearsing: `sauce simulate`

`sauce simulate` runs the cook as a rehearsal from the Pot's owner: no key, no transaction, and
nothing on chain changes. It needs neither a deployed Pot nor the tokens the program spends:

```sh
sauce simulate pay.sauce.ts --chain base --owner 0xYou \
  --assume-balance USDC:2 --args 0x… 1000000
```

The owner is `--owner`, or the owner's key: `--keystore` (or `--private-key`; on Solana,
`--keypair`) names it, and signs nothing but the pulls `--fund` rehearses.

- **A Pot that is not deployed** is deployed in the rehearsal first. Anyone may send a Pot's
  `Kitchen.deployPot(owner, salt)`, and the Pot is the owner's whoever sends it, so the rehearsal
  sends it ahead of the cook. Name such a Pot by `--owner` (and `--salt`): a `--pot` address alone
  does not say whose it is.
- **`--assume-balance <TOKEN|address>:<amount>`**, repeatable, with the amount as `--fund` takes
  it, gives the Pot that balance for this rehearsal only, by state override. `ETH:<amount>` sets
  the Pot's native balance. A token keeps balances in its own storage (a proxy's, behind one), and
  the command finds the word with `eth_call` and state overrides alone — Solidity mappings at slots
  0–255, Vyper's at 0–31, OpenZeppelin's namespaced ERC-20 and Solady's — then confirms it with
  `balanceOf`. A token whose balance is computed rather than stored (rebasing, shares) is refused.
- **The cook's value**: an owner holding less than it (the Kitchen's fee, plus whatever `--value`
  or `--fund ETH:` adds) is given it for the rehearsal, and told.
- **`--fund`**: with the owner's key the rehearsal includes the signed pulls, and before the cook,
  in the same block, each approval or transfer `run` would send first (see
  [Funding a run](#funding-a-run---fund)). With no key the pulls cannot be signed, so the Pot is
  credited what they would bring — its balance plus each amount, or the amount on top of an
  `--assume-balance` of the same token — `--sweep` still runs, and a shortfall in your wallet is
  reported rather than refused.

It rehearses through `eth_simulateV1` where the endpoint serves it: one simulated block holding
the deployment and the cook, state carried from one to the next, with the cook's logs. Everything
it reads first (the Pot, the Kitchen's fee, the balances it assumes) and the rehearsal itself run on
one block: the latest when the command starts, or the one `--block <number | latest | safe |
finalized>` names, so a limit computed from a quote can be rehearsed on the state the quote saw. The
`Rehearsed with …` line, and `block` in `--json`, say which. On success it prints each
transaction's gas — the Pot's deployment and the cook, when it deploys the Pot first (`transactions`
in `--json`, where `gas` is the cook's) — and what the program returned — read as the type `main` declares, where it declares one (`main returns
Address: 0xd0b5…`, an array as its elements, a record as its fields; `returnType` and `returned`
in `--json`) — then what the cook did:

```text
The cook succeeds from 0xYou: gas used 128999 for the cook, after the Pot's deploy (1. below), returns 0x
Rehearsed with eth_simulateV1 on the state of block 36120411; nothing was signed or sent:
  1. Kitchen.deployPot(0xYou, 0x00…00), gas used 160415: Pot 0x8a… is not deployed on base yet. Any account may send this; the Pot is the owner's either way.
  2. the cook, from the owner 0xYou, gas used 128999
Assumed for this rehearsal only, by state override:
  the Pot holds 2 USDC: --assume-balance (its balance word 0x1d39…: Solidity mapping at slot 9)
  the owner holds 0.00000374478538635 ETH: the cook's value; it holds 0, and a real cook needs the value and gas
Token transfers:
  1 USDC: 0x8a… (the Pot) -> 0x66…
Native transfers:
  0.00000374478538635 ETH: 0xYou (owner) -> 0x8a… (the Pot)
  0.00000374478538635 ETH: 0x8a… (the Pot) -> 0x1984… (Kitchen)
Net balance changes:
  0x8a… (the Pot): -1 USDC
  0x66…: +1 USDC
  0xYou (owner): -0.00000374478538635 ETH
  0x1984… (Kitchen): +0.00000374478538635 ETH
```

ERC-20 `Transfer` and `Approval` logs are decoded with the registry's symbols and whole units (a
token the registry does not record is named by its own `symbol()` and `decimals()`), native
transfers come from the node's `traceTransfers`, wrapping and unwrapping the wrapped native token
count as moves, and every other log is counted, and listed in full under `--json`. Addresses the
registry records are named, as are the Pot, its owner and the Kitchen.

An endpoint without `eth_simulateV1` falls back to `eth_call` with state overrides. A Pot that is
not deployed is then put in place as its deployment would leave it: an `eth_call` creation runs
the real `Kitchen.deployPot` and returns the Pot's code, and the cook runs from the owner against
that code, set at the Pot's address by override with its Router's storage word and a new
contract's nonce. That route reports the result and an estimated gas but no logs, so not what
moved. The `Rehearsed with …` line names the route taken, and why it fell back.

A revert prints `The cook reverts: <reason>` (or `Deploying the Pot reverts: …`) and exits 1: a
Pot, Kitchen, Router, Permit2 or Portal error by name, ERC-20's standard errors, `Error(string)`, or
`the program threw "…"` for a SauceScript `throw` or `require` message. A pool's short revert string
says what the check is: `"SPL" (a V3-style pool's price-limit check: the limit is on the wrong side
of the pool's current price, or at or past a bound …)`, and likewise `AS`, `LOK`, `IIA`, `TF`, the
token helpers' `STF`, `ST`, `SA`, `STE`, and a V2-style pair's `UniswapV2: K` (or any fork's). A
`main` argument named like a price limit (`sqrtPriceLimitX96`) at or past `MIN_SQRT_RATIO` or
`MAX_SQRT_RATIO` is named on stderr before the rehearsal, by `compile` and `publish` too. `--json`
carries the same as fields: `block`, `path`, `fallback`, `deployPot`, `assumed`, `gas` and
`gasKind` (`used` or `estimated`), `returns`, `returnType` and `returned`, `transfers`,
`approvals`, `nativeTransfers`, `balanceChanges` and `otherLogs`, amounts as decimal strings in
base units with `formatted` whole units beside them — or `stage` and `reason` for a revert.

### Funding a run: `--fund`

A program spends what its Pot holds. Instead of sending the Pot tokens first, `sauce run` can pull
them from your wallet in the same transaction as the cook:

```sh
sauce run pay.sauce.ts --chain base --keystore ~/.keys/me.json \
  --fund USDC:1.5 --sweep --args 0x… 1000000
```

`--fund <TOKEN|address>:<amount>` names a token the chain registers (`sauce globals --tokens`) or
any ERC-20 by address, and an amount in whole tokens — `USDC:1.5`, by the registry's decimals or
the token's own. A bare integer is whole tokens too: `USDC:1500000` is 1.5 million USDC, which the
command points out on stderr. For base units, end the amount in `n`, as a JavaScript bigint is
written: `USDC:1500000n` is 1.5 USDC. Repeat it for more tokens.
`ETH:<amount>` (or `native:`) is the chain's native currency: it rides as the cook's value, on top
of the Kitchen's fee.

The command wraps the program: a new `main`, with the same parameters, first pulls each amount from
you into the Pot, then calls the program's own `main` with the arguments as given, then, with
`--sweep`, sends the Pot's whole balance of each funded token (and of the native currency, when
`ETH` is funded) back to you. A script gets the pulls after its imports and the sweep after its
last statement. It is one cook, so the pulls, the program and the sweep succeed or
revert together. The pulls are `@sauce/token`'s, the same functions a program can call itself
([Pulling tokens in](protocols-and-tokens.md#pulling-tokens-in)). Your balance of each token is
checked before anything is sent.

`--fund-mode` chooses how the Pot is allowed to pull:

| Mode                | You sign or send                                               | What stands afterwards                        |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `permit2` (default) | A Permit2 signature for exactly this amount, to this Pot, once | Nothing for the Pot; your approval of Permit2 |
| `permit`            | The token's own EIP-2612 `permit` signature, for the Pot       | Nothing: the pull spends it                   |
| `allowance`         | An `approve` of the Pot for the amount, in a transaction first | The Pot's allowance, until a cook spends it   |
| `transfer`          | A plain `transfer` to the Pot, in a transaction first          | Nothing                                       |

**Why `permit2` is the default.** It works for every ERC-20, USDT included, where `permit` needs a
token that implements EIP-2612. It gives the Pot no allowance at all: each signature is for one
amount, to one spender, with a fresh nonce Permit2 spends and a deadline ten minutes out, so it
cannot be replayed or used late. And it is one transaction per run, the cook itself. Permit2 is
the canonical deployment the registry records (`sauce globals --protocols` lists it as
`Permit2.Permit2`).

The first time you fund a token through Permit2, Permit2 itself needs your approval for that token
— a standing approval, as Permit2 is meant to have; each spend still needs your signature. The run
asks, as it does before deploying a Pot:

```text
Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3) may move 0 of your USDC (base units), and this run needs 1500000. Approve Permit2 for USDC now? [y/N]
```

`y` sends the approval (reset to zero first when a smaller one stands, as USDT requires) and then
the cook; anything else sends nothing. With no terminal to ask on, the run names it and sends
nothing, unless you pass `--auto-approve`. `--fund-mode allowance` asks the same about approving
the Pot, and warns when it leaves an
allowance standing. `permit` refuses a token whose `DOMAIN_SEPARATOR()` does not match its name,
version and address, before sending anything.

**Every pull is a `safeTransferFrom`.** In `permit` and `allowance` modes the program pulls with
`@sauce/token`'s `transferFrom`, which has OpenZeppelin `SafeERC20` semantics: a token that returns
nothing (USDT) is accepted, and one that returns `false` reverts the whole run. In `permit2` mode
Permit2's `permitTransferFrom` moves the tokens with Solmate's `SafeTransferLib.safeTransferFrom`,
with the same outcome for both kinds of token. The `permit` call itself is checked as OpenZeppelin's
`safePermit` checks it: the token's nonce for you must move by exactly one.

Security notes:

- Signatures are made locally, by the signer you gave, over EIP-712 data the command prints nothing
  of; no key is ever printed. A Permit2 signature names the Pot as its spender, and only the Pot's
  owner can cook on the Pot, so nobody else can use it.
- A revert inside Permit2 is reported by name: `SignatureExpired(…)` for a passed deadline,
  `InvalidNonce()` for a nonce already spent.
- `allowance` mode's approval is its own transaction: if the cook then fails, the allowance stands
  until a later cook spends it or you change it. `transfer` mode's transfer is likewise sent before
  the cook, and the tokens stay in the Pot if the cook fails.

`sauce simulate --fund` rehearses the same wrapped cook, with nothing sent. The pulls carry your
signature, so give the owner's key (`--keystore` or `--private-key`) to sign them. Without a key
the Pot is credited what the pulls would bring instead, by state override
([Rehearsing](#rehearsing-sauce-simulate)). With the key, each approval `run` would ask for (a
standing allowance reset to zero first, as for USDT) and `transfer` mode's transfer runs from your
wallet before the cook, in the same `eth_simulateV1` block, and nothing of it is sent: each is
listed as a transaction of its own, with its gas (`transactions` in `--json`, with its `to` and
`data`), for `run` to send first. An endpoint without `eth_simulateV1` cannot run them ahead of
the cook, and says so.

### Pots and salts

An owner has one Pot per salt; the default salt is zero. Name another with `--salt <label>`, which
is `keccak256` of the label's UTF-8 bytes (the SDK's `potSalt(label)`), or give the exact 32 bytes
with `--salt-hex 0x…`. Use the same salt in every command for that Pot.

```sh
sauce pot --chain base --owner 0xYou --salt treasury
```

prints the Pot's address — CREATE2 from the Kitchen over the owner and salt — and the unsigned
`Kitchen.deployPot(owner, salt)` transaction as JSON. With `--deploy` and a signer it sends it,
unless the Pot is already there, and waits until the endpoint shows the Pot's code before saying it
is deployed: a load-balanced endpoint can answer from a node that has not seen the block yet. Any
account may deploy a Pot; it is its owner's either way. So `pot --deploy` takes `--owner` for
another owner's Pot, which the signer sends and pays for — how the Pot every intent to a chain
cooks on, owned by that chain's Portal Executor, is deployed — and defaults the owner to the
signer. On Solana the owner signs `create_pot`, so there the signer creates its own.

With a signer and no `--owner`, `sauce pot` is the signer's own Pot: `sauce pot --chain base
--keystore ~/.keys/me.json` prints your address and your Pot. A keystore that records its address
(most wallets write one) is read with no password; one that does not is unlocked to learn it.

Without `--deploy`, `sauce pot` also reads the chain (or the Solana cluster) and
adds what it found under `deployment`, and in a line on stderr: whether the released engine and
Kitchen are there, the Kitchen's execution fee, and whether the Pot is deployed and whose it is.
`--deploy` refuses a chain with no Kitchen rather than send a `deployPot` to an address without
code, which would succeed and deploy nothing.

```sh
sauce pot --chain base --owner 0xYou
```

`run` and `publish` act for the signer, so the owner is the signer: `--owner` may only restate it,
and one that names someone else is refused. `simulate`, `tx` and plain `pot` have no signer and
take `--owner` (or, for `simulate` and `tx`, `--pot <address>`, of a deployed Pot).

### For a wallet: `sauce tx`

```sh
sauce tx pay.sauce.ts --chain base --owner 0xYou --value 1000 --args 0x… 1000000
```

prints the cook unsigned, for any wallet to sign from the owner:

```json
{ "chainId": 8453, "to": "0x8a…", "data": "0x…", "value": "1000" }
```

The value is `--value`, or else the Kitchen's fee, read from the chain, which also checks the Pot.
What must be true for it to land — the Pot deployed and funded, sent from its owner — goes to
stderr.

`--format cast` prints the same transaction as a `cast send` line instead, for
[Foundry](https://getfoundry.sh/cast/overview) users; it is never needed. The line leaves the
endpoint and the signer as `<RPC_URL>` and `<PRIVATE_KEY>` placeholders: the command never fills in
either. `sauce pot --format cast` does the same for the deployment.

## Writing the program file

The file is compiled for the chain as a standalone program (`routes.compileSauceProgram`, the
compile half of `routes.compileSauceRoute`, with the chain's names and the default token module):
the chain's token symbols (`USDC`), protocol namespaces (`Uniswap.UniversalRouter`), `chainId`, the
`@sauce/token` functions (`transfer(token, to, amount)` and the rest, with no import), the token
syntax (`USDC.transfer(...)`, `Token(address).approve(...)`, both SafeERC20) and
[intents opened inside the program](intents.md#create-an-intent-from-inside-a-program) all resolve
against it. One file therefore compiles for every chain whose names it uses. `sauce globals --chain
<c>` lists the names; [Protocols and tokens](protocols-and-tokens.md) explains them. Relative imports
are read from beside the file.

A file declares `function main(...)`, whose parameters are every input it takes, or is a script —
top-level statements, which are the program, with no inputs. It reaches the compiler as written:
imports, helper functions, `interface` declarations and annotations included. A script's imports
come first, and its top-level `const`s are the script's own locals, which a function cannot read;
declare `main` to take inputs, to share a module constant with functions or to return a value.

### Choosing the chain

`--chain` takes a slug, an alias or a chain id: `base`, `eth`, `8453`, `solana`. A file can carry
its own, in the `//` comment lines it starts with; a flag overrides it:

```js
// @chain base
// Pays `recipient` `amount` of Base's USDC from the Pot.
function main(recipient: Address, amount: Uint256) {
  USDC.transfer(recipient, amount);
}
```

`--target evm|svm` (or a `// @target` line) is a check against the chain. `--target svm` with no
chain means `solana`.

### Inputs: `main`'s arguments

Every value a program takes from you is a parameter of `main`. They arrive at run time, so one
compiled program serves every call:

```js
function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool) {
  for (let i = 0; i < recipients.length; i = i + 1) {
    transfer(token, recipients[i], amount);
    if (alsoUsdc) {
      USDC.transfer(recipients[i], amount);
    }
  }
}
```

`sauce compile --json` reports them (`entryParams`, `entryEncoding`, and `entrySchema` under
`--compact-args`). `simulate`, `run` and `tx` take them after `--args`, in order — a flag after
them is still a flag, and `--` before an argument that starts with `--` keeps it one — or as one
JSON array with `--args-json '[…]'` (or a file):

```sh
sauce run split.sauce.ts --chain base --keystore ~/.keys/me.json \
  --args 0xToken '["0xA…","0xB…"]' 1000000 true
```

An array or tuple argument is JSON. Each value is checked against its declared type before
anything is sent — `Address`, `Uint256` (also `number`, `bigint`), `bool`, `bytes`, `string`, `T[]`
and `{ field: T }` — and a wrong one is named:
`argument 1 (token: Address): '0x12' is not an address: 20 bytes of 0x-prefixed hex`. They are
encoded ABI-v1 by default, compact-v1 under `--compact-args`, and appended to the program: the SDK's
`routes.encodeEntryArguments`, whose inverse `routes.decodeEntryArguments` is what `sauce inspect`
reads them back with.

A value the program fixes for every run, such as a fee, is a module-level `const` beside `main`.
An intent file takes its inputs the same way, and `sauce intent publish` fixes them into the
intents it publishes ([Intents](#intents-sauce-run-or-sauce-intent)).

`sauce compile --json` reports what the compile applied:

- `defines`: each name compiling for the chain gave the program, its value, its `kind` (a `token`
  symbol, a protocol `contract` such as `UniswapV3_Factory`, the `chain id`) and the `chain` it
  applied on. An intent body the file opens reads its own chain's names, so its `USDC` is listed
  again with that chain.
- `contracts`: each protocol contract the program calls or reads (`UniswapV3.Factory.getPool(…)`,
  `Cctp.TokenMessenger`), as written and as resolved, with the chain whose deployment it is — an
  intent body's resolves on the intent's own chain.
- `size`, the program's bytes, and `payload`, the program with `main`'s arguments appended, given
  with `--args` or `--args-json` (`null` until they are).
- `returnType`: the type `main` declares it returns, an `interface` spelled out (`null` when it
  returns nothing), which `simulate` reads the cook's return data as.
- A value is an address where it is a token or a contract (on Solana a base58 key); any other is
  the integer it is, whatever its size.
- On Solana, `cook`: the size of the cook's transaction against the 1232-byte limit, measured as
  `sauce run` builds it, with each `--account` given and a distinct account for every other slot —
  the Kitchen's cook, or with `--via engine` the engine's direct one, which is smaller (no Kitchen,
  Pot or salt). Past the limit, stderr says `sauce run` stages the program first.

### When it does not compile

Errors point at your file's line and column, including on a line the SDK rewrote before compiling
it, and a `hint:` line names what to add:

```text
sauce compile: pay.sauce.ts does not compile for base
…
    ╰╴error: `recipient` is not a declared variable
       --> pay.sauce.ts:3:17
        |
      3 |   USDC.transfer(recipient, amount);
        |                 ^^^^^^^^^
hint: if recipient is a value you supply, make it a parameter of main (`recipient: Uint256`, or `Address`) and pass it with --args
```

### A program file as a command

A program file may start with a `#!` line that runs it through `sauce simulate`:

```sh
#!/usr/bin/env -S sauce simulate
```

After `chmod +x pay.sauce.ts`, `./pay.sauce.ts --chain base --owner
<address> --args <recipient> 1000000` rehearses the cook, exactly as `sauce simulate pay.sauce.ts`
with those flags does. Running the file never spends: sending it is still `sauce run`. The command
blanks the line before compiling, so the program and its error positions are the file's own.

### In an editor

A program file is checked by an editor as TypeScript, which does not know SauceScript's names.
`sauce init` writes `programs/tsconfig.json`, a TypeScript project of the `*.sauce.ts` files in
`programs/` alone, typed by the package's `@eco-incorp/sauce/sauce-script` declarations: the
builtins (`ctx`, `abi`, `evm`, `svm`, `crypto`, `require`, `revert`), `Token` and the
`@sauce/token` functions, every chain with its tokens and protocol namespaces, the protocol
contracts' `Namespace_Contract` names, and the ABI a program imports (`import IERC20 from "./artifacts/IERC20.json"`). The
project's other TypeScript is not in it, so a Node file keeps Node's `crypto` and `require`.

Some valid SauceScript is not valid TypeScript: every SauceScript number is one 256-bit integer, so
`xs[i]` with a `bigint` index, `n + 1` with `n` a `bigint`, and `f(500)` where `f` takes a `bigint`
are all fine. The tsconfig names a TypeScript plugin from the package that drops exactly those
diagnostics, in `*.sauce.ts` files only; a misspelled builtin, a wrong argument count or a method a
contract does not have still shows. An editor loads the plugin only when it runs the project's own
TypeScript (in VS Code, "TypeScript: Select TypeScript Version", then "Use Workspace Version"), and
`init` adds `typescript` to `devDependencies` for it. Without the plugin, those diagnostics show
and nothing else changes: whether a program compiles is the compiler's to say, not the editor's.

In a project `init` did not write, or for programs in another directory,
`sauce init <dir> --tsconfig` writes the same project as `<dir>/tsconfig.json` and nothing else
(it never replaces a different file without `--force`). An editor takes a file's nearest
`tsconfig.json`, so every `*.sauce.ts` under `<dir>` is typed as SauceScript. Where the project's
own `tsconfig.json` also covers those files, add `"exclude": ["**/*.sauce.ts"]` to it, so its
TypeScript leaves them to their own project. The file it writes is this, `<package>` being
`@eco-incorp/sauce`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "types": ["@eco-incorp/sauce/sauce-script"],
    "strict": true,
    "noImplicitAny": false,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": false,
    "skipLibCheck": true,
    "plugins": [{ "name": "@eco-incorp/sauce/sdk/dist/sauce-script/ts-plugin.cjs" }]
  },
  "include": ["**/*.sauce.ts"]
}
```

A contract ABI beside a program is typed by its default import, `import IOracle from "./IOracle.json"`,
as a contract whose methods the editor does not check; the compile checks them against the ABI.

`sauce skills install` and `sauce skills update` write the same file as `tsconfig.json` in each
skills directory, so the skills' example programs open typed as well. Its declarations, like the
plugin, come from the project's own copy of the package: in a project that does not depend on
`@eco-incorp/sauce`, the editor reports that it cannot find `@eco-incorp/sauce/sauce-script`, and
the programs show what they would with no `tsconfig.json` at all.

## An actions document instead of a program

An [actions document](actions.md) is JSON — `{ "version": 1, "actions": [ … ] }`, each action one
protocol operation — that the SDK lowers to a SauceScript program. Its tokens are registry symbols
(`"USDC"`) and its contracts namespace references (`"UniswapV3.Factory"`), or addresses, and a swap
may name its pool by its factory's key; every name is the program's global of that name, so a
document with no `chainId` compiles for any chain where its names exist.

`sauce actions <file>` lowers one for a chain and prints the SauceScript, `main`'s parameters and the
bytecode:

```sh
sauce actions swap.json --chain base
sauce actions swap.json --chain ethereum --json
```

`--chain` defaults to the document's `chainId`; a document without one needs it, and one with a
`chainId` compiles for that chain only. `--json` prints what `sauce compile --json` does, with the
parsed `document`, the `source`, the ABI bindings it calls through (`bindings`) and the argument
names (`parameters`); `contracts` is still the protocol contracts it calls, as `compile` reports them. `--compact-args` compiles the arguments compact-v1. A name the chain lacks is
refused with its path, the chain and the name:

```text
sauce actions: swap.json does not compile for avalanche:
  actions[1].tokenIn: no token "USDC" on Avalanche C-Chain (chain 43114), which registers no token symbols — give its address there instead
```

`compile`, `tx`, `simulate` and `run` take an actions document wherever they take a program file,
with the same flags: the document's `argument` actions are `main`'s parameters, given after
`--args` in the order it declares them, and its cook runs on the Pot `--owner` or `--pot` names,
funded with `--fund` if you like.

```sh
sauce simulate swap.json --chain base --owner 0xYou \
  --assume-balance USDC:1000 --args 1000000000
sauce run swap.json --chain base --keystore ~/.keys/me.json \
  --args 1000000000
```

## Intents: `sauce run` or `sauce intent`

A program can open an intent on another chain —
`Base.Portal.send(…).refundee(refundTo).receive(…).then(() => { … })`. Every intent names its
refundee, the refund address, with `.refundee(...)`: it is published by a program a Pot runs, and
the Pot may be shared, so nothing defaults it, not even the wallet that sends the cook. The
command supplies the rest the file leaves out ([Intent defaults](../reference/intent-defaults.md)):
the deadlines count from when it builds the intents, the fill five minutes later and the reward's
seven days after that; the salt is random, picked once per run; and the fee the body's cook pays is
read from the destination Kitchen, a separate read for each destination, which the command
reports. A modifier in the file sets any of them for its
intent. A flag sets one for every intent that does not set its own: `--intent-deadline <unix
seconds>`, `--intent-reward-deadline <unix seconds>`, `--intent-salt <bytes32>`,
`--intent-prover <address>` (instead of the prover the registry records for the pair), and
`--intent-execution-fee <wei>` (`auto`, the default, reads it; `--offline` reads nothing). The
command refuses a deadline at or before now, which no solver could ever fill (`sauce intent fill`
still rehearses one, with a note, to show the Portal's refusal). Each run builds new intents, its
deadlines counted from then and its salt fresh: give `--intent-deadline` and `--intent-salt` to
rehearse and publish the same one.

Every intent's body is a program that cooks on one Pot on its destination: the one owned by the
destination Portal's Executor with salt zero, which every intent through that Portal shares. No
solver can fill the intent until that Pot is deployed. `compile` and `sauce intent publish` check it on the
destination (`compile --json` reports each under `intentPots`) and warn
while it is missing, naming the `sauce pot --deploy --chain <destination> --owner <Executor>` that
deploys it; any account may send that. `publish` warns before it sends anything, and says how to
check when it cannot.

Every intent is published by a cook: the file run on a Pot, which reads each intent's vault from
the Portal, pays the reward into it from its own balance, and publishes the intent, all in one
transaction, so the intent may use a value the program measures as it runs — a balance, a swap's
output. Each intent's hash and record are read from the Portal's `IntentPublished` log in the
receipt, which the command prints and stores. Two commands send it:

- **`sauce intent publish`** cooks the file on your own Pot (`--salt` names another of yours), and
  is for a file that opens intents. `--fund USDC:1.01` pulls the reward from your wallet into the
  Pot in the same cook, exactly as `sauce run --fund` does ([Funding a run](#funding-a-run---fund)):
  Permit2 by default, `--fund-mode` for another way, `--sweep` to return what is left. Without
  `--fund` the Pot must hold the reward already.

  ```sh
  sauce intent publish bridge.sauce.ts --chain ethereum \
    --keystore ~/.keys/me.json --fund USDC:1.01 --args 0xRecipient 1000000 0xYou
  ```

  The file's `main` arguments go after `--args`, as for `sauce run`: they are the cook's, read as
  it runs. `--dry-run` rehearses the cook from the Pot's owner, the signer or `--from <address>`
  with no key, as `simulate` does, and prints each intent it publishes, read from the Portal's log
  (`intents` in `--json`, each with its `record`), sending nothing; `--assume-balance USDC:2`
  (repeatable, `ETH:` for the native currency) gives the Pot the reward for the rehearsal only, and
  `--fund` with no key credits it what the pull would bring. `--format json` (or `cast`) prints the
  cook unsigned, as `tx` does, with `--from <address>` when there is no signer; its intents are
  known once it lands (`sauce intent import <tx hash> --chain <source>`). Publishing, sent or
  printed, needs a supported source and supported destinations
  ([Supported and preview chains](#supported-and-preview-chains)); a dry run rehearses on any chain.

- **`sauce run`** sends the same cook for any program: opening its intents is one of its steps.

The Portal counts an intent funded when its vault holds the reward (`isIntentFunded`), which is
what a solver checks once it sees `IntentPublished`, so paying the vault directly needs no approval:
nothing is left standing, and a USDT-style token needs no reset. The vault is read from the Portal
(`intentVaultAddress`) over the very bytes the Pot then publishes. A token whose `transfer` returns
`false` reverts the cook, so no intent is announced with an empty vault.

`--intent-fund-via publishAndFund` (taken by `intent publish`, `run`, `tx`, `simulate`, `compile`
and `inspect`) funds through the Portal instead: for each reward token an `approve` to the Portal
(reset to zero first when a smaller allowance stands, as SafeERC20 does), then `publishAndFund`,
which pulls the reward into the same vault, records the intent `Funded` and emits `IntentFunded`.
Choose it when something you rely on reads that event or status rather than the vault's balance.

Publishing from Solana is not supported: see [Solana](#solana).

Everything after publishing is a verb of `sauce intent` too. Each takes the intent as it was
published: its hash, which the store keeps, or `--tx <hash> --chain <source>`, the transaction that
published it, read from its `IntentPublished` logs. A file is not one: its intents are rebuilt by a
rehearsal with a salt and deadlines of its own, so they are not the ones you published. Each verb
reads both chains:

| Verb                   | What it does                                                              |
| ---------------------- | ------------------------------------------------------------------------- |
| `sauce intent publish` | Publish a file's intents from your Pot — or, with no file, make one       |
| `sauce intent fill`    | Rehearse a solver's fill on the destination; with `--send`, send it       |
| `sauce intent prove`   | Send the proof of a filled (or cancelled) intent, paying the prover's fee |
| `sauce intent claim`   | Withdraw a proven intent's reward to its claimant, on the source          |
| `sauce intent refund`  | Return an unearned reward to its creator, once the Portal allows it       |
| `sauce intent cancel`  | Cancel an unfilled intent after its fill deadline, for an earlier refund  |
| `sauce intent status`  | Where an intent stands on both chains, and what can be done next          |
| `sauce intent list`    | Every intent the store keeps                                              |
| `sauce intent show`    | One stored intent: its route, reward, deadlines and events                |
| `sauce intent import`  | Store the intents a transaction published, rebuilt from its logs          |
| `sauce intent`         | At a terminal: pick a stored intent and act on it                         |

### Making one: `sauce intent publish` with no file

With no file, `publish` makes the intent, step by step: the source and destination chains (those
with a Portal that are [supported](#supported-and-preview-chains): Ethereum and Base), the token delivered (a registry symbol, or an address whose decimals it reads), how
much and to whom (you, by default), the reward, the fill and reward deadlines, the prover (the ones
the registry records on both chains), and how the reward is funded (a transfer to the vault by
default, or `publishAndFund`). At a terminal it asks for each; every question has a flag, so it
also runs with none:

```sh
sauce intent publish --source ethereum --destination base --token USDC --amount 1 \
  --recipient 0xYou --reward-token USDC --reward 1.01 --prover HyperProver \
  --fill-deadline +1h --reward-deadline +1d --keystore ~/.keys/me.json
```

With no terminal, it names every flag still missing; the funding, which has a default, is not one
(`--intent-fund-via publishAndFund` chooses the Portal's pull). The reward it suggests is what is delivered
plus a margin over what a solver spends on the destination — the gas of a fill, the prover's fee
(quoted from the destination's prover) and the Kitchen fee the body's cook pays — priced in the
reward token through a Uniswap V3 pool of the destination's wrapped native token, and doubled so a
fill is worth a solver's while; it shows how it got there, and you can change it. Deadlines are
unix seconds or `+30m`, `+2h`, `+1d` from now. The fill deadline is the last second a solver may
fill; the reward deadline, when an unproven reward becomes refundable, must leave time after it for
the fill to be proven.

It writes the intent as a `.sauce.ts` file (`--out`, else
`intent-<source>-to-<destination>-<time>.sauce.ts`), naming you (the signer, or `--from`) as its
refundee and headed by the command that publishes it again, shows it, rehearses publishing it and
filling it on the destination, and with a signer publishes it once you approve (or with
`--auto-approve`): a cook on your Pot, the reward pulled in from your wallet with `--fund`. It
stores it.

### Rehearsing the fill: `sauce intent fill`

`publish --dry-run` rehearses the source side: the cook that pays the vault and publishes. What the
intent does — the swap, the minimum it checks, the refund — runs on the destination, when a solver
fills it, and that is where it fails. `sauce intent fill` rehearses that fill with no key and sends
nothing. It takes the intent's hash or `--tx`, or, as a preview, the file and the flags `publish`
does, and reads both chains:

```sh
sauce intent fill swap.sauce.ts --chain ethereum \
  --intent-deadline 2000000000 --no-prove --args-json swap.args.json
```

A file's intents are first read from a rehearsal of publishing them on the source chain: the file
cooked on `--owner <address>`'s Pot (by default an account nobody holds the key of) with the
rewards left unpaid, each intent rebuilt from the Portal's log; a value the program measures is
measured on that Pot as it stands. Their hashes are the rehearsal's, so a file is a preview, and
`--send` refuses one. Then for each intent it runs one `eth_simulateV1` block on the
intent's destination, every call from a solver:

1. `Kitchen.deployPot(executor, 0)`, when the route cooks on the destination's shared intent Pot
   and it is not deployed yet. Any account may send it, and the Pot is the Executor's either way.
   The command also warns, with the `sauce pot` line that deploys it (`--deploy` and any signer).
2. The solver's approval of the Portal for each token the route delivers, reset to zero first where
   a smaller allowance stands. The Portal pulls them from the solver.
3. The fill, which proves itself when it can: `Portal.fulfillAndProve(intentHash, route,
rewardHash, claimant, prover, sourceDomain, data)` when the reward's prover is a Hyperlane one,
   with the route's native amount — the Kitchen's fee for its cook — plus the prover's fee, quoted
   from its `fetchFee`, as the value; else, or with `--no-prove`,
   `Portal.fulfill(intentHash, route, rewardHash, claimant)` with the native amount alone.

The prover is the destination's counterpart of the reward's (the registry's address for the same
role on that chain); it must serve the route's Portal, and the command checks the source prover
trusts it. The solver is an address nobody holds
the key of, or `--solver <address>`, and the claimant is the solver, or
`--claimant <address | bytes32>`. The solver is given the route's tokens and the value by state
override, the token's balance word found as `simulate --assume-balance` finds it. On success it
prints the gas, the transfers, each address's net change (an address given as an argument is named
by its parameter), the Portal's `IntentFulfilled` record, and what the fill left in the shared Pot and the
Portal's Executor:

```text
Intent 0xf261…5d2c from ethereum to base: the fill succeeds, gas used 1874288
Rehearsed with eth_simulateV1 on base, one block from the solver 0x5A0c…F111; nothing was signed or sent:
  1. approve the Portal for 998 USDC (gas 55425)
  2. Portal.fulfill(0xf261…5d2c, route, 0xe94c…0a6c, 0x5A0c…F111) with 3744785386350 wei: the route's nativeAmount, the Kitchen's fee for its cook (gas 1874288)
Assumed for this rehearsal only, by state override:
  the solver holds 998 USDC: the route's tokens, which the solver delivers (its balance word 0xc2e6…e5a4: Solidity mapping at slot 9)
  the solver holds 0.00000374478538635 ETH: fulfill's value
Token transfers:
  998 USDC: 0x5A0c…F111 (the solver) -> 0x645d…91Ca (the Portal's Executor)
  998 USDC: 0x645d…91Ca (the Portal's Executor) -> 0x48e8…744a (the shared intent Pot)
  0.368481796891017787 WETH: 0x72AB…2D38 -> 0x48e8…744a (the shared intent Pot)
  998 USDC: 0x48e8…744a (the shared intent Pot) -> 0x72AB…2D38
  0.368481796891017787 WETH: 0x48e8…744a (the shared intent Pot) -> 0x5a0C…Beef (recipient, refundTo)
Native transfers:
  …
Net balance changes:
  0x5A0c…F111 (the solver): -998 USDC, -0.00000374478538635 ETH
  0x72AB…2D38: -0.368481796891017787 WETH, +998 USDC
  0x5a0C…Beef (recipient, refundTo): +0.368481796891017787 WETH
  0x1984…506b (Kitchen): +0.00000374478538635 ETH
The Portal records the fill: IntentFulfilled(0xf261…5d2c, claimant 0x0000…F111)
Left behind: nothing. The shared intent Pot and the Portal's Executor end holding none of what the fill moved.
```

A fill that leaves tokens in the shared Pot or the Executor is warned about: every intent through
that Portal shares them, so a later intent's program or solver can take what is left. A revert
prints `the fill reverts: <reason>` and exits 1, a failed route call unwrapped from the Executor's
`CallFailed` down to its own reason — `route call 2 of 2 (the cook on the shared Pot 0x48e8…)
reverted: the program threw "output below minOut"`, or `FeeNotPaid(<fee>, <paid>)` for a cook
that underpays the Kitchen, which the command also warns about, naming the fee to build with. The
Portal's own refusals are named: `IntentExpired()` with the deadline, `IntentAlreadyFulfilled`,
`InvalidHash`. `--json` carries one object per intent under `intents`: the hashes, `portal`,
`executor`, `pot` and `potDeployed`, `solver`, `claimant`, `value`, `proves`, `prover`, `fee`,
`calls` (each with its `status` and `gasUsed`), `assumed`, then `gas`, `fulfilled`, `transfers`,
`approvals`, `nativeTransfers`, `balanceChanges`, `otherLogs` and `leftBehind` — or `stage` and
`reason`.

`--rpc-url` is the destination's endpoint, for a file whose intents all go to one chain; the source
is read through `--config` or the built-in endpoints. It needs `eth_simulateV1` on both, since the
deployment, the approvals and the fulfill carry state from one to the next. A Solana destination
is not filled.

### Filling it for real: `sauce intent fill --send`

A rehearsal sends nothing, so it runs on a preview chain too. With `--send` and a signer, the
signer is the solver, and the fill is sent — to a supported destination only:

```sh
sauce intent fill 0x<intent hash> --send --keystore ~/.keys/me.json
```

It is rehearsed first exactly as above, but with nothing assumed: on the signer's own balances, so
a solver short of a token, or of the value, sees the rehearsal revert and nothing is sent. Then it
says what the fill spends — each token the route delivers (which the Portal pulls from you into
its Executor) and the value, split into the Kitchen's fee, what the route spends and the proof's
fee — and asks you to approve; `--auto-approve` approves without asking, and with no terminal and no
`--auto-approve` it stops there. The transactions go out in order, each rehearsed again just before, and it
prints each one's hash, block and gas, the gas cost, what the fulfill moved, the Portal's
`IntentFulfilled` record and, when the fill proved itself, the Hyperlane message id the proof
travels as (the Hyperlane explorer finds it by that id). The intent and the fill go into the store.

### After the fill: `prove`, `claim`, `refund`, `cancel`

```sh
sauce intent prove 0x<intent hash> --keystore ~/.keys/me.json
sauce intent claim 0x<intent hash> --chain ethereum --keystore ~/.keys/me.json
sauce intent refund 0x<intent hash> --chain ethereum --keystore ~/.keys/me.json
sauce intent cancel 0x<intent hash> --keystore ~/.keys/me.json
```

- **`prove`** sends `Portal.prove(prover, sourceDomain, [intentHash…], data)` on the destination,
  for intents filled (or cancelled) there whose proof has not reached the source, with the prover's
  quoted fee as the value, approved as `fill --send`'s spending is. Several hashes with one
  destination, source and prover share one proof. An intent the source has proven already is left
  out.
- **`claim`** checks that the reward's prover on the source has the intent proven, for its
  destination, and that the reward is neither withdrawn nor refunded, then sends `Portal.withdraw`
  (`batchWithdraw` for several hashes), which anyone may send and which pays the claimant the proof
  names. It prints what left the vault. While the proof has not arrived it says so and exits 1,
  with when the store saw the intent filled and the Hyperlane message its proof travels as.
- **`refund`** sends `Portal.refund`, which anyone may send and which returns everything the
  intent's vault holds to the reward's creator, once the Portal allows it: at once after a proven
  cancellation, from the reward's deadline for an intent no one proved, and for a claimed one only
  its leftovers. It reads the state first and says why not, with the time left. There is no batch
  refund.
- **`cancel`** sends `Portal.cancel` on the destination, which anyone may send strictly after the
  fill deadline when no solver filled the intent: no fill can land after it, and once `prove` has
  carried the cancellation to the source, `refund` pays the creator before the reward's deadline.
  It needs a destination Portal with `cancel` and a source Portal whose `withdraw` refuses to pay a
  proven cancellation (`CancelledIntent`), both read from their code, since a cancellation is
  recorded as a claimant nobody controls; where either is missing it says so, and the reward is
  refunded after its deadline instead. Prove a cancellation once the cancel is final on the
  destination: a reorg that let a fill in first would leave that solver unpaid. `--and-prove`
  sends `cancelAndProve` instead, proving at once.

With no signer, each prints its transactions unsigned, for a wallet to send in order. Signed or
unsigned, each is refused on a preview chain: `prove` and `cancel` by the intent's destination,
`claim` and `refund` by its source.

### An intent to Solana

An intent an EVM chain publishes for Solana (eco-routes' Solana deposit addresses publish one per
deposit) is filled, proven and cancelled through Solana's Portal program, and claimed or refunded on
its source like any other. Store it from the transaction that published it, then:

```sh
sauce intent import 0x<tx hash> --chain base
sauce intent fill 0x<intent hash> --solver <solana key> --claimant 0xYou
sauce intent fill 0x<intent hash> --claimant 0xYou \
  --send --keypair ~/.config/solana/id.json
sauce intent claim 0x<intent hash> --keystore ~/.keys/me.json
```

- Solana is read as any chain is; a `--config` names its endpoint under its chain id,
  `1399811149`.
- **`fill`** sends `Portal.fulfill` from the solver: its token accounts pay the route's tokens into
  the Portal's executor, which runs the route's calls. The rehearsal runs on the accounts as they
  are (Solana's simulation takes no overrides, so `--solver` names a Solana key whose accounts
  hold the tokens) and prints the token accounts the fill moves. `--claimant`, the address on the
  source chain the reward pays, is required: a Solana key is not one. With `--send` and
  `--keypair` the fill is sent, then its proof: the Portal's `prove` through the HyperProver, with
  eco-routes' proof_helper paying Hyperlane's Interchain Gas Paymaster for the message's delivery in
  the same transaction. What the proof spends (the gas paymaster's quote and the message accounts'
  rent) is measured by a rehearsal and approved. `--no-prove` leaves it to `prove`.
- **`prove`** and **`cancel`** sign with `--keypair`, which pays their fee: their transactions are
  built for it, so on Solana they need it. A cancellation's proof waits until the slot that
  cancelled it is finalized; `--and-prove` sends the cancellation and its proof in one transaction.
- **`claim`** and **`refund`** are the source chain's, as for any intent.

`sauce intent status <file | hash>` reads the intent on both chains and prints its state —
`unfunded`, `funded`, `filled`, `cancelled`, `proven`, `cancelProven`, `claimed` or `refunded` —
its deadlines, and for fill, prove, claim, refund and cancel whether it can be done now, why not,
and from when.

### The store, and picking one: `sauce intent`

Every intent `sauce intent publish`, `sauce run` and the `sauce intent` verbs touch is kept in a
store, `~/.sauce/intents` (`--store <dir>` for another), so later commands name it by hash: one
directory per intent hash, holding `intent.json`, the full intent — route, reward, chains, Portal,
hashes, vault — written once and never changed, and `events.jsonl`, one line appended per thing that
happened to it (`published`, `funded`, `imported`, `filled`, `proving`, `claimed`, `refunded`,
`cancelled`), with its chain, transaction, block and time. Nothing is read and written back, so two
commands at once cannot tear it, and where an intent stands is never stored: it is read from the
chains each time. No key or endpoint is written there.

`sauce intent import <tx hash> --chain <source>` stores the intents a
transaction published — someone else's, say — rebuilt from its `IntentPublished` logs, each checked
against its hash. `sauce intent list` lists the store, and `sauce intent show <hash>` one intent
with its events. `sauce intent` alone, at a terminal, lists the stored intents with where each
stands (read live from the chains), and on the one you pick runs status, fill, prove, claim, refund
or cancel, with the same approvals; with a signer, they send. With no terminal it prints the list.

## Look up and take apart

### `sauce globals`

```sh
sauce globals --chain base                       # everything
sauce globals --chain base --tokens              # token symbols only
sauce globals --chain base --protocols           # protocol namespaces only
sauce globals --chain base --protocol UniswapV3  # one namespace, with its methods
sauce globals --chain base --stocks              # the chain's tokenized stocks
sauce globals --chain base --search spacex       # tokens by symbol, company name or ticker
```

lists every name a program compiled for the chain may use without declaring it: the token symbols
with their addresses and decimals, each protocol namespace with its contracts' addresses (and, with
`--protocol`, each method with every parameter and struct field named), the chain names that open
intents, `chainId` and each contract's address as `Namespace_Contract`, and the `@sauce/token`
functions. On an EVM chain it also lists the
interfaces: ABIs the registry knows with no fixed address (`Erc4626.Vault`, `Erc20.ERC20`), which a
program calls with an address of its own, `Erc4626.Vault(vault).totalAssets()`; `--protocol
Erc4626` lists their methods. `--json` prints the same for a program to read (`interfaces` beside
`protocols`). It is `routes.sourceGlobals(chain)`, which reads the registries the compile reads and
lists contracts through the protocol rewrite's own resolver, so a name it lists is one the compile
accepts, at the address the program gets.

A chain's tokenized stocks (Ethereum and Solana have over a thousand each) are counted rather than
listed unless you ask: `--stocks` lists them, each with its name, the underlying's ticker and its issuer, and
`--search <text>` lists the tokens, stocks included, whose symbol, name, ticker or issuer contains
the text, without regard to case. A search also finds a stock by the name another issuer gives it:
`--search spacex` finds Coinbase's `SPCXc`, whose own name is "Space Exploration Technologies
Corp.". In `--json`, a stock token carries `stock` with its issuer, name, ticker and the issuer's
list it was copied from. Symbols are matched without regard to case on the command line too
(`--fund spcxc:1`, `sauce price spcxc USDC 150`, `--account source=pot:tslax` on Solana); in a
program they are case-sensitive. On Solana each stock is a Token-2022 mint, listed with its mint
and the 32-byte key a program holds; `--stocks` leaves out devnet's mints, which have none.

### `sauce price`

```sh
sauce price --chain base 2700 USDC per WETH                   # the price, in words
sauce price --chain base WETH USDC 2700                       # the same: <base> <quote> <price>
sauce price --chain base 2700 USDC per WETH --offline         # without the pool's price now
sauce price --chain base WETH USDC --sqrt-price-x96 4116816085950893928074568
sauce price --chain base SPCXc USDC --pool 0x0bf58fe0FAc935Ac69595c19B12Ba0d75E3F8c0E
```

Its first line says what the price means both ways round — `2700 USDC per WETH on base: 1 WETH =
2700 USDC, 1 USDC = 0.00037037037037037 WETH` (`means` and `inverse` in `--json`) — since a price
written the wrong way round is off by its own square, a millionfold for WETH and USDC. It also
reads the pair's price now from its deepest Uniswap V3 pool on
the chain (`live` in `--json`) and warns on stderr when the price given is 10x or more away from it,
saying so, with the command that reads it the right way, when it looks written backwards. It
turns a price, in quote tokens per base token, into the numbers a swap program takes, for the pair's
order on the chain (token0 is the lower address): the `sqrtPriceX96` a Uniswap V3 or V4 pool (or a
fork) trades at, which is also the swap's `sqrtPriceLimitX96` — a floor when selling token0, a
ceiling when selling token1 — and, for selling the base token and for buying it, the price both ways
round, each labelled with its units (`units` in `--json`):

- `maxPrice` and `maxAvgPrice`: the paid token's base units per bought base unit, times 1e18 — the
  price times 10^(18 + paid decimals − bought decimals), rounded down — which the distributed swap
  takes as its `maxPrice` and `maxAvgPrice`, as `sauce pools` prints a pool's. Buying WETH with USDC
  at 2700 that is `2700000000`.
- `minAvgPrice`: the other way round, bought base units per paid base unit, times 1e18, rounded up,
  for a single swap's check `out * 1e18 >= minAvgPrice * spent`. It is never a `maxAvgPrice`.

Either check passes no worse an average than the price. A token is a symbol the chain registers, or
`0x…:<decimals>`, or the address alone: its decimals and symbol are read from the token (`readFromChain` in `--json`). `--sqrt-price-x96` reads a pool's price back, and `--pool
<address>` reads it from that pool of the pair now (`pool` in `--json`): a Uniswap V3, PancakeSwap
V3 or Aerodrome Slipstream pool, named by its venue where the registry's factory made it. The
conversion is the package's
`sqrtPriceX96FromPrice` and `priceFromSqrtPriceX96`, which a TypeScript program imports from the
root; with `--offline`, nothing reaches a network.

### `sauce pools`

```sh
sauce pools --chain base USDC WETH
sauce pools --chain base USDC SPCXc   # a tokenized stock
sauce pools --chain base USDC 0x<token> --json
sauce pools --chain base WETH USDC --v4-key 50:1
sauce pools --chain base USDC SPCXc --block 36120411   # at one block
```

lists every pool of a pair at the price-limit venues the registry records on the chain, read now:
Uniswap V3 and PancakeSwap V3 at each fee tier their factory enables (the tiers tried are 0.01%,
0.02%, 0.03%, 0.04%, 0.05%, 0.25%, 0.3% and 1%), Aerodrome Slipstream at each tick spacing each of
its CLFactories enables, and hookless Uniswap V4 pools at the keys `100:1`, `500:10`, `3000:60`
and `10000:200`, and any `--v4-key <fee>:<tickSpacing>`. A token is a symbol the chain registers,
a tokenized stock's included (`SPCXc`, in any case), or an address the registry does not know, whose
decimals and symbol are read from the token (or given, `0x…:8`). It reads
everything in five rounds, each a few `eth_call`s carrying up to 32 reads apiece (Multicall3's
`aggregate3`, sent deployless, so it needs nothing deployed), all at one block: `--block <number |
latest | safe | finalized>`, or the latest when it starts. It names that block (`block` in
`--json`), so `sauce simulate --block` can rehearse a swap on the prices its `maxPrice` came from.
It reads on every chain, preview chains included.

Pools with liquidity at their price come first, **deepest first, by that liquidity** (`sortedBy`
in `--json`), which is in the same units at every venue for one pair. For each:

- the venue, the contract a program finds it through as the program names it
  (`AerodromeSlipstream.CLFactoryGaugesV3`), and the pool's address — for a V4 pool, its id and
  key;
- its fee, read from the pool: Slipstream's is set per pool; a V4 pool's LP fee and its protocol
  fee, which is charged on top and differs by direction, from StateView;
- tick spacing, liquidity, tick and `sqrtPriceX96`;
- both directions, paying the first token for the second and then the reverse: what one token
  costs in the other at the pool's price (`mid`) and with the fee (`taker`), in whole tokens,
  decimals-aware; that taker price as the distributed swap's `maxPrice` — the paid token's base
  units per bought base unit, times 1e18, which is the price times
  10^(18 + paid decimals − bought decimals), so 150 USDC for an 8-decimal token is
  `1500000000000000000` — the pool trading only to a `maxPrice` above it; and `depth1Pct`, how
  much of the paid token, fee included, moves the pool's price 1% against the taker, walked
  through its initialized ticks.

Then the pools with no liquidity at their price, or none at all, listed apart as skipped (`empty`):
a swap passes them by. Last, what was looked at (`checked`): the tiers each factory enables, the
tick spacings each Slipstream factory enables, and the V4 keys tried, with any venue that could not
be read. A pool that answers wrongly is left out with a note on stderr.

```text
USDC/SPCXc on base at block 36120411: 3 pools with liquidity, deepest first (by liquidity at the pool's price)
  token0  USDC   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  6 decimals
  token1  SPCXc  0xb2000000000000000000007b9fcbd005511aCBd5  8 decimals

1. Aerodrome Slipstream 0x0bf58fe0FAc935Ac69595c19B12Ba0d75E3F8c0E
   AerodromeSlipstream.CLFactoryGaugesV3 0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef
   fee 0.05% (read from the pool), tick spacing 10, liquidity 206953500095168, tick -3968
   sqrtPriceX96  64972491279845651558239670148
   buy SPCXc with USDC  148.771 USDC each, 148.696 before the fee; 128966 USDC moves it 1%
                        maxPrice 1487706738131601814
   buy USDC with SPCXc  0.00672848 SPCXc each, 0.00672512 before the fee; 1267.21 SPCXc moves it 1%
                        maxPrice 672848166136197636
…
```

### `sauce inspect`

```sh
sauce inspect 0x<calldata> --chain base --source split.sauce.ts
sauce inspect 0x<tx hash> --chain arbitrum
sauce inspect bridge.sauce.ts --chain ethereum
```

takes bytes back apart into what a SauceScript author wrote:

- a `Pot.cook`: the engine (and whether it is the released one) and the program — its size, hash,
  and each intent it publishes, with how it funds it (`fundVia`: paid into the vault then
  `publish`, or `publishAndFund`). The program encodes an intent as it runs, so its route and
  reward are read from the Portal's log, which `simulate` and `intent publish --dry-run` print;
- with `--source <file>`: whether the program is that file's, and the arguments the cook appends,
  decoded against its `main`;
- a `Kitchen.deployPot` (the Pot it makes), a `Portal.publish` or `publishAndFund` (the route, the
  reward, and the intent's vault — the address a funder's `transfer` pays), an ERC-20 call, or
  bare program bytes;
- a 32-byte hash with `--chain`: the transaction, fetched — its status, sender, value and call,
  what it cost (gas, an OP-stack chain's L1 data fee, the value), and the token transfers,
  approvals and net balance changes its receipt's logs record;
- a file, offline: the program it compiles to, and its intents, each one's destination and the
  body it cooks there, with what the program gives the body as it runs.

An intent's route and reward are encoded as the program runs, so neither the bytes nor the file
give them: `simulate` and `intent publish --dry-run` read them from the Portal's log. There is no
opcode listing or disassembly: programs are reported by what they are and what they open.

### `sauce verify`

```sh
sauce verify 0x<settle payload>
sauce verify 0x<tx hash> --chain base --pin 0x…:435
```

checks that a settle payload, a `Pot.cook`, a `Portal.publish[AndFund]` (its route's calls) or a
transaction runs the audited settle program, with the SDK's `validateSettleProgram`, and prints the
`tokens`, `minOut` and `recipient` it carries. `--pin <keccak256>:<length>` also accepts a historical
settle program. A cook must name the released engine, or one you name with `--engine <address>`:
the right bytes on another interpreter are another computation. A transaction must have succeeded:
one that reverted, or has no receipt yet, settled nothing. A rejection exits 1 with its code — the
SDK's `SettleFailureCode` (`PROGRAM_HASH`, `TOKENS_OFFSET`, …), or `UNKNOWN_ENGINE`, `NO_SETTLE` for
an intent without a settle cook, `TX_FAILED` or `TX_PENDING`.

## Solana

The same commands take `--chain solana`, through the SDK's Solana client
(`svm.createSauceSvmClient`, with the cluster's endpoint and the program ids `/deployments` records).
Three things differ, and a fourth is Solana's alone: how the cook reaches the engine.

**Accounts.** A Solana program declares every account it touches as an `Account` parameter of
`main` — `Account<Writable>`, `Account<Signer>` — and `sauce compile --json` reports them in its
`manifest`. Pass each to `simulate`, `run` and `tx` as `--account NAME=<value>`, where the value is
an address, `pot` (the Pot, which the Kitchen signs for), `owner` (the signer), or an account named
by its token: `pot:USDC` is the Pot's own USDC account — its associated token account for the mint,
under the token program that owns the mint — `pot:<mint>` the same for any mint, and `owner:USDC`
the owner's (a direct cook, `--via engine`, has no Pot, so no `pot:` account); `mint:USDC` is the
mint and `program:USDC` its token program, SPL Token or Token-2022, the accounts
`transferChecked` takes. A registered symbol's program is the registry's; any other mint's is read
from the cluster. A tokenized stock is named the same way, by its symbol in any case
(`pot:TSLAx`, `mint:NVDA_US`). A slot with no `--account` is named with the role it needs, and `simulate` notes each
account it was given that the cluster does not have (a guard on it fails with no message of its
own).

```js
// @chain solana
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  dest: Account<Writable>,
  authority: Account<Signer>,
  mint: Address,
  amount: Uint256,
) {
  transfer(mint, tokenProgram, source, dest, authority, amount);
}
```

```sh
sauce run sweep.sauce.ts --keypair ~/.config/solana/id.json \
  --account tokenProgram=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  --account source=<the Pot's token account> --account dest=<token account> \
  --account authority=pot --args <mint> 400
```

**The Pot.** A Pot is the Kitchen's PDA over the owner and the salt. `sauce pot --chain solana
--owner <pubkey>` prints it and the `create_pot` instruction; `--deploy` with `--keypair` creates
it. It also lists the Pot's token account for each registered mint but the
tokenized stocks, over a thousand of them: its address, whether it exists and what it holds
(`tokenAccounts` in its JSON). A stock's is `pot:<symbol>`. A cook names its Pot by `--owner` and `--salt`, never `--pot`, and `run` asks before creating a
missing one, as on an EVM chain.

**The cook.** The execution fee is read from the cluster, so there is no `--value`: every output
prints it as `fee`, and the cook signs it as its `max_execution_fee`, so it pays what was printed
or, if the fee rises before it lands, fails. `--max-execution-fee <lamports>` refuses a cook whose
fee is above it, before anything is signed or sent. `simulate`
simulates the cook from `--owner` with signatures unchecked; a Pot the Kitchen has not created yet
is created by its `create_pot` ahead of the cook, in the same transaction. It prints the compute
units, what `main` returned (read as its declared type, as on an EVM chain) and what the cook
moved, or the reason — a program's `throw` or `require` message, decoded
from the engine's return data — and the program logs. What moved is read from the accounts
themselves: every account the transaction may write, as it is now and as the simulation leaves it
(`simulateTransaction`'s `accounts`). Each token account's balance change (SPL Token and
Token-2022, in whole units by its mint's decimals, a mint the registry records by its symbol) and
each account's lamports are listed, named
by their `--account` names, as the owner, the Pot and the Kitchen's fee config; the owner's
lamports include the transaction's fee. `--json` lists them as `tokenChanges` and
`lamportChanges`. Solana's `simulateTransaction` takes no account overrides, so there
is no `--assume-balance`: the rehearsal runs on the accounts as they are, and the owner must hold
the Pot's rent and the fees (a shortfall is named). A cook too large for one transaction is refused
with the bytes to shrink the payload (the program and its arguments) by, since staging it writes a
code buffer on chain, which only `run` does. `run` signs with `--keypair`, confirms by polling the endpoint (no websocket to
configure), and prints the signature, status and compute units — and the logs when it fails. A
program too large for one transaction is staged in a Kitchen code buffer first and the buffer is
closed again after the cook — or when staging or the cook's rehearsal fails; if closing it fails,
the run still prints the cook and warns with the buffer's address. A failure is named for the
program the logs show failing — the Kitchen's or the engine's refusals by name, and a token
program's in the words it logged. `tx` prints the
cook as a base64 transaction signed by no one, `{ chain, via, feePayer, pot, fee, maxExecutionFee,
transaction }`, for the owner's wallet to sign; its blockhash expires in about a minute.

**Through the Kitchen or direct: `--via`.** `run`, `simulate` and `tx` take
`--via kitchen|engine` (and `compile --json` sizes either cook with it):

- `--via kitchen`, the default, is everything above: the Kitchen's `cook` on the owner's Pot, which
  the Kitchen signs for. Use it when the program holds or spends what the Pot owns, or writes the
  Pot's storage.
- `--via engine` calls the engine's own paid cook (`cookAndPay`) with no Kitchen and no Pot: nothing
  is created, `--owner` (or the `--keypair`'s key) signs and pays the fee, and the program acts with
  that signature — give `--account NAME=owner` where it needs an authority, such as the owner of the
  token account it spends from. `NAME=pot` for a slot that must sign is refused, since nothing signs
  for a Pot here. The program's own calls get one more level of CPI depth, as no Kitchen frame sits
  under the engine. A staged program runs pinned to the staged bytes' digest.

The fee is the same either way, read from the Kitchen's config and paid into it.

```sh
sauce run sweep.sauce.ts --keypair ~/.config/solana/id.json \
  --via engine --max-execution-fee 10000 \
  --account tokenProgram=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  --account source=<your token account> --account dest=<token account> \
  --account authority=owner --args <mint> 400
```

The flag is `--via` rather than `--entry` because "entry" is already the compiler's word for a
program's entry module and the arguments `main` takes (`--compact-args`, `entryEncoding`); `--via`
names what the transaction calls. The [Solana guide](solana.md#two-ways-to-run-a-program) sets the
two side by side.

`sauce verify --chain solana <signature> --min-out <n> --spl-count <n>` checks a settle cook: the
engine invocation it made, against the SDK's settle program recompiled for that floor and split
(`svm.verifySvmSettleExecution`). It rejects with `TX_FAILED` (the transaction failed),
`NO_SETTLE` or `NOT_GENUINE`. It reads a cook through the Kitchen: a settle cooked `--via engine`
is not one it checks.

`sauce intent publish` does not work from Solana: open the intent from an EVM chain; its
destination may be Solana, and `sauce intent fill`, `prove` and `cancel` act on it there
([An intent to Solana](#an-intent-to-solana)). A `main` argument of type `Address` is a 32-byte
public key on Solana: pass it in base58 (or as 32 bytes of hex), and the command encodes the whole
key as the word the engine reads (ABI-v1 only, not under `--compact-args`).

## Agent wallets

An agent with no wallet can make one, and keep it. `sauce wallet` keeps keys in a wallet directory,
`~/.sauce/wallets` (or `--wallets <dir>`), each encrypted under a password the agent holds, in its
`.env` or its secret store, and names by source. The password is never an argument:

```sh
sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD             # an EVM wallet
sauce wallet new agent-sol --solana --password-env SAUCE_WALLET_PASSWORD
sauce wallet list                                                       # no password needed
sauce wallet address agent
```

| Verb      | Does                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new`     | Generates a key and stores it as `<name>.json`, created `0600` in a directory created `0700`, written once and never overwritten. `--solana` makes a Solana keypair. The password is 8 characters or more |
| `list`    | Each wallet's name, kind (`evm` or `solana`), address, and whether a policy limits it                                                                                                                     |
| `address` | One wallet's address                                                                                                                                                                                      |
| `import`  | A key you have, read from a file or stdin (`-`), never from the command line: an EVM private key, a keystore (opened with the password, which the wallet keeps), or a Solana keypair file                 |
| `export`  | The key, shown on the terminal itself (never stdout) once you type the wallet's name. It refuses without a terminal, and the MCP server has no such tool                                                  |

An EVM wallet's file is a Web3 Secret Storage v3 keystore (scrypt, AES-128-CTR, a keccak-256 MAC),
exactly as geth and `cast wallet` write one, so `--keystore <file>` and `cast wallet` read it too.
A Solana wallet's file is the same envelope around the keypair's 64 bytes, marked
`"kind": "solana"`. Each file names its address in the clear, so `list` and `address` need no
password.

Every command that signs takes `--wallet <name>` with the same password source: `run`,
`pot --deploy`, `simulate --fund`, `intent publish`, `intent fill --send` and the steps after it,
with an EVM wallet on an EVM chain and a Solana wallet on Solana:

```sh
sauce run pay.sauce.ts --chain base \
  --wallet agent --password-env SAUCE_WALLET_PASSWORD --args <recipient> 1000000
```

### A wallet's policy

`<name>.policy.json`, beside the wallet, limits what it sends. Every field is optional, and every
amount is a string in whole tokens (`"1.5"`), or in base units ending in `n`, as `--fund` takes them:

```json
{
  "chains": ["base", "ethereum"],
  "to": ["<address>"],
  "native": { "perTransaction": "0.01", "perDay": "0.05" },
  "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } }
}
```

- `chains` names the only chains it sends on, and `to` the only addresses a transaction goes to
  (on Solana, the programs its instructions call).
- `native` is the chain's native coin leaving the wallet or the Pot the transaction cooks on. On
  Solana the fee and any rent are included.
- `tokens` are named by registry symbol or by address (an ERC-20, a Solana mint). They count what
  leaves the wallet or its Pot, and an approval above what the limit leaves room for is refused
  (an approval of Permit2 aside, which moves nothing without a signature in a later cook). A token
  the policy does not name is not limited.
- `perDay` is the last 24 hours, every chain together, counted from `<name>.ledger.jsonl` beside
  the wallet.

What a transaction moves is measured, not read from its calldata. An EVM transaction is rehearsed
with `eth_simulateV1`, and its token and native transfers out of the wallet and its Pot are
counted. A Solana transaction is simulated with the accounts it writes reported. A limit that
cannot be measured on the endpoint (no `eth_simulateV1`, for one) refuses the send. A refused send
names the limit and sends nothing:

```text
sauce run: refused by the policy of wallet agent (…/agent.policy.json): tokens.USDC.perTransaction is 100 USDC, and this transaction sends 250 USDC
```

With no policy file, sends work, and each says that no limits are set. A policy file that others
can write is refused: they could loosen it.

**It is a hot wallet.** Whoever holds its file and its password holds the key, and an agent sends
from it without asking anyone. Keep small balances in it, and set a policy. Every wallet send also
holds to the [supported chains](#supported-and-preview-chains).

## Agent skills

`sauce skills` puts the package's agent skills where coding agents read them, brings them to the
package after an upgrade, and checks them:

```sh
sauce skills install                          # .claude/skills and .agents/skills
sauce skills install --agent codex            # only the directory Codex reads
sauce skills status                           # exit 1 while any target is outdated
sauce skills update                           # after upgrading the package
```

[Agent skills](skills.md) has what each skill teaches, the directory each agent reads, the
`AGENTS.md` index, how an edited file is kept through an update, and the MCP server's way of
serving them with nothing installed.
