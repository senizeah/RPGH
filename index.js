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

    console.log("FlushMonitor [Lifecycle]: Initializing namespace wrapper...");

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
        console.log("FlushMonitor [Settings]: Serializing configurations...", settings);
        context.extensionSettings['flush-monitor'] = settings;
        await context.saveSettingsObj();
        renderRpgSidebar(settings, context);
    }

    function getAvailableSTProfiles() {
        try {
            const stDropdown = document.getElementById('connection_profiles');
            if (stDropdown && stDropdown.options && stDropdown.options.length > 0) {
                const profiles = [];
                for (let i = 0; i < stDropdown.options.length; i++) {
                    const option = stDropdown.options[i];
                    if (option.value) {
                        profiles.push({ id: option.value, name: option.text });
                    }
                }
                if (profiles.length > 0) return profiles;
            }
            return [{ id: 'default', name: 'Default API Endpoint' }];
        } catch (e) {
            console.error("FlushMonitor [UI Error]: Failed to fetch profiles", e);
            return [{ id: 'default', name: 'Default API Endpoint' }];
        }
    }

    function updateCount() {
        console.log("FlushMonitor [Telemetry]: updateCount() triggered.");
        if (!context.chat) {
            console.warn("FlushMonitor [Telemetry Check]: context.chat is undefined or uninstantiated.");
            return;
        }
        if (!monitorElement) {
            console.warn("FlushMonitor [Telemetry Check]: monitorElement is null (UI not appended yet).");
            return;
        }
        
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

        console.log("FlushMonitor [Telemetry]: Gathering token metrics...");
        const tokenMetrics = estimateTokens(context, settings); 
        settings.runtimeVariables = Object.assign({}, settings.runtimeVariables, tokenMetrics);

        console.log("FlushMonitor [Telemetry]: Passing off to renderRpgSidebar(). Positions Mode:", settings.rpgSidebarPosition);
        renderRpgSidebar(settings, context);
    }

    async function handlePostGeneration() {
        console.log("FlushMonitor [Pipeline]: handlePostGeneration interceptor matching processing tokens...");
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
    eventSource.on(event_types.APP_READY, () => {
        console.log("FlushMonitor [Lifecycle]: SillyTavern APP_READY captured! Injecting panel layers...");
        
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