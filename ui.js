/**
 * ============================================================================
 * MODULE: ui.js
 * DESCRIPTION: Presentation Layer for the Prefill-Cache Flush Monitor Extension.
 * Handles DOM creation, event piping, and layout segmentation.
 * ============================================================================
 */

/**
 * ----------------------------------------------------------------------------
 * GENERAL CORE UI UTILITIES
 * Global design structures and boilerplate layout generators.
 * ----------------------------------------------------------------------------
 */
function createSettingRow(labelText, inputElement, description = '') {
    const wrapper = document.createElement('div');
    wrapper.style = 'display: flex; flex-direction: column; gap: 3px;';
    
    const labelRow = document.createElement('div');
    labelRow.style = 'display: flex; justify-content: space-between; align-items: center;';
    
    const label = document.createElement('label');
    label.style = 'font-weight: 500;';
    label.innerText = labelText;
    
    labelRow.appendChild(label);
    labelRow.appendChild(inputElement);
    wrapper.appendChild(labelRow);
    
    if (description) {
        const desc = document.createElement('small');
        desc.style = 'opacity: 0.5; font-size: 10px; font-style: italic;';
        desc.innerText = description;
        wrapper.appendChild(desc);
    }
    return wrapper;
}

/**
 * ----------------------------------------------------------------------------
 * SUBSYSTEM: CORE STORAGE & SLIDING CACHE LIMITS
 * ----------------------------------------------------------------------------
 */
