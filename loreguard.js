/**
 * Calculates overlap metrics against existing World Info layers using token ratios.
 */
export function checkSimilarityAgainstLore(newText, targetLorebook, threshold) {
    console.log(`[LoreGuard]: Starting similarity check against lorebook: "${targetLorebook}"`);

    // Safely look up world info structural records matching current context
    const worldInfoContext = window.SillyTavern?.worldinfo || {};
    const targetBook = worldInfoContext.books?.[targetLorebook] || worldInfoContext.current_books?.[targetLorebook];
    const loreEntries = targetBook?.entries ? Object.values(targetBook.entries) : [];
    
    if (!loreEntries.length) {
        console.log(`[LoreGuard]: No lore entries found in target book "${targetLorebook}".`);
        return false;
    }

    const getWords = text => new Set(text.toLowerCase().match(/\w+/g) || []);
    const newWords = getWords(newText);
    
    let highestSim = 0;
    
    for (const entry of loreEntries) {
        const entryText = entry.content || entry.text || "";
        if (!entryText) continue;

        const entryWords = getWords(entryText);
        if (entryWords.size === 0) continue;

        const intersection = new Set([...newWords].filter(x => entryWords.has(x)));
        const union = new Set([...newWords, ...entryWords]);
        
        const sim = intersection.size / union.size;
        if (sim > highestSim) highestSim = sim;
    }
    
    const isSignificant = highestSim > threshold;
    if (isSignificant) {
        console.log(`[LoreGuard]: High similarity detected (${(highestSim * 100).toFixed(2)}%). Threshold: ${(threshold * 100).toFixed(2)}%`);
    }
    return isSignificant;
}
