import { syncStateToLorebook } from './rpgh.js';

// Module-scoped persistent UI node references
let sidebarElement = null;
let activeModalElement = null;

/**
 * ----------------------------------------------------------------------------
 * MODAL UI SYSTEM
 * Creates floating window overlays for deeper state inspection and prompt editing.
 * ----------------------------------------------------------------------------
 */
function closeActiveModal() {
    if (activeModalElement) {
        activeModalElement.remove();
        activeModalElement = null;
    }
}

function showRpgModal(titleText, contentElement, width = "400px") {
    closeActiveModal();

    activeModalElement = document.createElement('div');
    activeModalElement.style = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
        display: flex; justify-content: center; align-items: center;
        z-index: 99999; font-family: system-ui, sans-serif;
    `;

    const windowBox = document.createElement('div');
    windowBox.style = `
        background: #111827; border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px; width: ${width}; max-height: 80vh;
        display: flex; flex-direction: column; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.8);
    `;

    const header = document.createElement('div');
    header.style = 'padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); border-radius: 8px 8px 0 0;';
    
    const title = document.createElement('h3');
    title.innerText = titleText;
    title.style = 'margin: 0; color: #34d399; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerText = '✖';
    closeBtn.style = 'background: transparent; border: none; color: #9ca3af; cursor: pointer; font-size: 16px;';
    closeBtn.onclick = closeActiveModal;

    header.appendChild(title);
    header.appendChild(closeBtn);
    windowBox.appendChild(header);

    const body = document.createElement('div');
    body.style = 'padding: 16px; overflow-y: auto; color: #e5e7eb; font-size: 13px; line-height: 1.5;';
    body.appendChild(contentElement);
    windowBox.appendChild(body);

    activeModalElement.appendChild(windowBox);
    document.body.appendChild(activeModalElement);
}

/**
 * Opens a management modal for RPG state.
 * @param {string} title - Modal title.
 * @param {string} type - 'stats' | 'inventory' | 'arts' | 'artTree'.
 * @param {Object} settings - Current extension settings.
 * @param {Object} context - SillyTavern context.
 */
function openRpgManagementModal(title, type, settings, context) {
    const variables = settings.runtimeVariables || {};
    const container = document.createElement('div');
    container.style = 'display: flex; flex-direction: column; gap: 15px;';

    const commitChanges = async (updatedVariables) => {
        if (!confirm("Are you sure you want to save these changes to the RPGLedger?")) return;

        settings.runtimeVariables = updatedVariables;
        context.extensionSettings['flush-monitor'] = settings;
        await context.saveSettingsObj();
        await syncStateToLorebook(settings);
        closeActiveModal();
        renderRpgSidebar(settings, context);
    };

    const cancelChanges = () => {
        closeActiveModal();
    };

    // --- Sub-renderers ---

    const renderStatsManager = (draft, onCommit, onCancel) => {
        const list = document.createElement('div');
        list.style = 'display: flex; flex-direction: column; gap: 8px;';
        
        const updateRow = (key, val) => {
            const rowDiv = document.createElement('div');
            rowDiv.style = 'display: flex; gap: 5px; align-items: center;';
            
            const keyInput = document.createElement('input');
            keyInput.value = key;
            keyInput.style = 'width: 40%; background: #111827; color: #34d399; border: 1px solid #374151; padding: 4px; font-size: 11px;';
            
            const valInput = document.createElement('input');
            valInput.value = typeof val === 'object' ? JSON.stringify(val) : val;
            valInput.style = 'flex-grow: 1; background: #111827; color: #f3f4f6; border: 1px solid #374151; padding: 4px; font-size: 11px;';
            
            const delBtn = document.createElement('button');
            delBtn.innerText = '✖';
            delBtn.style = 'background: #991b1b; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 4px;';
            delBtn.onclick = () => {
                list.removeChild(rowDiv);
                delete draft[key];
            };

            rowDiv.appendChild(keyInput);
            rowDiv.appendChild(valInput);
            rowDiv.appendChild(delBtn);
            return rowDiv;
        };

        Object.entries(draft).forEach(([k, v]) => {
            if (k === 'skills' || k === 'rpg_artTree' || k === 'inventory') return;
            list.appendChild(updateRow(k, v));
        });

        const addBtn = document.createElement('button');
        addBtn.innerText = '+ Add Variable';
        addBtn.style = 'background: #065f46; color: white; border: none; padding: 8px; cursor: pointer; border-radius: 4px; font-size: 11px;';
        addBtn.onclick = () => {
            if (!confirm("⚠️ Warning: Adding variables increases the prompt size. Please ensure your model has sufficient context window capacity before proceeding.")) return;
            const rowDiv = document.createElement('div');
            rowDiv.style = 'display: flex; gap: 5px; align-items: center;';
            
            const keyInput = document.createElement('input');
            keyInput.value = 'new_variable';
            keyInput.style = 'width: 40%; background: #111827; color: #34d399; border: 1px solid #374151; padding: 4px; font-size: 11px;';
            
            const valInput = document.createElement('input');
            valInput.value = '0';
            valInput.style = 'flex-grow: 1; background: #111827; color: #f3f4f6; border: 1px solid #374151; padding: 4px; font-size: 11px;';
            
            const delBtn = document.createElement('button');
            delBtn.innerText = '✖';
            delBtn.style = 'background: #991b1b; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 4px;';
            delBtn.onclick = () => rowDiv.remove();

            rowDiv.appendChild(keyInput);
            rowDiv.appendChild(valInput);
            rowDiv.appendChild(delBtn);
            list.appendChild(rowDiv);
        };
        
        container.appendChild(list);
        container.appendChild(addBtn);
    };

    const renderInventoryManager = (draft, onCommit, onCancel) => {
        const list = document.createElement('div');
        list.style = 'display: flex; flex-direction: column; gap: 10px;';
        const items = draft.inventory || [];
        const commonFlags = ['Equipped', 'Stowed', 'Disguised', 'Dirty', 'Clean', 'Hood Up'];

        const refreshList = () => {
            list.innerHTML = '';
            items.forEach((item, idx) => {
                const itemDiv = document.createElement('div');
                itemDiv.style = 'background: #1f2937; padding: 8px; border-radius: 4px; border: 1px solid #374151; display: flex; flex-direction: column; gap: 5px;';
                
                const header = document.createElement('div');
                header.style = 'display: flex; justify-content: space-between; align-items: center;';
                
                const nameInput = document.createElement('input');
                nameInput.value = item.name;
                nameInput.style = 'background: transparent; border: none; color: #34d399; font-weight: bold; width: 60%;';
                nameInput.onchange = (e) => { item.name = e.target.value; };
                header.appendChild(nameInput);
                
                const delBtn = document.createElement('button');
                delBtn.innerText = 'Remove';
                delBtn.style = 'background: #991b1b; color: white; border: none; padding: 2px 6px; font-size: 10px; cursor: pointer; border-radius: 3px;';
                delBtn.onclick = () => {
                    items.splice(idx, 1);
                    refreshList();
                };
                header.appendChild(delBtn);
                itemDiv.appendChild(header);

                // Quantity
                const qtyDiv = document.createElement('div');
                qtyDiv.style = 'display: flex; align-items: center; gap: 5px; font-size: 11px;';
                qtyDiv.innerHTML = 'Qty:';
                const qtyInput = document.createElement('input');
                qtyInput.type = 'number';
                qtyInput.value = item.quantity || 1;
                qtyInput.style = 'width: 40px; background: #111827; color: white; border: 1px solid #374151;';
                qtyInput.onchange = (e) => { item.quantity = parseInt(e.target.value); };
                qtyDiv.appendChild(qtyInput);
                itemDiv.appendChild(qtyDiv);

                // Flags
                const flagContainer = document.createElement('div');
                flagContainer.style = 'display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px;';

                // Always ensure item.flags is initialized as an array right away
                if (!Array.isArray(item.flags)) item.flags = [];

                commonFlags.forEach(f => {
                    const lbl = document.createElement('label');
                    lbl.style = 'font-size: 10px; display: flex; align-items: center; gap: 3px; cursor: pointer;';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = item.flags.includes(f);
                    cb.onchange = () => {
                        if (cb.checked) { 
                            if (!item.flags.includes(f)) item.flags.push(f); 
                        } else { 
                            const i = item.flags.indexOf(f); 
                            if (i > -1) item.flags.splice(i, 1); 
                        }
                        // Re-render to keep the "Other" text field in sync with checkbox changes
                        refreshList(); 
                    };
                    lbl.appendChild(cb);
                    lbl.append(f);
                    flagContainer.appendChild(lbl);
                });

                const otherFlagDiv = document.createElement('div');
                otherFlagDiv.style = 'display: flex; align-items: center; gap: 5px; margin-top: 3px;';
                otherFlagDiv.innerHTML = '<span style="font-size: 10px;">Other:</span>';
                const otherInput = document.createElement('input');
                otherInput.style = 'flex-grow: 1; background: #111827; color: white; border: 1px solid #374151; font-size: 10px; padding: 2px;';
                otherInput.value = item.flags.filter(f => !commonFlags.includes(f)).join(', ');
                otherInput.onchange = (e) => {
                    const others = e.target.value.split(',').map(s => s.trim()).filter(s => s !== '');
                    const base = item.flags.filter(f => commonFlags.includes(f));
                    item.flags = [...base, ...others];
                    // Re-render to ensure references are completely fresh
                    refreshList(); 
                };
                otherFlagDiv.appendChild(otherInput);
                flagContainer.appendChild(otherFlagDiv);

                itemDiv.appendChild(flagContainer);
                list.appendChild(itemDiv);
            });
        };

        refreshList();
        container.appendChild(list);

        const addBtn = document.createElement('button');
        addBtn.innerText = '+ Add Item';
        addBtn.style = 'background: #065f46; color: white; border: none; padding: 8px; cursor: pointer; border-radius: 4px; font-size: 11px;';
        addBtn.onclick = () => {
            if (!confirm("⚠️ Warning: Adding items increases the prompt size. Please ensure your model has sufficient context window capacity before proceeding.")) return;
            items.push({ name: "New Item", flags: [], quantity: 1 });
            refreshList();
        };
        container.appendChild(addBtn);
    };

    const renderListManager = (title, listData, key, isArray = false) => {
        const list = document.createElement('div');
        list.style = 'display: flex; flex-direction: column; gap: 8px;';
        
        const refreshList = () => {
            list.innerHTML = '';
            if (isArray) {
                listData.forEach((val, idx) => {
                    const row = document.createElement('div');
                    row.style = 'display: flex; gap: 5px; align-items: center;';
                    const input = document.createElement('input');
                    input.value = val;
                    input.style = 'flex-grow: 1; background: #111827; color: #f3f4f6; border: 1px solid #374151; padding: 4px; font-size: 11px;';
                    input.onchange = (e) => { listData[idx] = e.target.value; };
                    const delBtn = document.createElement('button');
                    delBtn.innerText = '✖';
                    delBtn.style = 'background: #991b1b; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 4px;';
                    delBtn.onclick = () => {
                        listData.splice(idx, 1);
                        refreshList();
                    };
                    row.appendChild(input);
                    row.appendChild(delBtn);
                    list.appendChild(row);
                });
            }
        };

        refreshList();
        container.appendChild(list);

        const addBtn = document.createElement('button');
        addBtn.innerText = '+ Add Entry';
        addBtn.style = 'background: #065f46; color: white; border: none; padding: 8px; cursor: pointer; border-radius: 4px; font-size: 11px;';
        addBtn.onclick = () => {
            if (!confirm("⚠️ Warning: Adding entries increases the prompt size. Please ensure your model has sufficient context window capacity before proceeding.")) return;
            if (isArray) listData.push("New Entry");
            refreshList();
        };
        container.appendChild(addBtn);
    };

    if (type === 'stats') renderStatsManager(variables, onCommit, onCancel);
    else if (type === 'inventory') renderInventoryManager(variables, onCommit, onCancel);
    else if (type === 'arts') renderListManager('Arts', variables.skills || [], 'skills', true);
    else if (type === 'artTree') renderListManager('Art-Tree', variables.rpg_artTree || [], 'rpg_artTree', true);

    // --- Footer Actions ---
    const footer = document.createElement('div');
    footer.style = 'display: flex; justify-content: space-between; gap: 10px; margin-top: 10px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = 'Cancel';
    cancelBtn.style = 'flex: 1; background: #374151; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px;';
    cancelBtn.onclick = cancelChanges;

    const saveBtn = document.createElement('button');
    saveBtn.innerText = 'Save Changes';
    saveBtn.style = 'flex: 2; background: #2563eb; color: white; border: none; padding: 8px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;';
    saveBtn.onclick = () => onCommit(variables);

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    container.appendChild(footer);

    showRpgModal(title, container, '500px');
}

function openPromptEditorModal(settings, context) {
    const container = document.createElement('div');
    container.style = 'display: flex; flex-direction: column; gap: 10px;';

    const textarea = document.createElement('textarea');
    textarea.style = 'width: 100%; height: 300px; background: #1f2937; color: #e5e7eb; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 10px; font-family: monospace; font-size: 12px; resize: vertical;';
    textarea.value = settings.rpgSystemPrompt;

    const saveBtn = document.createElement('button');
    saveBtn.innerText = 'Save Prompt';
    saveBtn.style = 'padding: 8px; background: #2563eb; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;';
    saveBtn.onclick = async () => {
        settings.rpgSystemPrompt = textarea.value;
        context.extensionSettings['flush-monitor'] = settings;
        await context.saveSettingsObj();
        closeActiveModal();
    };

    container.appendChild(textarea);
    container.appendChild(saveBtn);
    showRpgModal('Edit RPG System Prompt', container, '600px');
}

/**
 * ----------------------------------------------------------------------------
 * SIDEBAR UI RENDERER
 * ----------------------------------------------------------------------------
 */
export function renderRpgSidebar(settings, context) {
    if (sidebarElement) {
        sidebarElement.remove();
        sidebarElement = null;
    }

    // Fix: Changed 'chat' to 'chat_container' to correctly verify the ST chat UI exists
    if (!settings.rpgSidebarPosition || settings.rpgSidebarPosition === "hidden" || !document.getElementById('chat_container')) {
        return;
    }

    sidebarElement = document.createElement('div');
    sidebarElement.id = 'rpg-status-sidebar';
    
    const isLeft = settings.rpgSidebarPosition === "left";
    sidebarElement.style = `
        position: fixed; top: 80px; ${isLeft ? 'left: 20px;' : 'right: 20px;'}
        width: 280px; max-height: calc(100vh - 120px);
        background: rgba(17, 24, 39, 0.85); backdrop-filter: blur(8px); -webkit-backdropfilter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 12px;
        color: #f3f4f6; font-family: system-ui, -apple-system, sans-serif;
        z-index: 9999; overflow-y: auto; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    `;

    // 1. Header
    const title = document.createElement('div');
    title.innerHTML = '📊 <span>RPG State Ledger</span>';
    title.style = 'font-weight: bold; font-size: 13px; color: #34d399; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;';
    sidebarElement.appendChild(title);

    const variables = settings.runtimeVariables || {};
    
    // 2. Status / Equipment Callouts
    const equipmentBlock = document.createElement('div');
    equipmentBlock.style = 'margin-bottom: 12px; font-size: 11px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);';
    
    const eqTitle = document.createElement('div');
    eqTitle.innerText = '🛡️ Active Equipment & Status';
    eqTitle.style = 'color: #fbbf24; font-weight: bold; margin-bottom: 5px;';
    equipmentBlock.appendChild(eqTitle);

    let hasEquipment = false;
    let statusCallouts = [];

    if (Array.isArray(variables.inventory)) {
        variables.inventory.forEach(item => {
            const flags = Array.isArray(item.flags) ? item.flags : [];
            const flagStr = flags.join(', ').toLowerCase();
            
            // Collect global status indicators
            if (flagStr.includes('hood up')) statusCallouts.push('Hood Up');
            if (flagStr.includes('disguised')) statusCallouts.push('Disguised');

            if (flagStr.includes('equipped')) {
                hasEquipment = true;
                const eqItem = document.createElement('div');
                const secondaryFlags = flags.filter(f => f.toLowerCase() !== 'equipped').join(', ');
                eqItem.innerHTML = `<span style="color: #f3f4f6;">• ${item.name}</span> <span style="opacity:0.6; font-size:10px;">${secondaryFlags ? `(${secondaryFlags})` : ''}</span>`;
                equipmentBlock.appendChild(eqItem);
            }
        });
    }

    if (statusCallouts.length > 0) {
        const statusDiv = document.createElement('div');
        statusDiv.style = 'margin-top: 5px; padding-top: 5px; border-top: 1px dashed rgba(255,255,255,0.2); color: #f87171; font-weight: bold;';
        statusDiv.innerText = `⚠️ Status: ${[...new Set(statusCallouts)].join(' | ')}`;
        equipmentBlock.appendChild(statusDiv);
    }

    if (!hasEquipment && statusCallouts.length === 0) {
        equipmentBlock.style.display = 'none';
    }
    sidebarElement.appendChild(equipmentBlock);

    // 3. Stats Table
    const table = document.createElement('table');
    table.style = 'width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 15px;';
    for (const [key, val] of Object.entries(variables)) {
        if (key === 'skills' || key === 'rpg_artTree' || key === 'inventory') continue;
        
        const row = document.createElement('tr');
        row.style = 'border-bottom: 1px solid rgba(255,255,255,0.03);';
        const cellKey = document.createElement('td');
        cellKey.innerText = key.replace('rpg_', '').replace(/([A-Z])/g, ' $1');
        cellKey.style = 'padding: 5px 0; color: #9ca3af; font-weight: 500; font-size: 11px; text-transform: capitalize;';
        const cellVal = document.createElement('td');
        cellVal.innerText = typeof val === 'object' ? JSON.stringify(val) : val;
        cellVal.style = 'padding: 5px 0; text-align: right; font-weight: bold; color: #f3f4f6; font-family: monospace;';
        row.appendChild(cellKey);
        row.appendChild(cellVal);
        table.appendChild(row);
    }
    sidebarElement.appendChild(table);

    // 4. Modal Triggers (Action Grid)
    const buttonGrid = document.createElement('div');
    buttonGrid.style = 'display: grid; grid-template-columns: 1fr 1fr; gap: 6px;';

    const createBtn = (label, icon, onClick) => {
        const btn = document.createElement('button');
        btn.innerHTML = `${icon} ${label}`;
        btn.style = 'background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 6px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: background 0.2s;';
        btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.2)';
        btn.onmouseout = () => btn.style.background = 'rgba(255,255,255,0.1)';
        btn.onclick = onClick;
        return btn;
    };

    buttonGrid.appendChild(createBtn('Stats (Raw)', '⚖️', () => {
        const rawStats = { ...variables };
        delete rawStats.skills; delete rawStats.rpg_artTree; delete rawStats.inventory;
        openDataModal('Raw Statistic Variables', rawStats, true);
    }));
    
    buttonGrid.appendChild(createBtn('Inventory', '🎒', () => {
        openRpgManagementModal('Inventory Matrix', 'inventory', settings, context);
    }));

    buttonGrid.appendChild(createBtn('Arts', '⚔️', () => {
        openRpgManagementModal('Acquired Arts & Skills', 'arts', settings, context);
    }));

    buttonGrid.appendChild(createBtn('Art-Tree', '🌳', () => {
        openRpgManagementModal('Available Art Tree', 'artTree', settings, context);
    }));

    const promptBtn = createBtn('Edit Prompt', '⚙️', () => {
        openPromptEditorModal(settings, context);
    });
    promptBtn.style.gridColumn = 'span 2';
    promptBtn.style.background = 'rgba(37, 99, 235, 0.4)';
    buttonGrid.appendChild(promptBtn);

    sidebarElement.appendChild(buttonGrid);

    // 5. Token Tracker Table
    const tokenTracker = document.createElement('div');
    tokenTracker.style = 'margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;';
    
    const createTokenTable = (data) => {
        const table = document.createElement('table');
        table.style = 'width: 100%; border-collapse: collapse; font-size: 10px; text-align: center;';
        
        const createRow = (cells, isHeader = false) => {
            const row = document.createElement('tr');
            cells.forEach(cellText => {
                const td = document.createElement('td');
                td.innerText = cellText;
                td.style = isHeader 
                    ? 'padding: 2px; color: #9ca3af; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.05);'
                    : 'padding: 2px; color: #f3f4f6; font-family: monospace;';
                row.appendChild(td);
            });
            return row;
        };

        // Row 1: Header
        table.appendChild(createRow(['Active Tokens'], true));
        
        // Row 2: Column Headers
        table.appendChild(createRow(['Lorebook', 'Summary', 'Raw', 'ChapterLedger', 'RPGLedger'], true));
        
        // Row 3: Values
        table.appendChild(createRow([
            data.lorebookTValue || 0, 
            data.summaryTValue || 0, 
            data.rawTValue || 0, 
            data.chapterledgerTValue || 0, 
            data.rpgledgerTValue || 0
        ]));

        // Row 4: Column Headers
        table.appendChild(createRow(['Main Prompt', 'Summary Prompt', 'Cleaner Prompt', 'RPGH Prompt', 'Char Description'], true));
        
        // Row 5: Values
        table.appendChild(createRow([
            data.mainPromptTValue || 0,
            data.summarizerPromptTValue || 0,
            data.cleanerPromptTValue || 0,
            data.rpgSystemPromptTValue || 0,
            data.characterDescriptionTValue || 0
        ]));

        // Row 6: Column Headers
        table.appendChild(createRow(['Lorebook Total', 'Summary Total', 'Cleaner Total', 'RPGH Total'], true));

        // Row 7: Values
        table.appendChild(createRow([
            data.lorebookATotal || 0,
            data.summaryATotal || 0,
            data.cleanerATotal || 0,
            data.rpgATotal || 0
        ]));

        return table;
    };

    // We'll use runtimeVariables or a dedicated object for these values
    // For now, we use settings.runtimeVariables as the source
    const tokenData = settings.runtimeVariables || {};
    tokenTracker.appendChild(createTokenTable(tokenData));
    
    sidebarElement.appendChild(tokenTracker);
    document.body.appendChild(sidebarElement);
}

/**
 * Helper for raw data viewing (legacy/fallback)
 */
function openDataModal(title, data, isJson = false) {
    const container = document.createElement('pre');
    container.style = 'margin: 0; white-space: pre-wrap; font-family: monospace; font-size: 12px; color: #a78bfa; background: #1f2937; padding: 10px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);';
    container.innerText = isJson ? JSON.stringify(data, null, 4) : (Array.isArray(data) ? data.join('\n') : data);
    showRpgModal(title, container);
}