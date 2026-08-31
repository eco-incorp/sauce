// Simple addition example.
// A/B are compile-time DEFINES: `sauce add.ts A=5 B=10`. A define replaces the const of that name
// and is folded in, which is how a build supplies values to a program the Pot executes with no
// calldata of its own.
const A: Uint256 = 0;
const B: Uint256 = 0;

function main(): Uint256 {
  return A + B;
}
