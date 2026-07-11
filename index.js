import { initializeExtensionUI, updateProfileDropdowns } from './ui.js';
import { processProseCleanerStage, defaultCleanerSettings } from './cleaner.js';
import { processSummarizerStage, defaultSummarizerSettings } from './summarizer.js';
import { processRpgStateStage, defaultRpgSettings } from './rpgh.js';
import { renderRpgSidebar } from './rpgui.js';
import { executeFlushToLorebook } from './flush.js';
import { estimateTokens } from './token.js';
import { getContext } from '/scripts/extensions.js';

(function() {
    let isExtensionInitialized = false;
    let monitorElement = null;
    let variableTextAreaRef = null; 
    let isPipelineProcessing = false;

    function logTelemetry(msg, lvl = 'info') {
        const payload = `[Flush-Monitor:ORCHESTRATOR] [${lvl.toUpperCase()}] ${msg}`;
        if (lvl === 'error') console.error(`%c${payload}`, "color: #ef4444; font-weight: bold;");
        else if (lvl === 'warn') console.warn(`%c${payload}`, "color: #fbbf24;");
        else console.log(`%c${payload}`, "color: #10b981; font-weight: bold;"); 
    }

    function getActiveSettings(context) {
        return Object.assign(
            {}, 
            defaultCleanerSettings, 
            defaultSummarizerSettings, 
            defaultRpgSettings, 
            context?.extensionSettings?.['flush-monitor'] || {}
        );
    }

    async function forceTriggerPipeline(sourceName = "Event Bus Trigger") {
        if (isPipelineProcessing) return;
        const activeContext = window.SillyTavern?.getContext();
        const chat = activeContext?.chat;
        if (!chat || !chat.length) return;

        const targetIndex = chat.length - 1;
        const lastMsg = chat[targetIndex];
        const currentSettings = getActiveSettings(activeContext);

        if (!lastMsg || lastMsg.is_user || lastMsg.system || lastMsg.name === "SillyTavern System") return;

        try {
            isPipelineProcessing = true;
            if (!lastMsg.extra?.is_cleaned) {
                try {
                    await processProseCleanerStage(chat, lastMsg, currentSettings, (t) => estimateTokens(t, currentSettings), activeContext);
                    await processSummarizerStage(chat, currentSettings, (t) => estimateTokens(t, currentSettings), () => executeFlushToLorebook(currentSettings, updateCount, activeContext), updateCount, activeContext);
                } catch (proseError) {
                    logTelemetry(`Prose/Summary sub-stage failed: ${proseError.message}`, 'error');
                }
            }
            try {
                if (activeContext && typeof activeContext.characters !== 'undefined') {
                    await processRpgStateStage(chat, currentSettings, activeContext);
                }
            } catch (rpgError) {
                logTelemetry(`RPG Subsystem sync failed: ${rpgError.message}`, 'error');
            }
            updateCount();
        } catch (globalPipelineError) {
            logTelemetry(`Critical Pipeline Exception: ${globalPipelineError.message}`, 'error');
        } finally {
            isPipelineProcessing = false;
        }
    }

    function updateCount() {
        const context = window.SillyTavern?.getContext();
        if (!context?.chat || !monitorElement) return;
        const currentSettings = getActiveSettings(context);
        const totalMessages = context.chat.length;
        const summarizedCount = context.chat.filter(m => m.extra?.is_summarized).length;
        
        monitorElement.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">Cache Pool Status</div>
            <div>Active Pool: <b>${totalMessages}</b> / ${currentSettings.autoFlushThreshold || 0}</div>
            <div>Summarized: ${summarizedCount}</div>
        `;
        
        if (variableTextAreaRef) variableTextAreaRef.value = JSON.stringify(currentSettings.runtimeVariables, null, 4);
        renderRpgSidebar(currentSettings, context);
    }

    // ========================================================================
    // STATE MACHINE: INITIALIZATION & DATA FETCHING
    // ========================================================================

    function saveSettings() {
        try {
            if (typeof window.saveSettingsDebounced === 'function') {
                window.saveSettingsDebounced();
            }
            const context = window.SillyTavern?.getContext();
            if (context) renderRpgSidebar(context.extensionSettings['flush-monitor'], context);
            updateCount();
        } catch (err) {
            console.error("SETTINGS WRITE FAULT:", err);
        }
    }

    function executeLevel2Fetch(settings) {
        const rawProfiles = window.settings?.profiles || [];
        
        // Track the current selected profiles from the UI settings
        const activeProfileIds = [
            settings.selectedProfile,   // Summarizer Profile
            settings.cleanerProfile,    // Cleaner Profile
            settings.rpgWorkerProfile   // RPG Profile
        ];

        // Deduplicate and filter out empty values
        const uniqueProfiles = [...new Set(activeProfileIds)].filter(id => id);

        uniqueProfiles.forEach(profileId => {
            console.log(`[UI Profile]: Beginning level 2 fetch for ${profileId}.`);
            try {
                const profileData = rawProfiles.find(p => (p.id === profileId || p.name === profileId));
                if (profileData) {
                    console.log(`[UI Profile]: Level 2 fetch for ${profileId} complete.`);
                    // NOTE: Data injection for rpgh, cleaner, and summarizer will occur here in the future.
                } else {
                    console.log(`[UI Profile]: Level 2 fetch for ${profileId} failed.`);
                }
            } catch (err) {
                console.log(`[UI Profile]: Level 2 fetch for ${profileId} failed.`);
            }
        });
    }

async function startLevel1Sequence(context) {
    let attempts = 0;
    const maxAttempts = 50;
    const delayMs = 200;

    // Standardized profile layout formatter
    const formatProfiles = (profilesArray) => {
        const safeArray = (Array.isArray(profilesArray) && profilesArray.length > 0)
            ? profilesArray
            : [{ id: 'default', name: 'Default Profile' }];
            
        return safeArray.map(p => ({
            id: p.id || p.name || 'default',
            name: p.name || p.id || 'Default Profile'
        }));
    };

    async function pollForProfiles() {
        attempts++;
        console.log(`[UI Profile]: Beginning level 1 fetch (Attempt ${attempts}/${maxAttempts}).`);

        try {
            let rawProfiles = null;

            // 1. Pull the live execution environment context safely from SillyTavern
            const stContext = getContext();
            
            // 2. Query actual connection profile presets via the Connection Manager Module
            if (stContext?.ConnectionManagerRequestService) {
                const service = stContext.ConnectionManagerRequestService;
                rawProfiles = typeof service.getProfiles === 'function' 
                    ? await service.getProfiles() 
                    : (service.profiles || service.connectionProfiles);
            }

            // 3. Resilient Secondary Fallback: Query SillyTavern's primary configuration block
            // This safely bypasses uninitialized frontend UI service variables completely!
            if (!rawProfiles || !Array.isArray(rawProfiles) || rawProfiles.length === 0) {
                try {
                    const apiResponse = await fetch('/api/settings/get', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    });
                    
                    if (apiResponse.ok) {
                        const data = await apiResponse.json();
                        // Connection profiles sit inside the 'connection_profiles' parameter in user config schemas
                        if (data && data.connection_profiles) {
                            rawProfiles = data.connection_profiles;
                        }
                    }
                } catch (apiErr) {
                    console.log("[UI Profile]: API fallback fetch failed.");
                }
            }

            // Success or failure execution threshold
            if ((rawProfiles && rawProfiles.length > 0) || attempts >= maxAttempts) {
                
                if (!rawProfiles || !Array.isArray(rawProfiles) || rawProfiles.length === 0) {
                    console.log("[UI Profile]: Level 1 fetch failed. Profiles could not be resolved.");
                    console.log("[UI Profile]: Level 1 fetch failed. Reverting to default profile layout.");
                    rawProfiles = [{ id: 'default', name: 'Default Profile' }];
                }

                // Prepare extension configuration state space
                if (!context.extensionSettings['flush-monitor']) {
                    context.extensionSettings['flush-monitor'] = {};
                }
                
                const settings = Object.assign(
                    {},
                    defaultCleanerSettings,
                    defaultSummarizerSettings,
                    defaultRpgSettings,
                    context.extensionSettings['flush-monitor']
                );
                context.extensionSettings['flush-monitor'] = settings;

                // Reactive closure parsing layout wrapper utilizing the dedicated profile sources
                const getAvailableProfiles = () => {
                    const dynamicContext = getContext();
                    const dynamicService = dynamicContext?.ConnectionManagerRequestService;
                    const liveProfiles = dynamicService?.profiles || dynamicService?.connectionProfiles || rawProfiles;
                    return formatProfiles(liveProfiles);
                };

                // CRITICAL FIX: Expose rawProfiles into your execution pipeline 
                // so your Level 2 features can map configurations between 5000 and 5001.
                context.allProfilesRepository = rawProfiles;

                monitorElement = initializeExtensionUI(
                    settings, 
                    saveSettings, 
                    () => executeFlushToLorebook(settings, updateCount, context), 
                    getAvailableProfiles, 
                    updateCount, 
                    (el) => { variableTextAreaRef = el; }
                );
                
                console.log("[UI Profile]: Level 1 fetch complete.");
                console.log("[UI Profile]: Beginning level 1 settings update.");
                
                try {
                    saveSettings();
                    console.log("[UI Profile]: Level 1 settings update complete.");
                } catch (err) {
                    console.log("[UI Profile]: Level 1 settings update failed.");
                }

                const eventSource = window.SillyTavern?.eventSource || context?.eventSource;
                if (eventSource) {
                    eventSource.on('character_message_rendered', () => forceTriggerPipeline("EventBus:CHARACTER_MESSAGE_RENDERED"));
                    eventSource.on('chat_changed', updateCount);
                    eventSource.on('message_sent', updateCount);
                    
                    eventSource.on('settings_updated', async () => {
                        updateCount();
                        
                        // Dynamically refresh profiles from memory or fallback api during settings events
                        let freshRawProfiles = null;
                        const updateContext = getContext();
                        if (updateContext?.ConnectionManagerRequestService) {
                            const upService = updateContext.ConnectionManagerRequestService;
                            freshRawProfiles = upService.profiles || upService.connectionProfiles;
                        }
                        
                        if (!freshRawProfiles) {
                            try {
                                const res = await fetch('/api/settings/get', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({})
                                });
                                if (res.ok) {
                                    const d = await res.json();
                                    freshRawProfiles = d?.connection_profiles;
                                }
                            } catch (e) {}
                        }

                        // Maintain persistent tracking reference inside active context engine
                        if (freshRawProfiles && freshRawProfiles.length > 0) {
                            context.allProfilesRepository = freshRawProfiles;
                        }

                        const freshProfilesList = formatProfiles(freshRawProfiles);
                        updateProfileDropdowns(freshProfilesList, context.extensionSettings['flush-monitor']);
                        executeLevel2Fetch(context.extensionSettings['flush-monitor']);
                    });
                }
                
                executeLevel2Fetch(settings);
                isExtensionInitialized = true;
                updateCount();
                logTelemetry("Unified Extension Module Online.", "info");
                return;
            }

        } catch (err) {
            console.error("[UI Profile]: Error processing profile initialization pass:", err);
        }

        // Defer next polling check sequentially
        setTimeout(pollForProfiles, delayMs);
    }

    pollForProfiles();
}
  
  
  
  // Master Bootloader
    const bootInterval = setInterval(() => {
        const context = window.SillyTavern?.getContext();
        if (context && context.extensionSettings) {
            clearInterval(bootInterval);
            startLevel1Sequence(context);
        }
    }, 200);

})();