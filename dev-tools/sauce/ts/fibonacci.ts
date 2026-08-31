// Calculate fibonacci number. N is a compile-time define: `sauce fibonacci.ts N=10`.
const N: Uint256 = 0;

function main(): Uint256 {
  if (N <= 1) return N;

  let a: Uint256 = 0;
  let b: Uint256 = 1;
  for (let i: Uint256 = 2; i <= N; i++) {
    const temp: Uint256 = a + b;
    a = b;
    b = temp;
  }
  return b;
}
