(function () {
    const baseModuleURL = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    
    let isExtensionInitialized = false;
    let isPipelineProcessing = false;
    let cycleAttempts = 0;
    const maxLifecycleRetries = 50;

    let monitorElement = null;
    let variableTextAreaRef = null;
    let internalProfilesRepository = [];

    // Helper to log clearly tagged telemetry
    function logTelemetry(tag, msg, lvl = 'info') {
        const payload = `[RPGH-Orchestrator:${tag.toUpperCase()}] [${lvl.toUpperCase()}] ${msg}`;
        if (lvl === 'error') console.error(`%c${payload}`, "color: #ef4444; font-weight: bold;");
        else if (lvl === 'warn') console.warn(`%c${payload}`, "color: #fbbf24;");
        else console.log(`%c${payload}`, "color: #10b981; font-weight: bold;");
    }

    // Load modules dynamically to match the proper example patterns
    async function loadExtensionModules() {
        try {
            const [ui, cleaner, summarizer, rpgh, rpgui, flush, token, extensions] = await Promise.all([
                import(`${baseModuleURL}/ui.js`),
                import(`${baseModuleURL}/cleaner.js`),
                import(`${baseModuleURL}/summarizer.js`),
                import(`${baseModuleURL}/rpgh.js`),
                import(`${baseModuleURL}/rpgui.js`),
                import(`${baseModuleURL}/flush.js`),
                import(`${baseModuleURL}/token.js`),
                import(`/scripts/extensions.js`)
            ]);

            return { ui, cleaner, summarizer, rpgh, rpgui, flush, token, extensions };
        } catch (err) {
            logTelemetry('loader', `Failed to dynamically import modules: ${err.message}`, 'error');
            throw err;
        }
    }

    // Helper to retrieve active settings with default fallbacks
    function getActiveSettings(context, cleaner, summarizer, rpgh) {
        return Object.assign(
            {},
            cleaner.defaultCleanerSettings,
            summarizer.defaultSummarizerSettings,
            rpgh.defaultRpgSettings,
            context?.extensionSettings?.['flush-monitor'] || {}
        );
    }

    // Centralised execution pipeline
    async function executeExtensionPipeline(sourceName) {
        if (isPipelineProcessing) {
            logTelemetry('pipeline', 'Pipeline execution bypassed: already processing.', 'warn');
            return;
        }

        const modules = await loadExtensionModules();
        const activeContext = window.SillyTavern?.getContext();
        const chat = activeContext?.chat;

        if (!chat || !chat.length) {
            logTelemetry('pipeline', 'Halted. Chat history is empty.', 'warn');
            return;
        }

        const lastMsg = chat[chat.length - 1];
        if (!lastMsg || lastMsg.is_user || lastMsg.system || lastMsg.name === "SillyTavern System") {
            return; // Only process AI generated non-system messages
        }

        const currentSettings = getActiveSettings(activeContext, modules.cleaner, modules.summarizer, modules.rpgh);

        try {
            isPipelineProcessing = true;
            logTelemetry('pipeline', `Triggered by ${sourceName}. Starting sequential stages...`);

            // Stage 1: Prose Cleaner
            if (!lastMsg.extra?.is_cleaned) {
                try {
                    logTelemetry('ProseCleaner', `Dispatching to cleaner stage for author: ${lastMsg.name}`);
                    await modules.cleaner.processProseCleanerStage(
                        chat,
                        lastMsg,
                        currentSettings,
                        (text) => modules.token.estimateTokens(text, currentSettings),
                        activeContext
                    );
                } catch (cleanerErr) {
                    logTelemetry('ProseCleaner', `Stage failed: ${cleanerErr.message}`, 'error');
                }
            }

            // Stage 2: Summarizer
            try {
                logTelemetry('Summarizer', `Dispatching to summarizer stage...`);
                await modules.summarizer.processSummarizerStage(
                    chat,
                    currentSettings,
                    (text) => modules.token.estimateTokens(text, currentSettings),
                    () => modules.flush.executeFlushToLorebook(currentSettings, () => updateCount(modules), activeContext),
                    () => updateCount(modules),
                    activeContext
                );
            } catch (summarizerErr) {
                logTelemetry('Summarizer', `Stage failed: ${summarizerErr.message}`, 'error');
            }

            // Stage 3: RPG Engine Status Updates
            try {
                if (activeContext && typeof activeContext.characters !== 'undefined') {
                    logTelemetry('RPGHelper', `Dispatching turn to RPG state calculations...`);
                    await modules.rpgh.processRpgStateStage(chat, currentSettings, activeContext);
                }
            } catch (rpgErr) {
                logTelemetry('RPGHelper', `Stage failed: ${rpgErr.message}`, 'error');
            }

            updateCount(modules);
            logTelemetry('pipeline', 'All pipeline execution stages completed successfully.', 'info');
        } catch (globalErr) {
            logTelemetry('pipeline', `Critical global execution failure: ${globalErr.message}`, 'error');
        } finally {
            isPipelineProcessing = false;
        }
    }

    // Refresh UI display counts and variable textareas
    function updateCount(modules) {
        const context = window.SillyTavern?.getContext();
        if (!context?.chat || !monitorElement) return;

        const currentSettings = getActiveSettings(context, modules.cleaner, modules.summarizer, modules.rpgh);
        const totalMessages = context.chat.length;
        const summarizedCount = context.chat.filter(m => m.extra?.is_summarized).length;

        monitorElement.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">Cache Pool Status</div>
            <div>Active Pool: <b>${totalMessages}</b> / ${currentSettings.autoFlushThreshold || 0}</div>
            <div>Summarized: ${summarizedCount}</div>
        `;

        if (variableTextAreaRef) {
            variableTextAreaRef.value = JSON.stringify(currentSettings.runtimeVariables, null, 4);
        }

        modules.rpgui.renderRpgSidebar(currentSettings, context);
    }

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

    // Level 2 updates: handles logging and validation of profile mappings
    function executeLevel2Fetch(settings) {
        logTelemetry('ProfileManager', 'Beginning level 2 connection profile validation check...');
        const uniqueProfiles = [...new Set([
            settings.selectedProfile,
            settings.cleanerProfile,
            settings.rpgWorkerProfile
        ])].filter(id => id);

        uniqueProfiles.forEach(profileId => {
            const profileData = internalProfilesRepository.find(p => p.id === profileId || p.name === profileId);
            if (profileData) {
                logTelemetry('ProfileManager', `Level 2 check: "${profileId}" mapped successfully to endpoint "${profileData.name}".`);
            } else {
                logTelemetry('ProfileManager', `Level 2 check: "${profileId}" could not be resolved in repository.`, 'warn');
            }
        });
    }

    // Saves extension settings to SillyTavern's persistent configuration store
    async function saveSettings(modules) {
        try {
            if (typeof window.saveSettingsDebounced === 'function') {
                window.saveSettingsDebounced();
            }
            const context = window.SillyTavern?.getContext();
            if (context) {
                modules.rpgui.renderRpgSidebar(context.extensionSettings['flush-monitor'], context);
            }
            updateCount(modules);
        } catch (err) {
            logTelemetry('ProfileManager', `Failed to write persistent settings: ${err.message}`, 'error');
        }
    }

    // Sequence polling checking for SillyTavern profile list arrays
    async function sequenceProfileScanning() {
        cycleAttempts++;
        logTelemetry('ProfileManager', `Polling connection profiles from memory (${cycleAttempts}/${maxLifecycleRetries})...`);

        try {
            const modules = await loadExtensionModules();
            const stContext = modules.extensions.getContext() || window.SillyTavern?.getContext();

            if (stContext) {
                let rawProfiles = null;

                // 1. Resolve via connection manager settings profiles (as per Example-index.js)
                if (stContext.extensionSettings?.connectionManager?.profiles) {
                    rawProfiles = stContext.extensionSettings.connectionManager.profiles;
                }

                // 2. Resolve via connection manager request service
                if ((!rawProfiles || !Array.isArray(rawProfiles) || rawProfiles.length === 0) && stContext.ConnectionManagerRequestService) {
                    const service = stContext.ConnectionManagerRequestService;
                    rawProfiles = typeof service.getProfiles === 'function'
                        ? await service.getProfiles()
                        : (service.profiles || service.connectionProfiles);
                }

                // 3. Resolve via api settings fallback using requestSecure
                if (!rawProfiles || !Array.isArray(rawProfiles) || rawProfiles.length === 0) {
                    try {
                        const requestSecure = window.SillyTavern?.requestSecure || stContext?.requestSecure;
                        if (typeof requestSecure === 'function') {
                            const data = await requestSecure('/api/settings/get', {});
                            if (data && data.connection_profiles) {
                                rawProfiles = data.connection_profiles;
                            }
                        }
                    } catch (apiErr) {
                        logTelemetry('ProfileManager', `Settings fallback fetch failed: ${apiErr.message}`, 'warn');
                    }
                }

                // If profiles have been acquired, initialize the UI layer
                if ((rawProfiles && rawProfiles.length > 0) || cycleAttempts >= maxLifecycleRetries) {
                    if (!rawProfiles || !Array.isArray(rawProfiles) || rawProfiles.length === 0) {
                        logTelemetry('ProfileManager', 'Failed to resolve connection profiles. Defaulting layout.', 'warn');
                        rawProfiles = [{ id: 'default', name: 'Default Profile' }];
                    }

                    internalProfilesRepository = rawProfiles;
                    stContext.allProfilesRepository = rawProfiles; // Maintain reference inside the active context

                    // Establish settings tree space
                    if (!stContext.extensionSettings['flush-monitor']) {
                        stContext.extensionSettings['flush-monitor'] = {};
                    }

                    const settings = Object.assign(
                        {},
                        modules.cleaner.defaultCleanerSettings,
                        modules.summarizer.defaultSummarizerSettings,
                        modules.rpgh.defaultRpgSettings,
                        stContext.extensionSettings['flush-monitor']
                    );
                    stContext.extensionSettings['flush-monitor'] = settings;

                    const getAvailableProfiles = () => {
                        const liveContext = window.SillyTavern?.getContext();
                        const liveService = liveContext?.ConnectionManagerRequestService;
                        const liveProfiles = liveService?.profiles || liveService?.connectionProfiles || internalProfilesRepository;
                        return formatProfiles(liveProfiles);
                    };

                    const targetParentPanel = document.getElementById('extensions_settings');
                    if (!targetParentPanel) {
                        logTelemetry('loader', 'Parent container #extensions_settings missing.', 'error');
                        return;
                    }

                    monitorElement = modules.ui.initializeExtensionUI(
                        settings,
                        () => saveSettings(modules),
                        () => modules.flush.executeFlushToLorebook(settings, () => updateCount(modules), stContext),
                        getAvailableProfiles,
                        () => updateCount(modules),
                        (el) => { variableTextAreaRef = el; }
                    );

                    logTelemetry('ProfileManager', `Success! Repository loaded with ${internalProfilesRepository.length} profiles.`);
                    await saveSettings(modules);

                    // Setup system event routing
                    const eventSource = window.SillyTavern?.eventSource || stContext?.eventSource;
                    if (eventSource) {
                        eventSource.on('character_message_rendered', () => executeExtensionPipeline('EventBus:CHARACTER_MESSAGE_RENDERED'));
                        eventSource.on('chat_changed', () => updateCount(modules));
                        eventSource.on('message_sent', () => updateCount(modules));

                        eventSource.on('settings_updated', async () => {
                            updateCount(modules);

                            let freshProfiles = null;
                            const updateContext = window.SillyTavern?.getContext();
                            if (updateContext?.ConnectionManagerRequestService) {
                                const upService = updateContext.ConnectionManagerRequestService;
                                freshProfiles = upService.profiles || upService.connectionProfiles;
                            }

                            if (!freshProfiles) {
                                try {
                                    const requestSecure = window.SillyTavern?.requestSecure || updateContext?.requestSecure;
                                    if (typeof requestSecure === 'function') {
                                        const d = await requestSecure('/api/settings/get', {});
                                        if (d && d.connection_profiles) {
                                            freshProfiles = d.connection_profiles;
                                        }
                                    }
                                } catch (e) {}
                            }

                            if (freshProfiles && freshProfiles.length > 0) {
                                internalProfilesRepository = freshProfiles;
                                updateContext.allProfilesRepository = freshProfiles;
                            }

                            const freshProfilesList = formatProfiles(internalProfilesRepository);
                            modules.ui.updateProfileDropdowns(freshProfilesList, updateContext.extensionSettings['flush-monitor']);
                            executeLevel2Fetch(updateContext.extensionSettings['flush-monitor']);
                        });
                    }

                    executeLevel2Fetch(settings);
                    isExtensionInitialized = true;
                    updateCount(modules);
                    logTelemetry('loader', 'Unified Extension Module Online.', 'info');
                    return; // Scanning loop complete
                }
            }
        } catch (err) {
            logTelemetry('loader', `Critical lifecycle setup error: ${err.message}`, 'error');
        }

        if (cycleAttempts < maxLifecycleRetries) {
            setTimeout(sequenceProfileScanning, 250);
        } else {
            logTelemetry('ProfileManager', 'Polling timed out. Connection profiles could not be loaded.', 'warn');
        }
    }

    $(document).ready(() => {
        sequenceProfileScanning();
    });

})();