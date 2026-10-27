import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeFunctionData,
  http,
  parseAbi,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { bridge } from "../../src/protocols/across/functions.js";
import { sendMessage } from "../../src/protocols/chainlink-ccip/functions.js";
import { bridge as debridgeBridge } from "../../src/protocols/debridge/functions.js";
import { sendMessage as layerZeroSend } from "../../src/protocols/layerzero/functions.js";
import { bridge as stargateBridge } from "../../src/protocols/stargate/functions.js";
import { depositETH } from "../../src/protocols/zksync-bridge/functions.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { compileSauceFunctionRust } from "../helpers.js";
import { startGatedEngine, type GatedEngine } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error("SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI; recipe execution must not skip");
}

const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const RECORDER = "0x0000000000000000000000000000000000001234";
const TOKEN = "0x1111111111111111111111111111111111111111";
const OUTPUT_TOKEN = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = freePortSync();
const transport = http(`http://127.0.0.1:${PORT}`, {
  fetchOptions: { headers: { connection: "close" } },
});
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

// The calldata recorder pattern from actions/tests/anvil.ts: copy the actual callee input,
// LOG1 it with CALLVALUE as its topic, then return 256 zero bytes from fresh memory: a valid CCIP
// messageId, deBridge orderId and zkSync tx hash, and wide enough for the LayerZero and Stargate
// receipts, whose outputs the recipes decode.
const RECORDER_CODE = "0x365f5f3734365fa161010036f3";

// Decode independently of the SDK bindings used to compile the recipes.
const acrossAbi = parseAbi([
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
]);
const ccipAbi = parseAbi([
  "function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32)",
]);
const zkSyncAbi = parseAbi([
  "function requestL2Transaction(address _contractL2, uint256 _l2Value, bytes _calldata, uint256 _l2GasLimit, uint256 _l2GasPerPubdataByteLimit, bytes[] _factoryDeps, address _refundRecipient) payable returns (bytes32)",
]);
const stargateAbi = parseAbi([
  "function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable",
]);
const layerZeroAbi = parseAbi([
  "function send((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) params, address refundAddress) payable",
]);
const dlnSourceAbi = parseAbi([
  "function createOrder((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) orderCreation, bytes affiliateFee, uint32 referralCode, bytes permitEnvelope) payable returns (bytes32)",
]);
const RECIPIENT_WORD = `0x${"00".repeat(12)}${RECIPIENT.slice(2)}`;

let anvil: ChildProcess;
let engine: GatedEngine;

const executeRecipe = async (
  source: string,
  protocol: string,
  invocation: string,
): Promise<Hex> => {
  // Only rename the entry point to supply concrete arguments; the exported recipe body and its
  // ABI import are compiled unchanged by the same helper as the SDK's recipe compilation tests.
  const program = `${source.replace("function main(", "function recipe(")}
function main(): void { ${invocation} }`;
  const { bytecode } = compileSauceFunctionRust(
    program,
    resolve(HERE, "../../src/protocols", protocol),
  );
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    to: engine.pot,
    data: engine.cookData(toHex(bytecode)),
    gas: 10_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  const calls = receipt.logs.filter((log) => log.address.toLowerCase() === RECORDER.toLowerCase());
  expect(calls).toHaveLength(1);
  expect(calls[0]!.topics).toEqual([`0x${"00".repeat(32)}`]);
  return calls[0]!.data;
};

