/**
 * The hand-offs a result carries for a wallet's own MCP server, held to that server's input schema
 * (`wallet-mcp-schemas.ts`) and then sent as that server would send them, on a local anvil running
 * the released gated stack (`sdk/test/cli-anvil.ts`):
 *
 * - `sendCalls`, Coinbase Wallet MCP's `send_calls` input, run by a contract wallet as one batch
 *   (`sdk/test/evm/fixtures/BatchWallet.sol`, Coinbase Smart Wallet's `executeBatch` shape): the
 *   wallet owns the Pot, and one batch deploys it and cooks on it — or, when the cook reverts,
 *   leaves nothing behind;
 * - `sendTransaction`, Phantom MCP's `evm_send` input, sent one by one as the
 *   eth_sendTransaction object it is, from the account the Pot belongs to.
 *
 * Nothing here signs with a key the server sees: anvil's own accounts send. GATED on
 * SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  FEE,
  fixture,
  OTHER_KEY,
  OWNER,
  placePortal,
  potOwner,
  registered,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import { v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { connect, endpointsFor, ok, type Connected } from "./harness.js";
import { coinbaseSendCalls, phantomSendEvmTransaction } from "./wallet-mcp-schemas.js";

const EVM_FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../sdk/test/evm/fixtures",
);
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const ZERO_SALT = `0x${"00".repeat(32)}` as Hex;
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");
const INTENT = [
  "Ethereum(() => {",
  "  USDC.transfer(RECIPIENT, 5n);",
  "}).reward({ tokens: [{ token: USDC, amount: 7n }] });",
  "",
].join("\n");

const WALLET_ABI = parseAbi([
  "function executeBatch((address target, uint256 value, bytes data)[] calls) payable",
]);

interface Tx {
  readonly what?: string;
  readonly to: Address;
  readonly data: Hex;
  readonly value: string;
  readonly gas?: string;
  readonly sendTransaction: SendTransaction;
}
/** `sendTransaction`, as eth_sendTransaction's object takes it. */
interface SendTransaction {
  readonly chainId: Hex;
  readonly to: Address;
  readonly data: Hex;
  readonly value: Hex;
  readonly gas?: Hex;
}
interface Batch {
  readonly chain: string;
  readonly calls: ReadonlyArray<{ to: Address; value: Hex; data: Hex }>;
}

/** Each transaction's hand-off says what the transaction says, in hex. */
function sameTransaction(tx: Tx, chainId: number): void {
  const parsed = phantomSendEvmTransaction.parse({ ...tx.sendTransaction, confirmed: true });
  assert.equal(BigInt(parsed.chainId), BigInt(chainId));
  assert.equal(parsed.to, getAddress(tx.to));
  assert.equal(parsed.data, tx.data);
  assert.equal(BigInt(parsed.value), BigInt(tx.value));
  assert.equal(
    parsed.gas === undefined ? undefined : BigInt(parsed.gas),
    tx.gas === undefined ? undefined : BigInt(tx.gas),
  );
}

/** The batch is the transactions, in order. */
function sameBatch(batch: Batch, txs: readonly Tx[], chain: string): void {
  const parsed = coinbaseSendCalls.parse(batch);
  assert.equal(parsed.chain, chain);
  assert.deepEqual(
    parsed.calls.map((call) => [call.to, BigInt(call.value ?? "0x0"), call.data]),
    txs.map((tx) => [tx.to, BigInt(tx.value), tx.data]),
  );
}

