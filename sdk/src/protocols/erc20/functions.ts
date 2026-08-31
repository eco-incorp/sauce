export const transfer = `
import { ERC20ABI as IERC20 } from "./abis";

function main(token: Address, to: Address, amount: Uint256): Uint256 {
  const t = IERC20.at(token);
  t.transfer(to, amount);
  return 1;
}
`;

export const approve = `
import { ERC20ABI as IERC20 } from "./abis";

function main(token: Address, spender: Address, amount: Uint256): Uint256 {
  const t = IERC20.at(token);
  t.approve(spender, amount);
  return 1;
}
`;

export const transferFrom = `
import { ERC20ABI as IERC20 } from "./abis";

function main(token: Address, from: Address, to: Address, amount: Uint256): Uint256 {
  const t = IERC20.at(token);
  t.transferFrom(from, to, amount);
  return 1;
}
`;

export const balanceOf = `
import { ERC20ABI as IERC20 } from "./abis";

function main(token: Address, account: Address): Uint256 {
  const t = IERC20.at(token);
  return t.balanceOf(account);
}
`;

export const storageTransfer = `
// ERC20-like transfer using storage operations.
// Demonstrates: storage, crypto, abi encode/decode, events, ctx.msgSender()

function balanceSlot(account: any) {
  return crypto.keccak256(abi.encode(account, 1));
}

function main(to: any, amount: any) {
  const from = ctx.msgSender();
  const fromSlot = balanceSlot(from);
  const fromBalance = storage.read(fromSlot);
  if (fromBalance < amount) throw "insufficient balance";
  storage.write(fromSlot, fromBalance - amount);
  const toSlot = balanceSlot(to);
  storage.write(toSlot, storage.read(toSlot) + amount);
  emit("Transfer(address,address,uint256)", { from, to, amount }, "from", "to");
  return 1;
}
`;
