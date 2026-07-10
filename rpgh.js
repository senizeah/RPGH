/**
 * ============================================================================
 * MODULE: rpgh.js
 * DESCRIPTION: Automated RPG State Engine & Live Sidebar UI Matrix.
 * Handles state calculations, ledger serialization, modal viewers, and viewport tracking.
 * ============================================================================
 */

/**
 * Default internal configuration states for the RPG subsystem.
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
    rpgSidebarPosition: "right", // Options: "left", "right", "hidden"
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

/**
 * LIFECYCLE PIPELINE & LOREBOOK SYNC
 * ----------------------------------------------------------------------------
 */
export async function processRpgStateStage(chat, settings, context, updateCountCb) {
    if (!settings.rpgStateEnabled || !settings.rpgWorkerProfile || chat.length === 0) return;

    const immediateLastMsg = chat[chat.length - 1];
    if (!immediateLastMsg || !immediateLastMsg.mes) return;
    
    const cleanText = immediateLastMsg.mes.trim();
    if (immediateLastMsg.is_system || cleanText.startsWith("[OOC:") || cleanText.startsWith("(OOC:") || cleanText.startsWith("/")) {
        return;
    }

    try {
        console.log("FlushMonitor Pipeline [4/4]: Routing turn delta to RPG State Engine...");

        let baselineString = "### CURRENT ABSOLUTE VARIABLE VALUES:\n";
        for (const [key, value] of Object.entries(settings.runtimeVariables || {})) {
            baselineString += `${key} = ${JSON.stringify(value)}\n`;
        }

        const userPromptPayload = `${baselineString}\n\n### LATEST NARRATIVE TURN:\n${immediateLastMsg.name}: ${cleanText}`;

        const payload = {
            messages: [
                { role: "system", content: settings.rpgSystemPrompt },
                { role: "user", content: userPromptPayload }
            ],
            max_tokens: 1500,
            temperature: 0.1
        };

        const response = await window.SillyTavern.api.request(settings.rpgWorkerProfile, payload);
        const output = response?.choices?.[0]?.message?.content?.trim();

        if (!output) throw new Error("RPG Worker Profile returned empty response.");

        parseAndApplyStateUpdates(output, settings, context);
        await syncStateToLorebook(settings);

        if (typeof updateCountCb === 'function') {
            updateCountCb();
        }

    } catch (err) {
        console.error("FlushMonitor Pipeline [Error]: RPG State Engine processing failed.", err);
    }
}

function parseAndApplyStateUpdates(output, settings, context) {
    if (!settings.runtimeVariables) settings.runtimeVariables = {};
    let variablesUpdated = false;

    try {
        // Strip markdown blocks in case the AI wraps the JSON despite instructions
        const cleanOutput = output.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        // Parse the AI's JSON output
        const parsedState = JSON.parse(cleanOutput);

        // Merge the parsed values into the runtime state
        for (const [key, value] of Object.entries(parsedState)) {
            // Optional: You can add validation here to ensure only expected keys are merged
            settings.runtimeVariables[key] = value;
            variablesUpdated = true;
        }
    } catch (e) {
        console.error("FlushMonitor Pipeline [Error]: Failed to parse RPG state JSON.", e);
        console.warn("Raw LLM Output was:", output);
    }

    if (variablesUpdated) {
        context.saveSettingsObj();
    }
}

/**
 * Procedurally generates 4 distinct Lorebook cards from the runtime variable state.
 */
export async function syncStateToLorebook(settings) {
    if (!window.SillyTavern.worldinfo) throw new Error("World Info uninitialized.");
    
    const lorebookName = settings.targetStateLorebook || "RPGLedger";
    const worldInfoContext = window.SillyTavern.worldinfo;
    const targetBook = worldInfoContext.books?.[lorebookName] || worldInfoContext.current_books?.[lorebookName];
    
    if (!settings.cardUids) settings.cardUids = { stats: null, arts: null, artTree: null, inventory: null };

    const variables = settings.runtimeVariables || {};
    
    // 1. Build Stats Markdown
    let statsMd = "";
    for (const [key, val] of Object.entries(variables)) {
        if (key === 'skills' || key === 'rpg_artTree' || key === 'inventory') continue;
        statsMd += `* **${key}**: ${val}\n`;
    }

    // 2. Build Inventory Markdown
    let inventoryMd = "";
    if (Array.isArray(variables.inventory)) {
        variables.inventory.forEach(item => {
            const qty = item.quantity ? ` (x${item.quantity})` : '';
            const flags = Array.isArray(item.flags) && item.flags.length > 0 ? ` [${item.flags.join(', ')}]` : '';
            inventoryMd += `* ${item.name}${qty}${flags}\n`;
        });
    }

    // 3. Formulate the Categories mapping
    const categories = {
        stats: statsMd.trim(),
        arts: Array.isArray(variables.skills) ? variables.skills.map(s => `* ${s}`).join('\n') : "",
        artTree: Array.isArray(variables.rpg_artTree) ? variables.rpg_artTree.map(a => `* ${a}`).join('\n') : "",
        inventory: inventoryMd.trim()
    };

    // 4. Inject or Update Lorebook Cards
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
    
    // Save updated UIDs to extension memory
    SillyTavern.getContext().saveSettingsObj();
}