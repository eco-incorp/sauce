// Returns a * b, and refuses a product above `limit`.
function main(a: Uint256, b: Uint256, limit: Uint256): Uint256 {
  const product = a * b;
  require(product <= limit, "product above limit");
  return product;
}
