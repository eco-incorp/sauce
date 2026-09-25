// ERC20-like transfer operation
// Demonstrates: storage, crypto, abi encode/decode, events, ctx.msgSender()

function balanceSlot(account) {
  return crypto.keccak256(abi.encode(account, 1));
}

function main(to, amount) {
  const from = ctx.msgSender();
  const fromSlot = balanceSlot(from);
  const fromBalance = evm.sload(fromSlot);
  if (fromBalance < amount) throw "insufficient balance";
  evm.sstore(fromSlot, fromBalance - amount);
  const toSlot = balanceSlot(to);
  evm.sstore(toSlot, evm.sload(toSlot) + amount);
  log(abi.encode(from, to, amount), crypto.keccak256("Transfer(address,address,uint256)"));
  return 1;
}
