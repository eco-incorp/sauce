# The sauce command

[Documentation](../README.md) · [Compiling programs](compiling.md) · [Create an intent](intents.md)

`@eco-incorp/sauce` installs a `sauce` command. It compiles a program file exactly as the SDK
compiles a route body, deploys the Pot the program runs on, rehearses the cook, signs it, sends it
and waits for it — on an EVM chain or on Solana — and takes transactions and programs back apart
afterwards. It needs no other tool. It reads no environment variables and reaches a network only
through an endpoint you name on the command line.

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
| `sauce inspect`  | Take a cook, a Kitchen or Portal call, a program or a file apart                  |
| `sauce verify`   | Check that a payload, cook, intent or transaction runs the audited settle program |
| `sauce init`     | Scaffold a project that uses this package                                         |
| `sauce skills`   | Install, update or check this package's agent skills in a project                 |

Every command takes `--help`. A mistyped invocation exits 2. A program that does not compile, a
cook that reverts, a rejected settle and an outdated skills install exit 1.

## Install

```sh
npm install @eco-incorp/sauce
npx sauce --help
```

Node.js 24 or newer. To start a new project instead, let the command scaffold it:

```sh
npx @eco-incorp/sauce init my-app
cd my-app
npm install
```

`sauce init` writes a `package.json` that pins `@eco-incorp/sauce` to exactly the version that ran
it, an `AGENTS.md` with the project's instructions for coding agents, a `.gitignore` that keeps
local configuration out of git, `sauce.config.example.json`, and `programs/tsconfig.json`
([In an editor](#in-an-editor)), and then installs the agent skills ([Agent skills](#agent-skills)). `init` refuses to overwrite a file that already has other content,
and lists it, unless you pass `--force`. It runs no package manager unless you pass `--install`.

## Endpoints and signers

Nothing reaches a network without one of these:

- `--rpc-url <url>`, the chain's endpoint; or
- `--config <file>`, a JSON file of endpoints by chain id, used for whichever chain the command is
  for:

  ```json
  { "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
  ```

  `sauce init` writes `sauce.config.example.json` with `<…>` placeholders; copy it to
  `sauce.config.json`, which its `.gitignore` keeps out of git. A placeholder left in is refused.

The command checks that an EVM endpoint serves the chain you named. It never prints the URL: a
provider URL often carries a key.

Nothing is signed without one of these, and the signer is always the Pot's owner (on Solana with
`--via engine`, which uses no Pot, the signer is the program's authority):

- `--keystore <path>`: a JSON keystore (Web3 Secret Storage v3, scrypt or PBKDF2, as `cast wallet`
  and geth write). The password is asked for at the terminal without echo, or read from
  `--password-file <path>`.
- `--private-key <hex>`: works, with a warning: it lands in your shell history.
- `--keypair <path>`, on Solana: a keypair file, the JSON array of 64 bytes `solana-keygen` writes.

Keys are read from those paths only — never from the environment or the config file — and no
command prints one: everything a command writes passes through a filter that removes any key it
was given, error messages included.

## The flow on an EVM chain

A program runs as a **Pot**: a contract you own that holds what the program spends and calls
`cook(engine, program)` on the released engine. `cook` is `onlyOwner`, and pays the Kitchen's
execution fee as its value.

```sh
# 1. The names a program on Base can use: tokens, protocol contracts, functions.
npx sauce globals --chain base

# 2. Check that the program compiles.
npx sauce compile pay.sauce.ts --chain base --define RECIPIENT=0x… --define AMOUNT=1000000

# 3. Deploy your Pot (once). Its address is known before it exists.
npx sauce pot --deploy --chain base --config sauce.config.json --keystore ~/.keys/me.json

# 4. Fund the Pot with what the program spends: send its address the tokens, from any wallet —
#    or let `sauce run --fund` pull them in with the cook (see "Funding a run" below).

# 5. Rehearse the cook from the Pot's owner: no key, nothing sent. It can come first: a Pot not
#    deployed yet is deployed in the rehearsal, and --assume-balance gives it what it spends.
npx sauce simulate pay.sauce.ts --chain base --owner 0xYou --config sauce.config.json \
  --assume-balance USDC:1 --assume-balance USDT:1 --define RECIPIENT=0x… --define AMOUNT=1000000

# 6. Run it.
npx sauce run pay.sauce.ts --chain base --config sauce.config.json --keystore ~/.keys/me.json \
  --define RECIPIENT=0x… --define AMOUNT=1000000
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
cat pay.sauce.ts | npx sauce compile - --chain base --define RECIPIENT=0x… --define AMOUNT=1
npx sauce inspect - --chain base < cook.hex
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
npx sauce simulate pay.sauce.ts --chain base --owner 0xYou --config sauce.config.json \
  --assume-balance USDC:2 --assume-balance USDT:2 --define RECIPIENT=0x… --define AMOUNT=1000000
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
- **`--fund`**: with the owner's key the rehearsal includes the signed pulls (see
  [Funding a run](#funding-a-run---fund)). With no key the pulls cannot be signed, so the Pot is
  credited what they would bring — its balance plus each amount, or the amount on top of an
  `--assume-balance` of the same token — `--sweep` still runs, and a shortfall in your wallet is
  reported rather than refused.

It rehearses through `eth_simulateV1` where the endpoint serves it: one simulated block holding
the deployment and the cook, state carried from one to the next, with the cook's logs. Everything
it reads first (the Pot, the Kitchen's fee, the balances it assumes) and the rehearsal itself run on
one block: the latest when the command starts, or the one `--block <number | latest | safe |
finalized>` names, so a limit computed from a quote can be rehearsed on the state the quote saw. The
`Rehearsed with …` line, and `block` in `--json`, say which. On success it prints the gas used and
what the program returned — read as the type `main` declares, where it declares one (`main returns
Address: 0xd0b5…`, an array as its elements, a record as its fields; `returnType` and `returned`
in `--json`) — then what the cook did:

```text
The cook succeeds from 0xYou: gas used 128999, returns 0x
Rehearsed with eth_simulateV1 on the state of block 36120411; nothing was signed or sent:
  1. Kitchen.deployPot(0xYou, 0x00…00): Pot 0x8a… is not deployed on base yet. Any account may send this; the Pot is the owner's either way.
  2. the cook, from the owner 0xYou
Assumed for this rehearsal only, by state override:
  the Pot holds 2 USDC: --assume-balance (its balance word 0x1d39…: Solidity mapping at slot 9)
  the owner holds 0.00000374478538635 ETH: the cook's value; it holds 0, and a real cook needs the value and gas
Token transfers:
  1 USDC: 0x8a… (the Pot) -> 0x66…
  1 USDT: 0x8a… (the Pot) -> 0x66…
Native transfers:
  0.00000374478538635 ETH: 0xYou (owner) -> 0x8a… (the Pot)
  0.00000374478538635 ETH: 0x8a… (the Pot) -> 0x1984… (Kitchen)
Net balance changes:
  0x8a… (the Pot): -1 USDC, -1 USDT
  0x66…: +1 USDC, +1 USDT
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
define or argument named like a price limit (`SQRT_PRICE_LIMIT_X96`) at or past `MIN_SQRT_RATIO` or
`MAX_SQRT_RATIO` is named on stderr before the rehearsal, by `compile` and `publish` too. `--json`
carries the same as fields: `block`, `path`, `fallback`, `deployPot`, `assumed`, `gas` and
`gasKind` (`used` or `estimated`), `returns`, `returnType` and `returned`, `transfers`,
`approvals`, `nativeTransfers`, `balanceChanges` and `otherLogs`, amounts as decimal strings in
base units with `formatted` whole units beside them — or `stage` and `reason` for a revert.

### Funding a run: `--fund`

A program spends what its Pot holds. Instead of sending the Pot tokens first, `sauce run` can pull
them from your wallet in the same transaction as the cook:

```sh
npx sauce run pay.sauce.ts --chain base --config sauce.config.json --keystore ~/.keys/me.json \
  --fund USDC:1.5 --sweep --define RECIPIENT=0x… --define AMOUNT=1000000
```

`--fund <TOKEN|address>:<amount>` names a token the chain registers (`sauce globals --tokens`) or
any ERC-20 by address, and an amount in whole units — `USDC:1.5`, by the registry's decimals or
the token's own — or in base units ending in `n`, as SauceScript writes an integer:
`USDC:1500000n`. Repeat it for more tokens. `ETH:<amount>` (or `native:`) is the chain's native
currency: it rides as the cook's value, on top of the Kitchen's fee.

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
([Rehearsing](#rehearsing-sauce-simulate)). An approval `run` would ask for is reported, not made,
and `transfer` mode's transfer is not rehearsed.

### Pots and salts

An owner has one Pot per salt; the default salt is zero. Name another with `--salt <label>`, which
is `keccak256` of the label's UTF-8 bytes (the SDK's `potSalt(label)`), or give the exact 32 bytes
with `--salt-hex 0x…`. Use the same salt in every command for that Pot.

```sh
npx sauce pot --chain base --owner 0xYou --salt treasury
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

Given an endpoint and no `--deploy`, `sauce pot` also reads the chain (or the Solana cluster) and
adds what it found under `deployment`, and in a line on stderr: whether the released engine and
Kitchen are there, the Kitchen's execution fee, and whether the Pot is deployed and whose it is.
`--deploy` refuses a chain with no Kitchen rather than send a `deployPot` to an address without
code, which would succeed and deploy nothing.

```sh
npx sauce pot --chain base --owner 0xYou --config sauce.config.json
```

`run` and `publish` act for the signer, so the owner is the signer: `--owner` may only restate it,
and one that names someone else is refused. `simulate`, `tx` and plain `pot` have no signer and
take `--owner` (or, for `simulate` and `tx`, `--pot <address>`, of a deployed Pot).

### For a wallet: `sauce tx`

```sh
npx sauce tx pay.sauce.ts --chain base --owner 0xYou --value 1000
```

prints the cook unsigned, for any wallet to sign from the owner:

```json
{ "chainId": 8453, "to": "0x8a…", "data": "0x…", "value": "1000" }
```

Give the value, or an endpoint to read the Kitchen's fee (the endpoint also checks the Pot). What
must be true for it to land — the Pot deployed and funded, sent from its owner — goes to stderr.

`--format cast` prints the same transaction as a `cast send` line instead, for
[Foundry](https://getfoundry.sh/cast/overview) users; it is never needed. The line leaves the
endpoint and the signer as `<RPC_URL>` and `<PRIVATE_KEY>` placeholders: the command never fills in
either. `sauce pot --format cast` does the same for the deployment.

## Writing the program file

The file is compiled for the chain as a standalone program (`routes.compileSauceProgram`, the
compile half of `routes.compileSauceRoute`, with the chain's names `openRoute` gives a route body):
the chain's token symbols (`USDC`), protocol namespaces (`Uniswap.UniversalRouter`), `chainId`, the
`@sauce/token` functions (`transfer(token, to, amount)` and the rest, with no import), the token
syntax (`USDC.transfer(...)`, `Token(address).approve(...)`, both SafeERC20) and
[intents opened inside the program](intents.md#create-an-intent-from-inside-a-program) all resolve
against it. One file therefore compiles for every chain whose names it uses. `sauce globals --chain
<c>` lists the names; [Protocols and tokens](protocols-and-tokens.md) explains them. Relative imports
are read from beside the file.

A file is either a script — top-level statements, which are the program — or declares
`function main(...)`, and it reaches the compiler as written: imports, helper functions,
`interface` declarations and annotations included. A script's imports come first, and its
top-level `const`s are the script's own locals, which a function cannot read; declare `main` to
share a module constant with functions or to return a value.

### Choosing the chain

`--chain` takes a slug, an alias or a chain id: `base`, `eth`, `8453`, `solana`. A file can carry
its own, in the `//` comment lines it starts with; a flag overrides it:

```js
// @chain base
// Pays RECIPIENT from the Pot.
USDC.transfer(RECIPIENT, AMOUNT);
```

`--target evm|svm` (or a `// @target` line) is a check against the chain. `--target svm` with no
chain means `solana`.

### Values fixed when it is compiled: defines

```js
const RECIPIENT = 0n;
const AMOUNT = 0n;

function main() {
  require(RECIPIENT != 0n);
  USDC.transfer(RECIPIENT, AMOUNT);
}
```

Pass `--define NAME=VALUE`, repeated, or `--defines values.json`, one JSON object of name to value;
`--define` wins over the file. A value is one 256-bit word: an integer in decimal or `0x` hex, an
address (which is its integer), `true` or `false`. In the JSON file, a number must be a safe integer;
write anything larger as a string.

A define replaces a **module-level** `const`, so in a file with `main` the constant sits beside it,
as above. In a script, a top-level `const` is the script's own local and a define cannot replace it:
leave the name undeclared and define it. The command refuses a define a script would never see,
rather than ignoring it, and names on stderr a define the file never reads, which changes nothing.
For a program on Solana, a value may also be a base58 public key, as `--account` takes them: it is
the 32-byte word an account's `address` compares to.

`sauce compile --json` reports what the compile applied:

- `defines`: each define the file reads, its value, its `source` and the `chain` it applied on. The
  source is `user` for `--define` and `--defines`, or `chain` for what compiling for the chain sets,
  with its `kind` (a `token` symbol, a protocol `contract` such as `UniswapV3_Factory`, the
  `chain id`). A user define that replaced a chain value says what it `replaces`. An intent body
  the file opens reads its own chain's values, so its `USDC` is listed again with that chain; a
  define of such a name stays on the chain it was given for, while any other (`RECIPIENT`) holds
  in the body too. stderr names a define that changes nothing for that reason.
- `contracts`: each protocol contract the program calls or reads (`UniswapV3.Factory.getPool(…)`,
  `Cctp.TokenMessenger`), as written and as resolved, with the chain whose deployment it is — an
  intent body's resolves on the intent's own chain.
- `size`, the program's bytes, and `payload`, the program with `main`'s arguments appended, given
  with `--args` or `--args-json` (`null` until they are).
- `returnType`: the type `main` declares it returns, an `interface` spelled out (`null` when it
  returns nothing), which `simulate` reads the cook's return data as.
- A define's `value` is an address only where it was written as one (`0x` and 40 hex digits, or a
  base58 key on Solana) or where it replaces a chain's token or contract; any other value is the
  integer it is, whatever its size.
- On Solana, `cook`: the size of the cook's transaction against the 1232-byte limit, measured as
  `sauce run` builds it, with each `--account` given and a distinct account for every other slot —
  the Kitchen's cook, or with `--via engine` the engine's direct one, which is smaller (no Kitchen,
  Pot or salt). Past the limit, stderr says `sauce run` stages the program first.

### Values given when it runs: `main`'s arguments

A `main` with typed parameters takes its values at run time, so one compiled program serves every
call:

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
npx sauce run split.sauce.ts --chain base --config sauce.config.json --keystore ~/.keys/me.json \
  --args 0xToken '["0xA…","0xB…"]' 1000000 true
```

An array or tuple argument is JSON. Each value is checked against its declared type before
anything is sent — `Address`, `Uint256` (also `number`, `bigint`), `bool`, `bytes`, `string`, `T[]`
and `{ field: T }` — and a wrong one is named:
`argument 1 (token: Address): '0x12' is not an address: 20 bytes of 0x-prefixed hex`. They are
encoded ABI-v1 by default, compact-v1 under `--compact-args`, and appended to the program: the SDK's
`routes.encodeEntryArguments`, whose inverse `routes.decodeEntryArguments` is what `sauce inspect`
reads them back with.

### When it does not compile

Errors point at your file's line and column, including on a line the SDK rewrote before compiling
it, and a `hint:` line names the flag or define to add:

```text
sauce compile: pay.sauce.ts does not compile for base
…
    ╰╴error: `RECIPIENT` is not a declared variable
       --> pay.sauce.ts:2:15
        |
      2 | USDC.transfer(RECIPIENT, AMOUNT);
        |               ^^^^^^^^^
hint: if RECIPIENT is a value you supply, pass --define RECIPIENT=<value>
```

### In an editor

A program file is checked by an editor as TypeScript, which does not know SauceScript's names.
`sauce init` writes `programs/tsconfig.json`, a TypeScript project of the `*.sauce.ts` files in
`programs/` alone, typed by the package's `@eco-incorp/sauce/sauce-script` declarations: the
builtins (`ctx`, `abi`, `evm`, `svm`, `crypto`, `require`, `revert`), `Token` and the
`@sauce/token` functions, every chain with its tokens and protocol namespaces, the protocol
defines, and the ABI a program imports (`import IERC20 from "./artifacts/IERC20.json"`). The
project's other TypeScript is not in it, so a Node file keeps Node's `crypto` and `require`.

Some valid SauceScript is not valid TypeScript: every SauceScript number is one 256-bit integer, so
`xs[i]` with a `bigint` index, `n + 1` with `n` a `bigint`, and `f(500)` where `f` takes a `bigint`
are all fine, and a define the file leaves undeclared for `--define` is not an error until the
compile. The tsconfig names a TypeScript plugin from the package that drops exactly those
diagnostics, in `*.sauce.ts` files only; a misspelled builtin, a wrong argument count or a method a
contract does not have still shows. An editor loads the plugin only when it runs the project's own
TypeScript (in VS Code, "TypeScript: Select TypeScript Version", then "Use Workspace Version"), and
`init` adds `typescript` to `devDependencies` for it. Without the plugin, those diagnostics show
and nothing else changes: whether a program compiles is the compiler's to say, not the editor's.

In a project `init` did not write, copy that `programs/tsconfig.json` beside your programs.

## An actions document instead of a program

An [actions document](actions.md) is JSON — `{ "version": 1, "actions": [ … ] }`, each action one
protocol operation — that the SDK lowers to a SauceScript program. Its tokens are registry symbols
(`"USDC"`) and its contracts namespace references (`"UniswapV3.Factory"`), or addresses, and a swap
may name its pool by its factory's key; every name is the program's global of that name, so a
document with no `chainId` compiles for any chain where its names exist.

`sauce actions <file>` lowers one for a chain and prints the SauceScript, `main`'s parameters and the
bytecode:

```sh
npx sauce actions swap.json --chain base
npx sauce actions swap.json --chain ethereum --json
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
funded with `--fund` if you like. `--define` and `--defines` are refused, because a document's values
are its own fields.

```sh
npx sauce simulate swap.json --chain base --owner 0xYou --rpc-url <url> \
  --assume-balance USDC:1000 --args 1000000000
npx sauce run swap.json --chain base --config sauce.config.json --keystore ~/.keys/me.json \
  --args 1000000000
```

## Intents: `sauce run` or `sauce intent`

A program can open an intent on another chain — `Base(() => { … }).reward({ … })`. The command
needs what the SDK cannot look up: `--intent-deadline <unix seconds>` and `--intent-creator
<address>`, and, when the intent's body compiles to a program of its own,
`--intent-execution-fee <wei>`, the destination Kitchen's fee. It names whichever is missing, and
refuses a deadline at or before now, which no solver could ever fill (`sauce intent fill` still
rehearses one, with a note, to show the Portal's refusal). `--intent-reward-deadline <unix seconds>`
sets when an unproven reward becomes refundable (the fill deadline by default), and
`--intent-prover <address>` overrides the prover the registry records for the pair.
`--intent-execution-fee auto` reads that fee from each destination's Kitchen, through `--config`
(an `rpcUrls` entry for the destination's chain id), and says what it read.

Every intent whose body runs a program cooks on one Pot on its destination: the one owned by the
destination Portal's Executor with salt zero, which every intent through that Portal shares. No
solver can fill the intent until that Pot is deployed. `compile` and `sauce intent publish` check it on the
destination when `--config` reaches it (`compile --json` reports each under `intentPots`) and warn
while it is missing, naming the `sauce pot --deploy --chain <destination> --owner <Executor>` that
deploys it; any account may send that. `publish` warns before it sends anything, and says how to
check when it cannot.

There are two ways to get such a file's intents onto the chain:

- **`sauce run`** cooks the file on your Pot. Inside one transaction the Pot reads each intent's
  vault from the Portal, pays the reward into it from its own balance, and publishes the intent,
  so the intent may use a value the program measures as it runs — a balance, a swap's output.
- **`sauce intent publish`** sends the source chain's transactions from your **wallet**, with no Pot: for
  each reward token a `transfer` to the intent's vault (and, for a native reward, a plain send to
  it), then `Portal.publish`. It prints each intent's hash, its vault and each transaction's
  result.

  ```sh
  npx sauce intent publish bridge.sauce.ts --chain arbitrum --config sauce.config.json \
    --keystore ~/.keys/me.json --intent-deadline 2000000000 --intent-creator 0xYou
  ```

  Only a file whose intents are fixed when it is built qualifies: every amount a literal, a define
  or a top-level `const` of a literal, and nothing but intents. A file whose intent uses a value
  measured or computed on chain is refused, naming the value and pointing at `sauce run`, and so is
  one that does anything else.
  `--dry-run` rehearses the transactions together (`eth_simulateV1`) and sends nothing, from the
  signer's wallet or `--from <address>`'s, printing each one's gas or revert (`gasUsed` and
  `reason` in `--json`); `--assume-balance USDC:2` (repeatable, `ETH:` for the
  native currency) gives that wallet the reward for the rehearsal only, by state override, as
  `simulate` gives a Pot one. `--format json` (or `cast`) prints the transactions unsigned, with
  `--from <address>` when there is no signer.

  The Portal counts an intent funded when its vault holds the reward (`isIntentFunded`), which is
  what a solver checks once it sees `IntentPublished`, so paying the vault directly needs no
  approval at all: nothing is left standing, and a USDT-style token needs no reset. The vault is
  the SDK's own derivation for the Portal's address. With an endpoint it is also read from the
  Portal (`intentVaultAddress`), and when the two disagree nothing is sent: the command says which
  address each reported. Only what the vault does not hold yet is transferred, so running the
  command again publishes alone. The transfers go first and `publish` is sent only once the Portal
  counts the intent funded. A token whose `transfer` returns `false`, or keeps a fee, stops the
  command before the intent is announced, with what was paid still in the vault: top it up and run
  it again, or refund it after the reward deadline. A `--dry-run` reports `Portal.isIntentFunded`
  after the rehearsed transactions, and `--format` prints each intent's `vault`, `vaultFrom` (`read`
  when the Portal agreed, `derived` with no endpoint) and `fundVia`.

  `--intent-fund-via publishAndFund` (also taken by `run`, `tx`, `simulate`, `compile` and
  `inspect`, for intents a program opens) funds through the Portal instead: for each reward token
  an `approve` to the Portal (reset to zero first when a smaller allowance stands, as SafeERC20
  does; skipped when the allowance already covers it), then `publishAndFund`, which pulls the
  reward into the same vault, records the intent `Funded` and emits `IntentFunded`. Choose it when
  something you rely on reads that event or status rather than the vault's balance. Neither mode
  goes through Permit2: the Portal's Permit2 path (`publishAndFundFor` with Permit2 as its permit
  contract) pulls through a Permit2 _allowance_ to the intent's vault, which takes an on-chain
  `Permit2.approve` per intent — the same number of transactions, plus a standing approval of
  Permit2.

