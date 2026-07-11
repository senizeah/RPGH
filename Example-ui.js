/**
 * Programmatically constructs the User Interface elements container for the 
 * Connection Profile Inspector using SillyTavern's native formatting styles.
 * 
 * @param {HTMLElement} targetPanel - The parent DOM node to append the interface to.
 * @returns {Object} References to the created dropdown select and output text box nodes.
 */
export function createInspectorUI(targetPanel) {
    if (document.getElementById('st_qvink_tester_panel')) {
        console.log('[Connections UI]: Panel already exists. Skipping duplicate injection loop.');
        return {
            profileSelector: document.getElementById('qvink_profile_selector'),
            configurationOutputBlock: document.getElementById('qvink_configuration_output')
        };
    }

    const isolatedContainer = document.createElement('div');
    isolatedContainer.id = 'st_qvink_tester_panel';
    isolatedContainer.style.marginTop = '15px';
    isolatedContainer.style.padding = '12px';
    isolatedContainer.style.borderRadius = '4px';
    isolatedContainer.style.background = 'rgba(0, 0, 0, 0.2)';
    isolatedContainer.style.border = '1px solid var(--border-color)';

    const panelHeader = document.createElement('h4');
    panelHeader.innerText = '⚙️ Connection Profile Inspector';
    panelHeader.style.margin = '0 0 10px 0';
    panelHeader.style.fontSize = '14px';

    const selectionLabel = document.createElement('small');
    selectionLabel.innerText = 'Select Profile:';
    selectionLabel.style.display = 'block';
    selectionLabel.style.marginBottom = '4px';

    const profileSelector = document.createElement('select');
    profileSelector.id = 'qvink_profile_selector';
    profileSelector.className = 'text_block';
    profileSelector.style.width = '100%';
    profileSelector.style.marginBottom = '12px';

    const baselineOption = document.createElement('option');
    baselineOption.text = 'Polling extensionSettings registry...';
    profileSelector.appendChild(baselineOption);

    const dataLabel = document.createElement('small');
    dataLabel.innerText = 'Extracted Settings Properties:';
    dataLabel.style.display = 'block';
    dataLabel.style.marginBottom = '4px';

    const configurationOutputBlock = document.createElement('textarea');
    configurationOutputBlock.id = 'qvink_configuration_output';
    configurationOutputBlock.className = 'text_block';
    configurationOutputBlock.style.width = '100%';
    configurationOutputBlock.style.height = '200px';
    configurationOutputBlock.style.fontFamily = 'Courier, monospace';
    configurationOutputBlock.style.fontSize = '11px';
    configurationOutputBlock.style.background = '#111';
    configurationOutputBlock.style.color = '#00ff66';
    configurationOutputBlock.readOnly = true;

    isolatedContainer.appendChild(panelHeader);
    isolatedContainer.appendChild(selectionLabel);
    isolatedContainer.appendChild(profileSelector);
    isolatedContainer.appendChild(dataLabel);
    isolatedContainer.appendChild(configurationOutputBlock);
    targetPanel.appendChild(isolatedContainer);

    return {
        profileSelector: profileSelector,
        configurationOutputBlock: configurationOutputBlock
    };
}

/**
 * Manages updating, wiping, and drawing the option blocks inside the dropdown selector.
 * 
 * @param {HTMLSelectElement} selectorEl - The dropdown DOM element handle.
 * @param {Array} profilesArray - Raw profiles dataset.
 */
export function updateProfileDropdown(selectorEl, profilesArray) {
    if (!selectorEl) return;
    
    selectorEl.innerHTML = '';

    const initialPlaceholder = document.createElement('option');
    initialPlaceholder.text = '-- Select a Profile (QVink Path) --';
    initialPlaceholder.value = '';
    selectorEl.appendChild(initialPlaceholder);

    profilesArray.forEach(profile => {
        const optionNode = document.createElement('option');
        optionNode.value = profile.id; 
        optionNode.text = profile.name || `Profile ID: ${profile.id}`;
        selectorEl.appendChild(optionNode);
    });
}