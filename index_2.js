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
     * @param {String} chatTextPayload - The raw input data string to send to background services.
     */
    async function launchParallelServicesPipeline(chatTextPayload) {
        console.log(`[Module Core]: Initializing parallel background sweep...`);

        try {
            // 1. Resolve targets from the internal profile repository.
            // We look for profiles that match the service IDs (e.g., '5001', '5002')
            const config5001 = internalProfilesRepository.find(p => p.name?.includes('5001') || p.id?.includes('5001'));
            const config5002 = internalProfilesRepository.find(p => p.name?.includes('5002') || p.id?.includes('5002'));

            if (!config5001 && !config5002) {
                console.warn(`[Module Core]: Halted. Targeted connection profile configurations (5001/5002) missing from memory.`);
                return null;
            }

            // 2. Natively import individual script workers on-demand via dynamic modules
            const workersToLoad = [];
            if (config5001) workersToLoad.push(import(`${baseModuleURL}/5001.js`));
            if (config5002) workersToLoad.push(import(`${baseModuleURL}/5002.js`));

            const loadedWorkers = await Promise.all(workersToLoad);
            const executionPromises = [];

            // 3. Dispatch the processing tasks concurrently.
            console.time("[Module Core]: Connections Pipeline Runtime");
            
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
            console.timeEnd("[Module Core]: Connections Pipeline Runtime");

            // 4. Output results
            let resultIndex = 0;
            let summaryResult = config5001 ? results[resultIndex++] : null;
            let analysisResult = config5002 ? results[resultIndex++] : null;

            if (summaryResult) console.log(`[Module Core]: Service 5001 Output Received ->`, summaryResult);
            if (analysisResult) console.log(`[Module Core]: Service 5002 Output Received ->`, analysisResult);

            return { summaryResult, analysisResult };

        } catch (pipelineError) {
            console.error(`[Module Core]: Parallel execution track encountered a fault: ${pipelineError}`);
            throw pipelineError;
        }
    }

    async function mountCoreUI() {
        // Locate the native extensions settings drawer panel container
        const targetParentPanel = document.getElementById('extensions_settings');
        if (!targetParentPanel) {
            console.error(`[Module Core]: Core UI structural element #extensions_settings missing.`);
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

            // Run background scanning loops checking for the profile list via the SillyTavern context
            function sequenceProfileScanning() {
                cycleAttempts++;
                console.log(`[Module Core]: Polling extension settings structure (${cycleAttempts}/${maxLifecycleRetries})...`);

                try {
                    const context = window.SillyTavern?.getContext ? window.SillyTavern.getContext() : null;
                    
                    if (context) {
                        const disabledList = context.extensionSettings?.disabledExtensions || [];
                        const isActive = !disabledList.includes('rpgh'); // Assuming extension ID is 'rpgh'

                        if (isActive && context.extensionSettings?.connectionManager) {
                            const dynamicDataStream = context.extensionSettings.connectionManager.profiles;

                            if (Array.isArray(dynamicDataStream) && dynamicDataStream.length > 0) {
                                console.log(`[Module Core]: Success! Found ${dynamicDataStream.length} profiles via connectionManager object path.`);
                                internalProfilesRepository = dynamicDataStream;

                                const liveSelector = document.getElementById('rpgh_profile_selector');
                                if (liveSelector) {
                                    updateProfileDropdown(liveSelector, internalProfilesRepository);
                                }

                                return; // Extraction completed successfully!
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

    // Fire initialization wrapper once jQuery reports document state as ready
    $(document).ready(() => {
        mountCoreUI();
    });

    // Expose the parallel pipeline orchestrator function to the local execution space
    window.launchParallelServicesPipeline = launchParallelServicesPipeline;
})();