Publishing from Solana is not supported: see [Solana](#solana).

Everything after publishing is a verb of `sauce intent` too. Each takes the intent's file (with
`--chain`, its source, and the flags it was built with) or its hash, and `--config` with both
chains' endpoints:

| Verb                   | What it does                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| `sauce intent publish` | Publish a file's fixed intents from your wallet — or, with no file, make one |
| `sauce intent fill`    | Rehearse a solver's fill on the destination; with `--send`, send it          |
| `sauce intent prove`   | Send the proof of a filled (or cancelled) intent, paying the prover's fee    |
| `sauce intent claim`   | Withdraw a proven intent's reward to its claimant, on the source             |
| `sauce intent refund`  | Return an unearned reward to its creator, once the Portal allows it          |
| `sauce intent cancel`  | Cancel an unfilled intent after its fill deadline, for an earlier refund     |
| `sauce intent status`  | Where an intent stands on both chains, and what can be done next             |
| `sauce intent list`    | Every intent the store keeps                                                 |
| `sauce intent show`    | One stored intent: its route, reward, deadlines and events                   |
| `sauce intent import`  | Store the intents a transaction published, rebuilt from its logs             |
| `sauce intent`         | At a terminal: pick a stored intent and act on it                            |

### Making one: `sauce intent publish` with no file

