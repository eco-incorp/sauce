// Preloaded into every runner the skills check executes (`node --import offline-guard.mjs <runner>`):
// any attempt to reach the network throws, so "the examples run offline" is enforced, not assumed.
import dns from "node:dns";
import net from "node:net";

const refuse = (what) => {
  throw new Error(
    `offline check: ${what} attempted network access; the skills check runs examples offline`,
  );
};

globalThis.fetch = async () => refuse("fetch");
globalThis.WebSocket = class {
  constructor() {
    refuse("WebSocket");
  }
};
net.Socket.prototype.connect = function connect() {
  refuse("a socket connect");
};
dns.lookup = () => refuse("dns.lookup");
dns.promises.lookup = async () => refuse("dns.promises.lookup");
