export async function injectFormattingLock(chat, type) {
    if (type === 'quiet' || type === 'summarize') return; 

    let lastUserIdx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].is_user && !chat[i].is_system) {
            lastUserIdx = i;
            break;
        }
    }

    if (lastUserIdx !== -1) {
        chat[lastUserIdx] = structuredClone(chat[lastUserIdx]);
        chat[lastUserIdx].mes += "\n\n[System Note: Provide your response strictly in immersive narrative prose. Do not use lists, summaries, repetitive conclusions, or AI disclaimers. Stay entirely in character. CRITICAL CONSTRAINT: Focus exclusively on your own character's actions, thoughts, and dialogue. Do not speak, think, act, or dictate choices for the user's character, and make no assumptions about their motives, goals, or next decisions.]";
    }
}