With no file, `publish` makes the intent, step by step: the source and destination chains (those
with a Portal), the token delivered (a registry symbol, or an address whose decimals it reads), how
much and to whom (you, by default), the reward, the fill and reward deadlines, the prover (the ones
the registry records on both chains), and how the reward is funded (a transfer to the vault by
default, or `publishAndFund`). At a terminal it asks for each; every question has a flag, so it
also runs with none:

```sh
npx sauce intent publish --source arbitrum --destination base --token USDC --amount 1 \
  --recipient 0xYou --reward-token USDC --reward 1.01 --prover HyperProver \
  --fill-deadline +1h --reward-deadline +1d --config sauce.config.json --keystore ~/.keys/me.json
```

With no terminal, it names every flag still missing; the funding, which has a default, is not one
(`--intent-fund-via publishAndFund` chooses the Portal's pull). The reward it suggests is what is delivered
plus a margin over what a solver spends on the destination — the gas of a fill, the prover's fee
(quoted from the destination's prover) and a Kitchen fee where the body cooks — priced in the
reward token through a Uniswap V3 pool of the destination's wrapped native token, and doubled so a
fill is worth a solver's while; it shows how it got there, and you can change it. Deadlines are
unix seconds or `+30m`, `+2h`, `+1d` from now. The fill deadline is the last second a solver may
fill; the reward deadline, when an unproven reward becomes refundable, must leave time after it for
the fill to be proven.

It writes the intent as a `.sauce.ts` file (`--out`, else
`intent-<source>-to-<destination>-<time>.sauce.ts`), headed by the command that publishes it again,
shows it, rehearses publishing it and filling it on the destination, and with a signer publishes it
once you approve (or with `--auto-approve`), storing it.

### Rehearsing the fill: `sauce intent fill`

`publish --dry-run` rehearses the source side: the reward paid into the vault and `publish`. What the intent
does — the swap, the minimum it checks, the refund — runs on the destination, when a solver fills
it, and that is where it fails. `sauce intent fill` rehearses that fill with no key and sends
nothing. It takes the file and the flags `publish` does (or the intent's hash), and the
destination's endpoint:

```sh
npx sauce intent fill swap.sauce.ts --chain arbitrum --config sauce.config.json \
  --defines swap.defines.json --intent-deadline 2000000000 --intent-creator 0xYou \
  --intent-execution-fee 3744785386350 --no-prove
```

For each intent the file opens it runs one `eth_simulateV1` block on the intent's destination,
every call from a solver:

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
role on that chain); it must serve the route's Portal, and with the source chain's endpoint in
`--config` the command checks the source prover trusts it. The solver is an address nobody holds
the key of, or `--solver <address>`, and the claimant is the solver, or
`--claimant <address | bytes32>`. The solver is given the route's tokens and the value by state
override, the token's balance word found as `simulate --assume-balance` finds it. On success it
prints the gas, the transfers, each address's net change (an address a define holds is named by the
define), the Portal's `IntentFulfilled` record, and what the fill left in the shared Pot and the
Portal's Executor:

```text
Intent 0xf261…5d2c from arbitrum to base: the fill succeeds, gas used 1874288
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
  0.368481796891017787 WETH: 0x48e8…744a (the shared intent Pot) -> 0x5a0C…Beef (RECIPIENT, REFUND_TO)
Native transfers:
  …
Net balance changes:
  0x5A0c…F111 (the solver): -998 USDC, -0.00000374478538635 ETH
  0x72AB…2D38: -0.368481796891017787 WETH, +998 USDC
  0x5a0C…Beef (RECIPIENT, REFUND_TO): +0.368481796891017787 WETH
  0x1984…506b (Kitchen): +0.00000374478538635 ETH
The Portal records the fill: IntentFulfilled(0xf261…5d2c, claimant 0x0000…F111)
Left behind: nothing. The shared intent Pot and the Portal's Executor end holding none of what the fill moved.
```

A fill that leaves tokens in the shared Pot or the Executor is warned about: every intent through
that Portal shares them, so a later intent's program or solver can take what is left. A revert
prints `the fill reverts: <reason>` and exits 1, a failed route call unwrapped from the Executor's
`CallFailed` down to its own reason — `route call 2 of 2 (the cook on the shared Pot 0x48e8…)
reverted: the program threw "output below MIN_OUT"`, or `FeeNotPaid(<fee>, <paid>)` for a cook
that underpays the Kitchen, which the command also warns about, naming the fee to build with. The
Portal's own refusals are named: `IntentExpired()` with the deadline, `IntentAlreadyFulfilled`,
`InvalidHash`. `--json` carries one object per intent under `intents`: the hashes, `portal`,
`executor`, `pot` and `potDeployed`, `solver`, `claimant`, `value`, `proves`, `prover`, `fee`,
`calls` (each with its `status` and `gasUsed`), `assumed`, then `gas`, `fulfilled`, `transfers`,
`approvals`, `nativeTransfers`, `balanceChanges`, `otherLogs` and `leftBehind` — or `stage` and
`reason`.

The endpoint is the destination's: `--config` names one for each destination, and `--rpc-url`
serves a file whose intents all go to one chain. It needs `eth_simulateV1`, since the deployment,
the approvals and the fulfill carry state from one to the next. The intent must be fixed when it is
built, as for `publish`: an intent that uses a value the program measures on chain has no route
until the program runs (name it by the hash `sauce run` stored instead). A Solana destination is
not filled.

### Filling it for real: `sauce intent fill --send`

With `--send` and a signer, the signer is the solver, and the fill is sent:

```sh
npx sauce intent fill 0x<intent hash> --config sauce.config.json --send --keystore ~/.keys/me.json
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
npx sauce intent prove 0x<intent hash> --config sauce.config.json --keystore ~/.keys/me.json
npx sauce intent claim 0x<intent hash> --chain arbitrum --config sauce.config.json --keystore ~/.keys/me.json
npx sauce intent refund 0x<intent hash> --chain arbitrum --config sauce.config.json --keystore ~/.keys/me.json
npx sauce intent cancel 0x<intent hash> --config sauce.config.json --keystore ~/.keys/me.json
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

With no signer, each prints its transactions unsigned, for a wallet to send in order.

### An intent to Solana

An intent an EVM chain publishes for Solana (eco-routes' Solana deposit addresses publish one per
deposit) is filled, proven and cancelled through Solana's Portal program, and claimed or refunded on
its source like any other. Store it from the transaction that published it, then:

```sh
npx sauce intent import 0x<tx hash> --chain arbitrum --config sauce.config.json
npx sauce intent fill 0x<intent hash> --config sauce.config.json --solver <solana key> --claimant 0xYou
npx sauce intent fill 0x<intent hash> --config sauce.config.json --claimant 0xYou \
  --send --keypair ~/.config/solana/id.json
npx sauce intent claim 0x<intent hash> --config sauce.config.json --keystore ~/.keys/me.json
```

- The config names Solana's endpoint under its chain id, `1399811149`, beside the source's.
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

`sauce intent import <tx hash> --chain <source> --config sauce.config.json` stores the intents a
transaction published — someone else's, say — rebuilt from its `IntentPublished` logs, each checked
against its hash. `sauce intent list` lists the store, and `sauce intent show <hash>` one intent
with its events. `sauce intent` alone, at a terminal, lists the stored intents with where each
stands (read live with `--config`), and on the one you pick runs status, fill, prove, claim, refund
or cancel, with the same approvals; with a signer, they send. With no terminal it prints the list.

## Look up and take apart

### `sauce globals`

```sh
npx sauce globals --chain base                       # everything
npx sauce globals --chain base --tokens              # token symbols only
npx sauce globals --chain base --protocols           # protocol namespaces only
npx sauce globals --chain base --protocol UniswapV3  # one namespace, with its methods
```

lists every name a program compiled for the chain may use without declaring it: the token symbols
with their addresses and decimals, each protocol namespace with its contracts' addresses (and, with
`--protocol`, each method with every parameter and struct field named), the chain names that open
intents, the defines, and the `@sauce/token` functions. On an EVM chain it also lists the
interfaces: ABIs the registry knows with no fixed address (`Erc4626.Vault`, `Erc20.ERC20`), which a
program binds to an address of its own, `Erc4626.Vault.at(vault).totalAssets()`; `--protocol
Erc4626` lists their methods. `--json` prints the same for a program to read (`interfaces` beside
`protocols`). It is `routes.sourceGlobals(chain)`, which reads the registries the compile reads and
lists contracts through the protocol rewrite's own resolver, so a name it lists is one the compile
accepts, at the address the program gets.

### `sauce price`

```sh
npx sauce price --chain base 2700 USDC per WETH                   # the price, in words
npx sauce price --chain base WETH USDC 2700                       # the same: <base> <quote> <price>
npx sauce price --chain base 2700 USDC per WETH --config sauce.config.json   # and the pool's now
npx sauce price --chain base WETH USDC --sqrt-price-x96 4116816085950893928074568
```

Its first line says what the price means both ways round — `2700 USDC per WETH on base: 1 WETH =
2700 USDC, 1 USDC = 0.00037037037037037 WETH` (`means` and `inverse` in `--json`) — since a price
written the wrong way round is off by its own square, a millionfold for WETH and USDC. With
`--rpc-url` or `--config` it also reads the pair's price now from its deepest Uniswap V3 pool on
the chain (`live` in `--json`) and warns on stderr when the price given is 10x or more away from it,
saying so, with the command that reads it the right way, when it looks written backwards. It
turns a price, in quote tokens per base token, into the numbers a swap program takes, for the pair's
order on the chain (token0 is the lower address): the `sqrtPriceX96` a Uniswap V3 or V4 pool (or a
fork) trades at, which is also the swap's `sqrtPriceLimitX96` — a floor when selling token0, a
ceiling when selling token1 — and, for selling the base token and for buying it, the `minAvgPrice` a
program compares a fill against, `out * 1e18 >= minAvgPrice * spent`, rounded up so the check never
passes a worse average. A token is a symbol the chain registers, or `0x…:<decimals>`.
`--sqrt-price-x96` reads a pool's price back. The conversion is the package's
`sqrtPriceX96FromPrice` and `priceFromSqrtPriceX96`, which a TypeScript program imports from the
root; without an endpoint, nothing reaches a network.

### `sauce inspect`

```sh
npx sauce inspect 0x<calldata> --chain base --source split.sauce.ts
npx sauce inspect 0x<tx hash> --config sauce.config.json --chain arbitrum
npx sauce inspect bridge.sauce.ts --intent-deadline 2000000000 --intent-creator 0xYou
```

takes bytes back apart into what a SauceScript author wrote:

- a `Pot.cook`: the engine (and whether it is the released one) and the program — its size, hash,
  and every intent it opens, with the route's calls, the reward, the intent hash, the vault the
  reward is escrowed in, and how the program funds it (`fundVia`: paid into the vault then
  `publish`, or `publishAndFund`);
- with `--source <file>`: whether the program is that file's, and the arguments the cook appends,
  decoded against its `main`;
- a `Kitchen.deployPot` (the Pot it makes), a `Portal.publish` or `publishAndFund` (the route, the
  reward, and the intent's vault — the address a funder's `transfer` pays), an ERC-20 call, or
  bare program bytes;
- a 32-byte hash with an endpoint: the transaction, fetched — its status, sender, value and call,
  what it cost (gas, an OP-stack chain's L1 data fee, the value), and the token transfers,
  approvals and net balance changes its receipt's logs record;
- a file: the program it compiles to, and its intents, with every value it measures at run time
  named (`reward: <amount> of 0x…`).

An intent whose values the program measures at run time is only partly readable from the bytes: its
destination, and that the rest is filled in on chain. There is no opcode listing or disassembly:
programs are reported by what they are and what they open.

### `sauce verify`

```sh
npx sauce verify 0x<settle payload>
npx sauce verify 0x<tx hash> --config sauce.config.json --chain base --pin 0x…:435
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
(`svm.createSauceSvmClient`, with the endpoint you give and the program ids `/deployments` records).
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
from the cluster. A slot with no `--account` is named with the role it needs, and `simulate` notes each
account it was given that the cluster does not have (a guard on it fails with no message of its
own).

```js
// @chain solana
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  dest: Account<Writable>,
  authority: Account<Signer>,
  amount: Uint256,
) {
  transfer(MINT, tokenProgram, source, dest, authority, amount);
}
```

```sh
npx sauce run sweep.sauce.ts --config sauce.config.json --keypair ~/.config/solana/id.json \
  --define MINT=0x<mint, as 32 bytes of hex> \
  --account tokenProgram=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  --account source=<the Pot's token account> --account dest=<token account> \
  --account authority=pot --args 400
```

**The Pot.** A Pot is the Kitchen's PDA over the owner and the salt. `sauce pot --chain solana
--owner <pubkey>` prints it and the `create_pot` instruction; `--deploy` with `--keypair` creates
it. With an endpoint it also lists the Pot's token account for each registered mint: its address,
whether it exists and what it holds (`tokenAccounts` in its JSON). A cook names its Pot by `--owner` and `--salt`, never `--pot`, and `run` asks before creating a
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
npx sauce run sweep.sauce.ts --config sauce.config.json --keypair ~/.config/solana/id.json \
  --via engine --max-execution-fee 10000 --define MINT=0x<mint, as 32 bytes of hex> \
  --account tokenProgram=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  --account source=<your token account> --account dest=<token account> \
  --account authority=owner --args 400
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

## Agent skills

The package ships agent skills: directories in the [Agent Skills](https://agentskills.io/specification)
format, a `SKILL.md` and the examples and references it links, that teach a coding agent to write
Sauce programs and run them with this package. They live in [`skills/`](../../skills/sauce-overview/SKILL.md)
at the package root:

| Skill                    | What it teaches                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `sauce-overview`         | What Sauce is, the path from a file to a transaction, the rules, and which skill to load next |
| `sauce-script`           | The language: program forms, inputs and defines, compile errors, and the builtins reference   |
| `sauce-globals`          | The names a program uses with no import, with generated indexes of them                       |
| `sauce-chains`           | Each chain, generated from the registries: tokens, every protocol with its addresses, intents |
| `sauce-protocols`        | Every protocol by category: how to choose, its deployments, its pitfalls and how to call it   |
| `sauce-swaps`            | Swapping through the Router: entry points, price limits, callbacks and the guard on every leg |
| `sauce-distributed-swap` | One exact-input swap split across every price-limit venue on a chain                          |
| `sauce-intents`          | Cross-chain intents written in Sauce: rewards, cascades, run or publish                       |
| `sauce-solana`           | Programs for Solana: accounts, the SPL token functions, the Kitchen                           |
| `sauce-run`              | Everything on this page: compiling, funding, simulating, running and publishing               |
| `sauce-typescript`       | The same from application code: compiling, arguments, cooks, actions and verification         |
| `sauce-examples`         | An index of every example program and runner, with the chains each is checked on              |

Every program in them is compiled through this command on the chains it names, and every command
line they show is held to its flags, before the package is published. The per-protocol documents in
`sauce-protocols` are the files the [`/skills` export](../api/README.md#protocol-resources) returns.

They are written once and installed where coding agents read them. Each agent reads skills from
these directories, per its vendor's documentation:

| Agent          | Reads project skills from                                         | Documentation                                                                                                                 |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Claude Code    | `.claude/skills/`, and nothing under `.agents/`                   | [Skills](https://code.claude.com/docs/en/skills), [memory](https://code.claude.com/docs/en/memory)                            |
| OpenAI Codex   | `.agents/skills/`, from the working directory up to the repo root | [Build skills](https://learn.chatgpt.com/docs/build-skills)                                                                   |
| Cursor         | `.agents/skills/`, `.cursor/skills/`, and `.claude/skills/` too   | [Skills](https://cursor.com/docs/skills)                                                                                      |
| GitHub Copilot | `.github/skills/`, `.claude/skills/` or `.agents/skills/`         | [Add skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) |
| Gemini CLI     | `.gemini/skills/`, or its `.agents/skills/` alias (which wins)    | [Skills](https://geminicli.com/docs/cli/skills/)                                                                              |

So two directories reach all five natively: `.claude/skills/` for Claude Code and `.agents/skills/`
for the other four. Those two are what `sauce skills install` writes by default, and what
`--agent all` means. `--agent claude`, `codex`, `cursor`, `copilot` or `gemini` alone writes only
the directory that agent reads. Cursor and Copilot also read `.claude/skills/`, so they see the
same skill, with the same files, in both.

`--agent agents-md` is opt-in, for a tool that reads [`AGENTS.md`](https://agents.md/) but no
skills directory: it writes `.agents/skills/` and an index of the skills into `AGENTS.md`, a block
between `<!-- sauce-skills:begin … -->` and `<!-- sauce-skills:end -->` markers listing each skill
and its `SKILL.md`. The command owns that block and nothing else in the file. Every packaged skill
follows the [Agent Skills specification](https://agentskills.io/specification): a `name` that is
its directory's, lowercase letters, digits and hyphens, at most 64 characters, and a `description`
of at most 1024.

`sauce init` writes the project's instructions to `AGENTS.md`, which Codex, Cursor, Copilot and
Gemini CLI read, and the one-line pointers to it that the other two document: `CLAUDE.md` holding
`@AGENTS.md` (Claude Code reads `AGENTS.md` only when there is no `CLAUDE.md`) and `GEMINI.md`
holding `@./AGENTS.md` ([GEMINI.md imports](https://geminicli.com/docs/cli/gemini-md)).

```sh
npx sauce skills install                          # .claude/skills and .agents/skills
npx sauce skills install --agent codex            # only the directory Codex reads
npx sauce skills install --agent all,agents-md    # and the AGENTS.md index
npx sauce skills status                           # exit 1 while any target is outdated
npx sauce skills update                           # after upgrading the package
```

- **`install`** is the first install. It never overwrites. Run again, it says the skills are up to
  date, or, after a package upgrade, that they are outdated — installed from one version, the
  package has another — and to run `sauce skills update`. A file already there that it did not
  write is left alone.
- **`update`** brings each installed target to the package: it adds new skill files, replaces
  changed ones and removes retired ones. A file edited since it was installed is kept, with a short
  diff of what differs, unless you pass `--force`. It prints, per target,
  `added N, updated N, removed N, kept N modified`. In `AGENTS.md` it rewrites only its own block.
- **`status`** reports each target as up to date, outdated or modified, listing the files, and
  exits 1 while any is outdated: put it in CI to notice an upgrade the skills have not followed.

Each skills directory records what it was given in `.sauce-skills.json` — the package, its version,
and the sha256 of each file as written — and the `AGENTS.md` block records the same in its opening
marker. That record is how a package upgrade (a file still as installed) is told apart from an edit
(a file that is not). Skills of your own in the same directories are never touched.

The per-protocol documents the `/skills` export returns are not a second set: they are the
`sauce-protocols` skill's `references/`, installed with it.
