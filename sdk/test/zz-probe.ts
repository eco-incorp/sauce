import { compileSauceProgram } from "../src/routes/sauce-route.js";
const show = (label: string, steps: string) => {
  const src = `function main(spender: Address, amount: Uint256) {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 }).receive()${steps}
    .then(() => { USDC.transfer(RECIPIENT, 1); });
}`;
  try {
    const c = compileSauceProgram("base", src, { defines: { RECIPIENT: 0x66n, HOOK: 0x77n, SPENDER: 0x55n }, intents: { executionFee: 1n, publisher: "0x4444444444444444444444444444444444444444" } });
    console.log(label, "OK", c.intents[0]!.intent.route.calls.length);
  } catch (e) { const err = e as Error & { diagnostics?: { code?: string }[]; cause?: unknown }; console.log(label, "ERR", JSON.stringify(err.diagnostics?.map((d) => d.code) ?? (err.cause as {diagnostics?: {code?:string}[]})?.diagnostics?.map((d) => d.code)), err.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 12).join("\n")); }
};
show("local", ".before(() => { const n = 5; USDC.approve(SPENDER, n); })");
show("computed const", ".before(() => { USDC.approve(SPENDER, 2 * 3); })");
show("computed runtime", ".before(() => { USDC.approve(SPENDER, amount * 2); })");
show("read", ".before(() => { USDC.transfer(SPENDER, USDC.balanceOf(HOOK)); })");
show("branch", ".before(() => { if (SPENDER != 0) { USDC.approve(SPENDER, 1); } })");
show("empty", ".before(() => {})");
show("after local", ".after(() => { const n = 5; USDC.approve(SPENDER, n); })");
show("view call", ".before(() => { USDC.balanceOf(HOOK); })");
