import { checkSimilarityAgainstLore } from './loreguard.js';

/**
 * Flushes context cache buffers out into structured world info chunk matrices.
 */
export async function executeFlushToLorebook(settings, updateCountCb, context) {
    if (!context.chat || context.chat.length === 0) return;
    
    const keepRawCount = settings.keepRawCount;
    const targetWipeThreshold = context.chat.length - keepRawCount;

    if (targetWipeThreshold <= 0) {
        toastr.warning("Context footprint rests within your protected tail boundaries.");
        return;
    }

    const validSummaries = [];
    for (let i = 0; i < targetWipeThreshold; i++) {
        const msg = context.chat[i];
        if (msg.extra?.is_summarized) {
            if (msg.extra.summary_text && msg.extra.summary_text.length > 0) {
                validSummaries.push({
                    text: msg.extra.summary_text,
                    keys: msg.extra.summary_keys || ["history"]
                });
            }
        }
    }

    if (validSummaries.length === 0) {
        context.chat = context.chat.slice(targetWipeThreshold);
        await context.saveChat();
        context.renderChat();
        updateCountCb();
        return;
    }

    console.log("FlushMonitor Pipeline [3/3]: Evaluating Flush parameters and lore integration...");
    toastr.info("Initializing context rotation...");

    try {
        // FIX: Safely extract worldinfo context from either window or extension parameters
        const worldInfoContext = window.SillyTavern?.worldinfo || context?.worldinfo;
        if (!worldInfoContext) {
            throw new Error("World Info systems uninitialized or missing from runtime context.");
        }

        const chunkSize = settings.chunkSize;
        let chunkIndex = 1;

        for (let i = 0; i < validSummaries.length; i += chunkSize) {
            const currentChunk = validSummaries.slice(i, i + chunkSize);
            const timestamp = new Date().toISOString().split('T')[0];
            
            const entryContent = `[Chronicle Block - Archived Record ${timestamp}]\n` + 
                currentChunk.map(s => `• ${s.text}`).join("\n");

            if (settings.enableLoreGuard) {
                const isDuplicate = checkSimilarityAgainstLore(entryContent, settings.targetLorebook, settings.similarityThreshold);
                if (isDuplicate) {
                    console.warn(`FlushMonitor Pipeline [Guardrail]: Vector check blocked redundant entry chunk indexes ${i} to ${i + chunkSize}`);
                    continue;
                }
            }

            const chunkKeys = new Set(["history", "chronicle", `archive_segment_${chunkIndex}`]);
            currentChunk.forEach(s => s.keys.forEach(k => chunkKeys.add(k)));

            const newEntry = {
                uid: Date.now() + chunkIndex,
                key: Array.from(chunkKeys).slice(0, 20),
                content: entryContent,
                extensions: { vector_space: true },
                enabled: true,
                selective: false,
                probability: 100,
                insertion_order: 100
            };

            // FIX: Uses the safe local reference instead of relying on a naked global object
            await worldInfoContext.createEntry(settings.targetLorebook, newEntry);
            chunkIndex++;
        }

        context.chat = context.chat.slice(targetWipeThreshold);
        
        await context.saveChat();
        context.renderChat();
        
        toastr.success(`Archived ${validSummaries.length} chat entries into chunks inside "${settings.targetLorebook}"!`);
        updateCountCb();
        console.log("FlushMonitor Pipeline [Complete]: Execution loop finished. Workers idling.");

    } catch (err) {
        console.error("FlushMonitor: Lorebook integration serialization failed.", err);
        toastr.error("Failed to commit blocks to World Info ledger.");
    }
}