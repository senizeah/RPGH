/**
 * Default settings for the Prose Cleaner Subsystem.
 */
export const defaultCleanerSettings = {
    cleanerEnabled: true,
    pruneEnabled: true,
    regexStyleEnabled: false, 
    cleanerProfile: "default",
    cleanerPrompt: "You are an expert copy editor. Rewrite the provided text to remove repetitive 'AI-isms', overly flowery language, and unnatural phrasing. Maintain the exact original meaning, facts, formatting, and character voice. Return ONLY the edited text with no additional commentary.",    
    customCleanFilters: ["(?:In conclusion|To summarize|Ultimately),? .+"].join("\n"),
};

/**
 * Trims un-finished sentences trailing at the end of a generation.
 */
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

/**
 * Ensures formatting bounds (quotes and asterisks) are balanced.
 */
export function runStructuralPass(text) {
    if (!text) return text;
    let balanced = text;

    // Balance unclosed dialogue quotes
    const quotes = (balanced.match(/"/g) || []).length;
    if (quotes % 2 !== 0) balanced += '"';

    // Balance unclosed roleplay asterisks
    const asterisks = (balanced.match(/\*/g) || []).length;
    if (asterisks % 2 !== 0) balanced += '*';
    
    // Repetition/Loop detection
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

/**
 * Dynamic regular expression substitution and analysis engine.
 * Returns both the stripped text and whether any matches were detected.
 */
export function runStylisticPass(text, rawRulesString) {
    let result = {
        text: text ? text.trim() : "",
        hasMatches: false
    };

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
            console.error(`FlushMonitor [Regex Error]: Could not compile pattern "${pattern}"`, e);
        }
    });

    result.text = result.text.trim();
    return result;
}

/**
 * Orchestrates the full cleaner logic pipeline (Regex -> Passes -> API Worker Pass)
 */
export async function processProseCleanerStage(chat, immediateLastMsg, settings, estimateTokensCb, context) {
    const cleanText = immediateLastMsg.mes.trim();
    const isOOC = cleanText.startsWith("[OOC:") || cleanText.startsWith("(OOC:") || cleanText.includes("[OOC]");
    const isCommand = cleanText.startsWith("/");
    const isUnderSize = estimateTokensCb(cleanText) <= 30;

    if (!immediateLastMsg.extra) immediateLastMsg.extra = {};
    if (!immediateLastMsg.extra.raw_uncleaned) immediateLastMsg.extra.raw_uncleaned = immediateLastMsg.mes;

    if (isOOC || isCommand || isUnderSize) {
        immediateLastMsg.extra.is_cleaned = true;
        return;
    }

    let modifiedText = cleanText;

    if (settings.pruneEnabled) {
        modifiedText = trimUnfinishedSentence(modifiedText);
    }

    modifiedText = runStructuralPass(modifiedText);
    
    const styleAnalysis = runStylisticPass(modifiedText, settings.customCleanFilters);

    let shouldInvokeLLM = false;

    if (settings.regexStyleEnabled) {
        modifiedText = styleAnalysis.text;
        if (settings.cleanerEnabled) {
            shouldInvokeLLM = true;
        }
    } else {
        if (settings.cleanerEnabled && styleAnalysis.hasMatches) {
            shouldInvokeLLM = true; 
            console.log("FlushMonitor Pipeline [Alert]: Style check failed via local regex. Flagging message for AI rewrite wrapper.");
        }
    }

    if (shouldInvokeLLM) {
        try {
            console.log("FlushMonitor Pipeline [1/3]: Routing generation to Prose Cleaner...");
            const historyStart = Math.max(0, chat.length - settings.keepRawCount - 1);
            const historySlice = chat.slice(historyStart, chat.length - 1);
            let historyContextString = historySlice.map(m => `${m.name}: ${m.mes}`).join("\n");

            let userPromptPayload = "";
            if (historyContextString) {
                userPromptPayload += `Recent History for Context:\n${historyContextString}\n\n`;
            }
            userPromptPayload += `Target Message to Rewrite:\n${immediateLastMsg.name}: ${modifiedText}`;

            const payload = {
                messages: [
                    { role: "system", content: settings.cleanerPrompt },
                    { role: "user", content: userPromptPayload }
                ],
                max_tokens: 1500,
                temperature: 0.3 
            };

            const response = await window.SillyTavern.api.request(settings.cleanerProfile, payload);
            const cleanedOutput = response?.choices?.[0]?.message?.content?.trim();
            
            if (cleanedOutput && cleanedOutput.length > 0) {
                modifiedText = cleanedOutput;
            }
        } catch (err) {
            console.error("FlushMonitor Pipeline [Error]: Prose Cleaner API call failed. Falling back to unmodified text.", err);
        }
    }

    if (modifiedText !== immediateLastMsg.mes) {
        immediateLastMsg.mes = modifiedText;
        await context.saveChat();
        context.renderChat();
    }
    
    immediateLastMsg.extra.is_cleaned = true;
}