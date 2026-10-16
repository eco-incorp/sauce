// Pays a Solana wallet USDC, for a USDC reward on the chain that publishes it.
function main(recipient: Address, amount: Uint256, reward: Uint256) {
  Solana(() => {
    USDC.transfer(recipient, amount);
  }).reward({ tokens: [{ token: USDC, amount: reward }] });
}
