// The Pot's public `expire(bytes32 key)`: anyone may reject a promise whose deadline has passed,
// with `Timeout(bytes32 key)`, which runs its `.catch`. Installed with every package of the family.
//
// Anyone may call it, so it runs only when the caller pays: the call's value at least the Kitchen's
// fee for the cook the Router makes of it, which the Pot pays from the balance that value joined. A
// promise that is not pending is left alone and the call returns; one not yet expired, or with no
// deadline, is refused.
import { expire, kitchenFee } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): void {
  require(value >= kitchenFee(), "async: expire pays the Kitchen's fee");
  const [key] = abi.decode(data.slice(4, data.length), ["Uint256"]);
  expire(key);
}
