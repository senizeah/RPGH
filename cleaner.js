export const defaultCleanerSettings = {
    cleanerEnabled: true,
    pruneEnabled: true,
    regexStyleEnabled: false, 
    cleanerProfile: "default",
    cleanerPrompt: "You are an expert copy editor. Rewrite the provided text to remove repetitive 'AI-isms', overly flowery language, and unnatural phrasing. Maintain the exact original meaning, facts, formatting, and character voice. Return ONLY the edited text with no additional commentary.",    
    customCleanFilters: ["(?:In conclusion|To summarize|Ultimately),? .+"].join("\n"),
};

async function cmdLog(tag, message, level = 'info') {
    const logPrefix = `[Flush-Monitor:${tag.toUpperCase()}]`;
    const formattedMessage = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
    
    if (level === 'error') console.error(`%c${logPrefix} ${formattedMessage}`, "color: #ef4444; font-weight: bold;");
    else if (level === 'warn') console.warn(`%c${logPrefix} ${formattedMessage}`, "color: #f59e0b;");
    else console.log(`%c${logPrefix} ${formattedMessage}`, "color: #10b981; font-weight: bold;");
}

export function trimUnfinishedSentence(text) {
    if (!text) return text;
    const trimmed = text.trim();
    if (/[.!?…'"”’\])}*~-]$/.test(trimmed)) return trimmed;
    
    const lastPunctuation = trimmed.search(/([.!?…'"”’\])}*~-])[^.!?…'"”’\])}*~-]*$/);
    if (lastPunctuation !== -1) {
        return trimmed.substring(0, lastPunctuation + 1).trim();
    }
    return trimmed;
}

export function runStructuralPass(text) {
    if (!text) return text;
    let balanced = text;

    const quotes = (balanced.match(/"/g) || []).length;
    if (quotes % 2 !== 0) balanced += '"';

    const asterisks = (balanced.match(/\*/g) || []).length;
    if (asterisks % 2 !== 0) balanced += '*';
    
    const sentences = balanced.match(/[^.!?]+[.!?]+/g) || [];
    if (sentences.length >= 3) {
        const last = sentences[sentences.length - 1].trim();
        const prev = sentences[sentences.length - 2].trim();
        if (last && last === prev) {
            balanced = balanced.substring(0, balanced.lastIndexOf(last));
        }
    }
    return balanced.trim();
}

export function runStylisticPass(text, rawRulesString) {
    let result = { text: text ? text.trim() : "", hasMatches: false };
    if (!text || !rawRulesString || !rawRulesString.trim()) return result;

    const lines = rawRulesString.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    lines.forEach(pattern => {
        try {
            const regex = new RegExp(pattern, 'gi');
            if (regex.test(result.text)) {
                result.hasMatches = true;
                result.text = result.text.replace(regex, '');
            }
        } catch (e) {
            cmdLog('regex_parser', `Heuristic matching processing failure on pattern "${pattern}": ${e.message}`, 'error');
        }
    });

    result.text = result.text.trim();
    return result;
}

async function executeCleanerWorker(profileName, systemPrompt, userContent, context) {
    const cleanPrompt = systemPrompt.replace(/"/g, '\\"');
    const cleanContent = userContent.replace(/"/g, '\\"');
    const macroString = `/profile-genstream "${profileName}" "${cleanPrompt}" "${cleanContent}"`;

    try {
        console.log(`[Cleaner Engine] Dispatching fire-and-forget to profile: "${profileName}"`);
        window.SillyTavern.executeSlashCommands(macroString);
    } catch (err) {
        cmdLog('cleaner_worker', `Execution fault: ${err.message}`, 'error');
    }
}

export async function processProseCleanerStage(chat, immediateLastMsg, settings, estimateTokensCb, context) {
    await cmdLog('cleaner_pipeline', `Entering Prose Cleaner Pipeline Stage for Author: [${immediateLastMsg.name}]`, 'info');
    
    if (!immediateLastMsg.mes) {
        immediateLastMsg.extra = immediateLastMsg.extra || {};
        immediateLastMsg.extra.is_cleaned = true;
        return;
    }

    let cleanText = immediateLastMsg.mes.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    
    const isOOC = cleanText.startsWith("[OOC:") || cleanText.startsWith("(OOC:") || cleanText.includes("[OOC]");
    const isCommand = cleanText.startsWith("/");
    const tokensCount = estimateTokensCb(cleanText);
    const isUnderSize = tokensCount <= 30;

    if (isOOC || isCommand || isUnderSize) {
        immediateLastMsg.extra = immediateLastMsg.extra || {};
        immediateLastMsg.extra.is_cleaned = true;
        return;
    }

    let modifiedText = cleanText;

    if (settings.pruneEnabled) {
        modifiedText = trimUnfinishedSentence(modifiedText);
    }
    modifiedText = runStructuralPass(modifiedText);
    
    const styleAnalysis = runStylisticPass(modifiedText, settings.customCleanFilters);
    let shouldInvokeLLM = (settings.regexStyleEnabled && settings.cleanerEnabled) || 
                          (settings.cleanerEnabled && styleAnalysis.hasMatches);

    if (shouldInvokeLLM) {
        const profiles = window.SillyTavern?.settings?.connectionManager?.profiles || [];
        const profileObj = profiles.find(p => p.id === settings.cleanerProfile);
        const profileName = profileObj ? profileObj.name : settings.cleanerProfile;

        console.log(`[Cleaner Engine] Mapping ID ${settings.cleanerProfile} to Name: "${profileName}"`);

        executeCleanerWorker(profileName, settings.cleanerPrompt, modifiedText, context);
        
        immediateLastMsg.extra = immediateLastMsg.extra || {};
        immediateLastMsg.extra.is_cleaning = true;
    } else {
        immediateLastMsg.mes = modifiedText;
        immediateLastMsg.extra = immediateLastMsg.extra || {};
        immediateLastMsg.extra.is_cleaned = true;
    }
}

window.SillyTavern?.eventSource?.on('background_gen_finished', (data) => {
    if (!data?.text) return;
    
    const context = window.SillyTavern?.getContext();
    const lastMsg = context?.chat?.[context.chat.length - 1];
    
    if (lastMsg && lastMsg.extra?.is_cleaning) {
        console.log("[Cleaner Engine] Applying LLM-cleaned text to message.");
        lastMsg.mes = data.text.trim();
        lastMsg.extra.is_cleaning = false;
        lastMsg.extra.is_cleaned = true;
        window.SillyTavern?.updateChatDisplay?.();
    }
});