describe(
  "handing transactions to a wallet's own MCP server",
  { skip: RUNTIME_HEX_PATH === undefined },
  () => {
    let base: LocalChain;
    let usdc: Address;
    let mcp: Connected;

    /** A contract wallet `OWNER` runs, holding some ETH for the Kitchen's fee. */
    const contractWallet = async (): Promise<Address> => {
      const address = await base.plant(
        `${fixture("BatchWallet", EVM_FIXTURES)}${encodeAbiParameters([{ type: "address" }], [OWNER.address]).slice(2)}` as Hex,
      );
      await base.testClient.setBalance({ address, value: parseEther("1") });

      return address;
    };

    /** `OWNER` has its wallet run `batch`, as Coinbase's wallet runs an approved `send_calls`. */
    const runBatch = async (at: Address, batch: Batch): Promise<"success" | "reverted"> => {
      const hash = await base.owner.sendTransaction({
        account: OWNER,
        chain: null,
        to: at,
        // Past any estimate, so a batch that reverts is mined, and its revert read from the receipt.
        gas: 5_000_000n,
        data: encodeFunctionData({
          abi: WALLET_ABI,
          functionName: "executeBatch",
          args: [
            batch.calls.map((call) => ({
              target: call.to,
              value: BigInt(call.value),
              data: call.data,
            })),
          ],
        }),
      });

      return (await base.publicClient.waitForTransactionReceipt({ hash })).status;
    };

    before(async () => {
      base = await startChain("base");
      usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
      await placePortal(base);
      mcp = await connect(endpointsFor({ [String(base.chain.id)]: base.rpcUrl }));
    });

    after(async () => {
      await mcp?.close();
      await base?.stop();
    });

    it("a smart wallet's one batch deploys its Pot and cooks on it", async () => {
      const owner = await contractWallet();
      const pot = getAddress(v12PredictPot(owner, ZERO_SALT) as Address);
      // Funded before it exists: tokens sent to its address are there when it is deployed.
      await base.mint(usdc, pot, 1_500_000n);

      const tx = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner,
          args: [RECIPIENT, "1500000"],
        }),
      ) as { pot: Address; transactions: Tx[]; sendCalls: Batch };
      assert.equal(tx.pot, pot);
      assert.equal(tx.transactions.length, 2, "the Pot's deployment, then the cook");
      tx.transactions.forEach((each) => sameTransaction(each, base.chain.id));
      sameBatch(tx.sendCalls, tx.transactions, "base");
      assert.equal(BigInt(tx.sendCalls.calls[1]!.value), FEE, "the cook pays the Kitchen's fee");

      assert.equal(await runBatch(owner, tx.sendCalls), "success");
      assert.equal(
        getAddress(await potOwner(base, pot)),
        getAddress(owner),
        "the wallet owns the Pot",
      );
      assert.equal(await base.balanceOf(usdc, RECIPIENT), 1_500_000n, "and its cook ran");
      assert.equal(await base.balanceOf(usdc, pot), 0n);

      // Deployed, the next cook is one call: the batch of one.
      const again = ok(
        await mcp.call("sauce_tx", { source: PAY, chain: "base", owner, args: [RECIPIENT, "0"] }),
      ) as unknown as Tx & { sendCalls: Batch };
      assert.equal(again.to, pot);
      sameTransaction(again, base.chain.id);
      sameBatch(again.sendCalls, [again], "base");
      assert.equal(await runBatch(owner, again.sendCalls), "success");
    });

    it("a batch whose cook reverts deploys no Pot either: all of it or none", async () => {
      const owner = await contractWallet();
      const pot = getAddress(v12PredictPot(owner, ZERO_SALT) as Address);
      // Not funded: the cook's transfer reverts, and with it the deployment before it.
      const tx = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner,
          args: [RECIPIENT, "1500000"],
        }),
      ) as { transactions: Tx[]; sendCalls: Batch };
      sameBatch(tx.sendCalls, tx.transactions, "base");
      assert.equal(await runBatch(owner, tx.sendCalls), "reverted");
      assert.equal(await base.publicClient.getCode({ address: pot }), undefined);
    });

    it("each transaction's own hand-off, sent in order as eth_sendTransaction, from the Pot's owner", async () => {
      const other = privateKeyToAccount(OTHER_KEY).address;
      const pot = getAddress(v12PredictPot(other, ZERO_SALT) as Address);
      await base.mint(usdc, pot, 2_000_000n);
      const tx = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner: other,
          args: [RECIPIENT, "2000000"],
        }),
      ) as { transactions: Tx[] };
      const before = await base.balanceOf(usdc, RECIPIENT);
      for (const each of tx.transactions) {
        sameTransaction(each, base.chain.id);
        // Anvil's account sends the object as a wallet's tool takes it, with the gas it names.
        const hash = await base.owner.request({
          method: "eth_sendTransaction",
          params: [{ from: other, ...each.sendTransaction }],
        });
        const receipt = await base.publicClient.waitForTransactionReceipt({ hash });
        assert.equal(receipt.status, "success", each.what);
      }
      assert.equal(getAddress(await potOwner(base, pot)), getAddress(other));
      assert.equal((await base.balanceOf(usdc, RECIPIENT)) - before, 2_000_000n);
    });

    it("a Pot's deployment, and a Pot there already, which is not to be sent", async () => {
      const owner = getAddress("0x5a0Ce0000000000000000000000000000000Beef");
      const unsigned = ok(
        await mcp.call("sauce_pot", { chain: "base", owner }),
      ) as unknown as Tx & {
        deployed: boolean;
        sendCalls: Batch;
      };
      assert.equal(unsigned.deployed, false);
      sameTransaction(unsigned, base.chain.id);
      sameBatch(unsigned.sendCalls, [unsigned], "base");
      await base.send(base.deployer, unsigned.to, unsigned.data);
      const there = ok(await mcp.call("sauce_pot", { chain: "base", owner }));
      assert.equal(there.deployed, true);
      assert.equal(there.sendCalls, undefined);
      assert.equal(there.sendTransaction, undefined);
    });

    it("an intent's publish: every intent's transactions as one batch, and none for a dry run", async () => {
      const args = {
        source: INTENT,
        chain: "base",
        defines: { RECIPIENT },
        intentDeadline: 2_000_000_000,
        intentCreator: OWNER.address,
        from: OWNER.address,
      };
      const out = ok(await mcp.call("sauce_intent_publish", args)) as {
        intents: Array<{ transactions: Tx[] }>;
        sendCalls: Batch;
      };
      const transactions = out.intents.flatMap((intent) => intent.transactions);
      assert.deepEqual(
        transactions.map((tx) => tx.what?.split(" ")[0]),
        ["transfer", "publish"],
      );
      transactions.forEach((each) => sameTransaction(each, base.chain.id));
      sameBatch(out.sendCalls, transactions, "base");
      // A rehearsal reports what ran: nothing in it is to be sent.
      const dry = ok(
        await mcp.call("sauce_intent_publish", {
          ...args,
          dryRun: true,
          assumeBalance: ["USDC:1"],
        }),
      );
      assert.equal(dry.sendCalls, undefined);
      assert.ok(
        (dry.transactions as Array<Record<string, unknown>>).every(
          (tx) => !("sendTransaction" in tx),
        ),
      );
    });
  },
);
