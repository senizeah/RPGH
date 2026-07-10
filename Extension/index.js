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
    let variableTextAreaRef = null; // Holds the live reference to the JSON text area in ui.js

    // Ensure extension settings namespace exists
    if (!context.extensionSettings['flush-monitor']) {
        context.extensionSettings['flush-monitor'] = {};
    }
    
    // Merge baseline module defaults with user configurations stored in SillyTavern
    const settings = Object.assign(
        {}, 
        defaultCleanerSettings, 
        defaultSummarizerSettings, 
        defaultRpgSettings, 
        context.extensionSettings['flush-monitor']
    );

    /**
     * Serializes runtime settings state back to SillyTavern's global storage.
     */
    async function saveSettings() {
        context.extensionSettings['flush-monitor'] = settings;
        await context.saveSettingsObj();
        renderRpgSidebar(settings, context);
    }

    /**
     * Maps available SillyTavern API profiles for dropdown consumption.
     */
    function getAvailableSTProfiles() {
        try {
            const apiProfiles = window.SillyTavern?.settings?.connection_profiles || [];
            if (apiProfiles.length === 0) return [{ id: 'default', name: 'Default API Endpoint' }];
            return apiProfiles.map(p => ({ id: p.id || p.name, name: p.name }));
        } catch (e) {
            return [{ id: 'default', name: 'Default API Endpoint' }];
        }
    }

    /**
     * Updates the status banner metrics and syncs runtime variable text boxes.
     */
    function updateCount() {
        if (!context.chat || !monitorElement) return;
        
        const totalMessages = context.chat.length;
        const summarizedCount = context.chat.filter(m => m.extra && m.extra.is_summarized).length;
        const unsummarizedCount = totalMessages - summarizedCount;

        // Dynamic status boundary color shifts
        let statusColor = "#22c55e"; // Green
        if (totalMessages >= settings.autoFlushThreshold) {
            statusColor = "#ef4444"; // Red
        } else if (totalMessages >= (settings.autoFlushThreshold - settings.warningThreshold)) {
            statusColor = "#fbbf24"; // Yellow
        }
        
        // Push raw string segments directly into the UI hook provided by ui.js
        monitorElement.innerHTML = `
            <div style="color: ${statusColor}; font-weight: bold; margin-bottom: 5px;">Cache Pool Status</div>
            <div>Active Pool: <b>${totalMessages}</b> / ${settings.autoFlushThreshold}</div>
            <div>Summarized: ${summarizedCount} | Floating Raw: ${unsummarizedCount}</div>
        `;

        // If the state engine updated variables on the background, make sure the text area matches
        if (variableTextAreaRef && document.activeElement !== variableTextAreaRef) {
            variableTextAreaRef.value = JSON.stringify(settings.runtimeVariables, null, 4);
        }

        // Update token metrics in runtime variables before rendering sidebar
        const tokenMetrics = calculateTokenMetrics(context, settings);
        settings.runtimeVariables = Object.assign({}, settings.runtimeVariables, tokenMetrics);

        renderRpgSidebar(settings, context);
    }

    /**
     * Main Post-Generation Lifecycle Execution Flow.
     * Sequences text cleaning, historical text chunk summarization, and state engines sequentially.
     */
    async function handlePostGeneration() {
        const chat = context.chat;
        if (!chat || chat.length === 0) return;

        const immediateLastMsg = chat[chat.length - 1];
        
         // 1. Run Prose Cleaner Module if text originates from the AI character
         if (immediateLastMsg && !immediateLastMsg.is_user && immediateLastMsg.mes && !immediateLastMsg.extra?.is_cleaned) {
             await processProseCleanerStage(chat, immediateLastMsg, settings, (t) => estimateTokens(t, settings), context);
         }
 
         // 2. Run Main Summarization Module
         await processSummarizerStage(
             chat, 
             settings, 
             (t) => estimateTokens(t, settings), 
             () => executeFlushToLorebook(settings, updateCount, context), 
             updateCount, 
             context
         );

        // 3. Run Automated RPG Engine Module
        await processRpgStateStage(chat, settings, context, updateCount);
        
        // Refresh views
        updateCount();
    }

    // --- MAIN INITIALIZATION ORCHESTRATION ---
    jQuery(document).on('SillyTavern.APP_READY', () => {
        // Mount presentation layer views and extract tracking hooks
        monitorElement = initializeExtensionUI(
            settings, 
            saveSettings, 
            () => executeFlushToLorebook(settings, updateCount, context), 
            getAvailableSTProfiles,
            updateCount, // Passed as 'onUiUpdateNeeded' callback to refresh state if thresholds edit
            (el) => { variableTextAreaRef = el; } // Receives the input node pointer from ui.js
        );

    // Register low-level prompt interceptors for raw injection guardrails
    SillyTavern.registerInterceptor(async (chat, ctxSize, abort, type) => {
        // 1. Apply formatting lock
        if (settings.enableFormatLock) {
            try {
                await injectFormattingLock(chat, type);
            } catch (e) {
                console.error("FlushMonitor [Interceptor Error]: Formatting lock failed", e);
            }
        }

        // 2. Apply RPG State update for incoming User Message
        const lastMsg = chat[chat.length - 1];
        if (lastMsg && lastMsg.is_user && !lastMsg.is_system) {
            try {
                console.log("FlushMonitor Interceptor: Recalculating state engine for user turn before generation...");
                await processRpgStateStage(chat, settings, context, updateCount);
            } catch (e) {
                console.error("FlushMonitor [Interceptor Error]: Pre-flight RPG calculation failed", e);
            } finally {
                // Ensure UI reflects whatever changes occurred, even on partial failures
                updateCount();
            }
        }
    });

        // Event Hook Bindings
        eventSource.on(event_types.MESSAGE_RECEIVED, handlePostGeneration);
        jQuery(document).on('SillyTavern.CHAT_CHANGED SillyTavern.MESSAGE_SENT', updateCount);
        window.addEventListener('flush-monitor:sidebar-config-changed', updateCount);
        
        // Run an initial telemetry refresh
        updateCount();
    });

})();