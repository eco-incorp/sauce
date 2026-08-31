// Calculate fibonacci number. N is a compile-time define: `sauce fibonacci.js N=10`.
const N = 0n;

function main() {
  if (N <= 1) return N;

  let a = 0;
  let b = 1;
  for (let i = 2; i <= N; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}
