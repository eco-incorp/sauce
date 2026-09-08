const RPC = "https://api.mainnet-beta.solana.com";
const PROGRAM = "TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH";

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

async function main() {
  const limit = Number(process.argv[2] || 50);
  const before = process.argv[3];
  const params = [PROGRAM, { limit }];
  if (before) params[1].before = before;
  const sigs = await rpc("getSignaturesForAddress", params);
  console.log("fetched", sigs.length, "signatures, oldest:", sigs[sigs.length - 1]?.signature);
  const candidates = [];
  for (const s of sigs) {
    if (s.err) continue;
    // small delay to be nice to public RPC
    await new Promise((r) => setTimeout(r, 120));
    try {
      const tx = await rpc("getTransaction", [
        s.signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);
      if (!tx) continue;
      const cu = tx.meta?.computeUnitsConsumed ?? 0;
      const logs = tx.meta?.logMessages ?? [];
      const hasTransfer = logs.some((l) => l.includes("Transfer") || l.includes("TransferChecked"));
      candidates.push({ sig: s.signature, cu, hasTransfer, nLogs: logs.length });
      console.log(s.signature, "cu=", cu, "hasTransfer=", hasTransfer);
    } catch (e) {
      console.log(s.signature, "ERROR", e.message);
    }
  }
}

main();
