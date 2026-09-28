// Create a cross-chain intent from inside a Sauce program.
//
// This runs on the destination chain of the intent that contains it, as one of its route calls. It
// measures what the calls before it left in the Pot, and publishes a NEW intent that forwards that
// amount onward — so the amount does not have to be known when the first intent is signed. That is
// the whole point: a swap's output, or a bridge's, becomes the reward of the next leg.
//
// Every capitalised name is a compile-time `define` the caller supplies. They are not JavaScript
// values and nothing here captures anything from outside; see cross-chain-intent.ts for the caller.
function main() {
  // What the route calls before this one produced. `ctx.self()` is the Pot the route executes in.
  const amount = Token(TOKEN).balanceOf(ctx.self());
  if (amount < MIN_AMOUNT) {
    throw "cross-chain-intent: nothing to forward";
  }

  // The one call the new intent obliges a solver to make on its destination: move `amount` to
  // RECIPIENT. `abi.encode` lays the arguments out; the four-byte selector is transfer(address,uint256).
  const transferSelector = hex`a9059cbb`;
  const deliver = transferSelector.concat(abi.encode(RECIPIENT, amount));

  // The route, encoded exactly as the Portal hashes it. The leading word is the ABI offset that
  // Solidity's own `abi.encode(route)` writes for a dynamic struct; SauceScript's `abi.encode`
  // returns the struct body, so the offset is prepended here.
  const routeOffset = hex`0000000000000000000000000000000000000000000000000000000000000020`;
  const route = routeOffset.concat(
    abi.encode({
      salt: SALT,
      deadline: DEADLINE,
      portal: DESTINATION_PORTAL,
      nativeAmount: 0n,
      tokens: [{ token: TOKEN, amount: amount }],
      calls: [{ target: TOKEN, data: deliver, value: 0n }],
    }),
  );

  // The Portal escrows the reward by pulling it from this Pot, so the Pot has to allow it. Issued
  // as a raw call rather than `Token(TOKEN).approve(...)`: the ERC-20 ABI declares a `bool` return
  // that the engine decodes even when nothing reads it, and tokens like USDT return nothing at all.
  const approveSelector = hex`095ea7b3`;
  const allowance = approveSelector.concat(abi.encode(PORTAL, amount));
  evm.call(TOKEN, 0n, allowance);

  // Publish and fund it in one call. The reward is what this Pot just measured; the solver who
  // fulfils the new intent on DESTINATION collects it here.
  IPortal.at(PORTAL).publishAndFund(
    DESTINATION,
    route,
    {
      deadline: DEADLINE,
      creator: CREATOR,
      prover: PROVER,
      nativeAmount: 0n,
      tokens: [{ token: TOKEN, amount: amount }],
    },
    false,
  );
}
