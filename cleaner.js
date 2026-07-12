export const defaultCleanerSettings = {
    cleanerEnabled: true,
    pruneEnabled: true,
    regexStyleEnabled: false, 
    cleanerProfile: "default",
    cleanerPrompt: "You are an expert copy editor. Rewrite the provided text to remove repetitive 'AI-isms', overly flowery language, and unnatural phrasing. Maintain the exact original meaning, facts, formatting, and character voice. Return ONLY the edited text with no additional commentary.",    
    customCleanFilters: ["(?:In conclusion|To summarize|Ultimately),? .+"].join("\n"),
};


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
            console.error(`[ProseCleaner]: Heuristic matching processing failure on pattern "${pattern}": ${e.message}`);
        }
    });

    result.text = result.text.trim();
    return result;
}

async function executeCleanerWorker(profileConfig, systemPrompt, userContent, context) {
    console.log(`[ProseCleaner] Dispatching secure textgen/generate API call using profile: "${profileConfig.name}"`);
    
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
        console.error(`[ProseCleaner] Secure API processing failed:`, err);
        throw err;
    }
}

export async function processProseCleanerStage(chat, immediateLastMsg, settings, estimateTokensCb, context) {
    console.log(`[ProseCleaner]: Entering Prose Cleaner Pipeline Stage for Author: [${immediateLastMsg.name}]`);
    
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
        const rawProfiles = context?.allProfilesRepository || window.SillyTavern?.getContext()?.allProfilesRepository || [];
        const profileObj = rawProfiles.find(p => p.id === settings.cleanerProfile || p.name === settings.cleanerProfile);

        if (!profileObj) {
            console.warn(`[ProseCleaner]: Targeted connection profile (${settings.cleanerProfile}) missing from repository. Skipping LLM cleanup.`);
            immediateLastMsg.mes = modifiedText;
            immediateLastMsg.extra = immediateLastMsg.extra || {};
            immediateLastMsg.extra.is_cleaned = true;
            return;
        }

        console.log(`[ProseCleaner]: Mapping profile ID ${settings.cleanerProfile} to config: "${profileObj.name}"`);

        try {
            const cleanedResult = await executeCleanerWorker(profileObj, settings.cleanerPrompt, modifiedText, context);
            if (cleanedResult) {
                console.log("[ProseCleaner]: Successfully received LLM-cleaned text.");
                immediateLastMsg.mes = cleanedResult.trim();
            } else {
                console.warn("[ProseCleaner]: LLM-cleaned text was empty. Retaining original modified text.");
                immediateLastMsg.mes = modifiedText;
            }
        } catch (err) {
            console.error(`[ProseCleaner]: Direct API cleaning failed: ${err.message}. Retaining original modified text.`);
            immediateLastMsg.mes = modifiedText;
        }

        immediateLastMsg.extra = immediateLastMsg.extra || {};
        immediateLastMsg.extra.is_cleaned = true;
    } else {
        immediateLastMsg.mes = modifiedText;
        immediateLastMsg.extra = immediateLastMsg.extra || {};
        immediateLastMsg.extra.is_cleaned = true;
    }
}
