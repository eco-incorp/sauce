export const deposit = `
import { GatewayWalletABI as IGatewayWallet } from "./abis";

function main(walletAddress: Address, token: Address, amount: Uint256): Uint256 {
  const wallet = IGatewayWallet.at(walletAddress);
  wallet.deposit(token, amount);
  return 1;
}
`;

export const availableBalance = `
import { GatewayWalletABI as IGatewayWallet } from "./abis";

function main(walletAddress: Address, token: Address, depositor: Address): Uint256 {
  const wallet = IGatewayWallet.at(walletAddress);
  return wallet.availableBalance(token, depositor);
}
`;

export const gatewayMint = `
import { GatewayMinterABI as IGatewayMinter } from "./abis";

function main(minterAddress: Address, attestationPayload: bytes, signature: bytes): Uint256 {
  const minter = IGatewayMinter.at(minterAddress);
  minter.gatewayMint(attestationPayload, signature);
  return 1;
}
`;
