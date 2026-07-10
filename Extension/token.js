/**
 * Simple character-to-token fallback approximation.
 * @param {string} text - The text to estimate tokens for.
 * @param {Object} settings - The extension settings containing wordsPerToken.
 * @returns {number} The estimated token count.
 */
export function estimateTokens(text, settings) {
    if (!text) return 0;
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    return Math.ceil(wordCount / (settings.wordsPerToken || 4));
}

/**
 * Calculates all required token metrics for the RPGUI sidebar.
 * @param {Object} context - SillyTavern context.
 * @param {Object} settings - Extension settings.
 * @returns {Object} An object containing all calculated token metrics.
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
        const msgTokens = sumT(msgText);

        if (isWithinKeepRaw) {
            rawTValue += msgTokens;
        } else {
            if (isSummarized) {
                summaryTValue += msgTokens;
            } else {
                rawTValue += msgTokens;
            }
        }
    });

    // 2. Lorebook Metrics
    const getBookTokenCount = (bookName) => {
        const book = window.SillyTavern?.worldinfo?.books?.[bookName];
        if (!book || !book.entries) return 0;
        
        const entries = Object.values(book.entries);
        return entries.reduce((acc, entry) => {
            if (entry.enabled && entry.constant) {
                return acc + sumT(entry.content || "");
            }
            return acc;
        }, 0);
    };

    // Dynamically calculate main Lorebook tokens by summing all books active in current session except the extension-managed ones
    let lorebookTValue = 0;
    const activeBookNames = window.SillyTavern?.worldinfo?.current_books || [];
    const extensionBooks = [settings.targetLorebook, settings.targetStateLorebook];

    // Fix: Iterating directly over array elements instead of their object keys
    activeBookNames.forEach((bookName) => {
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