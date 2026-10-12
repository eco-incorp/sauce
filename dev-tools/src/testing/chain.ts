/**
 * A test chain: a local node with the released stack, anvil's dev accounts each with a Pot, and the
 * calls a test makes — fund an address, run or simulate a program as an account's cook, read
 * balances, snapshot and revert, move time.
 */
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseUnits,
  toHex,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TestClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

import {
  compileProgram,
  reasonOf,
  revertOf,
  CookReverted,
  type CompiledProgram,
  type ProgramInput,
  type Value,
} from "./program.js";
import { rpc } from "./node.js";
import {
  addressLabels,
  BalanceSlotError,
  balanceOverride,
  buildSauceEvmCall,
  effectsOf,
  TOKEN_REGISTRY,
  type CanonicalChain,
  type Effects,
  type EntryValue,
  type Movement,
  type RawLog,
} from "./sdk.js";
import type { Stack } from "./stack.js";

/** Anvil's default dev mnemonic: its accounts are the test accounts. */
const DEV_MNEMONIC = "test test test test test test test test test test test junk";
/** The salt `sauce pot` and `sauce run` use when given none. */
export const DEFAULT_POT_SALT = `0x${"00".repeat(32)}` as Hex;

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export interface TestAccount {
  readonly index: number;
  readonly address: Address;
  readonly privateKey: Hex;
  /** The account's Pot under the default salt. Deployed on the account's first cook, or by
   *  `chain.deployPot(account)`. */
  readonly pot: Address;
}

export interface CookOptions {
  /** The account whose Pot cooks: an index into the dev accounts, or one of them. Default 0. */
  readonly from?: number | TestAccount;
  /** `main`'s arguments, in order: integers as bigint or number, addresses and bytes as hex. */
  readonly args?: readonly EntryValue[];
  /** Native currency sent with the cook beyond the Kitchen's fee, in wei. */
  readonly value?: bigint;
}

export interface CookResult {
  /** The cook's transaction; absent from a simulation. */
  readonly hash?: Hex;
  readonly gasUsed: bigint;
  /** What the program returned, raw. */
  readonly returnData: Hex;
  /** What `main` returned, read as it declares it; undefined when it declares nothing. */
  readonly returned: Value | undefined;
  /** Every token and native movement the cook's logs record. */
  readonly transfers: readonly Movement[];
  /** The cook's logs, decoded: transfers, approvals, balance changes, the rest. */
  readonly effects: Effects;
  /** How much `holder`'s balance of `token` (a symbol, an address, or the native symbol) changed. */
  delta(holder: Address, token: string): bigint;
}

/** A token as a test names it: a registry symbol on the chain, the native symbol, or an address. */
interface TokenRef {
  readonly address: Address | "native";
  readonly symbol: string;
}

export class TestChain {
  readonly client: PublicClient;
  readonly test: TestClient;
  private readonly viemChain: Chain;
  private readonly snapshots: Hex[] = [];
  private readonly accounts: TestAccount[];

