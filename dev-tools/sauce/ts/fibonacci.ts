// Calculate fibonacci number
function main(n: Uint256): Uint256 {
  if (n <= 1) return n;

  let a: Uint256 = 0;
  let b: Uint256 = 1;
  for (let i: Uint256 = 2; i <= n; i++) {
    const temp: Uint256 = a + b;
    a = b;
    b = temp;
  }
  return b;
}
