/**
 * Makes a running anvil ready to cook: the released v12 EVM stack (engine, Router, Kitchen) at its
 * release addresses, and a Pot for anvil's first account under the salt the `sauce` command uses by
 * default, so `sauce run --rpc-url <node>` works against it.
 *
 *   npx tsx scripts/deploy.ts <rpc-url> [--zero-fee]
 *
 * The stack is the testing kit's (`src/testing/stack.ts`): on a fork of a chain that already runs
 * the release (Base, Ethereum) the stack there is used as it is, the Kitchen keeping its owner and
 * fee; anywhere else it is deployed from the release's creation code, owned by anvil's first account
 * and with no fee. `--zero-fee` makes cooks free on a live Kitchen too, by impersonating its owner.
 *
 * Prints one line, `SAUCE_DEPLOYMENT=<json>`, for `start-local.sh` to write to `.deployment.json`.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  getCreate2Address,
  http,
  keccak256,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { DEFAULT_POT_SALT } from "../src/testing/chain.js";
import { setUpStack } from "../src/testing/stack.js";

/** Anvil's first dev account: the Pot's owner. */
export const OWNER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export interface Deployment {
  rpcUrl: string;
  chainId: number;
  /** "live": the chain already ran the release; "deployed": this script put it there. */
  stack: "live" | "deployed";
  engine: Address;
  router: Address;
  kitchen: Address;
  executionFee: string;
  owner: Address;
  pot: Address;
}

export async function deploy(
  rpcUrl: string,
  options: { zeroFee?: boolean } = {},
): Promise<Deployment> {
  const transport = http(rpcUrl);
  const chainId = await createPublicClient({ transport }).getChainId();
  const chain = defineChain({
    id: chainId,
    name: "local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const account = privateKeyToAccount(OWNER_KEY);
  const owner = account.address;
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const testClient = createTestClient({ chain, mode: "anvil", transport });

  // A fork carries mainnet's code for anvil's well-known accounts, and someone has put an EIP-7702
  // delegation on the first one on Base. With code there, tokens and Permit2 check its signatures
  // through EIP-1271 and refuse them, so `sauce run --fund` would fail. Make it a plain EOA again.
  const ownerCode = await publicClient.getCode({ address: owner });
  if (ownerCode?.startsWith("0xef0100")) {
    await testClient.setCode({ address: owner, bytecode: "0x" });
    console.error(`cleared the EIP-7702 delegation the fork carried on ${owner}`);
  }

  const stack = await setUpStack(rpcUrl, publicClient, testClient, owner, options);
  console.error(
    stack.origin === "live"
      ? `chain ${chainId} already runs the release: using its stack as it is`
      : `chain ${chainId} did not run the release: deployed it at its addresses`,
  );

  // The owner's Pot under the default salt, which `sauce` finds with no --salt.
  const pot = getCreate2Address({
    bytecodeHash: stack.potInitCodeHash,
    from: stack.kitchen,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, DEFAULT_POT_SALT]),
    ),
  });
  if (((await publicClient.getCode({ address: pot })) ?? "0x") === "0x") {
    const hash = await walletClient.writeContract({
      abi: stack.kitchenAbi,
      address: stack.kitchen,
      args: [owner, DEFAULT_POT_SALT],
      functionName: "deployPot",
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`deploying the Pot ${pot} failed`);
  }

  const executionFee = (await publicClient.readContract({
    abi: stack.kitchenAbi,
    address: stack.kitchen,
    functionName: "executionFee",
  })) as bigint;

  return {
    chainId,
    engine: stack.engine,
    executionFee: String(executionFee),
    kitchen: stack.kitchen,
    owner,
    pot,
    router: stack.router,
    rpcUrl,
    stack: stack.origin,
  };
}

async function main() {
  const [rpcUrl, ...flags] = process.argv.slice(2);
  if (!rpcUrl || flags.some((flag) => flag !== "--zero-fee")) {
    console.error("Usage: npx tsx scripts/deploy.ts <rpc-url> [--zero-fee]");
    process.exit(1);
  }
  const deployment = await deploy(rpcUrl, { zeroFee: flags.includes("--zero-fee") });
  console.log(`SAUCE_DEPLOYMENT=${JSON.stringify(deployment)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error("Deployment failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
