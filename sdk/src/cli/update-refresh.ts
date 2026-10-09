/**
 * The update check's refresh, run as a process of its own: `update-check.ts` starts this file,
 * detached and with its output ignored, when its cache is a day old, passing the cache's path and
 * the running version. It asks the npm registry for the latest version (ten seconds at most) and
 * writes it to the cache, then exits; the command that started it has not waited. Nothing imports
 * this module: it is a script.
 */
import { nodeRefresh, refreshCache } from "./update-check.js";

const [file, version] = process.argv.slice(2);
if (file !== undefined && version !== undefined) await refreshCache(nodeRefresh(file), version);
