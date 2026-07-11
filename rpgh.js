/**
 * ============================================================================
 * MODULE: rpgh.js
 * DESCRIPTION: Automated RPG State Engine & Live Sidebar UI Matrix.
 * Handles state calculations, ledger serialization, modal viewers, and viewport tracking.
 * ============================================================================
 */

export const defaultRpgSettings = {
    rpgStateEnabled: true,
    rpgWorkerProfile: "default",
    targetStateLorebook: "RPGLedger",
    cardUids: {
        stats: null,
        arts: null,
        artTree: null,
        inventory: null
    },
    rpgSidebarPosition: "right", 
    runtimeVariables: {
        rpg_dayNum: 1,
        rpg_dayPhase: "Dawn",
        rpg_weather: "Clear",
        rpg_district: "Unknown",
        rpg_location: "Unknown",
        rpg_subLocation: "Unknown",
        rpg_currentHP: 50,
        rpg_maxHP: 50,
        rpg_currentMP: 10,
        rpg_maxMP: 10,
        rpg_currentEXP: 0,
        rpg_maxEXP: 100,
        rpg_charLevel: 1,
        rpg_CP: 140,
        rpg_SP: 24,
        rpg_AP: 6,
        rpg_gold: 0,
        rpg_silver: 0,
        rpg_copper: 5,
        skills: ["Dagger I", "Dual Wield I", "Sneak Attack I", "Assassinate I", "Stealth II", "Void Pocket I", "Void Step I"],
        rpg_artTree: [
            "Dagger II (2 AP) - Prerequisite: Dagger I (Acquired)",
            "Sneak Attack II (2 AP) - Prerequisite: Sneak Attack I (Acquired)",
            "Assassinate II (2 AP) - Prerequisite: Assassinate I (Acquired), Sneak Attack II (Missing)",
            "Stealth III (2 AP) - Prerequisite: Stealth II (Acquired)",
            "Illusion I (2 AP) - Prerequisite: Any Arcane-Art (Acquired)"
        ],
        inventory: [
            { name: "Traveler's Cloak", flags: ["Equipped", "Hood Down", "Clean"] },
            { name: "Iron Dagger", flags: ["Equipped", "Sturdy"] },
            { name: "Bandit Mask", flags: ["Stowed", "Disguised"] },
            { name: "Health Potion", quantity: 3, flags: ["Stowed"] }
        ]
    },
    rpgSystemPrompt: `# Role
You are a precise RPG State Synchronizer. Your task is to maintain a perfect, continuous snapshot of the character's world state based on the provided chat history.

# Task
Analyze the latest narrative turn and return the COMPLETE updated state of all variables.

# Constraints
- OUTPUT ONLY A SINGLE VALID JSON OBJECT.
- DO NOT include any conversational text, explanations, or markdown code blocks.
- If a variable is not mentioned in the text, retain its previous value exactly.
- For the \`inventory\` array, you must include ALL items. Do not omit items that were not mentioned in the current turn.
- Update \`flags\` within items (e.g., "Equipped", "Dirty", "Disguised") based on narrative context.

# State Schema
{
  "rpg_dayNum": number,
  "rpg_dayPhase": "Dawn" | "Morning" | "Noon" | "Dusk" | "Night",
  "rpg_weather": string,
  "rpg_district": string,
  "rpg_location": string,
  "rpg_subLocation": string,
  "rpg_currentHP": number,
  "rpg_maxHP": number,
  "rpg_currentMP": number,
  "rpg_maxMP": number,
  "rpg_currentEXP": number,
  "rpg_maxEXP": number,
  "rpg_charLevel": number,
  "rpg_CP": number,
  "rpg_SP": number,
  "rpg_AP": number,
  "rpg_gold": number,
  "rpg_silver": number,
  "rpg_copper": number,
  "skills": string[],
  "rpg_artTree": string[],
  "inventory": [{"name": string, "flags": string[], "quantity"?: number}]
}

# Example Output
{"rpg_dayNum": 1, "rpg_dayPhase": "Dusk", "rpg_currentHP": 45, "inventory": [{"name": "Iron Dagger", "flags": ["Equipped"]}, {"name": "Traveler's Cloak", "flags": ["Equipped", "Dirty"]}]}`
};

function safelySaveSettings(context) {
    if (context && typeof context.saveSettingsObj === 'function') {
        context.saveSettingsObj();
    } else if (window.SillyTavern?.getContext && typeof window.SillyTavern.getContext().saveSettingsObj === 'function') {
        window.SillyTavern.getContext().saveSettingsObj();
    }
}