describeEvm(
  "exported recipes reach the callee with empty bytes and the Pot's refund addresses",
  () => {
    beforeAll(async () => {
      anvil = await spawnAnvil(PORT);
      engine = await startGatedEngine(
        { publicClient, testClient, walletClient },
        OWNER.address,
        readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
      );
      await testClient.setCode({ address: RECORDER, bytecode: RECORDER_CODE });
    }, 120_000);

    afterAll(async () => {
      if (anvil && anvil.exitCode === null) {
        const exited = once(anvil, "exit");
        anvil.kill();
        await exited;
      }
    });

    it("Across bridge delivers a zero-length depositV3 message, not UTF-8 hex text", async () => {
      const data = await executeRecipe(
        bridge,
        "across",
        `require(recipe(${RECORDER}, ${TOKEN}, ${OUTPUT_TOKEN}, 100, 99, 10, ${RECIPIENT}, 1700000000, 1700003600) == 1);`,
      );
      const decoded = decodeFunctionData({ abi: acrossAbi, data });
      expect(decoded.functionName).toBe("depositV3");
      // The depositor is the Pot: it is refunded an unfilled deposit and holds the speed-up authority,
      // so it must not be whoever called the cook (a relayer, under `cookSigned`).
      expect(decoded.args).toEqual([
        engine.pot,
        RECIPIENT,
        TOKEN,
        OUTPUT_TOKEN,
        100n,
        99n,
        10n,
        zeroAddress,
        1700000000,
        1700003600,
        0,
        "0x",
      ]);
    });

    it("CCIP sendMessage delivers zero-length extraArgs alongside nonempty receiver and data", async () => {
      const data = await executeRecipe(
        sendMessage,
        "chainlink-ccip",
        `require(recipe(${RECORDER}, 16015286601757825753, abi.encode(${RECIPIENT}), "payload") == 0);`,
      );
      const decoded = decodeFunctionData({ abi: ccipAbi, data });
      expect(decoded.functionName).toBe("ccipSend");
      expect(decoded.args).toEqual([
        16015286601757825753n,
        {
          receiver: `0x${"00".repeat(12)}${RECIPIENT.slice(2)}`,
          data: "0x7061796c6f6164",
          tokenAmounts: [],
          feeToken: zeroAddress,
          extraArgs: "0x",
        },
      ]);
    });

    // A refund or authority address the recipe names must be the Pot or a party the caller chose,
    // never whoever called the cook: under `cookSigned` that is the relayer that submitted it.
    it("zkSync depositETH refunds L2 gas to the recipient, not the cook's caller", async () => {
      const data = await executeRecipe(
        depositETH,
        "zksync-bridge",
        `require(recipe(${RECORDER}, ${RECIPIENT}, 300000) == 0);`,
      );
      const decoded = decodeFunctionData({ abi: zkSyncAbi, data });
      expect(decoded.functionName).toBe("requestL2Transaction");
      // The Pot has code, so zkSync's Mailbox would alias it on L2 to an address nobody controls.
      expect(decoded.args).toEqual([RECIPIENT, 0n, "0x", 300000n, 800n, [], RECIPIENT]);
    });

    it("Stargate bridge refunds the excess LayerZero fee to the Pot", async () => {
      const data = await executeRecipe(
        stargateBridge,
        "stargate",
        `recipe(${RECORDER}, 30184, ${RECIPIENT}, 100, 99);`,
      );
      const decoded = decodeFunctionData({ abi: stargateAbi, data });
      expect(decoded.functionName).toBe("send");
      expect(decoded.args).toEqual([
        {
          dstEid: 30184,
          to: RECIPIENT_WORD,
          amountLD: 100n,
          minAmountLD: 99n,
          extraOptions: "0x",
          composeMsg: "0x",
          oftCmd: "0x",
        },
        { nativeFee: 0n, lzTokenFee: 0n },
        engine.pot,
      ]);
    });

    it("LayerZero sendMessage refunds the excess fee to the Pot", async () => {
      const data = await executeRecipe(
        layerZeroSend,
        "layerzero",
        `recipe(${RECORDER}, 30184, ${RECIPIENT}, "payload");`,
      );
      const decoded = decodeFunctionData({ abi: layerZeroAbi, data });
      expect(decoded.functionName).toBe("send");
      expect(decoded.args).toEqual([
        {
          dstEid: 30184,
          receiver: RECIPIENT_WORD,
          message: "0x7061796c6f6164",
          options: "0x",
          payInLzToken: false,
        },
        engine.pot,
      ]);
    });

    it("deBridge bridge gives the Pot the order's patch authority on the source chain", async () => {
      const data = await executeRecipe(
        debridgeBridge,
        "debridge",
        `require(recipe(${RECORDER}, ${TOKEN}, 100, hex\`${OUTPUT_TOKEN.slice(2)}\`, 99, 8453, hex\`${RECIPIENT.slice(2)}\`) == 0);`,
      );
      const decoded = decodeFunctionData({ abi: dlnSourceAbi, data });
      expect(decoded.functionName).toBe("createOrder");
      expect(decoded.args).toEqual([
        {
          giveTokenAddress: TOKEN,
          giveAmount: 100n,
          takeTokenAddress: OUTPUT_TOKEN,
          takeAmount: 99n,
          takeChainId: 8453n,
          receiverDst: RECIPIENT,
          givePatchAuthoritySrc: engine.pot,
          // The destination-chain authority stays the receiver: an address on that chain.
          orderAuthorityAddressDst: RECIPIENT,
          allowedTakerDst: "0x",
          externalCall: "0x",
          allowedCancelBeneficiarySrc: "0x",
        },
        "0x",
        0,
        "0x",
      ]);
    });
  },
);
