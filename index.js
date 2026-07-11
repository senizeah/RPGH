import { initializeExtensionUI } from './ui.js';
import { processProseCleanerStage, defaultCleanerSettings } from './cleaner.js';
import { processSummarizerStage, defaultSummarizerSettings } from './summarizer.js';
import { processRpgStateStage, defaultRpgSettings } from './rpgh.js';
import { renderRpgSidebar } from './rpgui.js';
import { executeFlushToLorebook } from './flush.js';
import { estimateTokens } from './token.js';

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
        if (isPipelineProcessing) {
            logTelemetry(`Pipeline bounced via [${sourceName}]: Processing lock is active.`, "debug");
            return;
        }

        const activeContext = window.SillyTavern?.getContext();
        const chat = activeContext?.chat;
        if (!chat || !chat.length) return;

        const targetIndex = chat.length - 1;
        const lastMsg = chat[targetIndex];
        const currentSettings = getActiveSettings(activeContext);

        if (!lastMsg || lastMsg.is_user || lastMsg.system || lastMsg.name === "SillyTavern System") {
            return;
        }

        try {
            isPipelineProcessing = true;
            logTelemetry(`🚨 PIPELINE PROCESSING RUNNING ON INDEX [${targetIndex}] via [${sourceName}]`, 'info');

            // 1. Prose Cleaner & Summarizer Stage
            if (!lastMsg.extra?.is_cleaned) {
                try {
                    logTelemetry(`🔥 Executing Cleaner & Summarizer Modules...`, "info");
                    await processProseCleanerStage(chat, lastMsg, currentSettings, (t) => estimateTokens(t, currentSettings), activeContext);
                    await processSummarizerStage(chat, currentSettings, (t) => estimateTokens(t, currentSettings), () => executeFlushToLorebook(currentSettings, updateCount, activeContext), updateCount, activeContext);
                } catch (proseError) {
                    logTelemetry(`Prose/Summary sub-stage failed: ${proseError.message}`, 'error');
                }
            }

            // 2. RPG Subsystem Stage (Always fires after cleaning is resolved)
            try {
                if (activeContext && typeof activeContext.characters !== 'undefined') {
                    logTelemetry(`🎲 Processing RPG state calculation sequence...`, "info");
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
            logTelemetry(`Pipeline processing lock released.`, "debug");
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

    function runInitialization() {
        if (isExtensionInitialized) return;
        
        const context = window.SillyTavern?.getContext();
        if (!context || !context.extensionSettings) return;

        isExtensionInitialized = true;
        logTelemetry("Initializing Unified Extension Core for SillyTavern 1.18.0...", "info");

        if (!context.extensionSettings['flush-monitor']) {
            context.extensionSettings['flush-monitor'] = {};
        }
        
        context.extensionSettings['flush-monitor'] = Object.assign(
            {},
            defaultCleanerSettings,
            defaultSummarizerSettings,
            defaultRpgSettings,
            context.extensionSettings['flush-monitor']
        );
        
        async function saveSettings() {
            try {
                await context.saveSettingsObj();
                renderRpgSidebar(context.extensionSettings['flush-monitor'], context);
                updateCount();
            } catch (err) {
                console.error("SETTINGS WRITE FAULT:", err);
            }
        }
// Access the profiles directly from the global settings object
const getAvailableProfiles = () => {
    return window.settings?.connectionManager?.profiles || [{ id: 'default', name: 'Default Profile' }];
};

// Pass this function to your UI builder
let uiControls = initializeExtensionUI(
    context.extensionSettings['flush-monitor'], 
    saveSettings, 
    // ... other arguments
    getAvailableProfiles, 
    updateCount, 
    (el) => { variableTextAreaRef = el; }
);

        monitorElement = uiControls.monitorElement;
        
        // NATIVE 1.18.0 LIFE-CYCLE EVENTS: Replaces DOM Mutation and Network Observers completely
        const eventSource = window.SillyTavern?.eventSource || context?.eventSource;
        if (eventSource) {
            eventSource.on('character_message_rendered', () => {
                forceTriggerPipeline("EventBus:CHARACTER_MESSAGE_RENDERED");
            });
            eventSource.on('chat_changed', updateCount);
            eventSource.on('message_sent', updateCount);
            eventSource.on('settings_updated', () => {
                logTelemetry("Settings updated event received. Updating UI profile dropdowns.", "debug");
                uiControls.updateProfileDropdowns();
            });
        }
        
        updateCount();
        logTelemetry("Unified Extension Module Online.", "info");
    }

    const bootInterval = setInterval(() => {
        if (window.SillyTavern?.getContext()?.extensionSettings) {
            runInitialization();
            clearInterval(bootInterval);
        }
    }, 200);
})();