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
| `sauce simulate` | Rehearse the cook with no key, no deployed Pot and assumed balances: what it did  |
| `sauce run`      | Compile, sign, send and wait for the cook on your Pot                             |
| `sauce publish`  | Publish a file's fixed intents from your wallet, with no Pot                      |
| `sauce tx`       | Print the unsigned cook transaction, for a wallet to sign                         |
| `sauce pot`      | Predict a Pot's address, and deploy it or print the transaction that does         |
| `sauce globals`  | List the tokens, protocols and other names a program on a chain can use           |
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
local configuration out of git, and `sauce.config.example.json`, and then installs the agent skills
([Agent skills](#agent-skills)). `init` refuses to overwrite a file that already has other content,
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

Nothing is signed without one of these, and the signer is always the Pot's owner:

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
the hash, the status and the gas used:

```text
cook 0x5f…: success, gas used 184211, block 21004500
```

A cook that would revert is not sent: the run stops with the decoded reason — a Pot or Kitchen
error by name, `Error(string)`, or `the program threw "…"` for a SauceScript `throw` — and exits 1.
The value defaults to the Kitchen's execution fee, read from the chain; pass `--value <wei>` when
the program also spends native currency (a `--value` below the fee is refused, since the cook would
revert).

If the Pot is not deployed yet, `run` asks first:

```text
Pot 0x8a… (owner 0xYou, salt 0x00…00) is not deployed on base. Deploy it now? [y/N]
```

`y` deploys it in a transaction of its own and then cooks; anything else sends nothing. With no
terminal to ask on (CI, a pipe), the run fails and says so, unless you pass `--yes`, which agrees in
advance.

### Rehearsing: `sauce simulate`

`sauce simulate` runs the cook as a rehearsal from the Pot's owner: no key, no transaction, and
nothing on chain changes. It needs neither a deployed Pot nor the tokens the program spends:

```sh
npx sauce simulate pay.sauce.ts --chain base --owner 0xYou --config sauce.config.json \
  --assume-balance USDC:2 --assume-balance USDT:2 --define RECIPIENT=0x… --define AMOUNT=1000000
```

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
the deployment and the cook, state carried from one to the next, with the cook's logs. On success
it prints the gas used and what the program returned, then what the cook did:

```text
The cook succeeds from 0xYou: gas used 128999, returns 0x
Rehearsed with eth_simulateV1; nothing was signed or sent:
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
Pot, Kitchen, Permit2 or Portal error by name, ERC-20's standard errors, `Error(string)`, or
`the program threw "…"` for a SauceScript `throw` or `require` message. `--json` carries the same
as fields: `path`, `fallback`, `deployPot`, `assumed`, `gas` and `gasKind` (`used` or
`estimated`), `returns`, `transfers`, `approvals`, `nativeTransfers`, `balanceChanges` and
`otherLogs`, amounts as decimal strings in base units with `formatted` whole units beside them —
or `stage` and `reason` for a revert.

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
`ETH` is funded) back to you. It is one cook, so the pulls, the program and the sweep succeed or
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
the cook; anything else sends nothing. With no terminal to ask on, the run fails unless you pass
`--yes`. `--fund-mode allowance` asks the same about approving the Pot, and warns when it leaves an
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
`function main(...)`. A bare body is wrapped in `main()` for you; a file that imports another
declares `main()` itself. Only `main`'s parameters carry type annotations.

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
rather than ignoring it.

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

## Intents: `run` or `publish`

A program can open an intent on another chain — `Base(() => { … }).reward({ … })`. The command
needs what the SDK cannot look up: `--intent-deadline <unix seconds>` and `--intent-creator
<address>`, and, when the intent's body compiles to a program of its own,
`--intent-execution-fee <wei>`, the destination Kitchen's fee. It names whichever is missing.

There are two ways to get such a file's intents onto the chain:

- **`sauce run`** cooks the file on your Pot. The Pot approves the Portal and publishes and funds
  each intent from its own balance, inside one transaction, so the intent may use a value the
  program measures as it runs — a balance, a swap's output.
- **`sauce publish`** sends the source chain's Portal transactions from your **wallet**, with no
  Pot: for each reward token an `approve` to the Portal (reset to zero first when a smaller
  allowance stands, as SafeERC20 does; skipped when the allowance already covers it), then
  `publishAndFund`. It prints each intent's hash and each transaction's result.

  ```sh
  npx sauce publish bridge.sauce.ts --chain arbitrum --config sauce.config.json \
    --keystore ~/.keys/me.json --intent-deadline 2000000000 --intent-creator 0xYou
  ```

  Only a file whose intents are fixed when it is built qualifies: every amount a define or a
  literal, and nothing but intents. A file whose intent uses a value measured on chain is refused,
  naming the value and pointing at `sauce run`, and so is one that does anything else.
  `--dry-run` rehearses the transactions together (`eth_simulateV1`) and sends nothing, from the
  signer's wallet or `--from <address>`'s; `--assume-balance USDC:2` (repeatable, `ETH:` for the
  native currency) gives that wallet the reward for the rehearsal only, by state override, as
  `simulate` gives a Pot one. `--format json` (or `cast`) prints the transactions unsigned, with
  `--from <address>` when there is no signer.

  `publish` approves the Portal for exactly the reward, and `publishAndFund` spends that approval
  in the next transaction, so no allowance stands once it lands. It does not go through Permit2:
  the Portal's Permit2 path (`publishAndFundFor` with Permit2 as its permit contract) pulls through
  a Permit2 _allowance_ to the intent's vault, which takes an on-chain `Permit2.approve` per intent
  — the same number of transactions, plus a standing approval of Permit2.

Publishing from Solana is not supported: see [Solana](#solana).

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
intents, the defines, and the `@sauce/token` functions. `--json` prints the same for a program to
read. It is `routes.sourceGlobals(chain)`, which reads the registries the compile reads and lists
contracts through the protocol rewrite's own resolver, so a name it lists is one the compile
accepts, at the address the program gets.

### `sauce inspect`

```sh
npx sauce inspect 0x<calldata> --chain base --source split.sauce.ts
npx sauce inspect 0x<tx hash> --config sauce.config.json --chain arbitrum
npx sauce inspect bridge.sauce.ts --intent-deadline 2000000000 --intent-creator 0xYou
```

takes bytes back apart into what a SauceScript author wrote:

- a `Pot.cook`: the engine (and whether it is the released one) and the program — its size, hash,
  and every intent it opens, with the route's calls, the reward and the intent hash;
- with `--source <file>`: whether the program is that file's, and the arguments the cook appends,
  decoded against its `main`;
- a `Kitchen.deployPot` (the Pot it makes), a `Portal.publish` or `publishAndFund` (the route and
  the reward), an ERC-20 call, or bare program bytes;
- a 32-byte hash with an endpoint: the transaction, fetched — its status, sender, value and call;
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
Three things differ.

**Accounts.** A Solana program declares every account it touches as an `Account` parameter of
`main` — `Account<Writable>`, `Account<Signer>` — and `sauce compile --json` reports them in its
`manifest`. Pass each to `simulate`, `run` and `tx` as `--account NAME=<value>`, where the value is
an address, `pot` (the Pot, which the Kitchen signs for) or `owner` (the signer). A missing one is
named with the role it needs.

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
it. A cook names its Pot by `--owner` and `--salt`, never `--pot`, and `run` asks before creating a
missing one, as on an EVM chain.

**The cook.** The Kitchen's fee is read from the cluster, so there is no `--value`. `simulate`
simulates the cook from `--owner` with signatures unchecked; a Pot the Kitchen has not created yet
is created by its `create_pot` ahead of the cook, in the same transaction. It prints the compute
units, or the reason — a program's `throw` or `require` message, decoded from the engine's return
data — and the program logs. Solana's `simulateTransaction` takes no account overrides, so there
is no `--assume-balance`: the rehearsal runs on the accounts as they are, and the owner must hold
the Pot's rent and the fees (a shortfall is named). A cook too large for one transaction is refused
with the bytes to shrink the payload (the program and its arguments) by, since staging it writes a
code buffer on chain, which only `run` does. `run` signs with `--keypair`, confirms by polling the endpoint (no websocket to
configure), and prints the signature, status and compute units — and the logs when it fails. A
program too large for one transaction is staged in a Kitchen code buffer first and the buffer is
closed again after the cook — or when staging or the cook's rehearsal fails; if closing it fails,
the run still prints the cook and warns with the buffer's address. A failure is named for the
program the logs show failing. `tx` prints the cook as a base64 transaction signed by no one,
`{ chain, feePayer, pot, fee, transaction }`, for the owner's wallet to sign; its blockhash expires
in about a minute.

`sauce verify --chain solana <signature> --min-out <n> --spl-count <n>` checks a settle cook: the
engine invocation it made, against the SDK's settle program recompiled for that floor and split
(`svm.verifySvmSettleExecution`). It rejects with `TX_FAILED` (the transaction failed),
`NO_SETTLE` or `NOT_GENUINE`.

`sauce publish` does not work from Solana: the SDK has no Kitchen-built path for an intent that
Solana's Portal runs ([Solana guide](solana.md#svm-destinations-in-eco-intents)). Open the intent
from an EVM chain; its destination may be Solana. A `main` argument of type `Address` is a 32-byte
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
