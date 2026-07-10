/**
 * Default settings for the Summarizer subsystem.
 */
export const defaultSummarizerSettings = {
    keepRawCount: 11, 
    autoFlushThreshold: 1024,
    warningThreshold: 100,
    autoFlushEnabled: true,
    chunkSize: 64,
    targetLorebook: "ChapterLedger",
    selectedProfile: "default",
    maxTokens: 60, 
    wordsPerToken: 0.66, 
    summarizerPrompt: "# Role\nYou are a mechanical event-extraction engine for a roleplay memory context. Your task is to extract the core narrative events of a message into a strict, three-item factual timeline.\n\n# Formatting Rules\n- **Maximum Length**: Under 30 words total.\n- **Strict Layout**: You must output exactly three short sentences, numbered 1, 2, and 3. Each number must be a new line.\n- **Punctuation Restriction**: Use only standard periods (.) to end each numbered item. Never use semicolons (;).\n- **The Blacklist**: Completely ban all descriptive adjectives, adverbs, scents, colors, environmental noise (rain, explosions), or metaphorical phrases.\n- **No Inventions**: Stop precisely on the last physical action stated. Do not assume or invent the resolution of an action.\n\n# Target Text\nExtract exactly three core factual actions from the text below using the 1-3 numbered format.",
    enableFormatLock: true,
    enableLoreGuard: true,
    similarityThreshold: 0.65,
};

/**
 * Processes sliding chat history nodes, generating atomic summarizations.
 */
export async function processSummarizerStage(chat, settings, estimateTokensCb, executeFlushCb, updateCountCb, context) {
    if (chat.length <= settings.keepRawCount) return;
    
    // Auto-flush threshold trigger routes directly to the flush pass
    if (settings.autoFlushEnabled && chat.length >= settings.autoFlushThreshold) {
        console.log("FlushMonitor: Auto-flush threshold hit. Bypassing summary for immediate rotation...");
        await executeFlushCb();
        return;
    }

    let targetIndex = chat.length - settings.keepRawCount;
    let targetMessage = null;

    while (targetIndex >= 0) {
        const checkMsg = chat[targetIndex];
        if (!checkMsg.extra || !checkMsg.extra.is_summarized) {
            targetMessage = checkMsg;
            break;
        }
        targetIndex--;
    }

    if (!targetMessage || !targetMessage.mes) return;

    const sumCleanText = targetMessage.mes.trim();
    const isSumOOC = sumCleanText.startsWith("[OOC:") || sumCleanText.startsWith("(OOC:") || sumCleanText.includes("[OOC]");
    const isSumCommand = sumCleanText.startsWith("/");
    const isSumUnderSize = estimateTokensCb(sumCleanText) <= 30;

    if (isSumOOC || isSumCommand || isSumUnderSize) {
        if (!targetMessage.extra) targetMessage.extra = {};
        targetMessage.extra.is_summarized = true;
        targetMessage.extra.summary_text = ""; 
        targetMessage.extra.summary_keys = ["skipped"];
        await context.saveChat();
        updateCountCb();
        return;
    }

    try {
        console.log("FlushMonitor Pipeline [2/3]: Routing context to Summarizer worker...");
        
        const historySlice = chat.slice(targetIndex + 1, targetIndex + 21);
        let historyContextString = "";
        
        if (historySlice.length > 0) {
            historyContextString = historySlice.map(m => `${m.name}: ${m.mes}`).join("\n");
        }

        let userPromptPayload = "";
        if (historyContextString) {
            userPromptPayload += `Following is a history of messages for context:\n${historyContextString}\n\n`;
        }
        userPromptPayload += `Following is the message to summarize:\n${targetMessage.name}: ${targetMessage.mes}`;

        const payload = {
             messages: [
                 { role: "system", content: settings.summarizerPrompt },
                 { role: "user", content: userPromptPayload }
             ],
            max_tokens: settings.maxTokens,
            temperature: 0.1 
        };

        const response = await window.SillyTavern.api.request(settings.selectedProfile, payload);
        const summary = response?.choices?.[0]?.message?.content?.trim();

        if (!summary) throw new Error("Connection Profile returned an empty summary payload.");

        if (!targetMessage.extra) targetMessage.extra = {};
        targetMessage.extra.is_summarized = true;
        targetMessage.extra.summary_text = summary;
        
        const keyExtract = summary.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "").split(" ").filter(w => w.length > 4).slice(0, 5);
        targetMessage.extra.summary_keys = keyExtract.length > 0 ? keyExtract : ["history"];

        await context.saveChat();
        updateCountCb();
    } catch (err) {
        console.error("FlushMonitor Pipeline [Error]: Summary sequence failed.", err);
    }
}