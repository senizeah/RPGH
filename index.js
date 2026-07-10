import { initializeExtensionUI } from './ui.js';
import { processProseCleanerStage, defaultCleanerSettings } from './cleaner.js';
import { processSummarizerStage, defaultSummarizerSettings } from './summarizer.js';
import { processRpgStateStage, defaultRpgSettings } from './rpgh.js';
import { renderRpgSidebar } from './rpgui.js';
import { executeFlushToLorebook } from './flush.js';
import { injectFormattingLock } from './lock.js';
import { estimateTokens } from './token.js';
import { eventSource, event_types } from '../../../../script.js';

(function() {
    const context = SillyTavern.getContext();
    let monitorElement = null;
    let variableTextAreaRef = null; 

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

    async function saveSettings() {
        context.extensionSettings['flush-monitor'] = settings;
        await context.saveSettingsObj();
        renderRpgSidebar(settings, context);
    }

    function getAvailableSTProfiles() {
        try {
            // 1. Check the primary runtime settings location
            let apiProfiles = window.settings?.connection_profiles 
                        || window.SillyTavern?.settings?.connection_profiles;

            // 2. If that fails, look into the specific API/Presets storage state
            if (!apiProfiles && window.api_profiles) {
                apiProfiles = window.api_profiles;
            }

            // Fallback if empty or unresolved
            if (!apiProfiles || apiProfiles.length === 0) {
                return [{ id: 'default', name: 'Default API Endpoint' }];
            }

            // Map profiles out safely
            return apiProfiles.map(p => ({ 
                id: p.id || p.name || 'default', 
                name: p.name || 'Unnamed Profile' 
            }));
        } catch (e) {
            console.error("FlushMonitor: Failed to fetch API profiles from ST context", e);
            return [{ id: 'default', name: 'Default API Endpoint' }];
        }
    }

    function updateCount() {
        if (!context.chat || !monitorElement) return;
        
        const totalMessages = context.chat.length;
        const summarizedCount = context.chat.filter(m => m.extra && m.extra.is_summarized).length;
        const unsummarizedCount = totalMessages - summarizedCount;

        let statusColor = "#22c55e"; 
        if (totalMessages >= settings.autoFlushThreshold) {
            statusColor = "#ef4444"; 
        } else if (totalMessages >= (settings.autoFlushThreshold - settings.warningThreshold)) {
            statusColor = "#fbbf24"; 
        }
        
        monitorElement.innerHTML = `
            <div style="color: ${statusColor}; font-weight: bold; margin-bottom: 5px;">Cache Pool Status</div>
            <div>Active Pool: <b>${totalMessages}</b> / ${settings.autoFlushThreshold}</div>
            <div>Summarized: ${summarizedCount} | Floating Raw: ${unsummarizedCount}</div>
        `;

        if (variableTextAreaRef && document.activeElement !== variableTextAreaRef) {
            variableTextAreaRef.value = JSON.stringify(settings.runtimeVariables, null, 4);
        }

        const tokenMetrics = estimateTokens(context, settings); // Assuming this returns the object based on your imports
        settings.runtimeVariables = Object.assign({}, settings.runtimeVariables, tokenMetrics);

        renderRpgSidebar(settings, context);
    }

    async function handlePostGeneration() {
        const chat = context.chat;
        if (!chat || chat.length === 0) return;

        const immediateLastMsg = chat[chat.length - 1];
        
         if (immediateLastMsg && !immediateLastMsg.is_user && immediateLastMsg.mes && !immediateLastMsg.extra?.is_cleaned) {
             await processProseCleanerStage(chat, immediateLastMsg, settings, (t) => estimateTokens(t, settings), context);
         }
 
         await processSummarizerStage(
             chat, 
             settings, 
             (t) => estimateTokens(t, settings), 
             () => executeFlushToLorebook(settings, updateCount, context), 
             updateCount, 
             context
         );

        await processRpgStateStage(chat, settings, context, updateCount);
        updateCount();
    }

    // --- MAIN INITIALIZATION ORCHESTRATION ---
    
    // FIX 1: Use native eventSource instead of jQuery on document
    eventSource.on(event_types.APP_READY, () => {
        monitorElement = initializeExtensionUI(
            settings, 
            saveSettings, 
            () => executeFlushToLorebook(settings, updateCount, context), 
            getAvailableSTProfiles,
            updateCount, 
            (el) => { variableTextAreaRef = el; } 
        );

        SillyTavern.registerInterceptor(async (chat, ctxSize, abort, type) => {
            if (settings.enableFormatLock) {
                try {
                    await injectFormattingLock(chat, type);
                } catch (e) {
                    console.error("FlushMonitor [Interceptor Error]: Formatting lock failed", e);
                }
            }

            const lastMsg = chat[chat.length - 1];
            if (lastMsg && lastMsg.is_user && !lastMsg.is_system) {
                try {
                    console.log("FlushMonitor Interceptor: Recalculating state engine for user turn before generation...");
                    await processRpgStateStage(chat, settings, context, updateCount);
                } catch (e) {
                    console.error("FlushMonitor [Interceptor Error]: Pre-flight RPG calculation failed", e);
                } finally {
                    updateCount();
                }
            }
        });

        eventSource.on(event_types.MESSAGE_RECEIVED, handlePostGeneration);
        jQuery(document).on('SillyTavern.CHAT_CHANGED SillyTavern.MESSAGE_SENT', updateCount);
        window.addEventListener('flush-monitor:sidebar-config-changed', updateCount);
        
        updateCount();
    });

})();