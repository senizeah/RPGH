(function () {
    let internalProfilesRepository = [];
    let cycleAttempts = 0;
    const maxLifecycleRetries = 40;

    // Dynamically calculate the active web folder path via meta location parsing
    const baseModuleURL = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

    /**
     * Pipeline Orchestration Engine
     * Fires isolated background requests to multiple service scripts concurrently
     * 
     * @param {Object} serviceRequests - Mapping of helper names to profile IDs.
     *                                   e.g., { cleaner: 'id1', summarizer: 'id2', rpg: 'id3' }
     * @param {String} chatTextPayload - The raw input data string to send to background services.
     * @param {Object} context - The SillyTavern context object.
     * @param {Function} updateCountCb - Callback to refresh UI counts.
     */
    async function launchParallelServicesPipeline(serviceRequests, chatTextPayload, context, updateCountCb) {
        console.log(`[Module Core]: Initializing parallel background sweep...`);

        const executionPromises = [];
        const resultsMap = {};

        try {
            // Define the mapping of helper names to their respective files and export functions
            const helperManifest = {
                cleaner: {
                    file: 'cleaner.js',
                    exec: 'processProseCleanerStage'
                },
                summarizer: {
                    file: 'summarizer.js',
                    exec: 'processSummarizerStage'
                },
                rpg: {
                    file: 'rpgh.js',
                    exec: 'processRpgStateStage'
                }
            };

            console.time("[Module Core]: Connections Pipeline Runtime");

            for (const [helperName, profileId] of Object.entries(serviceRequests)) {
                const manifest = helperManifest[helperName];
                if (!manifest) {
                    console.warn(`[Module Core]: Unknown helper requested: ${helperName}`);
                    continue;
                }

                // 1. Resolve profile from repository
                const profile = internalProfilesRepository.find(p => String(p.id) === String(profileId) || p.name === profileId);
                
                if (!profile) {
                    console.warn(`[Module Core]: Profile for ${helperName} (${profileId}) not found in repository.`);
                    continue;
                }

                // 2. Load worker and execute
                // We use a closure to capture the current helperName and profile for the promise
                const task = (async () => {
                    try {
                        const module = await import(`${baseModuleURL}/${manifest.file}`);
                        const executeFunc = module[manifest.exec];

                        if (typeof executeFunc !== 'function') {
                            throw new Error(`Exported function ${manifest.exec} not found in ${manifest.file}`);
                        }

                        // Note: We pass parameters based on what the specific worker expects.
                        // This requires the orchestrator to be aware of the specific signatures.
                        if (helperName === 'cleaner') {
                            // cleaner expects: (chat, immediateLastMsg, settings, estimateTokensCb, context)
                            // However, cleaner.js uses settings.cleanerProfile internally. 
                            // To be compliant with the user's request to use the DIRECT profile from settings:
                            // We will pass the context and let the worker handle the rest, OR 
                            // pass the specific parameters if we want to be surgical.
                            // Looking at cleaner.js: it takes (chat, immediateLastMsg, settings, estimateTokensCb, context)
                            // and then it does its own lookup. 
                            // To fix the "user sets helper in settings" requirement, we will pass the settings 
                            // that have been updated by the UI.
                            
                            // For the purpose of this orchestrator, we'll assume the 'settings' are part of the context 
                            // or provided. Since this is a background pipeline, we'll simulate the 'chat' 
                            // by passing the context's chat.
                            await executeFunc(context.chat, context.chat[context.chat.length - 1], context.extensionSettings, context.estimateTokensCb, context);
                        } else if (helperName === 'summarizer') {
                            // summarizer expects: (chat, settings, estimateTokensCb, executeFlushCb, updateCountCb, context)
                            await executeFunc(context.chat, context.extensionSettings, context.estimateTokensCb, context.executeFlush, updateCountCb, context);
                        } else if (helperName === 'rpg') {
                            // rpg expects: (chat, settings, context)
                            await executeFunc(context.chat, context.extensionSettings, context);
                        }

                        resultsMap[helperName] = { success: true };
                    } catch (err) {
                        console.error(`[Module Core]: ${helperName} worker failed: ${err}`);
                        resultsMap[helperName] = { success: false, error: err };
                    }
                })();

                executionPromises.push(task);
            }

            await Promise.all(executionPromises);
            console.timeEnd("[Module Core]: Connections Pipeline Runtime");

            return resultsMap;

        } catch (pipelineError) {
            console.error(`[Module Core]: Parallel execution track encountered a fault: ${pipelineError}`);
            throw pipelineError;
        }
    }

    async function mountCoreUI() {
        const targetParentPanel = document.getElementById('extensions_settings');
        if (!targetParentPanel) {
            console.error(`[Module Core]: Core UI structural element #extensions_settings missing.`);
            return;
        }

        try {
            const uiModulePath = `${baseModuleURL}/ui.js`;
            const uiModule = await import(uiModulePath);
            
            const createInspectorUI = uiModule.createInspectorUI;
            const updateProfileDropdown = uiModule.updateProfileDropdown;

            const uiHandles = createInspectorUI(targetParentPanel);
            const profileSelector = uiHandles.profileSelector;

            targetParentPanel.removeEventListener('change', handlePanelChangeDelegation);
            targetParentPanel.addEventListener('change', handlePanelChangeDelegation);

            function handlePanelChangeDelegation(event) {
                if (event.target && event.target.id === 'rpgh_profile_selector') {
                    const identifiedId = event.target.value;
                    const configurationOutputBlock = document.getElementById('rpgh_configuration_output');
                    
                    if (!configurationOutputBlock) return;

                    const matchingDataBlock = internalProfilesRepository.find(p => String(p.id) === String(identifiedId));
                    if (matchingDataBlock) {
                        console.log(`[Module Core]: Extracted profile data block for: "${matchingDataBlock.name}"`);
                        configurationOutputBlock.value = JSON.stringify(matchingDataBlock, null, 4);
                    } else {
                        configurationOutputBlock.value = '';
                    }
                }
            }

            function sequenceProfileScanning() {
                cycleAttempts++;
                console.log(`[Module Core]: Polling extension settings structure (${cycleAttempts}/${maxLifecycleRetries})...`);

                try {
                    const context = window.SillyTavern?.getContext ? window.SillyTavern.getContext() : null;
                    
                    if (context) {
                        const disabledList = context.extensionSettings?.disabledExtensions || [];
                        const isActive = !disabledList.includes('rpgh');

                        if (isActive && context.extensionSettings?.connectionManager) {
                            const dynamicDataStream = context.extensionSettings.connectionManager.profiles;

                            if (Array.isArray(dynamicDataStream) && dynamicDataStream.length > 0) {
                                console.log(`[Module Core]: Success! Found ${dynamicDataStream.length} profiles via connectionManager object path.`);
                                internalProfilesRepository = dynamicDataStream;

                                const liveSelector = document.getElementById('rpgh_profile_selector');
                                if (liveSelector) {
                                    updateProfileDropdown(liveSelector, internalProfilesRepository);
                                }

                                return;
                            }
                        }
                    }
                } catch (err) {
                    console.error(`[Module Core]: Exception tracking context tree properties: ${err}`);
                }

                if (cycleAttempts < maxLifecycleRetries) {
                    setTimeout(sequenceProfileScanning, 250);
                } else {
                    console.warn(`[Module Core]: Polling timed out. connectionManager is unpopulated.`);
                    const liveSelector = document.getElementById('rpgh_profile_selector');
                    if (liveSelector) {
                        liveSelector.innerHTML = '<option>⚠️ Error: Profiles unresolvable.</option>';
                    }
                }
            }

            sequenceProfileScanning();

        } catch (err) {
            console.error(`[Module Core]: Critical error loading split scripts: ${err}`);
        }
    }

    $(document).ready(() => {
        mountCoreUI();
    });

    window.launchParallelServicesPipeline = launchParallelServicesPipeline;
})();