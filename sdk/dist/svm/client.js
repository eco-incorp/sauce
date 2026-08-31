import { createSolanaRpc, createSolanaRpcSubscriptions, sendAndConfirmTransactionFactory } from '@solana/kit';
import { createAltWithAddresses, extendAlt, fetchAlt, waitForAltActive } from './alt.js';
import { encodePayloadArgs } from './args.js';
import { buildCloseBufferInstruction, buildExecuteFromAccountInstruction, buildExecuteInstruction, buildFinalizeBufferInstruction, buildInitBufferInstructions, buildStagingPlan, buildWriteBufferInstruction, } from './instructions.js';
import { deriveBufferPda } from './pda.js';
import { buildComputeBudgetPrepend, buildHeapFramePrepend } from './prepends.js';
import { resolveAccounts } from './resolve.js';
import { recommendedComputeUnitLimit, sendExecute, simulateExecute } from './send.js';
import { buildExecuteTransaction } from './transaction.js';
export async function createSauceSvmClient({ rpcUrl, wsUrl, programId, payer }) {
    const rpc = createSolanaRpc(rpcUrl);
    const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl ?? rpcUrl.replace(/^http/, 'ws'));
    /** Content hashes of buffers staged by THIS client — the automatic execute pins. */
    const stagedHashes = new Map();
    async function currentDataSize(account) {
        const { value } = await rpc.getAccountInfo(account, { encoding: 'base64' }).send();
        return value === null ? 0 : Number(value.space);
    }
    /** Sends staging/lifecycle instructions — NO heap frame (they never touch interpreter memory). */
    async function sendInstructions(instructions) {
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
        const transaction = await buildExecuteTransaction({ payer, instructions, latestBlockhash });
        return sendExecute({ rpc, rpcSubscriptions, transaction });
    }
    /**
     * Signs an execute transaction: RequestHeapFrame(262144) FIRST (required on
     * every execute/simulate; add-once — caller prepends must not carry their
     * own), then the prepends, then the execute instruction.
     */
    async function signExecuteTransaction(executeInstruction, prepends, lookupTables) {
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
        return buildExecuteTransaction({
            payer,
            instructions: [buildHeapFramePrepend(), ...prepends, executeInstruction],
            latestBlockhash,
            lookupTables,
        });
    }
    async function buildTransaction(bytecode, manifest, resolution, prepends, opts) {
        const accounts = resolveAccounts(manifest, resolution, payer.address, { appendPayerSigner: opts.appendPayerSigner });
        const executeInstruction = buildExecuteInstruction({ programId, bytecode, accounts });
        return signExecuteTransaction(executeInstruction, prepends, opts.lookupTables);
    }
    async function simulate(bytecode, manifest, resolution, opts = {}) {
        const transaction = await buildTransaction(bytecode, manifest, resolution, opts.prepends ?? [], opts);
        return simulateExecute(rpc, transaction);
    }
    function stagedPin(address, expectedSha256) {
        const pin = expectedSha256 ?? stagedHashes.get(address);
        if (pin === undefined) {
            throw new Error(`buffer ${address} was not staged by this client: pass expectedSha256 (the content-hash pin) — an address alone is never a trust anchor`);
        }
        return pin;
    }
    async function buildStagedTransaction(buffer, manifest, resolution, prepends, opts) {
        const address = typeof buffer === 'string' ? buffer : buffer.address;
        const expectedSha256 = stagedPin(address, opts.expectedSha256 ?? (typeof buffer === 'string' ? undefined : buffer.sha256));
        const accounts = resolveAccounts(manifest, resolution, payer.address, { appendPayerSigner: opts.appendPayerSigner });
        const args = opts.args && opts.args.layout.slots.length > 0 ? encodePayloadArgs(opts.args.layout, opts.args.values) : undefined;
        const executeInstruction = buildExecuteFromAccountInstruction({ programId, buffer: address, accounts, expectedSha256, args });
        return signExecuteTransaction(executeInstruction, prepends, opts.lookupTables);
    }
    async function simulateStaged(buffer, manifest, resolution, opts = {}) {
        const transaction = await buildStagedTransaction(buffer, manifest, resolution, opts.prepends ?? [], opts);
        return simulateExecute(rpc, transaction);
    }
    async function autoComputeUnitPrepends(simulateRun, opts) {
        let unitLimit;
        if (opts.computeUnitLimit === 'auto') {
            const sim = await simulateRun();
            if (!sim.ok || sim.unitsConsumed === undefined) {
                throw new Error(`compute unit auto-limit simulation failed: ${JSON.stringify(sim.err) ?? 'no units consumed'}`);
            }
            unitLimit = recommendedComputeUnitLimit(sim.unitsConsumed);
        }
        else {
            unitLimit = opts.computeUnitLimit;
        }
        return [
            ...(unitLimit !== undefined ? buildComputeBudgetPrepend({ unitLimit }) : []),
            ...(opts.prepends ?? []),
        ];
    }
    const sendAndConfirmAlt = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
    async function ensureLookupTable(addresses, opts = {}) {
        if (addresses.length === 0) {
            throw new Error('ensureLookupTable needs at least one address (a lookup table cannot be empty)');
        }
        const commitment = opts.commitment ?? 'confirmed';
        const deduped = [...new Set(addresses)];
        if (opts.existing !== undefined) {
            const current = (await fetchAlt(rpc, opts.existing))[opts.existing] ?? [];
            const have = new Set(current);
            const missing = deduped.filter((address) => !have.has(address));
            if (missing.length > 0) {
                const { lastExtendedSlot } = await extendAlt({
                    rpc,
                    payer,
                    authority: payer,
                    lookupTableAddress: opts.existing,
                    addresses: missing,
                    sendAndConfirm: sendAndConfirmAlt,
                    commitment,
                });
                await waitForAltActive(rpc, lastExtendedSlot);
            }
            return { lookupTableAddress: opts.existing, lookupTables: await fetchAlt(rpc, opts.existing) };
        }
        const { lookupTableAddress, lastExtendedSlot } = await createAltWithAddresses({
            rpc,
            payer,
            authority: payer,
            addresses: deduped,
            sendAndConfirm: sendAndConfirmAlt,
            commitment,
        });
        await waitForAltActive(rpc, lastExtendedSlot);
        return { lookupTableAddress, lookupTables: await fetchAlt(rpc, lookupTableAddress) };
    }
    return {
        payerAddress: payer.address,
        ensureLookupTable,
        simulate,
        async execute(bytecode, manifest, resolution, opts = {}) {
            const prepends = await autoComputeUnitPrepends(() => simulate(bytecode, manifest, resolution, {
                prepends: opts.prepends,
                lookupTables: opts.lookupTables,
                appendPayerSigner: opts.appendPayerSigner,
            }), opts);
            const transaction = await buildTransaction(bytecode, manifest, resolution, prepends, opts);
            return sendExecute({ rpc, rpcSubscriptions, transaction });
        },
        async stageBuffer(seed, bytecode) {
            const plan = buildStagingPlan(bytecode.length);
            const { address } = await deriveBufferPda(programId, payer.address, seed);
            // Copy into a fresh ArrayBuffer-backed view (subtle.digest rejects
            // SharedArrayBuffer-backed views at the type level).
            const sha256 = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytecode)));
            const currentBytes = await currentDataSize(address);
            const signatures = [];
            // One init tx (all growth steps pack), one tx per write chunk, then the
            // DEDICATED finalize — sent only after every write confirmed (landing
            // order across concurrently broadcast txs is not guaranteed; the on-chain
            // hash gate backstops any race). Each send fetches a fresh blockhash.
            const initInstructions = buildInitBufferInstructions({
                programId,
                payer: payer.address,
                buffer: address,
                seed,
                capacity: bytecode.length,
                currentBytes,
            });
            if (initInstructions.length > 0) {
                signatures.push((await sendInstructions(initInstructions)).signature);
            }
            for (const chunk of plan.chunks) {
                const write = buildWriteBufferInstruction({
                    programId,
                    authority: payer.address,
                    buffer: address,
                    offset: chunk.offset,
                    chunk: bytecode.subarray(chunk.offset, chunk.offset + chunk.length),
                });
                signatures.push((await sendInstructions([write])).signature);
            }
            const finalize = buildFinalizeBufferInstruction({
                programId,
                authority: payer.address,
                buffer: address,
                length: bytecode.length,
                sha256,
            });
            signatures.push((await sendInstructions([finalize])).signature);
            stagedHashes.set(address, sha256);
            return { address, seed, sha256, signatures };
        },
        async closeBuffer(seed) {
            const { address } = await deriveBufferPda(programId, payer.address, seed);
            stagedHashes.delete(address);
            return sendInstructions([buildCloseBufferInstruction({ programId, authority: payer.address, buffer: address })]);
        },
        simulateStaged,
        async executeStaged(buffer, manifest, resolution, opts = {}) {
            const prepends = await autoComputeUnitPrepends(() => simulateStaged(buffer, manifest, resolution, {
                prepends: opts.prepends,
                lookupTables: opts.lookupTables,
                appendPayerSigner: opts.appendPayerSigner,
                args: opts.args,
                expectedSha256: opts.expectedSha256,
            }), opts);
            const transaction = await buildStagedTransaction(buffer, manifest, resolution, prepends, opts);
            return sendExecute({ rpc, rpcSubscriptions, transaction });
        },
    };
}
//# sourceMappingURL=client.js.map