function buildCoreSlidingCacheSection(container, settings, saveSettings, onThresholdChange) {
    const inputKeepRaw = document.createElement('input');
    inputKeepRaw.type = 'number';
    inputKeepRaw.className = 'text_display input_text';
    inputKeepRaw.style = 'width: 70px; text-align: right;';
    inputKeepRaw.value = settings.keepRawCount;
    inputKeepRaw.onchange = async () => {
        settings.keepRawCount = parseInt(inputKeepRaw.value) || 21;
        await saveSettings();
        onThresholdChange();
    };
    container.appendChild(createSettingRow('Kept Raw Messages Window', inputKeepRaw));

    const inputThreshold = document.createElement('input');
    inputThreshold.type = 'number';
    inputThreshold.className = 'text_display input_text';
    inputThreshold.style = 'width: 70px; text-align: right;';
    inputThreshold.value = settings.autoFlushThreshold;
    inputThreshold.onchange = async () => {
        settings.autoFlushThreshold = parseInt(inputThreshold.value) || 1024;
        await saveSettings();
        onThresholdChange();
    };
    container.appendChild(createSettingRow('Cache Capacity Threshold', inputThreshold));

    const inputWarning = document.createElement('input');
    inputWarning.type = 'number';
    inputWarning.className = 'text_display input_text';
    inputWarning.style = 'width: 70px; text-align: right;';
    inputWarning.value = settings.warningThreshold;
    inputWarning.onchange = async () => {
        settings.warningThreshold = parseInt(inputWarning.value) || 100;
        await saveSettings();
        onThresholdChange();
    };
    container.appendChild(createSettingRow('Warning Buffer Alert Window', inputWarning));

    const inputWordsPerToken = document.createElement('input');
    inputWordsPerToken.type = 'number';
    inputWordsPerToken.step = '0.01';
    inputWordsPerToken.className = 'text_display input_text';
    inputWordsPerToken.style = 'width: 70px; text-align: right;';
    inputWordsPerToken.value = settings.wordsPerToken;
    inputWordsPerToken.onchange = async () => {
        settings.wordsPerToken = parseFloat(inputWordsPerToken.value) || 0.66;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Words Per Token Ratio', inputWordsPerToken));
}

/**
 * ----------------------------------------------------------------------------
 * SUBSYSTEM: FLUSH & ARCHIVAL ROTATION SYSTEM
 * ----------------------------------------------------------------------------
 */
function buildFlushArchivalSection(container, settings, saveSettings) {
    const checkAutoFlush = document.createElement('input');
    checkAutoFlush.type = 'checkbox';
    checkAutoFlush.checked = settings.autoFlushEnabled;
    checkAutoFlush.onchange = async () => {
        settings.autoFlushEnabled = checkAutoFlush.checked;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Enable Background Auto-Flushing', checkAutoFlush));

    const inputChunk = document.createElement('input');
    inputChunk.type = 'number';
    inputChunk.className = 'text_display input_text';
    inputChunk.style = 'width: 70px; text-align: right;';
    inputChunk.value = settings.chunkSize;
    inputChunk.onchange = async () => {
        settings.chunkSize = parseInt(inputChunk.value) || 64;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Lore Card Chronological Chunk Capacity', inputChunk));

    const inputLorebook = document.createElement('input');
    inputLorebook.type = 'text';
    inputLorebook.className = 'text_display input_text';
    inputLorebook.value = settings.targetLorebook;
    inputLorebook.onchange = async () => {
        settings.targetLorebook = inputLorebook.value.trim() || "ChapterLedger";
        await saveSettings();
    };
    container.appendChild(createSettingRow('Target World Info Lorebook Name', inputLorebook));
}

/**
 * ----------------------------------------------------------------------------
 * SUBSYSTEM: BACKGROUND SUMMARIZER ENGINE
 * ----------------------------------------------------------------------------
 */
function buildSummarizerSection(container, settings, saveSettings, availableProfiles) {
    const subheaderNet = document.createElement('div');
    subheaderNet.innerText = '⚙️ Summarizer Worker Routing';
    subheaderNet.style = 'margin: 10px 0 5px 0; font-weight: bold; color: #fbbf24; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 3px;';
    console.log("[UI]: Building Summarizer section.");
    container.appendChild(subheaderNet);

    const profileSelectElement = document.createElement('select');
    profileSelectElement.id = 'flush_monitor_summarizer_profile'; // ID added for dynamic binding
    profileSelectElement.className = 'text_display input_text';
    profileSelectElement.style = 'width: 150px; background: #111827; color: white; border: 1px solid rgba(255,255,255,0.2);';
    
    availableProfiles.forEach(prof => {
        const opt = document.createElement('option');
        opt.value = prof.id;
        opt.innerText = prof.name;
        if (settings.selectedProfile === prof.id || settings.selectedProfile === prof.name) opt.selected = true;
        profileSelectElement.appendChild(opt);
    });
    profileSelectElement.onchange = async () => {
        settings.selectedProfile = profileSelectElement.value;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Assigned Worker Profile Alias', profileSelectElement));

    const inputMaxTokens = document.createElement('input');
    inputMaxTokens.type = 'number';
    inputMaxTokens.className = 'text_display input_text';
    inputMaxTokens.style = 'width: 70px; text-align: right;';
    inputMaxTokens.value = settings.maxTokens;
    inputMaxTokens.onchange = async () => {
        settings.maxTokens = parseInt(inputMaxTokens.value) || 30;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Summary Output Limit (Tokens)', inputMaxTokens));

    const promptArea = document.createElement('textarea');
    promptArea.className = 'text_display input_text';
    promptArea.style = 'width: 100%; height: 75px; font-size: 11px; resize: vertical; margin-top: 4px;';
    promptArea.value = settings.summarizerPrompt;
    promptArea.onchange = async () => {
        settings.summarizerPrompt = promptArea.value.trim();
        await saveSettings();
    };

    const promptWrapper = document.createElement('div');
    promptWrapper.style = 'display: flex; flex-direction: column; gap: 3px;';
    const promptLabel = document.createElement('label');
    promptLabel.style = 'font-weight: 500;';
    promptLabel.innerText = 'Summarization System Instruction Prompt';
    promptWrapper.appendChild(promptLabel);
    promptWrapper.appendChild(promptArea);
    container.appendChild(promptWrapper);
}

/**
 * ----------------------------------------------------------------------------
 * SUBSYSTEM: PROSE CLEANER SUB-PIPELINE
 * ----------------------------------------------------------------------------
 */
function buildProseCleanerSection(container, settings, saveSettings, availableProfiles) {
    const subheaderCleaner = document.createElement('div');
    subheaderCleaner.innerText = '🧹 AI Prose Cleaner & Formatting';
    subheaderCleaner.style = 'margin: 15px 0 5px 0; font-weight: bold; color: #38bdf8; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 3px;';
    console.log("[UI]: Building Prose Cleaner section.");
    container.appendChild(subheaderCleaner);

    const checkPrune = document.createElement('input');
    checkPrune.type = 'checkbox';
    checkPrune.checked = settings.pruneEnabled;
    checkPrune.onchange = async () => {
        settings.pruneEnabled = checkPrune.checked;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Enable Unfinished Sentence Pruning (Regex)', checkPrune));

    const checkCleaner = document.createElement('input');
    checkCleaner.type = 'checkbox';
    checkCleaner.checked = settings.cleanerEnabled;
    checkCleaner.onchange = async () => {
        settings.cleanerEnabled = checkCleaner.checked;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Enable LLM Prose Detoxification', checkCleaner));

    const checkRegexStyle = document.createElement('input');
    checkRegexStyle.type = 'checkbox';
    checkRegexStyle.checked = settings.regexStyleEnabled;
    checkRegexStyle.onchange = async () => {
        settings.regexStyleEnabled = checkRegexStyle.checked;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Destructively Strip Regex Matches Locally', checkRegexStyle));

    const cleanerProfileSelectElement = document.createElement('select');
    cleanerProfileSelectElement.id = 'flush_monitor_cleaner_profile'; // ID added for dynamic binding
    cleanerProfileSelectElement.className = 'text_display input_text';
    cleanerProfileSelectElement.style = 'width: 150px; background: #111827; color: white; border: 1px solid rgba(255,255,255,0.2);';
    
    availableProfiles.forEach(prof => {
        const opt = document.createElement('option');
        opt.value = prof.id;
        opt.innerText = prof.name;
        if (settings.cleanerProfile === prof.id || settings.cleanerProfile === prof.name) opt.selected = true;
        cleanerProfileSelectElement.appendChild(opt);
    });
    cleanerProfileSelectElement.onchange = async () => {
        settings.cleanerProfile = cleanerProfileSelectElement.value;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Cleaner Worker Profile Alias', cleanerProfileSelectElement));

    const filterArea = document.createElement('textarea');
    filterArea.className = 'text_display input_text';
    filterArea.style = 'width: 100%; height: 100px; font-family: monospace; font-size: 11px; resize: vertical; margin-top: 4px; white-space: pre; overflow-x: auto;';
    filterArea.value = settings.customCleanFilters;
    filterArea.onchange = async () => {
        settings.customCleanFilters = filterArea.value;
        await saveSettings();
    };
    
    const filterWrapper = document.createElement('div');
    filterWrapper.style = 'display: flex; flex-direction: column; gap: 3px; margin-top: 5px;';
    const filterLabel = document.createElement('label');
    filterLabel.style = 'font-weight: 500;';
    filterLabel.innerText = 'Custom Heuristic Regex Stripping Rules';
    filterWrapper.appendChild(filterLabel);
    filterWrapper.appendChild(filterArea);
    container.appendChild(filterWrapper);

    const cleanerPromptArea = document.createElement('textarea');
    cleanerPromptArea.className = 'text_display input_text';
    cleanerPromptArea.style = 'width: 100%; height: 75px; font-size: 11px; resize: vertical; margin-top: 4px;';
    cleanerPromptArea.value = settings.cleanerPrompt;
    cleanerPromptArea.onchange = async () => {
        settings.cleanerPrompt = cleanerPromptArea.value.trim();
        await saveSettings();
    };
    
    const cleanerPromptWrapper = document.createElement('div');
    cleanerPromptWrapper.style = 'display: flex; flex-direction: column; gap: 3px;';
    const cleanerPromptLabel = document.createElement('label');
    cleanerPromptLabel.style = 'font-weight: 500;';
    cleanerPromptLabel.innerText = 'Prose Cleaner System Instruction Prompt';
    cleanerPromptWrapper.appendChild(cleanerPromptLabel);
    cleanerPromptWrapper.appendChild(cleanerPromptArea);
    container.appendChild(cleanerPromptWrapper);
}

/**
 * ----------------------------------------------------------------------------
 * SUBSYSTEM: AUTOMATED RPG STATE ENGINE
 * ----------------------------------------------------------------------------
 */
function buildRpgEngineSection(container, settings, saveSettings, availableProfiles, onSidebarConfigChanged, getVariableEditAreaRef) {
    const subheaderRpg = document.createElement('div');
    subheaderRpg.innerText = '📊 Automated RPG State Engine';
    subheaderRpg.style = 'margin: 15px 0 5px 0; font-weight: bold; color: #a78bfa; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 3px;';
    console.log("[UI]: Building RPG Engine section.");
    container.appendChild(subheaderRpg);

    const checkRpg = document.createElement('input');
    checkRpg.type = 'checkbox';
    checkRpg.checked = settings.rpgStateEnabled;
    checkRpg.onchange = async () => {
        settings.rpgStateEnabled = checkRpg.checked;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Enable RPG State Calculations', checkRpg));

    const posSelect = document.createElement('select');
    posSelect.className = 'text_display input_text';
    posSelect.style = 'width: 150px; background: #111827; color: white; border: 1px solid rgba(255,255,255,0.2);';
    [
        { id: 'hidden', name: '❌ Disabled' },
        { id: 'left', name: '⬅️ Left Sidebar' },
        { id: 'right', name: '➡️ Right Sidebar' }
    ].forEach(optData => {
        const opt = document.createElement('option');
        opt.value = optData.id;
        opt.innerText = optData.name;
        if (settings.rpgSidebarPosition === optData.id) opt.selected = true;
        posSelect.appendChild(opt);
    });
    posSelect.onchange = async () => {
        settings.rpgSidebarPosition = posSelect.value;
        await saveSettings();
        onSidebarConfigChanged();
    };
    container.appendChild(createSettingRow('Live Character Status Overlay View', posSelect, 'Places a floating overlay panel inside the viewport tracking data fields.'));

    const rpgProfileSelectElement = document.createElement('select');
    rpgProfileSelectElement.id = 'flush_monitor_rpg_profile'; // ID added for dynamic binding
    rpgProfileSelectElement.className = 'text_display input_text';
    rpgProfileSelectElement.style = 'width: 150px; background: #111827; color: white; border: 1px solid rgba(255,255,255,0.2);';
    
    availableProfiles.forEach(prof => {
        const opt = document.createElement('option');
        opt.value = prof.id;
        opt.innerText = prof.name;
        if (settings.rpgWorkerProfile === prof.id || settings.rpgWorkerProfile === prof.name) opt.selected = true;
        rpgProfileSelectElement.appendChild(opt);
    });
    rpgProfileSelectElement.onchange = async () => {
        settings.rpgWorkerProfile = rpgProfileSelectElement.value;
        await saveSettings();
    };
    container.appendChild(createSettingRow('RPG State Engine Worker Profile', rpgProfileSelectElement));

    const inputRpgLorebook = document.createElement('input');
    inputRpgLorebook.type = 'text';
    inputRpgLorebook.className = 'text_display input_text';
    inputRpgLorebook.value = settings.targetStateLorebook;
    inputRpgLorebook.onchange = async () => {
        settings.targetStateLorebook = inputRpgLorebook.value.trim() || "ChapterLedger";
        await saveSettings();
    };
    container.appendChild(createSettingRow('Target State Ledger Lorebook', inputRpgLorebook));

    const rpgPromptArea = document.createElement('textarea');
    rpgPromptArea.className = 'text_display input_text';
    rpgPromptArea.style = 'width: 100%; height: 100px; font-size: 11px; resize: vertical; margin-top: 4px; font-family: monospace;';
    rpgPromptArea.value = settings.rpgSystemPrompt;
    rpgPromptArea.onchange = async () => {
        settings.rpgSystemPrompt = rpgPromptArea.value.trim();
        await saveSettings();
    };
    
    const rpgPromptWrapper = document.createElement('div');
    rpgPromptWrapper.style = 'display: flex; flex-direction: column; gap: 3px;';
    const rpgPromptLabel = document.createElement('label');
    rpgPromptLabel.style = 'font-weight: 500;';
    rpgPromptLabel.innerText = 'RPG Engine Core System Rules & Formatting Layout';
    rpgPromptWrapper.appendChild(rpgPromptLabel);
    rpgPromptWrapper.appendChild(rpgPromptArea);
    container.appendChild(rpgPromptWrapper);

    const variableEditArea = document.createElement('textarea');
    variableEditArea.className = 'text_display input_text';
    variableEditArea.style = 'width: 100%; height: 120px; font-family: monospace; font-size: 11px; resize: vertical; margin-top: 4px; white-space: pre;';
    variableEditArea.value = JSON.stringify(settings.runtimeVariables, null, 4);
    variableEditArea.onchange = async () => {
        try {
            settings.runtimeVariables = JSON.parse(variableEditArea.value);
            variableEditArea.style.border = "1px solid rgba(255,255,255,0.2)";
            await saveSettings();
        } catch (err) {
            variableEditArea.style.border = "1px solid #ef4444";
        }
    };

    const varWrapper = document.createElement('div');
    varWrapper.style = 'display: flex; flex-direction: column; gap: 3px; margin-top: 5px;';
    const varLabel = document.createElement('label');
    varLabel.style = 'font-weight: 500; color: #34d399;';
    varLabel.innerText = '⚙️ Runtime Memory Variables (Live JSON Override)';
    varWrapper.appendChild(varLabel);
    varWrapper.appendChild(variableEditArea);
    container.appendChild(varWrapper);

    getVariableEditAreaRef(variableEditArea);
}

/**
 * ----------------------------------------------------------------------------
 * SUBSYSTEM: ADVANCED INJECTION GUARDRAILS
 * ----------------------------------------------------------------------------
 */
function buildGuardrailsSection(container, settings, saveSettings) {
    const subheaderGuardrails = document.createElement('div');
    subheaderGuardrails.innerText = '🛠️ Advanced Extension Guardrails';
    subheaderGuardrails.style = 'margin: 15px 0 5px 0; font-weight: bold; color: #a78bfa; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 3px;';
    console.log("[UI]: Building Guardrails section.");
    container.appendChild(subheaderGuardrails);

    const checkFormatLock = document.createElement('input');
    checkFormatLock.type = 'checkbox';
    checkFormatLock.checked = settings.enableFormatLock;
    checkFormatLock.onchange = async () => {
        settings.enableFormatLock = checkFormatLock.checked;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Enable Ephemeral Formatting Lock', checkFormatLock));

    const checkLoreGuard = document.createElement('input');
    checkLoreGuard.type = 'checkbox';
    checkLoreGuard.checked = settings.enableLoreGuard;
    checkLoreGuard.onchange = async () => {
        settings.enableLoreGuard = checkLoreGuard.checked;
        await saveSettings();
    };
    container.appendChild(createSettingRow('Enable Lorebook Vector Deduplication', checkLoreGuard));
}

/**
 * ----------------------------------------------------------------------------
 * MAIN MODULE ORCHESTRATOR
 * ----------------------------------------------------------------------------
 */
export function initializeExtensionUI(settings, saveSettings, executeManualFlush, getAvailableProfiles, onUiUpdateNeeded, getVariableEditAreaRef) {
    const panel = document.getElementById('extensions_settings2');
    if (!panel || document.getElementById('flush-monitor-panel')) return null;

    const mainWrapper = document.createElement('div');
    mainWrapper.id = 'flush-monitor-panel';
    mainWrapper.className = 'my-extension-settings'; 

    const inlineDrawer = document.createElement('div');
    inlineDrawer.className = 'inline-drawer';

    const drawerHeader = document.createElement('div');
    drawerHeader.className = 'inline-drawer-toggle inline-drawer-header';
    
    const titleText = document.createElement('b');
    titleText.innerText = '🧠 Prefill-Cache Flush Monitor';
    
    const chevronIcon = document.createElement('div');
    chevronIcon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';
    
    drawerHeader.appendChild(titleText);
    drawerHeader.appendChild(chevronIcon);

    const drawerContent = document.createElement('div');
    drawerContent.className = 'inline-drawer-content';

    const monitorElement = document.createElement('div');
    monitorElement.style = 'padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; font-family: monospace; font-size: 11px; margin-bottom: 12px; border-left: 3px solid #22c55e;';
    drawerContent.appendChild(monitorElement);

    const flushBtn = document.createElement('button');
    flushBtn.innerText = '⚡ Execute Manual Chapter Flush Now';
    flushBtn.className = 'menu_button';
    flushBtn.style = 'width: 100%; text-align: center; background: #2563eb; font-weight: bold; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 0.5px;';
    flushBtn.onclick = executeManualFlush;
    drawerContent.appendChild(flushBtn);

    const formContainer = document.createElement('div');
    formContainer.style = 'display: flex; flex-direction: column; gap: 10px; font-size: 12px;';

    const profiles = getAvailableProfiles();

    buildCoreSlidingCacheSection(formContainer, settings, saveSettings, onUiUpdateNeeded);
    buildFlushArchivalSection(formContainer, settings, saveSettings);
    buildSummarizerSection(formContainer, settings, saveSettings, profiles);
    buildProseCleanerSection(formContainer, settings, saveSettings, profiles);
    
    buildRpgEngineSection(formContainer, settings, saveSettings, profiles, () => {
        window.dispatchEvent(new CustomEvent('flush-monitor:sidebar-config-changed'));
    }, getVariableEditAreaRef);
    
    buildGuardrailsSection(formContainer, settings, saveSettings);

    drawerContent.appendChild(formContainer);

    inlineDrawer.appendChild(drawerHeader);
    inlineDrawer.appendChild(drawerContent);
    mainWrapper.appendChild(inlineDrawer);

    panel.appendChild(mainWrapper);

    return monitorElement;
}

/**
 * Function called externally to clear and re-populate the `<select>` inputs 
 * safely without rebuilding the entire interface DOM.
 */
export function updateProfileDropdowns(profiles, settings) {
    const selects = [
        { id: 'flush_monitor_summarizer_profile', settingKey: 'selectedProfile' },
        { id: 'flush_monitor_cleaner_profile', settingKey: 'cleanerProfile' },
        { id: 'flush_monitor_rpg_profile', settingKey: 'rpgWorkerProfile' }
    ];

    selects.forEach(({ id, settingKey }) => {
        const el = document.getElementById(id);
        if (!el) return;
        
        el.innerHTML = ''; // Wipe existing options
        
        profiles.forEach(prof => {
            const opt = document.createElement('option');
            opt.value = prof.id || prof.name;
            opt.innerText = prof.name;
            
            // Re-apply the stored selected value
            if (settings[settingKey] === opt.value || settings[settingKey] === prof.name) {
                opt.selected = true;
            }
            el.appendChild(opt);
        });
    });
}