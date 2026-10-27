// Maintenance fetches take their public, keyless endpoints explicitly, never from the command's
// private registry or the environment. Match the capture scripts' chain-id -> URL JSON convention;
// a nonempty URL array gives the existing readers their fallback order. No endpoint is printed.
import { readFileSync } from "node:fs";

export function readFixtureRpcConfig(values, chains) {
  if (values.offline) return new Map();
  const path = values["rpc-config"];
  if (path === undefined)
    throw new Error("pass --rpc-config <path> (public keyless endpoints), or --offline");
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // JSON parser errors can quote the input, including an endpoint or credential.
    throw new Error("cannot read --rpc-config as JSON");
  }
  if (config === null || typeof config !== "object" || Array.isArray(config))
    throw new Error(
      "--rpc-config must be a JSON object of chain id -> public HTTPS URL or URL list",
    );
  const endpoints = new Map();
  for (const [chain, value] of Object.entries(config)) {
    if (!/^[1-9][0-9]*$/.test(chain) || !Number.isSafeInteger(Number(chain)))
      throw new Error("--rpc-config contains an invalid chain id");
    const urls = Array.isArray(value) ? value : [value];
    if (urls.length === 0)
      throw new Error(`--rpc-config gives an empty endpoint list for chain ${chain}`);
    for (const value of urls) {
      let url;
      try {
        if (typeof value !== "string") throw new Error();
        url = new URL(value);
      } catch {
        throw new Error(`--rpc-config gives an invalid URL for chain ${chain}`);
      }
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        !url.hostname.includes(".") ||
        url.hostname.endsWith(".localhost") ||
        /^[\d.]+$/.test(url.hostname) ||
        url.hostname.startsWith("[")
      )
        throw new Error(
          `--rpc-config chain ${chain}: use public keyless HTTPS endpoints, without credentials, ` +
            "query strings, fragments, local hostnames or IP literals",
        );
    }
    endpoints.set(Number(chain), urls);
  }
  const missing = [...chains].filter((chain) => !endpoints.has(chain));
  if (missing.length > 0)
    throw new Error(`--rpc-config gives no endpoint for chain(s) ${missing.join(", ")}`);
  return endpoints;
}