async function executeRpgWorker(profileName, systemPrompt, userContent, context) {
    console.log(`[RPG Engine] [TRACE] Entering worker. Targeting: "${profileName}"`);

    return new Promise((resolve) => {
        // MUST use the global core eventSource
        const eventSource = window.SillyTavern?.eventSource || context?.eventSource || window.eventSource;

        if (!eventSource) {
            console.error("[RPG Engine] [FAIL] Global eventSource is unavailable.");
            resolve('');
            return;
        }

        const safetyTimeout = setTimeout(() => {
            console.warn("[RPG Engine] [TIMEOUT] Generation expired.");
            eventSource.removeListener('background_gen_finished', eventHandler);
            resolve('');
        }, 7000);

        const eventHandler = (data) => {
            console.log("[RPG Engine] [TRACE] Signal received.");
            clearTimeout(safetyTimeout);
            eventSource.removeListener('background_gen_finished', eventHandler);
            resolve(data?.text || '');
        };
        
        eventSource.on('background_gen_finished', eventHandler);

        // Sanitize inputs
        const cleanPrompt = systemPrompt.replace(/"/g, '\\"');
        const cleanContent = userContent.replace(/"/g, '\\"');
        
        // Command must have quotes around the profile name to handle spaces
        const macroString = `/profile-genstream "${profileName}" "${cleanPrompt}" "${cleanContent}"`;

        try {
            console.log(`[RPG Engine] [EXEC] Sending command: ${macroString}`);
            window.SillyTavern.executeSlashCommands(macroString);
        } catch (err) {
            console.error("[RPG Engine] [FAIL] Dispatch failed:", err);
            clearTimeout(safetyTimeout);
            eventSource.removeListener('background_gen_finished', eventHandler);
            resolve('');
        }
    });
}

/**
 * LIFECYCLE PIPELINE & LOREBOOK SYNC
 */
export async function processRpgStateStage(chat, settings, context) {
    if (!chat || !settings) return;
    if (!settings.rpgStateEnabled || chat.length === 0) return;

    const immediateLastMsg = chat[chat.length - 1];
    if (!immediateLastMsg || !immediateLastMsg.mes) return;

    // LOOKUP: Retrieve name from connectionManager profiles
    const profiles = window.SillyTavern?.settings?.connectionManager?.profiles || [];
    const profileObj = profiles.find(p => p.id === settings.rpgWorkerProfile);
    const profileName = profileObj ? profileObj.name : settings.rpgWorkerProfile;

    console.log(`[RPG Engine] Mapping ID ${settings.rpgWorkerProfile} to Name: "${profileName}"`);

    const baselineJson = JSON.stringify(settings.runtimeVariables, null, 2);
    const systemPrompt = settings.rpgSystemPrompt.replace(/{{baselineString}}/g, baselineJson);

    try {
        const userPromptPayload = `### LATEST NARRATIVE TURN:\n${immediateLastMsg.name}: ${immediateLastMsg.mes.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()}`;
        
        const output = await executeRpgWorker(
            profileName, 
            systemPrompt,
            userPromptPayload,
            context
        );

        if (output) {
            parseAndApplyStateUpdates(output, settings, context);
            await syncStateToLorebook(settings, context);
        }
    } catch (err) {
        console.error("FlushMonitor Pipeline [Error]: RPG State Engine processing failed.", err);
    }
}

function parseAndApplyStateUpdates(output, settings, context) {
    if (!settings.runtimeVariables) settings.runtimeVariables = {};
    let variablesUpdated = false;

    try {
        // Robust string strip for json validation blocks
        const cleanOutput = output.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsedState = JSON.parse(cleanOutput);

        for (const [key, value] of Object.entries(parsedState)) {
            settings.runtimeVariables[key] = value;
            variablesUpdated = true;
        }
    } catch (e) {
        console.error("FlushMonitor Pipeline [Error]: Failed to parse RPG state JSON.", e);
        console.warn("Raw LLM Output was:", output);
    }

    if (variablesUpdated) {
        safelySaveSettings(context);
    }
}

/**
 * Procedurally generates 4 distinct Lorebook cards from the runtime variable state.
 */
export async function syncStateToLorebook(settings, context) {
    const worldInfoContext = window.SillyTavern?.worldinfo || context?.worldinfo;
    if (!worldInfoContext) {
        console.warn("FlushMonitor [Lorebook Sync]: World Info system uninitialized or missing context.");
        return;
    }
    
    const lorebookName = settings.targetStateLorebook || "RPGLedger";
    const targetBook = worldInfoContext.books?.[lorebookName] || worldInfoContext.current_books?.[lorebookName];
    
    if (!settings.cardUids) settings.cardUids = { stats: null, arts: null, artTree: null, inventory: null };

    const variables = settings.runtimeVariables || {};
    
    let statsMd = "";
    for (const [key, val] of Object.entries(variables)) {
        if (key === 'skills' || key === 'rpg_artTree' || key === 'inventory') continue;
        statsMd += `* **${key}**: ${val}\n`;
    }

    let inventoryMd = "";
    if (Array.isArray(variables.inventory)) {
        variables.inventory.forEach(item => {
            const qty = item.quantity ? ` (x${item.quantity})` : '';
            const flags = Array.isArray(item.flags) && item.flags.length > 0 ? ` [${item.flags.join(', ')}]` : '';
            inventoryMd += `* ${item.name}${qty}${flags}\n`;
        });
    }

    const categories = {
        stats: statsMd.trim(),
        arts: Array.isArray(variables.skills) ? variables.skills.map(s => `* ${s}`).join('\n') : "",
        artTree: Array.isArray(variables.rpg_artTree) ? variables.rpg_artTree.map(a => `* ${a}`).join('\n') : "",
        inventory: inventoryMd.trim()
    };

    // Sequential resolution loop to guarantee stable creation sequence execution across world info blocks
    for (const [cardType, content] of Object.entries(categories)) {
        if (!content) continue;

        const systemInjectContent = `[SYSTEM STATE ENGINE - DO NOT MODIFY DIRECTLY]\n### ${cardType.toUpperCase()}\n${content}`;
        let existingUid = settings.cardUids[cardType];
        
        if (existingUid && targetBook?.entries?.[existingUid]) {
            const entryToUpdate = targetBook.entries[existingUid];
            entryToUpdate.content = systemInjectContent;
            await worldInfoContext.updateEntry(lorebookName, existingUid, entryToUpdate);
        } else {
            const newEntry = {
                uid: Date.now() + Math.floor(Math.random() * 10000),
                key: [`rpg_${cardType}`], 
                content: systemInjectContent,
                enabled: true,
                constant: true,
                probability: 100,
                insertion_order: 1
            };
            await worldInfoContext.createEntry(lorebookName, newEntry);
            settings.cardUids[cardType] = newEntry.uid;
        }
    }
    
    safelySaveSettings(context);
}

