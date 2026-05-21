/**
 * Rules Config Manager
 * Manages rule rules configuration dialog and related functionality
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";
import {
    createSettingsDialog,
    createFormGroup,
    createInputGroup,
    createSelectGroup,
    createTextareaGroup,
    createComboBoxGroup,
    createSelectButtonGroup
} from "./uiComponents.js";
import { APIService } from "../services/api.js";
import { tUI } from "../utils/uiI18n.js";



class RulesConfigManager {
    constructor() {
        this.systemPrompts = null;
        // ---Store rule list data---
        this.expandPrompts = [];
        this.zhVisionPrompts = [];
        this.enVisionPrompts = [];
        this.videoPrompts = [];
        // ---Current active rule ID---
        this.activeExpandPromptId = null;
        this.activeZhVisionPromptId = null;
        this.activeEnVisionPromptId = null;
        this.activeVideoPromptId = null;

        this.isDirty = false;
        this.initialState = null; // Used to store state backup
    }

    /**
     * Backup current state
     */
    _backupState() {
        this.initialState = {
            expandPrompts: JSON.parse(JSON.stringify(this.expandPrompts)),
            translatePrompts: JSON.parse(JSON.stringify(this.translatePrompts || [])),
            zhVisionPrompts: JSON.parse(JSON.stringify(this.zhVisionPrompts)),
            enVisionPrompts: JSON.parse(JSON.stringify(this.enVisionPrompts)),
            videoPrompts: JSON.parse(JSON.stringify(this.videoPrompts || [])),
            activeExpandPromptId: this.activeExpandPromptId,
            activeZhVisionPromptId: this.activeZhVisionPromptId,
            activeEnVisionPromptId: this.activeEnVisionPromptId,
            activeVideoPromptId: this.activeVideoPromptId,
        };
        this.isDirty = false;
        // Mark form as unmodified
        const form = document.querySelector('.rules-config-dialog .rules-config-form');
        if (form && form.elements.modified_marker) {
            form.elements.modified_marker.value = 'initial';
        }
    }

    /**
     * Restore state from backup
     */
    _restoreState() {
        if (this.initialState) {
            this.expandPrompts = JSON.parse(JSON.stringify(this.initialState.expandPrompts));
            this.translatePrompts = JSON.parse(JSON.stringify(this.initialState.translatePrompts || []));
            this.zhVisionPrompts = JSON.parse(JSON.stringify(this.initialState.zhVisionPrompts));
            this.enVisionPrompts = JSON.parse(JSON.stringify(this.initialState.enVisionPrompts));
            this.videoPrompts = JSON.parse(JSON.stringify(this.initialState.videoPrompts || []));
            this.activeExpandPromptId = this.initialState.activeExpandPromptId;
            this.activeZhVisionPromptId = this.initialState.activeZhVisionPromptId;
            this.activeEnVisionPromptId = this.initialState.activeEnVisionPromptId;
            this.activeVideoPromptId = this.initialState.activeVideoPromptId;
        }
        this.isDirty = false;
    }


    /**
     * Mark configuration as modified
     */
    _setDirty() {
        this.isDirty = true;
        // Trigger form modification so that generic dialog can detect unsaved changes
        const form = document.querySelector('.rules-config-dialog .rules-config-form');
        if (form && form.elements.modified_marker) {
            form.elements.modified_marker.value = 'modified_' + Date.now();
            form.elements.modified_marker.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * Show rules configuration modal
     */
    showRulesConfigModal() {
        try {
            logger.debug('Opening rules configuration dialog');

            createSettingsDialog({
                title: `<i class="pi pi-list" style="margin-right: 8px;"></i>${tUI('Rule Manager')}`,
                dialogClassName: 'rules-config-dialog',
                disableBackdropAndCloseOnClickOutside: true,
                renderContent: (container) => {
                    this._createRulesConfigUI(container);
                },
                onSave: async () => {
                    if (this.isDirty) {
                        try {
                            await this._saveConfigToServer();
                            this._backupState(); // Update backup after successful save
                            app.extensionManager.toast.add({
                                severity: "success",
                                summary: "Configuration saved",
                                detail: "All changes have been successfully saved to the server",
                                life: 3000
                            });
                        } catch (error) {
                            // Error notification already handled in _saveConfigToServer
                            return false; // Prevent closing dialog on save failure
                        }
                    } else {
                        app.extensionManager.toast.add({
                            severity: "info",
                            summary: "No changes",
                            detail: "Configuration has no unsaved changes",
                            life: 3000
                        });
                    }
                    return true; // Close dialog
                },
                onCancel: () => {
                    // createSettingsDialog's generic logic handles confirmation
                    // If user confirms cancel, restore state here
                    if (this.isDirty) {
                        this._restoreState();
                        this._renderPromptLists(); // Re-render to show restored state
                    }
                    return true; // Allow close
                }
            });
        } catch (error) {
            logger.error(`Failed to open rules configuration dialog: ${error.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                    summary: tUI("Failed to open configuration"),
                    detail: error.message || "An error occurred while opening the configuration dialog",
                    life: 3000
                });
        }
    }

    /**
     * Create rules configuration UI
     * @param {HTMLElement} container Container element
     */
    _createRulesConfigUI(container) {
        const form = document.createElement('form');
        form.onsubmit = (e) => e.preventDefault();
        form.className = 'rules-config-form';

        // Add a hidden input for dirty check
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'modified_marker';
        hiddenInput.value = 'initial';
        form.appendChild(hiddenInput);

        // ---Create tab container---
        const tabContainer = document.createElement('div');
        tabContainer.className = 'rules-config-tabs';

        // ---Create tab header wrapper container (includes tab buttons and add button)---
        const tabHeaderWrapper = document.createElement('div');
        tabHeaderWrapper.className = 'tab-header-wrapper';

        // ---Create tab header---
        const tabHeader = document.createElement('div');
        tabHeader.className = 'tab-header';

        // ---Create add button container---
        const addButtonContainer = document.createElement('div');
        addButtonContainer.className = 'tab-header-actions';

        // Define tab configuration (including whether it has an add button)
        const tabs = [
            { id: 'expand', title: tUI('Prompt Enhancement Rules'), subtitle: tUI('Prompt Enhancement & Polishing'), addLabel: tUI('Add Prompt Enhancement Rule') },
            { id: 'zhVision', title: tUI('Chinese Caption'), subtitle: tUI('Image Caption (Chinese)'), addLabel: tUI('Add Chinese Caption Rule') },
            { id: 'enVision', title: tUI('English Caption'), subtitle: tUI('Image Caption (English)'), addLabel: tUI('Add English Caption Rule') },
            { id: 'video', title: tUI('Video Caption'), subtitle: tUI('Video Caption'), addLabel: tUI('Add Video Caption Rule') },
            { id: 'translate', title: tUI('Translation Rules'), subtitle: tUI('LLM Translation Rules'), addLabel: null }
        ];

        // Create tab buttons
        tabs.forEach((tab, index) => {
            const button = this._createRuleTabButton(tab.id, tab.title, tab.subtitle);
            if (index === 0) {
                button.classList.add('active');
            }
            tabHeader.appendChild(button);
        });

        // Create add buttons for each tab (initially only show the first one)
        tabs.forEach((tab, index) => {
            if (tab.addLabel) {
                const addButton = document.createElement('button');
                addButton.className = 'p-button p-component p-button-sm tab-add-button';
                addButton.type = 'button';
                addButton.dataset.tab = tab.id;
                addButton.innerHTML = `<span class="p-button-icon-left pi pi-plus"></span><span class="p-button-label">${tab.addLabel}</span>`;
                addButton.onclick = () => {
                    this._showPromptEditDialog(tab.id, null);
                };
                // Only show button for first tab
                addButton.style.display = index === 0 ? 'inline-flex' : 'none';
                addButtonContainer.appendChild(addButton);
            }
        });

        tabHeaderWrapper.appendChild(tabHeader);
        tabHeaderWrapper.appendChild(addButtonContainer);
        tabContainer.appendChild(tabHeaderWrapper);

        // ---Create tab content container---
        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';

        // Create tab pane contents
        const expandPane = this._createExpandTabPane();
        const zhVisionPane = this._createVisionTabPane('zhVision', 'Chinese Caption Rules');
        const enVisionPane = this._createVisionTabPane('enVision', 'English Caption Rules');
        const videoPane = this._createVideoTabPane();
        const translatePane = this._createTranslateTabPane();

        tabContent.appendChild(expandPane);
        tabContent.appendChild(zhVisionPane);
        tabContent.appendChild(enVisionPane);
        tabContent.appendChild(videoPane);
        tabContent.appendChild(translatePane);

        tabContainer.appendChild(tabContent);
        form.appendChild(tabContainer);
        container.appendChild(form);

        // Default to first tab
        this._switchRuleTab('expand', tabHeader, tabContent);

        // Load system rules configuration
        this._loadSystemPrompts();
    }

    /**
     * Create a rule tab button
     * @param {string} tabId Tab ID
     * @param {string} title Tab title
     * @param {string} subtitle Tab subtitle
     * @returns {HTMLElement} Tab button element
     */
    _createRuleTabButton(tabId, title, subtitle) {
        const button = document.createElement('button');
        button.className = 'tab-button';
        button.dataset.tab = tabId;
        button.type = 'button';

        const titleEl = document.createElement('div');
        titleEl.className = 'tab-title';
        titleEl.textContent = title;
        button.appendChild(titleEl);

        if (subtitle) {
            const subtitleEl = document.createElement('div');
            subtitleEl.className = 'tab-subtitle';
            subtitleEl.textContent = subtitle;
            button.appendChild(subtitleEl);
        }

        // Click to switch tab
        button.addEventListener('click', () => {
            const tabHeader = button.parentElement;
            // tabHeader is inside tab-header-wrapper, tabContent is the next sibling of the wrapper
            const tabHeaderWrapper = tabHeader.parentElement;
            const tabContent = tabHeaderWrapper.nextElementSibling;
            this._switchRuleTab(tabId, tabHeader, tabContent);
        });

        return button;
    }

    /**
     * Switch rule tab
     * @param {string} tabId Tab ID
     * @param {HTMLElement} header Tab header container
     * @param {HTMLElement} contentContainer Content container
     */
    _switchRuleTab(tabId, header, contentContainer) {
        // Update tab button state
        header.querySelectorAll('.tab-button').forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Show corresponding content
        contentContainer.querySelectorAll('.tab-pane').forEach(pane => {
            pane.style.display = pane.dataset.tab === tabId ? 'block' : 'none';
        });

        // Toggle add button visibility
        const actionsContainer = header.parentElement?.querySelector('.tab-header-actions');
        if (actionsContainer) {
            actionsContainer.querySelectorAll('.tab-add-button').forEach(btn => {
                btn.style.display = btn.dataset.tab === tabId ? 'inline-flex' : 'none';
            });
        }
    }

    /**
     * Create expand rule tab pane
     * @returns {HTMLElement} Tab pane content element
     */
    _createExpandTabPane() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'expand';
        pane.style.display = 'none';
        pane.style.padding = '16px';

        // Create rule list container
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container';

        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">Status</div>
            <div class="prompt-list-cell name-cell">Rule Name</div>
            <div class="prompt-list-cell content-cell">Rule Content</div>
            <div class="prompt-list-cell action-cell">Actions</div>
        `;
        this._addHeaderResizers(listHeader);

        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        pane.appendChild(listContainer);

        // Store list reference
        this.expandScrollList = scrollList;

        return pane;
    }

    /**
     * Create translation rule tab pane (read-only edit mode)
     * @returns {HTMLElement} Tab pane content element
     */
    _createTranslateTabPane() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'translate';
        pane.style.display = 'none';
        pane.style.padding = '16px';



        // Create translation rule list container
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container';

        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell name-cell">Rule Name</div>
            <div class="prompt-list-cell content-cell">Rule Content</div>
            <div class="prompt-list-cell action-cell">Actions</div>
        `;
        this._addHeaderResizers(listHeader);

        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        pane.appendChild(listContainer);
        // Create notice
        const notice = document.createElement('div');
        notice.className = 'rule-pane-notice';
        notice.innerHTML = `<i class="pi pi-info-circle"></i> ${tUI('Translation rules only support editing, not adding or deleting')}`;
        pane.appendChild(notice);

        // Store list reference
        this.translateScrollList = scrollList;

        return pane;
    }

    /**
     * Create caption rule tab pane
     * @param {string} type Type (zhVision/enVision)
     * @param {string} title Title
     * @returns {HTMLElement} Tab pane content element
     */
    _createVisionTabPane(type, title) {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = type;
        pane.style.display = 'none';
        pane.style.padding = '16px';

        // Create rule list container
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container vision-prompt-list-container';

        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">Status</div>
            <div class="prompt-list-cell name-cell">Rule Name</div>
            <div class="prompt-list-cell content-cell">Rule Content</div>
            <div class="prompt-list-cell action-cell">Actions</div>
        `;
        this._addHeaderResizers(listHeader);

        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        pane.appendChild(listContainer);

        // Store list reference
        if (type === 'zhVision') {
            this.zhVisionScrollList = scrollList;
        } else {
            this.enVisionScrollList = scrollList;
        }

        return pane;
    }

    /**
     * Create video caption rule tab pane
     * @returns {HTMLElement} Tab pane content element
     */
    _createVideoTabPane() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'video';
        pane.style.display = 'none';
        pane.style.padding = '16px';

        // Create rule list container
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container video-prompt-list-container';

        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">Status</div>
            <div class="prompt-list-cell name-cell">Rule Name</div>
            <div class="prompt-list-cell content-cell">Rule Content</div>
            <div class="prompt-list-cell action-cell">Actions</div>
        `;
        this._addHeaderResizers(listHeader);

        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        pane.appendChild(listContainer);

        // Store list reference
        this.videoScrollList = scrollList;

        return pane;
    }

    /**
     * Load system rules configuration
     */
    async _loadSystemPrompts() {
        try {
            const response = await fetch(APIService.getApiUrl('/config/system_prompts'));
            if (!response.ok) {
                throw new Error(`Failed to load system rules configuration: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            this.systemPrompts = data;

            // Get active rule IDs
            const activePrompts = data.active_prompts || {};
            const activeExpandId = activePrompts.expand;
            const activeZhVisionId = activePrompts.vision_zh;
            const activeEnVisionId = activePrompts.vision_en;

            // Output loaded active IDs
            logger.debug(`Loaded active rule IDs | expand:${activeExpandId || 'none'} | vision_zh:${activeZhVisionId || 'none'} | vision_en:${activeEnVisionId || 'none'}`);

            // Convert expand rule data
            this.expandPrompts = [];
            if (data.expand_prompts) {
                // Save original order to restore when saving
                this.originalExpandOrder = Object.keys(data.expand_prompts);

                // Traverse keys in original order
                this.originalExpandOrder.forEach(key => {
                    const prompt = data.expand_prompts[key];
                    // Use key from config as ID, not generate new one
                    this.expandPrompts.push({
                        id: key,
                        name: prompt.name || key, // If no name, use key as name
                        tags: prompt.tags || [],
                        category: prompt.category || '',
                        showIn: prompt.showIn || ['frontend', 'node'],
                        content: prompt.content,
                        isActive: key === activeExpandId, // Determine active based on active_prompts
                        order: this.originalExpandOrder.indexOf(key) // Save original order
                    });
                });

                // If no active rule found, activate the first one
                if (!activeExpandId && this.expandPrompts.length > 0) {
                    this.expandPrompts[0].isActive = true;
                    this.activeExpandPromptId = this.expandPrompts[0].id;
                } else {
                    this.activeExpandPromptId = activeExpandId;
                }

                // Sort by original order
                this.expandPrompts.sort((a, b) => a.order - b.order);
            }

            // Convert caption rule data
            this.zhVisionPrompts = [];
            this.enVisionPrompts = [];
            if (data.vision_prompts) {
                // Save original order
                this.originalVisionOrder = Object.keys(data.vision_prompts);

                // Separate keys for Chinese and English rules
                const zhKeys = [];
                const enKeys = [];

                // First classify all keys
                this.originalVisionOrder.forEach(key => {
                    const prompt = data.vision_prompts[key];
                    // Determine if Chinese or English based on ID or content
                    const isChinese = key.includes('zh') || /[\u4e00-\u9fa5]/.test(prompt.content);

                    if (isChinese) {
                        zhKeys.push(key);
                    } else {
                        enKeys.push(key);
                    }
                });

                // Process Chinese rules
                zhKeys.forEach((key, index) => {
                    const prompt = data.vision_prompts[key];
                    this.zhVisionPrompts.push({
                        id: key,
                        name: prompt.name || key,
                        tags: prompt.tags || [],
                        category: prompt.category || '',
                        showIn: prompt.showIn || ['frontend', 'node'],
                        content: prompt.content,
                        isActive: key === activeZhVisionId,
                        order: this.originalVisionOrder.indexOf(key) // Save original order
                    });
                });

                // Process English rules
                enKeys.forEach((key, index) => {
                    const prompt = data.vision_prompts[key];
                    this.enVisionPrompts.push({
                        id: key,
                        name: prompt.name || key,
                        tags: prompt.tags || [],
                        category: prompt.category || '',
                        showIn: prompt.showIn || ['frontend', 'node'],
                        content: prompt.content,
                        isActive: key === activeEnVisionId,
                        order: this.originalVisionOrder.indexOf(key) // Save original order
                    });
                });

                // Sort by original order
                this.zhVisionPrompts.sort((a, b) => a.order - b.order);
                this.enVisionPrompts.sort((a, b) => a.order - b.order);

                // If no active Chinese rule found, activate the first one
                if (!activeZhVisionId && this.zhVisionPrompts.length > 0) {
                    this.zhVisionPrompts[0].isActive = true;
                    this.activeZhVisionPromptId = this.zhVisionPrompts[0].id;
                } else {
                    this.activeZhVisionPromptId = activeZhVisionId;
                }

                // If no active English rule found, activate the first one
                if (!activeEnVisionId && this.enVisionPrompts.length > 0) {
                    this.enVisionPrompts[0].isActive = true;
                    this.activeEnVisionPromptId = this.enVisionPrompts[0].id;
                } else {
                    this.activeEnVisionPromptId = activeEnVisionId;
                }
            }

            // Convert translation rule data (read-only edit mode)
            this.translatePrompts = [];
            if (data.translate_prompts) {
                Object.keys(data.translate_prompts).forEach(key => {
                    const prompt = data.translate_prompts[key];
                    this.translatePrompts.push({
                        id: key,
                        name: key, // Use key as name
                        content: prompt.content,
                        role: prompt.role || 'system',
                        isReadOnly: true // Mark as read-only (no add/delete)
                    });
                });
            }

            // Convert video caption rule data
            this.videoPrompts = [];
            const activeVideoId = activePrompts.video;
            if (data.video_prompts) {
                const videoKeys = Object.keys(data.video_prompts);
                videoKeys.forEach((key, index) => {
                    const prompt = data.video_prompts[key];
                    this.videoPrompts.push({
                        id: key,
                        name: prompt.name || key,
                        tags: prompt.tags || [],
                        category: prompt.category || '',
                        showIn: prompt.showIn || ['frontend', 'node'],
                        content: prompt.content,
                        isActive: key === activeVideoId,
                        order: index
                    });
                });

                // If no active video caption rule found, activate the first one
                if (!activeVideoId && this.videoPrompts.length > 0) {
                    this.videoPrompts[0].isActive = true;
                    this.activeVideoPromptId = this.videoPrompts[0].id;
                } else {
                    this.activeVideoPromptId = activeVideoId;
                }
            }

            // Backup initial state
            this._backupState();

            // Render lists
            this._renderPromptLists();

        } catch (error) {
            logger.error("Failed to load system rules configuration:", error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Load failed",
                detail: error.message || "An error occurred while loading system rules configuration",
                life: 3000
            });
        }
    }

    /**
     * Render rule lists
     */
    _renderPromptLists() {
        logger.debug(`Starting render rule lists | Prompt enhancement rules:${this.expandPrompts.length} | Translation rules:${this.translatePrompts?.length || 0} | Chinese caption:${this.zhVisionPrompts.length} | English caption:${this.enVisionPrompts.length}`);

        // Render expand rule list
        if (this.expandScrollList) {
            this._renderPromptList(this.expandScrollList, this.expandPrompts, 'expand');
            logger.debug(`Rendered prompt enhancement rule list`);
        } else {
            logger.error(`Prompt enhancement rule list container does not exist`);
        }

        // Render translation rule list (read-only edit mode)
        if (this.translateScrollList) {
            this._renderTranslateList(this.translateScrollList, this.translatePrompts || []);
            logger.debug(`Rendered translation rule list`);
        }

        // Render Chinese caption rule list
        if (this.zhVisionScrollList) {
            this._renderPromptList(this.zhVisionScrollList, this.zhVisionPrompts, 'zhVision');
            logger.debug(`Rendered Chinese caption rule list`);
        } else {
            logger.error(`Chinese caption rule list container does not exist`);
        }

        // Render English caption rule list
        if (this.enVisionScrollList) {
            this._renderPromptList(this.enVisionScrollList, this.enVisionPrompts, 'enVision');
            logger.debug(`Rendered English caption rule list`);
        } else {
            logger.error(`English caption rule list container does not exist`);
        }

        // Render video caption rule list
        if (this.videoScrollList) {
            this._renderPromptList(this.videoScrollList, this.videoPrompts || [], 'video');
            logger.debug(`Rendered video caption rule list`);
        }
    }


    /**
     * Render translation rule list (read-only edit mode)
     * @param {HTMLElement} container List container
     * @param {Array} prompts Translation rules array
     */
    _renderTranslateList(container, prompts) {
        container.innerHTML = '';

        prompts.forEach(prompt => {
            const row = document.createElement('div');
            row.className = 'prompt-list-row translate-row';
            row.dataset.promptId = prompt.id;
            row.dataset.type = 'translate';

            // Name column
            const nameCell = document.createElement('div');
            nameCell.className = 'prompt-list-cell name-cell';
            nameCell.textContent = prompt.name;
            nameCell.title = prompt.name;

            // Content column
            const contentCell = document.createElement('div');
            contentCell.className = 'prompt-list-cell content-cell';
            contentCell.textContent = prompt.content;
            contentCell.title = prompt.content;

            // Actions column (only edit button)
            const actionCell = document.createElement('div');
            actionCell.className = 'prompt-list-cell action-cell';

            const editBtn = document.createElement('button');
            editBtn.className = 'prompt-action-btn edit-btn';
            editBtn.innerHTML = '<span class="pi pi-pencil"></span>';
            editBtn.title = tUI('Edit Translation Rule');
            editBtn.onclick = (e) => {
                e.stopPropagation();
                this._showTranslateEditDialog(prompt.id);
            };

            actionCell.appendChild(editBtn);

            row.appendChild(nameCell);
            row.appendChild(contentCell);
            row.appendChild(actionCell);

            container.appendChild(row);
        });
    }

    /**
     * Show translation rule edit dialog
     * @param {string} promptId Translation rule ID
     */
    _showTranslateEditDialog(promptId) {
        const prompt = (this.translatePrompts || []).find(p => p.id === promptId);
        if (!prompt) {
            logger.error(`Cannot find translation rule: ${promptId}`);
            return;
        }

        createSettingsDialog({
            title: `<i class="pi pi-pencil" style="margin-right: 8px;"></i>${tUI('Edit Translation Rule')}`,
            isConfirmDialog: true,
            dialogClassName: 'translate-edit-dialog',
            renderContent: (content) => {
                content.className += ' dialog-form-content';
                content.style.padding = '1rem';
                content.style.display = 'flex';
                content.style.flexDirection = 'column';
                content.style.flex = '1';

                // Show rule name (read-only)
                const nameGroup = document.createElement('div');
                nameGroup.className = 'settings-form-group-item';
                nameGroup.innerHTML = `
                    <label class="settings-form-label">Rule Name</label>
                    <div class="settings-input-wrapper">
                        <input type="text" class="settings-input" value="${prompt.name}" disabled style="opacity: 0.7;" />
                    </div>
                `;
                nameGroup.style.marginBottom = '10px';

                // Create content edit area
                const contentTextarea = createTextareaGroup('Rule Content', tUI('Please enter translation rule content'), 10);
                contentTextarea.group.style.flex = '1';
                contentTextarea.group.style.display = 'flex';
                contentTextarea.group.style.flexDirection = 'column';
                contentTextarea.textarea.value = prompt.content || '';

                content.appendChild(nameGroup);
                content.appendChild(contentTextarea.group);

                content.contentTextarea = contentTextarea.textarea;
            },
            onSave: (content) => {
                const newContent = content.contentTextarea.value.trim();

                if (!newContent) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: tUI("Edit failed"),
                        detail: "Rule content cannot be empty",
                        life: 3000
                    });
                    return false;
                }

                // Update translation rule content
                prompt.content = newContent;

                // Mark as modified
                this._setDirty();

                // Re-render list
                this._renderPromptLists();

                return true;
            }
        });
    }

    /**
     * Render a single rule list
     * @param {HTMLElement} container List container
     * @param {Array} prompts Rules array
     * @param {string} type Type
     */
    _renderPromptList(container, prompts, type) {
        container.innerHTML = '';

        prompts.forEach(prompt => {
            const row = document.createElement('div');
            row.className = 'prompt-list-row';
            row.dataset.promptId = prompt.id;
            row.dataset.type = type;
            row.dataset.order = prompt.order; // Add order attribute to DOM element for debugging

            // Status column - clickable to toggle status
            const statusCell = document.createElement('div');
            statusCell.className = 'prompt-list-cell status-cell';
            const statusIcon = document.createElement('span');
            statusIcon.className = prompt.isActive ? 'pi pi-check-circle active-status' : 'pi pi-circle-off inactive-status';
            statusIcon.title = prompt.isActive ? tUI('Currently active, click to deactivate') : tUI('Inactive, click to activate');
            statusCell.appendChild(statusIcon);
            statusCell.onclick = (e) => {
                e.stopPropagation();
                this._togglePromptActive(type, prompt.id);
            };

            // Name column
            const nameCell = document.createElement('div');
            nameCell.className = 'prompt-list-cell name-cell';
            // Use name attribute for display, not id
            nameCell.textContent = prompt.name;
            nameCell.title = prompt.name;

            // Add column width resizer handle
            const nameResizer = document.createElement('div');
            nameResizer.className = 'column-resizer';
            nameCell.appendChild(nameResizer);
            this._addColumnResizer(nameResizer, nameCell);

            // Content column
            const contentCell = document.createElement('div');
            contentCell.className = 'prompt-list-cell content-cell';
            const contentPreview = prompt.content.length > 50 ?
                prompt.content.substring(0, 50) + '...' : prompt.content;
            contentCell.textContent = contentPreview;
            contentCell.title = prompt.content;

            // Add column width resizer handle
            const contentResizer = document.createElement('div');
            contentResizer.className = 'column-resizer';
            contentCell.appendChild(contentResizer);
            this._addColumnResizer(contentResizer, contentCell);

            // Actions column
            const actionCell = document.createElement('div');
            actionCell.className = 'prompt-list-cell action-cell';

            // Edit button
            const editButton = document.createElement('button');
            editButton.className = 'prompt-action-btn edit-btn';
            editButton.innerHTML = '<span class="pi pi-pencil"></span>';
            editButton.title = tUI('Edit');
            editButton.onclick = (e) => {
                e.stopPropagation();
                this._showPromptEditDialog(type, prompt.id);
            };

            // Delete button
            const deleteButton = document.createElement('button');
            deleteButton.className = 'prompt-action-btn delete-btn';
            deleteButton.innerHTML = '<span class="pi pi-trash"></span>';
            deleteButton.title = tUI('Delete');
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                this._deletePrompt(type, prompt.id);
            };

            actionCell.appendChild(editButton);
            actionCell.appendChild(deleteButton);

            row.appendChild(statusCell);
            row.appendChild(nameCell);
            row.appendChild(contentCell);
            row.appendChild(actionCell);

            container.appendChild(row);
        });

        // Initialize drag sorting
        this._initSortable(container, type);
    }

    /**
     * Get existing category list
     * Extract used categories from all rule types
     * @returns {Array<{value: string, text: string}>} Category option list
     */
    _getExistingCategories() {
        const categories = new Set();

        // Extract categories from all rule types
        const allPrompts = [
            ...this.expandPrompts,
            ...this.zhVisionPrompts,
            ...this.enVisionPrompts,
            ...this.videoPrompts
        ];

        allPrompts.forEach(prompt => {
            if (prompt.category && typeof prompt.category === 'string') {
                categories.add(prompt.category);
            }
        });

        // Convert to dropdown option format
        return Array.from(categories)
            .sort() // Sort alphabetically
            .map(cat => ({ value: cat, text: cat }));
    }

    /**
     * Show rule edit dialog
     * @param {string} type Type
     * @param {string|null} promptId Rule ID, null for new
     */
    _showPromptEditDialog(type, promptId) {
        this._showPromptConfigDialog(type, promptId);
    }



    /**
     * Show generic rule configuration dialog
     * @param {string} defaultType Default type
     * @param {string|null} promptId Rule ID, null for new
     */
    _showPromptConfigDialog(defaultType = 'expand', promptId = null) {
        const isEdit = !!promptId;
        let editData = null;

        // If editing, find corresponding data
        if (isEdit) {
            if (defaultType === 'expand') {
                editData = this.expandPrompts.find(p => p.id === promptId);
            } else if (defaultType === 'zhVision') {
                editData = this.zhVisionPrompts.find(p => p.id === promptId);
            } else if (defaultType === 'enVision') {
                editData = this.enVisionPrompts.find(p => p.id === promptId);
            } else if (defaultType === 'video') {
                editData = this.videoPrompts.find(p => p.id === promptId);
            }
        }

        createSettingsDialog({
            title: isEdit ? tUI('Edit Rule') : tUI('Add Rule'),
            isConfirmDialog: true,
            dialogClassName: 'prompt-edit-dialog',
            disableBackdropAndCloseOnClickOutside: true,
            saveButtonText: isEdit ? tUI('Save') : tUI('Add'),
            cancelButtonText: tUI('Cancel'),
            renderContent: (content) => {
                content.className += ' dialog-form-content';
                content.style.padding = '10px 40px'; // Increase side margins
                content.style.display = 'flex';
                content.style.flexDirection = 'column';
                content.style.flex = '1';
                content.style.overflow = 'hidden'; // Overall no scroll, internal textarea scrolls

                // Create rule name input
                const nameInput = createInputGroup('Rule Name', tUI('Please enter rule name'));
                nameInput.group.style.marginBottom = '10px';
                if (isEdit && editData) {
                    nameInput.input.value = editData.name || '';
                }

                // Create rule type dropdown
                const typeOptions = [
                    { value: 'expand', text: 'Prompt Enhancement' },
                    { value: 'zhVision', text: 'Caption (Chinese)' },
                    { value: 'enVision', text: 'Caption (English)' },
                    { value: 'video', text: 'Video Caption' }
                ];
                const typeSelect = createSelectGroup('Rule Type', typeOptions, defaultType);
                typeSelect.group.style.marginBottom = '10px';

                // Create category selection box (editable)
                const categoryOptions = this._getExistingCategories();
                const initialCategory = (isEdit && editData) ? (editData.category || '') : '';
                const categoryComboBox = createComboBoxGroup('Category', categoryOptions, initialCategory, {
                    placeholder: 'Enter or select category (can be left empty)',
                    emptyText: 'No categories'
                });
                categoryComboBox.group.style.flex = '1';
                categoryComboBox.group.style.marginBottom = '0';

                // Create display position selection component
                const showInOptions = [
                    { value: 'frontend', label: 'Show in Assistant' },
                    { value: 'node', label: 'Show in Node' }
                ];
                // Get initial value: edit from rule data, new default to both selected
                const initialShowIn = (isEdit && editData && editData.showIn)
                    ? editData.showIn
                    : ['frontend', 'node'];
                const showInSelectButton = createSelectButtonGroup('', showInOptions, initialShowIn, {
                    mode: 'multiple',
                    size: 'small',
                    allowEmpty: true
                });
                showInSelectButton.group.style.marginBottom = '0';

                // Create row container for category and display position
                const categoryRow = document.createElement('div');
                categoryRow.style.display = 'flex';
                categoryRow.style.flexDirection = 'row';
                categoryRow.style.alignItems = 'flex-end';
                categoryRow.style.gap = '1rem';
                categoryRow.style.marginBottom = '10px';
                categoryRow.appendChild(categoryComboBox.group);
                categoryRow.appendChild(showInSelectButton.group);

                // Create rule content multi-line input
                const contentTextarea = createTextareaGroup('Rule Content', tUI('Please enter rule content'));
                contentTextarea.group.style.marginBottom = '0';
                contentTextarea.group.style.flex = '1';
                contentTextarea.group.style.display = 'flex';
                contentTextarea.group.style.flexDirection = 'column';

                // Ensure textarea fills container
                const textareaContainer = contentTextarea.group.querySelector('.float-label-container');
                if (textareaContainer) {
                    textareaContainer.style.flex = '1';
                    textareaContainer.style.display = 'flex';
                    textareaContainer.style.flexDirection = 'column';
                    contentTextarea.textarea.style.flex = '1';
                }

                if (isEdit && editData) {
                    contentTextarea.textarea.value = editData.content || '';
                }

                content.appendChild(nameInput.group);
                content.appendChild(typeSelect.group);
                content.appendChild(categoryRow);
                content.appendChild(contentTextarea.group);

                content.nameInput = nameInput.input;
                content.typeSelect = typeSelect.select;
                content.categoryInput = categoryComboBox.input;
                content.showInSelectButton = showInSelectButton;
                content.contentTextarea = contentTextarea.textarea;

                // Focus name input
                setTimeout(() => {
                    nameInput.input.focus();
                }, 100);
            },
            onSave: (content) => {
                const name = content.nameInput.value.trim();
                const type = content.typeSelect.value;
                const category = content.categoryInput.value.trim();
                const showIn = content.showInSelectButton.getValue();
                const promptContent = content.contentTextarea.value.trim();

                if (!name || !promptContent) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? tUI("Edit failed") : tUI("Add failed"),
                        detail: "Rule name and content cannot be empty",
                        life: 3000
                    });
                    return;
                }

                // Get target array based on type
                let targetArray;
                if (type === 'expand') {
                    targetArray = this.expandPrompts;
                } else if (type === 'zhVision') {
                    targetArray = this.zhVisionPrompts;
                } else if (type === 'enVision') {
                    targetArray = this.enVisionPrompts;
                } else if (type === 'video') {
                    targetArray = this.videoPrompts;
                } else {
                    logger.error(`Unknown rule type: ${type}`);
                    return;
                }

                // Check for duplicate name (exclude self when editing)
                const isDuplicate = targetArray.some(p =>
                    (p.name === name || p.id === name) && (!isEdit || p.id !== promptId)
                );

                if (isDuplicate) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? tUI("Edit failed") : tUI("Add failed"),
                        detail: `${tUI('Rule name')} "${name}" ${tUI('already exists')}`,
                        life: 3000
                    });
                    return;
                }

                if (isEdit) {
                    // Edit mode: update existing data
                    if (editData) {
                        // If type changed, remove from original array and add to new one
                        if (type !== defaultType) {
                            // Remove from original array
                            let originalArray;
                            if (defaultType === 'expand') {
                                originalArray = this.expandPrompts;
                            } else if (defaultType === 'zhVision') {
                                originalArray = this.zhVisionPrompts;
                            } else if (defaultType === 'enVision') {
                                originalArray = this.enVisionPrompts;
                            }
                            const index = originalArray.findIndex(p => p.id === promptId);
                            if (index !== -1) {
                                originalArray.splice(index, 1);
                            }

                            // Add to new array
                            // Set different ID prefixes for different rule types
                            let newId;
                            if (type === 'expand') {
                                newId = 'expand_' + name.replace(/\s+/g, '_');
                            } else if (type === 'zhVision') {
                                newId = 'vision_zh_' + name.replace(/\s+/g, '_');
                            } else if (type === 'enVision') {
                                newId = 'vision_en_' + name.replace(/\s+/g, '_');
                            } else {
                                newId = this._generateId();
                            }

                            const newPrompt = {
                                id: newId,
                                name: name,
                                category: category,
                                showIn: showIn,
                                content: promptContent,
                                isActive: false,
                                order: targetArray.length // Set order to current array length
                            };
                            targetArray.push(newPrompt);
                            logger.debug(`Cross-type edit rule | original type:${defaultType} | new type:${type} | new ID:${newId}`);
                        } else {
                            // Same type edit, update directly
                            const oldName = editData.name;
                            editData.name = name;
                            editData.category = category;
                            editData.showIn = showIn;
                            editData.content = promptContent;

                            // If name changed, update ID
                            if (oldName !== name) {
                                const oldId = editData.id;
                                let newId;

                                // Set different ID prefixes based on type
                                if (type === 'expand') {
                                    newId = 'expand_' + name.replace(/\s+/g, '_');
                                } else if (type === 'zhVision') {
                                    newId = 'vision_zh_' + name.replace(/\s+/g, '_');
                                } else if (type === 'enVision') {
                                    newId = 'vision_en_' + name.replace(/\s+/g, '_');
                                } else if (type === 'video') {
                                    newId = 'video_' + name.replace(/\s+/g, '_');
                                } else {
                                    newId = name;
                                }

                                editData.id = newId;
                                logger.debug(`Updated rule ID | type:${type} | old ID:${oldId} | new ID:${newId}`);
                            }
                        }
                    }
                } else {
                    // Add mode: create new data
                    // Set different ID prefixes based on type
                    let newId;
                    if (type === 'expand') {
                        newId = 'expand_' + name.replace(/\s+/g, '_');
                    } else if (type === 'zhVision') {
                        newId = 'vision_zh_' + name.replace(/\s+/g, '_');
                    } else if (type === 'enVision') {
                        newId = 'vision_en_' + name.replace(/\s+/g, '_');
                    } else if (type === 'video') {
                        newId = 'video_' + name.replace(/\s+/g, '_');
                    } else {
                        newId = name;
                    }

                    const newPrompt = {
                        id: newId,
                        name: name,
                        category: category,
                        showIn: showIn,
                        content: promptContent,
                        isActive: false, // Default not active
                        order: targetArray.length // Set order to current array length, ensure added to end
                    };
                    targetArray.push(newPrompt);

                    // Output debug info
                    logger.debug(`Added new rule | type:${type} | ID:${newId} | order:${newPrompt.order} | array length:${targetArray.length}`);
                }

                // Mark as modified
                this._setDirty();

                // Re-render corresponding list
                this._renderPromptLists();

                return true;
            }
        });
    }

    /**
     * Generate unique ID
     * @returns {string} Unique ID
     */
    _generateId() {
        return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Refresh all rule lists
     * Note: For consistency, it is recommended to directly use _renderPromptLists method
     */
    _refreshPromptLists() {
        // Directly call _renderPromptLists method to ensure consistency
        this._renderPromptLists();
    }

    /**
     * Toggle rule active status
     * @param {string} type Type
     * @param {string} promptId Rule ID
     */
    _togglePromptActive(type, promptId) {
        // Get corresponding data array
        let dataArray;
        let activeIdProperty;
        let configKey; // Key name for saving to config

        switch (type) {
            case 'expand':
                dataArray = this.expandPrompts;
                activeIdProperty = 'activeExpandPromptId';
                configKey = 'expand';
                break;
            case 'zhVision':
                dataArray = this.zhVisionPrompts;
                activeIdProperty = 'activeZhVisionPromptId';
                configKey = 'vision_zh';
                break;
            case 'enVision':
                dataArray = this.enVisionPrompts;
                activeIdProperty = 'activeEnVisionPromptId';
                configKey = 'vision_en';
                break;
            case 'video':
                dataArray = this.videoPrompts;
                activeIdProperty = 'activeVideoPromptId';
                configKey = 'video';
                break;
            default:
                return;
        }


        // Find target rule
        const targetPrompt = dataArray.find(p => p.id === promptId);
        if (!targetPrompt) return;

        // Record previous activation state
        const oldActiveId = this[activeIdProperty];
        const wasActive = targetPrompt.isActive;

        // If current rule is already active, deactivate it
        if (targetPrompt.isActive) {
            targetPrompt.isActive = false;
            this[activeIdProperty] = null;
            logger.debug(`Deactivated rule | type:${type} | ID:${promptId} | config key:${configKey}`);
        } else {
            // Deactivate all other rules
            dataArray.forEach(p => p.isActive = false);
            // Activate current rule
            targetPrompt.isActive = true;
            this[activeIdProperty] = promptId;
            logger.debug(`Activated rule | type:${type} | ID:${promptId} | config key:${configKey} | old ID:${oldActiveId}`);
        }

        // Mark as modified
        this._setDirty();

        // Re-render list
        this._renderPromptLists();

        // Output activation state change
        logger.debug(`Activation state change | type:${type} | rule:${targetPrompt.name} | ID:${promptId} | old state:${wasActive} | new state:${targetPrompt.isActive} | instance property:${this[activeIdProperty]}`);

        // If systemPrompts object exists, directly update its active_prompts
        if (this.systemPrompts && this.systemPrompts.active_prompts) {
            const oldValue = this.systemPrompts.active_prompts[configKey];
            this.systemPrompts.active_prompts[configKey] = targetPrompt.isActive ? promptId : null;
            logger.debug(`Updated system prompts object | config key:${configKey} | old value:${oldValue} | new value:${this.systemPrompts.active_prompts[configKey]}`);
        }

        logger.debug(`${type} rule status toggle: ${promptId} -> ${targetPrompt.isActive ? 'Activated' : 'Deactivated'}`);
    }

    /**
     * Delete rule
     * @param {string} type Type
     * @param {string} promptId Rule ID
     */
    _deletePrompt(type, promptId) {
        // Get corresponding data array
        let dataArray;
        switch (type) {
            case 'expand':
                dataArray = this.expandPrompts;
                break;
            case 'zhVision':
                dataArray = this.zhVisionPrompts;
                break;
            case 'enVision':
                dataArray = this.enVisionPrompts;
                break;
            case 'video':
                dataArray = this.videoPrompts;
                break;
            default:
                return;
        }

        // Find index of rule to delete
        const index = dataArray.findIndex(p => p.id === promptId);
        if (index === -1) return;

        // Get rule name for prompt
        const promptName = dataArray[index].name;

        // Create confirmation dialog (use danger button style)
        createSettingsDialog({
            title: `<i class="pi pi-exclamation-triangle" style="margin-right: 8px; color: var(--p-orange-500);"></i>${tUI('Confirm Delete')}`,
            isConfirmDialog: true,
            dialogClassName: 'confirm-dialog',
            disableBackdropAndCloseOnClickOutside: true,
            saveButtonText: tUI('Delete'),
            saveButtonIcon: 'pi-trash',
            isDangerButton: true,
            cancelButtonText: tUI('Cancel'),
            renderContent: (content) => {
                content.style.textAlign = 'center';
                content.style.padding = '1rem';

                const confirmMessage = document.createElement('p');
                confirmMessage.textContent = `${tUI('Are you sure you want to delete the rule')} "${promptName}" ${tUI('?')}`;
                confirmMessage.style.margin = '0';
                confirmMessage.style.fontSize = '1rem';

                content.appendChild(confirmMessage);
            },
            onSave: () => {
                // Remove rule from array
                dataArray.splice(index, 1);

                // Mark as modified
                this._setDirty();

                // Re-render list
                this._renderPromptLists();

                return true;
            }
        });
    }


    /**
     * Save current configuration to server
     * @returns {Promise} Promise of the save operation
     */
    async _saveConfigToServer() {
        try {
            // Get original version number (from loaded systemPrompts)
            const configVersion = this.systemPrompts?.__config_version || '2.0';

            // Build system prompts configuration (preserve version number)
            const systemPrompts = {
                __config_version: configVersion,
                expand_prompts: {},
                translate_prompts: {},
                vision_prompts: {},
                video_prompts: {},
                active_prompts: {
                    expand: null,
                    vision_zh: null,
                    vision_en: null,
                    video: null
                }
            };

            // Add translation rules (dynamically built from this.translatePrompts)
            (this.translatePrompts || []).forEach(prompt => {
                systemPrompts.translate_prompts[prompt.id] = {
                    role: prompt.role || 'system',
                    content: prompt.content
                };
            });


            // Create an ordered rule list
            const orderedExpandPrompts = [...this.expandPrompts].sort((a, b) => a.order - b.order);

            // Add expand rules and record active rule ID
            orderedExpandPrompts.forEach(prompt => {
                systemPrompts.expand_prompts[prompt.id] = {
                    name: prompt.name,
                    tags: prompt.tags || [],
                    category: prompt.category || '',
                    showIn: prompt.showIn || ['frontend', 'node'],
                    role: "system",
                    content: prompt.content
                };

                // Record active rule ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.expand = prompt.id;
                    logger.debug(`Saved active prompt enhancement rule ID: ${prompt.id}`);
                }
            });

            // If no active expand rule found, use instance property saved ID
            if (!systemPrompts.active_prompts.expand && this.activeExpandPromptId) {
                systemPrompts.active_prompts.expand = this.activeExpandPromptId;
                logger.debug(`Using instance property prompt enhancement rule ID: ${this.activeExpandPromptId}`);
            }

            // Create ordered Chinese and English caption rule lists
            const orderedZhVisionPrompts = [...this.zhVisionPrompts].sort((a, b) => a.order - b.order);
            const orderedEnVisionPrompts = [...this.enVisionPrompts].sort((a, b) => a.order - b.order);

            // Add Chinese caption rules
            orderedZhVisionPrompts.forEach(prompt => {
                systemPrompts.vision_prompts[prompt.id] = {
                    name: prompt.name,
                    tags: prompt.tags || [],
                    category: prompt.category || '',
                    showIn: prompt.showIn || ['frontend', 'node'],
                    role: "system",
                    content: prompt.content
                };

                // Record active rule ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.vision_zh = prompt.id;
                    logger.debug(`Saved active Chinese caption rule ID: ${prompt.id}`);
                }
            });

            // If no active Chinese caption rule found, use instance property saved ID
            if (!systemPrompts.active_prompts.vision_zh && this.activeZhVisionPromptId) {
                systemPrompts.active_prompts.vision_zh = this.activeZhVisionPromptId;
                logger.debug(`Using instance property Chinese caption rule ID: ${this.activeZhVisionPromptId}`);
            }

            // Add English caption rules
            orderedEnVisionPrompts.forEach(prompt => {
                systemPrompts.vision_prompts[prompt.id] = {
                    name: prompt.name,
                    tags: prompt.tags || [],
                    category: prompt.category || '',
                    showIn: prompt.showIn || ['frontend', 'node'],
                    role: "system",
                    content: prompt.content
                };

                // Record active rule ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.vision_en = prompt.id;
                    logger.debug(`Saved active English caption rule ID: ${prompt.id}`);
                }
            });

            // If no active English caption rule found, use instance property saved ID
            if (!systemPrompts.active_prompts.vision_en && this.activeEnVisionPromptId) {
                systemPrompts.active_prompts.vision_en = this.activeEnVisionPromptId;
                logger.debug(`Using instance property English caption rule ID: ${this.activeEnVisionPromptId}`);
            }

            // Add video caption rules
            const orderedVideoPrompts = [...(this.videoPrompts || [])].sort((a, b) => a.order - b.order);
            orderedVideoPrompts.forEach(prompt => {
                systemPrompts.video_prompts[prompt.id] = {
                    name: prompt.name,
                    tags: prompt.tags || [],
                    category: prompt.category || '',
                    showIn: prompt.showIn || ['frontend', 'node'],
                    role: "system",
                    content: prompt.content
                };

                // Record active rule ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.video = prompt.id;
                    logger.debug(`Saved active video caption rule ID: ${prompt.id}`);
                }
            });

            // If no active video caption rule found, use instance property saved ID
            if (!systemPrompts.active_prompts.video && this.activeVideoPromptId) {
                systemPrompts.active_prompts.video = this.activeVideoPromptId;
                logger.debug(`Using instance property video caption rule ID: ${this.activeVideoPromptId}`);
            }

            // Output final active state
            logger.debug(`Final active rule IDs: expand=${systemPrompts.active_prompts.expand}, vision_zh=${systemPrompts.active_prompts.vision_zh}, vision_en=${systemPrompts.active_prompts.vision_en}, video=${systemPrompts.active_prompts.video}`);


            const response = await fetch(APIService.getApiUrl('/config/system_prompts'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(systemPrompts)
            });

            if (!response.ok) {
                throw new Error(`Save failed: ${response.status} ${response.statusText}`);
            }

            logger.debug('Configuration successfully saved to server');
            return true;
        } catch (error) {
            logger.error(`Failed to save system rules configuration: ${error.message}`);
            throw error;
        }
    }

    /**
     * Add column width resizer handles to header cells
     * @param {HTMLElement} headerRow Header row element
     */
    _addHeaderResizers(headerRow) {
        const cells = headerRow.querySelectorAll('.prompt-list-cell');
        // Add resizer to first three columns (last action column does not need)
        for (let i = 0; i < cells.length - 1; i++) {
            const cell = cells[i];
            const resizer = document.createElement('div');
            resizer.className = 'column-resizer';
            cell.appendChild(resizer);
            this._addColumnResizer(resizer, cell);
        }
    }

    /**
     * Add column width resize functionality
     * @param {HTMLElement} resizer Resizer handle element
     * @param {HTMLElement} column Column element
     */
    _addColumnResizer(resizer, column) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(document.defaultView.getComputedStyle(column).width, 10);

            // Add drag state style
            resizer.classList.add('resizing');
            document.body.classList.add('column-resizing');

            // Add event listeners
            document.addEventListener('mousemove', handleMouseMove, { capture: true });
            document.addEventListener('mouseup', handleMouseUp, { capture: true });

            e.preventDefault();
            e.stopPropagation();
        });

        const handleMouseMove = (e) => {
            if (!isResizing) return;

            e.preventDefault();
            e.stopPropagation();

            const deltaX = e.clientX - startX;
            const newWidth = startWidth + deltaX;

            // Set min and max width limits
            const minWidth = 80;
            const maxWidth = 500;

            if (newWidth >= minWidth && newWidth <= maxWidth) {
                // Get column class to determine which column
                const columnClass = Array.from(column.classList).find(cls =>
                    cls.includes('-cell') && cls !== 'prompt-list-cell'
                );

                if (columnClass) {
                    // Resize all same-type columns simultaneously
                    const allColumns = document.querySelectorAll(`.${columnClass}`);
                    allColumns.forEach(col => {
                        col.style.width = newWidth + 'px';
                        col.style.flexShrink = '0';
                        col.style.flexGrow = '0';
                        col.style.flexBasis = newWidth + 'px';
                    });
                } else {
                    // If no specific class found, only resize current column
                    column.style.width = newWidth + 'px';
                    column.style.flexShrink = '0';
                    column.style.flexGrow = '0';
                    column.style.flexBasis = newWidth + 'px';
                }
            }
        };

        const handleMouseUp = (e) => {
            if (!isResizing) return;

            isResizing = false;

            // Get column class to determine which column
            const columnClass = Array.from(column.classList).find(cls =>
                cls.includes('-cell') && cls !== 'prompt-list-cell'
            );

            // Reset flex properties to allow future resizing
            if (columnClass) {
                const allColumns = document.querySelectorAll(`.${columnClass}`);
                allColumns.forEach(col => {
                    col.style.flexShrink = '';
                    col.style.flexGrow = '';
                    col.style.flexBasis = '';
                });
            } else {
                column.style.flexShrink = '';
                column.style.flexGrow = '';
                column.style.flexBasis = '';
            }

            // Remove drag state style
            resizer.classList.remove('resizing');
            document.body.classList.remove('column-resizing');

            // Remove event listeners
            document.removeEventListener('mousemove', handleMouseMove, { capture: true });
            document.removeEventListener('mouseup', handleMouseUp, { capture: true });

            e.preventDefault();
            e.stopPropagation();
        };

        // Add mouse enter and leave events for enhanced visual feedback
        resizer.addEventListener('mouseenter', () => {
            if (!isResizing) {
                resizer.style.opacity = '0.6';
            }
        });

        resizer.addEventListener('mouseleave', () => {
            if (!isResizing) {
                resizer.style.opacity = '';
            }
        });
    }

    /**
     * Initialize drag sorting functionality
     * @param {HTMLElement} container List container
     * @param {string} type Type
     */
    _initSortable(container, type) {
        // Check if Sortable library is loaded
        if (typeof Sortable === 'undefined') {
            this._loadSortableLibrary().then(() => {
                this._createSortableInstance(container, type);
            }).catch(error => {
                logger.error('Failed to load Sortable library:', error);
            });
        } else {
            this._createSortableInstance(container, type);
        }
    }

    /**
     * Load Sortable library
     * @returns {Promise}
     */
    _loadSortableLibrary() {
        return new Promise((resolve, reject) => {
            if (typeof Sortable !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = '/custom_nodes/comfyui_prompt_assistant/js/lib/Sortable.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Sortable library'));
            document.head.appendChild(script);
        });
    }

    /**
     * Create Sortable instance
     * @param {HTMLElement} container List container
     * @param {string} type Type
     */
    _createSortableInstance(container, type) {
        new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            handle: '.prompt-list-row',
            // Exclude status and action columns, only allow drag from name and content columns
            filter: '.status-cell, .action-cell',
            preventOnFilter: true,
            onStart: (evt) => {
                logger.debug(`Start drag: type=${type}, old index=${evt.oldIndex}`);
            },
            onEnd: (evt) => {
                logger.debug(`End drag: type=${type}, old index=${evt.oldIndex}, new index=${evt.newIndex}`);
                this._handleSortEnd(evt, type);
            }
        });
    }

    /**
     * Handle drag sort end event
     * @param {Event} evt Sort event
     * @param {string} type Type
     */
    _handleSortEnd(evt, type) {
        const { oldIndex, newIndex } = evt;
        if (oldIndex === newIndex) return;

        // Get corresponding data array
        let dataArray;
        switch (type) {
            case 'expand':
                dataArray = this.expandPrompts;
                break;
            case 'zhVision':
                dataArray = this.zhVisionPrompts;
                break;
            case 'enVision':
                dataArray = this.enVisionPrompts;
                break;
            case 'video':
                dataArray = this.videoPrompts;
                break;
            default:
                return;
        }

        // Output order info before sorting
        logger.debug(`Before sort data: ${JSON.stringify(dataArray.map(item => ({ id: item.id, order: item.order })))}`);

        // Reorder data
        const movedItem = dataArray.splice(oldIndex, 1)[0];
        dataArray.splice(newIndex, 0, movedItem);

        // Update order property for all items
        dataArray.forEach((item, index) => {
            item.order = index;
        });

        // Output order info after sorting
        logger.debug(`After sort data: ${JSON.stringify(dataArray.map(item => ({ id: item.id, order: item.order })))}`);
        logger.debug(`${type} list order updated: ${oldIndex} -> ${newIndex} | Moved item ID: ${movedItem.id}`);

        // Mark as modified
        this._setDirty();
    }
}

// Export rules config manager instance
export const rulesConfigManager = new RulesConfigManager();