  constructor(
    /** The chain the node runs as. */
    readonly chain: CanonicalChain,
    /** The node's RPC URL. */
    readonly rpcUrl: string,
    /** How the node was started: "replay", "record", "live" (forks) or "local" (an empty chain). */
    readonly mode: "replay" | "record" | "live" | "local",
    readonly stack: Stack,
    private readonly stopNode: () => Promise<void>,
  ) {
    this.viemChain = defineChain({
      id: chain.id,
      name: chain.name,
      nativeCurrency: { name: "Ether", symbol: this.nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const transport = http(rpcUrl);
    this.client = createPublicClient({ chain: this.viemChain, transport });
    this.test = createTestClient({ chain: this.viemChain, mode: "anvil", transport });
    this.accounts = Array.from({ length: 10 }, (_, index) => {
      const hd = mnemonicToAccount(DEV_MNEMONIC, { addressIndex: index });
      const address = hd.address;

      return {
        index,
        address,
        privateKey: toHex(hd.getHdKey().privateKey!),
        pot: getCreate2Address({
          bytecodeHash: stack.potInitCodeHash,
          from: stack.kitchen,
          salt: keccak256(
            encodeAbiParameters(
              [{ type: "address" }, { type: "bytes32" }],
              [address, DEFAULT_POT_SALT],
            ),
          ),
        }),
      };
    });
  }

  get engine(): Address {
    return this.stack.engine;
  }

  get kitchen(): Address {
    return this.stack.kitchen;
  }

  get router(): Address {
    return this.stack.router;
  }

  /** The chain's native currency symbol (`ETH` on every EVM chain the registry has). */
  get nativeSymbol(): string {
    return "ETH";
  }

  /** Dev account `index` (0–9), with its private key and its Pot's address. */
  account(index = 0): TestAccount {
    const account = this.accounts[index];
    if (account === undefined)
      throw new RangeError(`there are 10 test accounts, 0 to 9: not ${index}`);

    return account;
  }

  private accountOf(from: number | TestAccount | undefined): TestAccount {
    return typeof from === "object" ? from : this.account(from ?? 0);
  }

  /** The Kitchen's execution fee, which every cook pays as value. */
  async executionFee(): Promise<bigint> {
    return (await this.client.readContract({
      abi: this.stack.kitchenAbi,
      address: this.stack.kitchen,
      functionName: "executionFee",
    })) as bigint;
  }

  /** Deploys `account`'s Pot if it is not deployed yet. */
  async deployPot(account: number | TestAccount = 0): Promise<Address> {
    const owner = this.accountOf(account);
    if (((await this.client.getCode({ address: owner.pot })) ?? "0x") !== "0x") return owner.pot;
    const wallet = this.wallet(owner);
    const hash = await wallet.sendTransaction({
      to: this.stack.kitchen,
      data: encodeFunctionData({
        abi: this.stack.kitchenAbi,
        functionName: "deployPot",
        args: [owner.address, DEFAULT_POT_SALT],
      }),
    });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error(`deploying the Pot of ${owner.address} reverted`);

    return owner.pot;
  }

  private wallet(account: TestAccount) {
    return createWalletClient({
      account: mnemonicToAccount(DEV_MNEMONIC, { addressIndex: account.index }),
      chain: this.viemChain,
      transport: http(this.rpcUrl),
    });
  }

  private token(name: string): TokenRef {
    if (name.toUpperCase() === this.nativeSymbol)
      return { address: "native", symbol: this.nativeSymbol };
    if (isAddress(name)) return { address: getAddress(name), symbol: name };
    const row = (TOKEN_REGISTRY[this.chain.id] ?? []).find(
      (entry) => entry.symbol.toLowerCase() === name.toLowerCase(),
    );
    if (row === undefined) {
      throw new Error(
        `${name} is not a token the registry has on ${this.chain.slug}: give its address`,
      );
    }

    return { address: getAddress(row.address), symbol: row.symbol };
  }

  private async decimals(token: TokenRef): Promise<number> {
    if (token.address === "native") return 18;
    const address = token.address;
    const row = (TOKEN_REGISTRY[this.chain.id] ?? []).find(
      (entry) => getAddress(entry.address) === address,
    );
    if (row !== undefined) return row.decimals;

    return Number(
      await this.client.readContract({ abi: ERC20, address, functionName: "decimals" }),
    );
  }

  /** `holder`'s balance of `token` (a symbol, an address, or the native symbol), in base units. */
  async balanceOf(holder: Address, token: string): Promise<bigint> {
    const ref = this.token(token);
    if (ref.address === "native") return this.client.getBalance({ address: holder });

    return this.client.readContract({
      abi: ERC20,
      address: ref.address,
      functionName: "balanceOf",
      args: [holder],
    });
  }

  /**
   * Gives `holder` more of each token: `{ USDC: "100", ETH: "1" }` adds whole tokens, a bigint adds
   * base units (`{ USDC: 100_000_000n }`). A token's balance is written into its own storage, in the
   * slot `balanceOf` reads (its total supply is left as it was); the native currency is set on the
   * account. A token whose balance is computed rather than stored, or a B20 precompile, is refused:
   * fund the holder from an account that has it instead (`impersonate`).
   */
  async fund(holder: Address, amounts: Readonly<Record<string, string | bigint>>): Promise<void> {
    for (const [name, amount] of Object.entries(amounts)) {
      const token = this.token(name);
      const units =
        typeof amount === "bigint" ? amount : parseUnits(amount, await this.decimals(token));
      const target = (await this.balanceOf(holder, name)) + units;
      if (token.address === "native") {
        await this.test.setBalance({ address: holder, value: target });
        continue;
      }
      let override: Awaited<ReturnType<typeof balanceOverride>>["override"];
      try {
        ({ override } = await balanceOverride(this.client, token.address, holder, target));
      } catch (error) {
        if (error instanceof BalanceSlotError) {
          throw new Error(`cannot fund ${holder} with ${name}: ${error.message}`, { cause: error });
        }
        throw error;
      }
      for (const { slot, value } of override.stateDiff ?? []) {
        await rpc(this.rpcUrl, "anvil_setStorageAt", [token.address, slot, value]);
      }
      if ((await this.balanceOf(holder, name)) !== target) {
        throw new Error(`funding ${holder} with ${name} did not change its balance as written`);
      }
    }
  }

  /** Lets `address` send transactions with no key, for as long as `body` runs (e.g. a token holder
   *  paying an account). `send` sends one from it. */
  async impersonate<T>(
    address: Address,
    body: (send: (tx: { to: Address; data?: Hex; value?: bigint }) => Promise<Hex>) => Promise<T>,
  ): Promise<T> {
    await this.test.impersonateAccount({ address });
    if ((await this.client.getBalance({ address })) < 10n ** 17n) {
      await this.test.setBalance({ address, value: 10n ** 18n });
    }
    try {
      return await body(async (tx) => {
        const hash = (await rpc(this.rpcUrl, "eth_sendTransaction", [
          {
            from: address,
            to: tx.to,
            ...(tx.data === undefined ? {} : { data: tx.data }),
            ...(tx.value === undefined ? {} : { value: toHex(tx.value) }),
          },
        ])) as Hex;
        const receipt = await this.client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
          throw new Error(`the transaction from ${address} reverted`);

        return hash;
      });
    } finally {
      await this.test.stopImpersonatingAccount({ address });
    }
  }

  /** `program` compiled for this chain, its imports read as they are now. Nothing is kept between
   *  calls: a program is the whole module graph it imports, not its own text. */
  compile(program: ProgramInput): CompiledProgram {
    return compileProgram(program, this.chain);
  }

  private async cookCall(program: CompiledProgram, options: CookOptions) {
    const owner = this.accountOf(options.from);
    await this.deployPot(owner);
    const fee = await this.executionFee();
    const call = buildSauceEvmCall({
      pot: owner.pot,
      engine: this.stack.engine,
      program: program.payload(options.args),
      value: fee + (options.value ?? 0n),
    });

    return { owner, to: getAddress(call.to), data: call.data, value: BigInt(call.value ?? 0) };
  }

  private async result(
    program: CompiledProgram,
    owner: TestAccount,
    returnData: Hex,
    gasUsed: bigint,
    logs: readonly RawLog[],
    hash?: Hex,
  ): Promise<CookResult> {
    const labels = addressLabels(this.chain, [
      [owner.pot, "the Pot"],
      [owner.address, "the owner"],
      [this.stack.kitchen, "Kitchen"],
    ]);
    const effects = await effectsOf(this.client, this.chain, logs, false, labels);

    return {
      ...(hash === undefined ? {} : { hash }),
      gasUsed,
      returnData,
      returned: program.decode(returnData),
      transfers: effects.moves,
      effects,
      delta: (holder: Address, token: string): bigint => {
        const ref = this.token(token);
        const change = effects.changes.find(
          (entry) => getAddress(entry.address) === getAddress(holder),
        );
        const entry = change?.deltas.find((delta) =>
          ref.address === "native"
            ? delta.token === "native"
            : delta.token !== "native" && getAddress(delta.token) === ref.address,
        );

        return entry?.amount ?? 0n;
      },
    };
  }

  /** Rehearses `program` as a cook from `options.from`'s Pot, changing nothing (but deploying the
   *  Pot if it is not yet). Throws {@link CookReverted} when it reverts. */
  async simulate(program: ProgramInput, options: CookOptions = {}): Promise<CookResult> {
    const compiled = this.compile(program);
    const { owner, to, data, value } = await this.cookCall(compiled, options);
    const [block] = await this.client.simulateBlocks({
      blocks: [{ calls: [{ account: owner.address, to, data, value }] }],
    });
    const call = block!.calls[0]!;
    if (call.status !== "success") {
      // A failed simulated call carries its revert data as its return data.
      const reverted = revertOf(call.error);
      const data = reverted.data ?? call.data;
      throw new CookReverted(reverted.reason ?? reasonOf(data), data, { cause: call.error });
    }

    return this.result(compiled, owner, call.data, call.gasUsed, call.logs ?? []);
  }

  /** Sends `program` as a cook from `options.from`'s Pot and waits for it. What `main` returned is
   *  read from a rehearsal in the same state just before. Throws {@link CookReverted} when it
   *  reverts, before sending anything. */
  async run(program: ProgramInput, options: CookOptions = {}): Promise<CookResult> {
    const compiled = this.compile(program);
    const { owner, to, data, value } = await this.cookCall(compiled, options);
    let returnData: Hex;
    try {
      ({ data: returnData = "0x" } = await this.client.call({
        account: owner.address,
        to,
        data,
        value,
      }));
    } catch (error) {
      throw revertOf(error);
    }
    const hash = await this.wallet(owner).sendTransaction({ to, data, value });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new CookReverted(undefined, undefined);

    return this.result(compiled, owner, returnData, receipt.gasUsed, receipt.logs, hash);
  }

  /** Remembers the chain's state; `revert()` returns to it. Snapshots nest. */
  async snapshot(): Promise<void> {
    this.snapshots.push(await this.test.snapshot());
  }

  /** Returns the chain to the last `snapshot()`, which is used up. */
  async revert(): Promise<void> {
    const id = this.snapshots.pop();
    if (id === undefined) throw new Error("revert() with no snapshot() to return to");
    await this.test.revert({ id });
  }

  /** Moves the chain's clock `seconds` forward and mines a block there. */
  async increaseTime(seconds: number | bigint): Promise<void> {
    await this.test.increaseTime({ seconds: Number(seconds) });
    await this.test.mine({ blocks: 1 });
  }

  /** Mines `blocks` empty blocks. */
  async mine(blocks = 1): Promise<void> {
    await this.test.mine({ blocks });
  }

  /** The latest block's timestamp, in seconds. */
  async now(): Promise<bigint> {
    return (await this.client.getBlock()).timestamp;
  }

  /** Stops the node. A recording chain writes its state file here: await it. */
  async stop(): Promise<void> {
    await this.stopNode();
  }
}
