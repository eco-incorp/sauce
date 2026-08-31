// Simple addition example.
// A/B are compile-time DEFINES: `sauce add.js A=5 B=10`. A define replaces the const of that name
// and is folded in, which is how a build supplies values to a program the Pot executes with no
// calldata of its own.
const A = 0n;
const B = 0n;

function main() {
  return A + B;
}
