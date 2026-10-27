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
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { encodeCookSigned, randomCookNonce, signedCookTypedData } from "../../src/evm/engine.js";
import { bridge } from "../../src/protocols/across/functions.js";
import { sendMessage } from "../../src/protocols/chainlink-ccip/functions.js";
import { bridge as lifiBridge } from "../../src/protocols/lifi/functions.js";
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
// Anvil's second dev account: submits the owner's signed cooks, so it is neither the owner, the Pot
// nor the recipient.
const SUBMITTER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
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
// LOG1 it with CALLVALUE as its topic, then return a zero bytes32 (a valid CCIP messageId).
const RECORDER_CODE = "0x365f5f3734365fa15f5f5260205ff3";

// Decode independently of the SDK bindings used to compile the recipes.
const acrossAbi = parseAbi([
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
]);
const ccipAbi = parseAbi([
  "function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32)",
]);
const lifiAbi = parseAbi([
  "function startBridgeTokensViaAcrossV4((bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall) bridgeData, (bytes32 receiverAddress, bytes32 refundAddress, bytes32 sendingAssetId, bytes32 receivingAssetId, uint256 outputAmount, uint128 outputAmountMultiplier, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) acrossData) payable",
]);
const word = (address: string): Hex => `0x${"00".repeat(12)}${address.slice(2).toLowerCase()}`;

let anvil: ChildProcess;
let engine: GatedEngine;

const executeRecipe = async (
  source: string,
  protocol: string,
  invocation: string,
  submitter?: PrivateKeyAccount,
): Promise<Hex> => {
  // Only rename the entry point to supply concrete arguments; the exported recipe body and its
  // ABI import are compiled unchanged by the same helper as the SDK's recipe compilation tests.
  const program = `${source.replace("function main(", "function recipe(")}
function main(): void { ${invocation} }`;
  const { bytecode } = compileSauceFunctionRust(
    program,
    resolve(HERE, "../../src/protocols", protocol),
  );
  let hash: Hex;
  if (submitter) {
    // OWNER signs and `submitter`, who is not the owner, sends it: `cookSigned`, where
    // `ctx.msgSender()` is the submitter.
    const execution = {
      chainId: await publicClient.getChainId(),
      pot: engine.pot,
      engine: engine.engine,
      program: toHex(bytecode),
      maxExecutionFee: 0n,
      nonce: randomCookNonce(),
      deadline: 4_000_000_000n,
    };
    const tx = encodeCookSigned({
      ...execution,
      signature: await OWNER.signTypedData(signedCookTypedData(execution)),
    });
    hash = await walletClient.sendTransaction({
      account: submitter,
      chain: null,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gas: 10_000_000n,
    });
  } else {
    hash = await walletClient.sendTransaction({
      account: OWNER,
      chain: null,
      to: engine.pot,
      data: engine.cookData(toHex(bytecode)),
      gas: 10_000_000n,
    });
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  const calls = receipt.logs.filter((log) => log.address.toLowerCase() === RECORDER.toLowerCase());
  expect(calls).toHaveLength(1);
  expect(calls[0]!.topics).toEqual([`0x${"00".repeat(32)}`]);
  return calls[0]!.data;
};

describeEvm("exported recipes preserve empty bytes at the callee", () => {
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

  // Across refunds a deposit no relayer fills by `fillDeadline` on the source chain, so the refund
  // address must be the Pot that paid it: not the receiver, a destination-chain address, and not
  // the cook's submitter (the owner on a direct cook, a relayer under `cookSigned`). The four are
  // distinct addresses, so the refund read back from the calldata names exactly one of them.
  const lifiAcrossV4 = async (submitter?: PrivateKeyAccount) => {
    expect(
      new Set([RECIPIENT, OWNER.address, SUBMITTER.address, engine.pot].map((a) => a.toLowerCase()))
        .size,
    ).toBe(4);
    const data = await executeRecipe(
      lifiBridge,
      "lifi",
      `require(recipe(${RECORDER}, 7, ${TOKEN}, ${OUTPUT_TOKEN}, ${RECIPIENT}, 100, 99, 10, 1700000000, 1700003600) == 1);`,
      submitter,
    );
    const decoded = decodeFunctionData({ abi: lifiAbi, data });
    expect(decoded.functionName).toBe("startBridgeTokensViaAcrossV4");
    expect(decoded.args[1].refundAddress).toBe(word(engine.pot));
    expect(decoded.args[1].receiverAddress).toBe(word(RECIPIENT));
    expect(decoded.args).toEqual([
      {
        transactionId: `0x${"00".repeat(31)}07`,
        bridge: "acrossV4",
        integrator: "sauce",
        referrer: zeroAddress,
        sendingAssetId: TOKEN,
        receiver: RECIPIENT,
        minAmount: 100n,
        destinationChainId: 10n,
        hasSourceSwaps: false,
        hasDestinationCall: false,
      },
      {
        receiverAddress: word(RECIPIENT),
        refundAddress: word(engine.pot),
        sendingAssetId: word(TOKEN),
        receivingAssetId: word(OUTPUT_TOKEN),
        outputAmount: 99n,
        outputAmountMultiplier: 0n,
        exclusiveRelayer: `0x${"00".repeat(32)}`,
        quoteTimestamp: 1700000000,
        fillDeadline: 1700003600,
        exclusivityParameter: 0,
        message: "0x",
      },
    ]);
  };

  it("LI.FI bridge refunds an unfilled Across V4 deposit to the Pot, not the receiver", async () => {
    await lifiAcrossV4();
  });

  it("LI.FI bridge refunds to the Pot, not the submitter, in a signed cook", async () => {
    await lifiAcrossV4(SUBMITTER);
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
});
