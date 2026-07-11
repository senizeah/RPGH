/**
 * Isolated Worker for Service 5002
 */
export async function executeService5002(profileConfig, taskData) {
    console.log(`[Service 5002]: Extraction run triggered on profile: ${profileConfig.name}`);
    
    const finalizedPrompt = `### Instruction:\nExtract important facts, places, and characters from this text as JSON:\n\n${taskData}\n\n### JSON Output:\n`;

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
        console.error("[Service 5002]: Processing crashed:", err);
        throw err;
    }
}