/**
 * Simple character-to-token fallback approximation.
 * @param {string|Object} text - The text string or object to estimate tokens for.
 * @param {Object} settings - The extension settings containing wordsPerToken.
 * @returns {number} The estimated token count.
 */
export function estimateTokens(text, settings) {
    // FIX: If context object is accidentally passed here, look for its text or redirect it safely
    if (text && typeof text === 'object') {
        if (typeof text.mes === 'string') text = text.mes;
        else return 0; 
    }
    
    if (!text || typeof text !== 'string') return 0;
    
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    return Math.ceil(wordCount / (settings.wordsPerToken || 4));
}

/**
 * Calculates all required token metrics for the RPGUI sidebar.
 * @param {Object} context - SillyTavern context.
 * @param {Object} settings - Extension settings.
 * @returns {Object} An object containing all calculated token metrics._
 */
export function calculateTokenMetrics(context, settings) {
    const chat = context.chat || [];
    const keepRawCount = settings.keepRawCount || 0;

    // Helper to sum tokens in a string
    const sumT = (str) => estimateTokens(str, settings);

    // 1. Chat Message Metrics
    let summaryTValue = 0;
    let rawTValue = 0;

    chat.forEach((msg, idx) => {
        const isWithinKeepRaw = idx >= (chat.length - keepRawCount);
        const isSummarized = msg.extra?.is_summarized;
        const msgText = msg.mes || "";
        
        if (isSummarized) {
            summaryTValue += sumT(msgText);
        }
        if (isWithinKeepRaw) {
            rawTValue += sumT(msgText);
        }
    });

    // 2. Lorebook Metrics
    let lorebookTValue = 0;
    const extensionBooks = [settings.targetLorebook, settings.targetStateLorebook];
    
    const getBookTokenCount = (bookName) => {
        if (!bookName) return 0;
        const book = context.lorebooks?.find(b => b.name === bookName);
        if (!book || !book.entries) return 0;
        return Object.values(book.entries).reduce((acc, entry) => acc + sumT(entry.content || ""), 0);
    };

    context.activeLorebooks?.forEach((bookName) => {
        if (!extensionBooks.includes(bookName)) {
            lorebookTValue += getBookTokenCount(bookName);
        }
    });

    const chapterledgerTValue = getBookTokenCount(settings.targetLorebook) || 0;
    const rpgledgerTValue = getBookTokenCount(settings.targetStateLorebook) || 0;

    // 3. Prompt Metrics
    const mainPromptTValue = sumT(context.mainPrompt || "");
    const summarizerPromptTValue = sumT(settings.summarizerPrompt || "");
    const cleanerPromptTValue = sumT(settings.cleanerPrompt || "");
    const rpgSystemPromptTValue = sumT(settings.rpgSystemPrompt || "");
    const characterDescriptionTValue = sumT(context.characters?.[context.character_id]?.description || "");

    // 4. Totals
    const lorebookATotal = mainPromptTValue + characterDescriptionTValue + lorebookTValue + summaryTValue + rawTValue + chapterledgerTValue + rpgledgerTValue + summarizerPromptTValue + cleanerPromptTValue + rpgSystemPromptTValue;
    const summaryATotal = rawTValue + summarizerPromptTValue;
    const cleanerATotal = summaryTValue + cleanerPromptTValue; 
    const rpgATotal = rpgledgerTValue + characterDescriptionTValue + rpgSystemPromptTValue; 

    return {
        lorebookTValue, summaryTValue, rawTValue, chapterledgerTValue, rpgledgerTValue,
        mainPromptTValue, summarizerPromptTValue, cleanerPromptTValue, rpgSystemPromptTValue, characterDescriptionTValue,
        lorebookATotal, summaryATotal, cleanerATotal, rpgATotal
    };
}