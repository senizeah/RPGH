(function () {
    let internalProfilesRepository = [];
    let cycleAttempts = 0;
    const maxLifecycleRetries = 40;

    // Dynamically calculate the active web folder path via meta location parsing
    // This allows module-level file queries without hitting server-side 404 concatenations
    const baseModuleURL = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

    /**
     * Pipeline Orchestration Engine
     * Fires isolated background requests to multiple service scripts concurrently
     * without clogging the primary UI roleplay context on port 5000.
     * 
     * @param {String} chatTextPayload - The raw input data string to send to background services.
     */
    async function launchParallelServicesPipeline(chatTextPayload) {
        console.log("[Connections Orchestrator]: Initializing parallel background sweep...");

        try {
            // 1. Resolve your targets from your populated internal profile array repository.
            // Replace these search strings ('5001', '5002') with the exact names of your profiles if necessary.
            const config5001 = internalProfilesRepository.find(p => p.name?.includes('5001') || p.id?.includes('5001'));
            const config5002 = internalProfilesRepository.find(p => p.name?.includes('5002') || p.id?.includes('5002'));

            if (!config5001 && !config5002) {
                console.warn("[Connections Orchestrator]: Halted. Targeted connection profile configurations (5001/5002) missing from memory.");
                return null;
            }

            // 2. Natively import your individual script workers on-demand via dynamic modules
            const workersToLoad = [];
            if (config5001) workersToLoad.push(import(`${baseModuleURL}/5001.js`));
            if (config5002) workersToLoad.push(import(`${baseModuleURL}/5002.js`));

            const loadedWorkers = await Promise.all(workersToLoad);
            const executionPromises = [];

            // 3. Dispatch the processing tasks concurrently.
            console.time("[Connections Pipeline Runtime]");
            
            let workerIndex = 0;
            if (config5001) {
                const module5001 = loadedWorkers[workerIndex++];
                executionPromises.push(module5001.executeService5001(config5001, chatTextPayload));
            }
            if (config5002) {
                const module5002 = loadedWorkers[workerIndex++];
                executionPromises.push(module5002.executeService5002(config5002, chatTextPayload));
            }

            const results = await Promise.all(executionPromises);
            console.timeEnd("[Connections Pipeline Runtime]");

            // 4. Output results to the console log tracker
            let resultIndex = 0;
            let summaryResult = config5001 ? results[resultIndex++] : null;
            let analysisResult = config5002 ? results[resultIndex++] : null;

            if (summaryResult) console.log("[Connections Orchestrator]: Service 5001 Output Received ->", summaryResult);
            if (analysisResult) console.log("[Connections Orchestrator]: Service 5002 Output Received ->", analysisResult);

            return { summaryResult, analysisResult };

        } catch (pipelineError) {
            console.error("[Connections Orchestrator]: Parallel execution track encountered a fault:", pipelineError);
            throw pipelineError;
        }
    }

    async function mountQvinkTester() {
        // Locate the native extensions settings drawer panel container
        const targetParentPanel = document.getElementById('extensions_settings');
        if (!targetParentPanel) {
            console.error('[Connections]: Core UI structural element #extensions_settings missing.');
            return;
        }

        try {
            // Natively resolve the ui.js file dynamically through a module import promise
            const uiModulePath = `${baseModuleURL}/ui.js`;
            const uiModule = await import(uiModulePath);
            
            // Extract the exported module functions cleanly
            const createInspectorUI = uiModule.createInspectorUI;
            const updateProfileDropdown = uiModule.updateProfileDropdown;

            // Call the layout generator method
            const uiHandles = createInspectorUI(targetParentPanel);
            const profileSelector = uiHandles.profileSelector;

            // Attach event listener directly to the parent node using event delegation
            targetParentPanel.removeEventListener('change', handlePanelChangeDelegation);
            targetParentPanel.addEventListener('change', handlePanelChangeDelegation);

            function handlePanelChangeDelegation(event) {
                if (event.target && event.target.id === 'qvink_profile_selector') {
                    const identifiedId = event.target.value;
                    const configurationOutputBlock = document.getElementById('qvink_configuration_output');
                    
                    if (!configurationOutputBlock) return;

                    const matchingDataBlock = internalProfilesRepository.find(p => String(p.id) === String(identifiedId));
                    if (matchingDataBlock) {
                        console.log(`[Connections]: Extracted profile data block for: "${matchingDataBlock.name}"`);
                        configurationOutputBlock.value = JSON.stringify(matchingDataBlock, null, 4);
                        
                        // TEST HOOK EXAMPLE: 
                        // Whenever you select a profile in the UI, it automatically triggers a parallel pipeline test string
                        // launchParallelServicesPipeline("Sample testing log context sequence payload.");
                    } else {
                        configurationOutputBlock.value = '';
                    }
                }
            }

            // Run background scanning loops checking for your profile list array via the QVink data path
            function sequenceProfileScanning() {
                cycleAttempts++;
                console.log(`[Connections]: Polling extension settings structure (${cycleAttempts}/${maxLifecycleRetries})...`);

                try {
                    const context = window.SillyTavern?.getContext ? window.SillyTavern.getContext() : null;
                    
                    if (context) {
                        const disabledList = context.extensionSettings?.disabledExtensions || [];
                        const isActive = !disabledList.includes('connection-manager');

                        if (isActive && context.extensionSettings?.connectionManager) {
                            const dynamicDataStream = context.extensionSettings.connectionManager.profiles;

                            if (Array.isArray(dynamicDataStream) && dynamicDataStream.length > 0) {
                                console.log(`[Connections]: Success! Found ${dynamicDataStream.length} profiles via connectionManager object path.`);
                                internalProfilesRepository = dynamicDataStream;

                                const liveSelector = document.getElementById('qvink_profile_selector');
                                if (liveSelector) {
                                    updateProfileDropdown(liveSelector, internalProfilesRepository);
                                }

                                return; // Extraction completed successfully! Stop the loop.
                            }
                        }
                    }
                } catch (err) {
                    console.error('[Connections]: Exception tracking context tree properties:', err);
                }

                if (cycleAttempts < maxLifecycleRetries) {
                    setTimeout(sequenceProfileScanning, 250);
                } else {
                    console.warn('[Connections]: Polling timed out. connectionManager is unpopulated.');
                    const liveSelector = document.getElementById('qvink_profile_selector');
                    if (liveSelector) {
                        liveSelector.innerHTML = '<option>⚠️ Error: Profiles unresolvable.</option>';
                    }
                }
            }

            sequenceProfileScanning();

        } catch (err) {
            console.error('[Connections]: Critical error loading split scripts:', err);
        }
    }

    // Fire initialization wrapper once jQuery reports document state as ready
    $(document).ready(() => {
        mountQvinkTester();
    });

    // Expose the parallel pipeline orchestrator function to the local execution space if other scripts call it
    window.launchParallelServicesPipeline = launchParallelServicesPipeline;
})();