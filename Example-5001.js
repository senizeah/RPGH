/**
 * Isolated Worker for Service 5001
 * @param {Object} profileConfig - The raw Connection Profile config passed from the controller
 * @param {String} taskData - The input text data to compile
 */
export async function executeService5001(profileConfig, taskData) {
    console.log(`[Service 5001]: Executing task out-of-band on endpoint: ${profileConfig.name}`);
    
    // Construct a specialized prompt for this specific worker's job
    const finalizedPrompt = `### Instruction:\nSummarize the following chat records strictly into a short paragraph:\n\n${taskData}\n\n### Response:\n`;

    const payload = {
        prompt: finalizedPrompt,
        api_type: profileConfig.api || profileConfig.api_type || profileConfig.apiType,
        api_server: profileConfig.url || profileConfig.custom_url,
        api_key: profileConfig.apiKey || profileConfig.api_key,
        model: profileConfig.model || profileConfig.active_model,
        preset: profileConfig.preset || null,
        is_background_task: true,
        bypass_global_state: true
    };

    try {
        const response = await window.SillyTavern.requestSecure('/api/textgen/generate', payload);
        return response?.text || response;
    } catch (err) {
        console.error("[Service 5001]: Processing crashed:", err);
        throw err;
    }
}