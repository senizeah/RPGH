import { checkSimilarityAgainstLore } from './loreguard.js';

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

async function executeSummarizerWorker(profileConfig, systemPrompt, userContent, context) {
    console.log(`[Summarizer]: Dispatching secure textgen/generate API call using profile: "${profileConfig.name}"`);
    
    const finalizedPrompt = `### Instruction:\n${systemPrompt}\n\n${userContent}\n\n### Response:\n`;

    const payload = {
        prompt: finalizedPrompt,
        api_type: profileConfig.api || profileConfig.api_type || profileConfig.apiType,
        api_server: profileConfig.url || profileConfig.custom_url,
        api_key: profileConfig.apiKey || profileConfig.api_key,
        model: profileConfig.model || profileConfig.active_model,
        preset: profileConfig.preset || null,
        is_background_task: true,
        bypass_global_state: true
    };

    try {
        const requestSecure = window.SillyTavern?.requestSecure || context?.requestSecure;
        if (typeof requestSecure !== 'function') {
            throw new Error("SillyTavern.requestSecure is not available.");
        }
        const response = await requestSecure('/api/textgen/generate', payload);
        return response?.text || response;
    } catch (err) {
        console.error(`[Summarizer]: Secure API processing failed: ${err}`);
        throw err;
    }
}

/**
 * Processes sliding chat history nodes, generating atomic summarizations.
 */
export async function processSummarizerStage(chat, settings, estimateTokensCb, executeFlushCb, updateCountCb, context) {
    if (chat.length <= settings.keepRawCount) return;
    
    // Auto-flush threshold trigger routes directly to the flush pass
    if (settings.autoFlushEnabled && chat.length >= settings.autoFlushThreshold) {
        console.log("[Summarizer]: Auto-flush threshold hit. Bypassing summary for immediate rotation...");
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
        const rawProfiles = context?.allProfilesRepository || window.SillyTavern?.getContext()?.allProfilesRepository || [];
        const profileObj = rawProfiles.find(p => p.id === settings.selectedProfile || p.name === settings.selectedProfile);

        if (!profileObj) {
            console.warn(`[Summarizer]: Targeted connection profile (${settings.selectedProfile}) missing from repository. Skipping summarization.`);
            return;
        }

        console.log(`[Summarizer]: Mapping profile ID ${settings.selectedProfile} to config: "${profileObj.name}"`);
        
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

        const summary = await executeSummarizerWorker(
            profileObj,
            settings.summarizerPrompt,
            userPromptPayload,
            context
        );

        if (!summary) throw new Error("Connection Profile returned an empty summary payload.");

        if (!targetMessage.extra) targetMessage.extra = {};
        targetMessage.extra.is_summarized = true;
        targetMessage.extra.summary_text = summary.trim();
        
        const keyExtract = summary.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "").split(" ").filter(w => w.length > 4).slice(0, 5);
        targetMessage.extra.summary_keys = keyExtract.length > 0 ? keyExtract : ["history"];

        await context.saveChat();
        updateCountCb();
        console.log("[Summarizer]: Successfully saved atomic message summary.");
    } catch (err) {
        console.error(`[Summarizer]: Summary sequence failed: ${err}`);
    }
}
