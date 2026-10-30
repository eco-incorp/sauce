/**
 * The hand-offs a result carries for a wallet's own MCP server, held to that server's input schema
 * (`wallet-mcp/`) and then sent as that server would send them, on a local anvil running
 * the released gated stack (`sdk/test/cli-anvil.ts`):
 *
 * - `sendCalls`, Coinbase Wallet MCP's `send_calls` input, run by a contract wallet as one batch
 *   (`sdk/test/evm/fixtures/BatchWallet.sol`, Coinbase Smart Wallet's `executeBatch` shape): the
 *   wallet owns an explicitly deployed and authenticated Pot, and one batch funds it from the
 *   wallet (`fund`) and cooks on it — or leaves every balance unchanged when a call reverts;
 * - each transaction itself, Phantom MCP's `evm_send` input (its labels dropped by that schema),
 *   sent one by one as eth_sendTransaction, from the account the Pot belongs to.
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
  potOwner,
  registered,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import {
  connect,
  deployedPotBinding,
  endpointsFor,
  failed,
  ok,
  type Connected,
} from "./harness.js";
import { SendCallsSchema } from "./wallet-mcp/coinbase.js";
import { SendEvmTransactionSchema } from "./wallet-mcp/phantom.verbatim.js";

const EVM_FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../sdk/test/evm/fixtures",
);
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");

const WALLET_ABI = parseAbi([
  "function executeBatch((address target, uint256 value, bytes data)[] calls) payable",
]);

/** An unsigned EVM transaction as a tool returns it: what a wallet's send tool takes, labelled. */
interface Tx {
  readonly what?: string;
  readonly chainId: number;
  readonly to: Address;
  readonly data: Hex;
  readonly value: Hex;
  readonly gas?: Hex;
}
interface Batch {
  readonly chain: string;
  readonly calls: ReadonlyArray<{ to: Address; value: Hex; data: Hex }>;
}

/** Each transaction, as it is, is `evm_send`'s input: its fields kept, its labels dropped. */
function walletTakes(tx: Tx, chainId: number): void {
  const parsed = SendEvmTransactionSchema.parse({ ...tx, confirmed: true });
  assert.deepEqual(
    parsed,
    {
      chainId,
      to: getAddress(tx.to),
      data: tx.data,
      value: tx.value,
      ...(tx.gas === undefined ? {} : { gas: tx.gas }),
      derivationIndex: 0,
      confirmed: true,
    },
    "nothing but what the wallet takes, and nothing of it changed",
  );
}

