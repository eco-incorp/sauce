/**
 * Deploy script for SauceRouter contract using pre-compiled artifact.
 * SauceRouter inherits Sauce, so cook() works identically.
 */

import { createWalletClient, createPublicClient, http, Hex, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  // Hardhat default pre-funded account private key
  const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const account = privateKeyToAccount(privateKey);

  // Load artifacts from local artifacts/ directory
  const routerImplArtifact = JSON.parse(
    readFileSync(join(__dirname, "../artifacts/Router.json"), "utf-8"),
  );
  const sauceRouterArtifact = JSON.parse(
    readFileSync(join(__dirname, "../artifacts/SauceRouter.json"), "utf-8"),
  );

  // Get the actual chain ID from the RPC (may be mainnet when forking)
  const tempClient = createPublicClient({
    transport: http("http://127.0.0.1:8545"),
  });
  const chainId = await tempClient.getChainId();

  const chain = defineChain({
    id: chainId,
    name: "Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  });

  // Create clients
  const publicClient = createPublicClient({
    chain,
    transport: http("http://127.0.0.1:8545"),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http("http://127.0.0.1:8545"),
  });

  console.log("Deployer:", account.address);

  // Deploy Router
  console.log("Deploying Router...");
  // @ts-expect-error - viem types require kzg for blob transactions, but we're not using blobs
  const routerHash = await walletClient.deployContract({
    abi: routerImplArtifact.abi,
    bytecode: routerImplArtifact.bytecode.object as Hex,
    account,
    chain,
  });
  const routerReceipt = await publicClient.waitForTransactionReceipt({
    hash: routerHash,
  });
  if (!routerReceipt.contractAddress) {
    throw new Error("Router deployment failed");
  }
  console.log("Router deployed at:", routerReceipt.contractAddress);

  // Deploy SauceRouter with Router address
  console.log("Deploying SauceRouter...");
  // @ts-expect-error - viem types require kzg for blob transactions, but we're not using blobs
  const hash = await walletClient.deployContract({
    abi: sauceRouterArtifact.abi,
    bytecode: sauceRouterArtifact.bytecode.object as Hex,
    args: [routerReceipt.contractAddress],
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("SauceRouter deployment failed");
  }

  console.log("SauceRouter deployed at:", receipt.contractAddress);
  return receipt.contractAddress;
}

main()
  .then((address) => {
    // Output just the address for shell script to capture
    console.log(`SAUCE_ADDRESS=${address}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