/** The batch is the transactions, in order. */
function sameBatch(batch: Batch, txs: readonly Tx[], chain: string): void {
  const parsed = SendCallsSchema.parse(batch);
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
      mcp = await connect(endpointsFor({ [String(base.chain.id)]: base.rpcUrl }));
    });

    after(async () => {
      await mcp?.close();
      await base?.stop();
    });

    it("a smart wallet's one batch cooks on its authenticated Pot", async () => {
      const owner = await contractWallet();
      const binding = await deployedPotBinding(base, owner);
      const pot = binding.pot;
      await base.mint(usdc, pot, 1_500_000n);

      const tx = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          pot,
          potBinding: binding,
          args: [RECIPIENT, "1500000"],
        }),
      ) as unknown as Tx & { potBinding: unknown; sendCalls: Batch };
      assert.deepEqual(tx.potBinding, binding);
      assert.equal(tx.to, pot);
      walletTakes(tx, base.chain.id);
      sameBatch(tx.sendCalls, [tx], "base");
      assert.equal(BigInt(tx.sendCalls.calls[0]!.value), FEE, "the cook pays the Kitchen's fee");

      assert.equal(await runBatch(owner, tx.sendCalls), "success");
      assert.equal(
        getAddress(await potOwner(base, pot)),
        getAddress(owner),
        "the wallet owns the Pot",
      );
      assert.equal(await base.balanceOf(usdc, RECIPIENT), 1_500_000n, "and its cook ran");
      assert.equal(await base.balanceOf(usdc, pot), 0n);

      // The next cook still carries its explicit provenance: the server stores nothing.
      const again = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          pot,
          potBinding: binding,
          args: [RECIPIENT, "0"],
        }),
      ) as unknown as Tx & { sendCalls: Batch };
      assert.equal(again.to, pot);
      walletTakes(again, base.chain.id);
      sameBatch(again.sendCalls, [again], "base");
      assert.equal(await runBatch(owner, again.sendCalls), "success");
    });

    it("with fund, one batch funds the authenticated Pot from the wallet and cooks", async () => {
      const owner = await contractWallet();
      const binding = await deployedPotBinding(base, owner);
      const pot = binding.pot;
      await base.mint(usdc, owner, 1_500_000n);
      const before = await base.balanceOf(usdc, RECIPIENT);

      const tx = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          pot,
          potBinding: binding,
          fund: ["USDC:1.5"],
          args: [RECIPIENT, "1500000"],
        }),
      ) as unknown as { transactions: Tx[]; sendCalls: Batch; notes: string[] };
      assert.deepEqual(
        tx.transactions.map((each) => each.what?.split(" ")[0]),
        ["transfer", "cook"],
      );
      tx.transactions.forEach((each) => {
        walletTakes(each, base.chain.id);
        assert.ok(each.gas !== undefined, `${each.what} comes with its gas`);
      });
      sameBatch(tx.sendCalls, tx.transactions, "base");
      assert.ok(tx.notes.some((note) => /verified Pot is funded and cooked on at once/.test(note)));

      // One approval: the wallet's USDC moved into its Pot and was spent by the cook.
      assert.equal(await runBatch(owner, tx.sendCalls), "success");
      assert.equal(getAddress(await potOwner(base, pot)), getAddress(owner));
      assert.equal((await base.balanceOf(usdc, RECIPIENT)) - before, 1_500_000n);
      assert.equal(await base.balanceOf(usdc, owner), 0n);
      assert.equal(await base.balanceOf(usdc, pot), 0n);
    });

    it("with fund the wallet cannot cover, the batch reverts whole, and the plan says why", async () => {
      const owner = await contractWallet();
      const binding = await deployedPotBinding(base, owner);
      const pot = binding.pot;
      await base.mint(usdc, owner, 1_000_000n);
      const tx = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          pot,
          potBinding: binding,
          fund: ["USDC:1.5"],
          args: [RECIPIENT, "1500000"],
        }),
      ) as unknown as { sendCalls: Batch; notes: string[] };
      assert.ok(tx.notes.some((note) => /holds 1000000 of USDC .*below the 1500000/.test(note)));
      assert.equal(await runBatch(owner, tx.sendCalls), "reverted");
      assert.notEqual(await base.publicClient.getCode({ address: pot }), undefined);
      assert.equal(await base.balanceOf(usdc, owner), 1_000_000n);
      assert.equal(await base.balanceOf(usdc, pot), 0n);
    });

    it("a batch whose cook reverts rolls back its funding too: all of it or none", async () => {
      const owner = await contractWallet();
      const binding = await deployedPotBinding(base, owner);
      const pot = binding.pot;
      await base.mint(usdc, owner, 1_500_000n);
      const before = await base.balanceOf(usdc, RECIPIENT);
      const tx = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          pot,
          potBinding: binding,
          fund: ["USDC:1.5"],
          args: [RECIPIENT, "2000000"],
        }),
      ) as { transactions: Tx[]; sendCalls: Batch };
      sameBatch(tx.sendCalls, tx.transactions, "base");
      assert.equal(await runBatch(owner, tx.sendCalls), "reverted");
      assert.notEqual(await base.publicClient.getCode({ address: pot }), undefined);
      assert.equal(await base.balanceOf(usdc, owner), 1_500_000n);
      assert.equal(await base.balanceOf(usdc, pot), 0n);
      assert.equal(await base.balanceOf(usdc, RECIPIENT), before);
    });

    it("each transaction's own hand-off, sent in order as eth_sendTransaction, from the Pot's owner", async () => {
      const other = privateKeyToAccount(OTHER_KEY).address;
      const binding = await deployedPotBinding(base, other);
      const pot = binding.pot;
      await base.mint(usdc, other, 2_000_000n);
      const tx = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          pot,
          potBinding: binding,
          fund: ["USDC:2"],
          args: [RECIPIENT, "2000000"],
        }),
      ) as { transactions: Tx[] };
      assert.deepEqual(
        tx.transactions.map((each) => each.what?.split(" ")[0]),
        ["transfer", "cook"],
      );
      const before = await base.balanceOf(usdc, RECIPIENT);
      for (const each of tx.transactions) {
        walletTakes(each, base.chain.id);
        // Anvil's account sends the object as a wallet's tool takes it, with the gas it names.
        const hash = await base.owner.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: other,
              to: each.to,
              data: each.data,
              value: each.value,
              ...(each.gas === undefined ? {} : { gas: each.gas }),
            },
          ],
        });
        const receipt = await base.publicClient.waitForTransactionReceipt({ hash });
        assert.equal(receipt.status, "success", each.what);
      }
      assert.equal(getAddress(await potOwner(base, pot)), getAddress(other));
      assert.equal((await base.balanceOf(usdc, RECIPIENT)) - before, 2_000_000n);
    });

    it("missing expected Pot code refuses instead of handing the wallet a deployment", async () => {
      const owner = getAddress("0x5a0Ce0000000000000000000000000000000Beef");
      const binding = await deployedPotBinding(base, owner);
      const code = await base.publicClient.getCode({ address: binding.pot });
      assert.ok(code);
      await base.testClient.setCode({ address: binding.pot, bytecode: "0x" });
      try {
        assert.match(
          failed(
            await mcp.call("sauce_tx", {
              source: PAY,
              chain: "base",
              pot: binding.pot,
              potBinding: binding,
              args: [RECIPIENT, "0"],
            }),
          ),
          /code|deploy/i,
        );
        assert.equal(await base.publicClient.getCode({ address: binding.pot }), undefined);
      } finally {
        await base.testClient.setCode({ address: binding.pot, bytecode: code });
      }
    });
  },
);
