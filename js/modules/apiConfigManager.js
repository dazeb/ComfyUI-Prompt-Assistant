/**
 * API Configuration Manager v2.0
 * Supports dynamic provider management and multi-model configuration
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import {
    createSettingsDialog,
    createFormGroup,
    createInputGroup,
    createSelectGroup,
    createHorizontalFormGroup,
    createSwitchControl,
    createConfirmPopup,
    createContextMenu,
    createTooltip,
    createMultiSelectListbox
} from "./uiComponents.js";
import { APIService } from "../services/api.js";
import { tUI } from "../utils/uiI18n.js";

// Sortable library is already loaded via script tag, use global variable directly

class APIConfigManager {
    // Preset provider IDs (not editable/deletable)
    static PRESET_SERVICE_IDS = ['zhipu', 'xFlow', 'ollama'];

    constructor() {
        // Provider data
        this.services = [];
        this.currentServices = { llm: null, vlm: null };

        // Baidu Translate config
        this.baiduConfig = { app_id: '', secret_key: '' };
    }

    /**
     * Notify the system that API config has been updated
     * Triggers the pa-config-updated event to notify settings.js and other modules to refresh
     */
    notifyConfigChange() {
        logger.debug('Dispatching API config update event: pa-config-updated');
        window.dispatchEvent(new CustomEvent('pa-config-updated'));
    }

    /**
     * Show API configuration modal
     */
    async showAPIConfigModal() {
        try {
            logger.debug('Opening API configuration modal v2.0');

            createSettingsDialog({
                title: `<i class="pi pi-cog" style="margin-right: 8px;"></i>${tUI('API Manager')}`,
                dialogClassName: 'api-config-dialog-v2',
                disableBackdropAndCloseOnClickOutside: true,
                hideFooter: true,  // Do not show save/cancel buttons at the bottom
                renderNotice: (noticeArea) => {
                    const subtitle = document.createElement('div');
                    subtitle.className = 'api-config-warning';
                    subtitle.textContent = `*${tUI('Disclaimer: This plugin only provides API calling tools. Third-party service responsibilities are unrelated to this plugin. All user configuration information related to the plugin is stored locally. This plugin assumes no responsibility for any issues arising from account usage!')}`;
                    noticeArea.appendChild(subtitle);
                },
                renderContent: async (container) => {
                    await this._loadAllConfigs();
                    this._createAPIConfigUI(container);
                },
                onSave: async () => {
                    // Manual save is no longer needed because it is already saved in real-time
                }
            });
        } catch (error) {
            logger.error(`Failed to open API configuration modal: ${error.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Failed to open configuration",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * Load all configurations
     */
    async _loadAllConfigs() {
        try {
            // Load provider list
            const servicesRes = await fetch(APIService.getApiUrl('/services'));
            const servicesData = await servicesRes.json();

            if (servicesData.success) {
                this.services = servicesData.services || [];
            }

            // Load Baidu Translate config
            const baiduRes = await fetch(APIService.getApiUrl('/config/baidu_translate'));
            this.baiduConfig = await baiduRes.json();

            // Load current service config to get current_services
            const llmRes = await fetch(APIService.getApiUrl('/config/llm'));
            const llmConfig = await llmRes.json();
            if (llmConfig.provider) {
                this.currentServices.llm = llmConfig.provider;
            }

            const vlmRes = await fetch(APIService.getApiUrl('/config/vision'));
            const vlmConfig = await vlmRes.json();
            if (vlmConfig.provider) {
                this.currentServices.vlm = vlmConfig.provider;
            }

            logger.debug('Configuration loaded successfully', {
                services: this.services.length,
                currentLLM: this.currentServices.llm,
                currentVLM: this.currentServices.vlm
            });
        } catch (error) {
            logger.error('Failed to load configuration', error);
            throw error;
        }
    }

    /**
     * Save all configurations
     */
    async _saveAllConfigs() {
        try {
            // Save Baidu Translate config
            await fetch(APIService.getApiUrl('/config/baidu_translate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.baiduConfig)
            });

            app.extensionManager.toast.add({
                severity: "success",
                summary: "Configuration saved",
                life: 3000
            });
        } catch (error) {
            logger.error('Failed to save configuration', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Save failed",
                detail: error.message,
                life: 3000
            });
            throw error;
        }
    }

    /**
     * Save Baidu Translate config
     */
    async _saveBaiduConfig() {
        try {
            await fetch(APIService.getApiUrl('/config/baidu_translate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.baiduConfig)
            });

            logger.debug('Baidu Translate config saved');

            // Trigger config sync event
            this.notifyConfigChange();

            // Show success notification
            app.extensionManager.toast.add({
                severity: "success",
                summary: "Baidu Translate config saved",
                life: 2000
            });
        } catch (error) {
            logger.error('Failed to save Baidu Translate config', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Save failed",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * Create API configuration UI
     */
    _createAPIConfigUI(container) {
        // Create tab container
        const tabContainer = document.createElement('div');
        tabContainer.className = 'api-config-tabs';

        // Create tab header (dynamically generate all provider tabs)
        const tabHeader = this._createTabHeader();
        tabContainer.appendChild(tabHeader);

        // Create tab content container
        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';

        // Create Baidu Translate tab
        const baiduContent = this._createBaiduTab();
        tabContent.appendChild(baiduContent);

        // Dynamically create tab content for each provider
        this.services.forEach(service => {
            const serviceContent = this._createServiceContentTab(service);
            tabContent.appendChild(serviceContent);
        });

        tabContainer.appendChild(tabContent);
        container.appendChild(tabContainer);

        // Display the first tab by default
        this._switchTab('baidu', tabHeader, tabContent);
    }

    /**
     * Create tab header (includes all providers)
     */
    _createTabHeader() {
        const header = document.createElement('div');
        header.className = 'tab-header';

        // Baidu Translate tab
        const baiduTab = this._createTabButton('baidu', tUI('Baidu Translate'), tUI('Machine Translation'));
        header.appendChild(baiduTab);

        // Dynamically create provider tabs
        this.services.forEach(service => {
            const tabButton = this._createTabButton(
                service.id,
                service.name || tUI('Unnamed Service'),
                service.description || ''
            );
            header.appendChild(tabButton);
        });

        // Create "+" add tab button
        const addButton = document.createElement('button');
        addButton.className = 'service-tab-add';
        addButton.innerHTML = '<i class="pi pi-plus"></i>';
        addButton.addEventListener('click', () => this._addNewService(header, header.nextElementSibling));
        header.appendChild(addButton);

        // Initialize drag-and-drop sorting
        new Sortable(header, {
            handle: '.tab-button',
            draggable: '.tab-button',
            filter: '.service-tab-add',  // Exclude the "+" button
            animation: 150,
            onEnd: async (evt) => {
                await this._updateServicesOrder();
            }
        });

        return header;
    }

    /**
     * Update provider order
     */
    async _updateServicesOrder() {
        try {
            // Read current tab order from DOM
            const header = document.querySelector('.tab-header');
            const buttons = header.querySelectorAll('.tab-button');
            const serviceIds = [];

            buttons.forEach(btn => {
                const tabId = btn.dataset.tab;
                // Exclude special tabs (e.g., Baidu Translate)
                if (tabId && tabId !== 'baidu') {
                    serviceIds.push(tabId);
                }
            });

            // Call backend API to save order
            const res = await fetch(APIService.getApiUrl('/services/order'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service_ids: serviceIds })
            });

            const result = await res.json();

            if (result.success) {
                // Update local service list order
                const orderedServices = [];
                serviceIds.forEach(id => {
                    const service = this.services.find(s => s.id === id);
                    if (service) {
                        orderedServices.push(service);
                    }
                });

                // Add services not in orderedServices
                this.services.forEach(s => {
                    if (!orderedServices.find(os => os.id === s.id)) {
                        orderedServices.push(s);
                    }
                });

                this.services = orderedServices;

                logger.debug('Provider order updated', { order: serviceIds });

                // Trigger config sync event
                this.notifyConfigChange();
            } else {
                throw new Error(result.error || 'Failed to update order');
            }
        } catch (error) {
            logger.error('Failed to update provider order', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Failed to update order",
                detail: error.message,
                life: 3000
            });
        }
    }


    /**
     * Create a single tab button
     */
    _createTabButton(tabId, title, subtitle) {
        const button = document.createElement('button');
        button.className = 'tab-button';
        button.dataset.tab = tabId;

        // Tab title
        const titleEl = document.createElement('div');
        titleEl.className = 'tab-title';
        titleEl.textContent = title;
        button.appendChild(titleEl);

        // Tab subtitle (description)
        if (subtitle) {
            const subtitleEl = document.createElement('div');
            subtitleEl.className = 'tab-subtitle';
            subtitleEl.textContent = subtitle;
            button.appendChild(subtitleEl);
        }

        // Click to switch tab
        button.addEventListener('click', () => {
            this._switchTab(tabId, button.parentElement, button.parentElement.nextElementSibling);
        });

        // Attach right-click menu for provider tabs (except Baidu Translate and preset providers)
        // Preset providers cannot be edited/deleted; only user-defined providers have right-click menu
        const isPresetService = APIConfigManager.PRESET_SERVICE_IDS.includes(tabId);
        if (tabId !== 'baidu' && !isPresetService) {
            this._attachServiceContextMenu(button, tabId, title);
        }

        return button;
    }

    /**
     * Switch tab
     */
    _switchTab(tabId, header, contentContainer) {
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
    }

    /**
     * Attach right-click menu for service tab
     */
    _attachServiceContextMenu(button, serviceId, serviceName) {
        createContextMenu({
            target: button,
            items: [
                {
                    label: tUI('Edit provider name'),
                    icon: 'pi-pencil',
                    onClick: () => {
                        this._editServiceName(button, serviceId, serviceName);
                    }
                },
                {
                    separator: true
                },
                {
                    label: tUI('Delete service'),
                    icon: 'pi-trash',
                    danger: true,  // Mark as dangerous action, icon shown in red
                    onClick: () => {
                        this._deleteService(serviceId, serviceName);
                    }
                }
            ]
        });
    }

    /**
     * Edit provider name
     */
    _editServiceName(triggerButton, serviceId, currentName) {
        const service = this.services.find(s => s.id === serviceId);
        if (!service) return;

        createConfirmPopup({
            target: triggerButton,
            message: tUI('Edit provider information'),
            icon: 'pi-pencil',
            position: 'bottom',
            confirmLabel: tUI('Save'),
            cancelLabel: tUI('Cancel'),
            renderFormContent: (formContainer) => {
                // Provider name input
                const nameInput = createInputGroup(tUI('Provider Name'), tUI('Please enter provider name'));
                nameInput.input.value = service.name || currentName;
                nameInput.input.dataset.fieldName = 'serviceName';
                formContainer.appendChild(nameInput.group);

                // Provider description input
                const descInput = createInputGroup(tUI('Provider Description'), tUI('Please enter provider description (optional)'));
                descInput.input.value = service.description || '';
                descInput.input.dataset.fieldName = 'serviceDescription';
                formContainer.appendChild(descInput.group);
            },
            onConfirm: async (formContainer) => {
                try {
                    const nameInput = formContainer.querySelector('[data-field-name="serviceName"]');
                    const descInput = formContainer.querySelector('[data-field-name="serviceDescription"]');

                    const newName = nameInput.value.trim();
                    const newDescription = descInput.value.trim();

                    if (!newName) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: tUI("Please enter provider name"),
                            life: 2000
                        });
                        throw new Error(tUI('Provider name cannot be empty'));
                    }

                    // Update provider information
                    await this._updateService(serviceId, {
                        name: newName,
                        description: newDescription
                    });

                    // Update button display
                    const titleEl = triggerButton.querySelector('.tab-title');
                    const subtitleEl = triggerButton.querySelector('.tab-subtitle');

                    if (titleEl) {
                        titleEl.textContent = newName;
                    }

                    if (subtitleEl) {
                        subtitleEl.textContent = newDescription;
                    } else if (newDescription) {
                        // If there was no subtitle before, add one now
                        const newSubtitleEl = document.createElement('div');
                        newSubtitleEl.className = 'tab-subtitle';
                        newSubtitleEl.textContent = newDescription;
                        triggerButton.appendChild(newSubtitleEl);
                    }

                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: tUI("Provider information updated"),
                        detail: `${newName} ${tUI('updated successfully')}`,
                        life: 2000
                    });
                } catch (error) {
                    logger.error('Failed to update provider information', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: tUI("Update failed"),
                        detail: error.message,
                        life: 3000
                    });
                    throw error;
                }
            }
        });
    }


    /**
     * Create provider content tab
     */
    _createServiceContentTab(service) {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = service.id;
        pane.style.display = 'none';
        pane.style.padding = '16px';

        // Provider configuration card (reuse existing card creation logic)
        const card = this._createServiceCard(service);
        pane.appendChild(card);

        return pane;
    }

    /**
     * Add new provider
     */
    async _addNewService(headerElement, contentElement) {
        // Get the trigger button as positioning reference
        const triggerButton = headerElement.querySelector('.service-tab-add');

        // Show confirmation bubble
        createConfirmPopup({
            target: triggerButton,
            message: tUI('Create new provider'),
            icon: 'pi-plus-circle',
            position: 'left',
            confirmLabel: tUI('Create'),
            cancelLabel: tUI('Cancel'),
            renderFormContent: (formContainer) => {
                // Provider name input
                const nameInput = createInputGroup(tUI('Provider Name'), tUI('Please enter provider name'));
                nameInput.input.value = tUI('New Provider');
                nameInput.input.dataset.fieldName = 'serviceName';
                formContainer.appendChild(nameInput.group);

                // Provider description input
                const descInput = createInputGroup(tUI('Provider Description'), tUI('Please enter provider description (optional)'));
                descInput.input.dataset.fieldName = 'serviceDescription';
                formContainer.appendChild(descInput.group);
            },
            onConfirm: async (formContainer) => {
                try {
                    // Get form data
                    const nameInput = formContainer.querySelector('[data-field-name="serviceName"]');
                    const descInput = formContainer.querySelector('[data-field-name="serviceDescription"]');

                    const serviceName = nameInput.value.trim();
                    const serviceDescription = descInput.value.trim();

                    if (!serviceName) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: tUI("Please enter provider name"),
                            life: 2000
                        });
                        throw new Error(tUI('Provider name cannot be empty'));
                    }

                    // Create provider
                    const res = await fetch(APIService.getApiUrl('/services'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'openai_compatible',
                            name: serviceName,
                            description: serviceDescription,
                            base_url: 'https://api.example.com/v1',
                            api_key: ''
                        })
                    });

                    const result = await res.json();

                    if (result.success) {
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: tUI("New provider created"),
                            detail: `${serviceName} ${tUI('created successfully')}`,
                            life: 3000
                        });

                        // Reload configuration
                        await this._loadAllConfigs();

                        // Get newly created service
                        const newService = this.services.find(s => s.id === result.service_id);
                        if (newService) {
                            // Create new tab button (insert before the "+" button)
                            const addButton = headerElement.querySelector('.service-tab-add');
                            const newTabButton = this._createTabButton(
                                newService.id,
                                newService.name || tUI('Unnamed Service'),
                                newService.description || ''
                            );
                            headerElement.insertBefore(newTabButton, addButton);

                            // Create new content tab
                            const newContentPane = this._createServiceContentTab(newService);
                            contentElement.appendChild(newContentPane);

                            // Switch to the new tab
                            this._switchTab(newService.id, headerElement, contentElement);
                        }

                        // Trigger config sync event
                        this.notifyConfigChange();
                    } else {
                        throw new Error(result.error || tUI('Creation failed'));
                    }
                } catch (error) {
                    logger.error('Failed to create provider', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: tUI("Creation failed"),
                        detail: error.message,
                        life: 3000
                    });
                    throw error;
                }
            }
        });
    }

    /**
     * Create Baidu Translate tab
     */
    _createBaiduTab() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'baidu';

        const section = createFormGroup(tUI('Baidu Translate Configuration'), [
            { text: tUI('Activate Baidu Translation Service'), url: 'https://fanyi-api.baidu.com/' }
        ]);
        section.classList.add('baidu-translate-section');

        // Add icon to the link, keeping consistent with other services
        const linkElement = section.querySelector('.settings-service-link');
        if (linkElement) {
            const icon = document.createElement('i');
            icon.className = 'pi pi-star';
            icon.style.marginRight = '4px';
            linkElement.insertBefore(icon, linkElement.firstChild);
        }

        const appIdInput = createInputGroup(tUI('AppID'), tUI('Please enter Baidu Translate AppID'));
        appIdInput.input.value = this.baiduConfig.app_id || '';
        appIdInput.input.addEventListener('input', (e) => {
            this.baiduConfig.app_id = e.target.value;
        });
        // Add save on blur
        appIdInput.input.addEventListener('blur', async () => {
            await this._saveBaiduConfig();
        });

        const secretInput = createInputGroup(tUI('Secret Key'), tUI('Please enter Baidu Translate secret key'));
        secretInput.input.type = 'password';
        secretInput.input.value = this.baiduConfig.secret_key || '';
        secretInput.input.addEventListener('input', (e) => {
            this.baiduConfig.secret_key = e.target.value;
        });
        // Add save on blur
        secretInput.input.addEventListener('blur', async () => {
            await this._saveBaiduConfig();
        });

        section.appendChild(appIdInput.group);
        section.appendChild(secretInput.group);
        pane.appendChild(section);

        return pane;
    }

    /**
     * Create generic provider tab (sub-tab structure)
     */
    _createServicesTab() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane services-tab-pane';
        pane.dataset.tab = 'services';
        // Style moved to CSS

        // Sub-tab navigation
        const subTabNav = document.createElement('div');
        subTabNav.className = 'service-sub-tabs';
        // Style moved to CSS

        // Sub-tab content container
        const subTabContent = document.createElement('div');
        subTabContent.className = 'service-sub-content';

        // Get generic providers
        const genericServices = this.services.filter(s => s.type === 'openai_compatible');

        // Create provider tabs
        genericServices.forEach((service, index) => {
            // Create tab button
            const tabButton = this._createServiceTabButton(service);
            subTabNav.appendChild(tabButton);

            // Create tab content
            const tabContentPane = this._createServiceTabContent(service);
            subTabContent.appendChild(tabContentPane);

            // Select the first one by default
            if (index === 0) {
                tabButton.classList.add('active');
                tabContentPane.style.display = 'block';
            }
        });

        // Create "+" add tab button
        const addTabButton = document.createElement('button');
        addTabButton.className = 'service-tab-add';
        addTabButton.textContent = '+';
        addTabButton.addEventListener('click', () => this._addNewServiceTab(subTabNav, subTabContent));
        subTabNav.appendChild(addTabButton);

        // If there are no providers, show empty state
        if (genericServices.length === 0) {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'empty-state-hint';
            emptyHint.innerHTML = `
                <div style="font-size: 48px; margin-bottom: 16px;">📦</div>
                <div style="font-size: 16px; margin-bottom: 8px;">${tUI('No providers yet')}</div>
                <div style="font-size: 14px;">${tUI('Click the "+" button in the top right to add the first provider')}</div>
            `;
            subTabContent.appendChild(emptyHint);
        }

        pane.appendChild(subTabNav);
        pane.appendChild(subTabContent);
        return pane;
    }

    /**
     * Create provider tab button
     */
    _createServiceTabButton(service) {
        const button = document.createElement('button');
        button.className = 'service-tab-button';
        button.dataset.serviceId = service.id;

        // Tab title
        const title = document.createElement('div');
        title.className = 'service-tab-title';
        title.textContent = service.name || tUI('Unnamed Service');

        // Tab subtitle (description)
        const subtitle = document.createElement('div');
        subtitle.className = 'service-tab-subtitle';
        subtitle.textContent = service.description || '';

        button.appendChild(title);
        if (service.description) {
            button.appendChild(subtitle);
        }

        // Click to switch
        button.addEventListener('click', () => {
            this._switchServiceTab(service.id);
        });

        return button;
    }

    /**
     * Switch provider tab
     */
    _switchServiceTab(serviceId) {
        const container = document.querySelector('.services-tab-pane');
        if (!container) return;

        // Update tab button state
        const buttons = container.querySelectorAll('.service-tab-button');
        buttons.forEach(btn => {
            if (btn.dataset.serviceId === serviceId) {
                btn.classList.add('active');
                btn.style.background = 'var(--p-primary-500)';
                btn.style.color = 'white';
                btn.querySelector('.service-tab-title').style.color = 'white';
                const subtitle = btn.querySelector('.service-tab-subtitle');
                if (subtitle) {
                    subtitle.style.color = 'rgba(255, 255, 255, 0.8)';
                }
            } else {
                btn.classList.remove('active');
                btn.style.background = 'transparent';
                btn.style.color = 'var(--p-text-color)';
                btn.querySelector('.service-tab-title').style.color = 'var(--p-text-color)';
                const subtitle = btn.querySelector('.service-tab-subtitle');
                if (subtitle) {
                    subtitle.style.color = 'var(--p-text-muted-color)';
                }
            }
        });

        // Update content display
        const panes = container.querySelectorAll('.service-content-pane');
        panes.forEach(pane => {
            pane.style.display = pane.dataset.serviceId === serviceId ? 'block' : 'none';
        });
    }

    /**
     * Create provider tab content
     */
    _createServiceTabContent(service) {
        const contentPane = document.createElement('div');
        contentPane.className = 'service-content-pane';
        contentPane.dataset.serviceId = service.id;
        contentPane.style.cssText = `
            display: none;
        `;

        // Create a simple placeholder content here; will be improved later
        const card = this._createServiceCard(service);
        contentPane.appendChild(card);

        return contentPane;
    }

    /**
     * Add new provider tab
     */
    async _addNewServiceTab(navContainer, contentContainer) {
        // Call backend API to create new provider
        try {
            const res = await fetch(APIService.getApiUrl('/services'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'openai_compatible',
                    name: tUI('New Provider'),
                    description: '',
                    base_url: 'https://api.example.com/v1',
                    api_key: ''
                })
            });

            const result = await res.json();

            if (result.success) {
                app.extensionManager.toast.add({
                    severity: "success",
                    summary: tUI("New provider created"),
                    detail: tUI("Please fill in the configuration information"),
                    life: 3000
                });

                // Reload configuration
                await this._loadAllConfigs();

                // Get newly created service
                const newService = this.services.find(s => s.id === result.service_id);
                if (newService) {
                    // Create new tab button (insert before the "+" button)
                    const newTabButton = this._createServiceTabButton(newService);
                    const addButton = navContainer.querySelector('.service-tab-add');
                    navContainer.insertBefore(newTabButton, addButton);

                    // Create new content
                    const newContentPane = this._createServiceTabContent(newService);
                    contentContainer.appendChild(newContentPane);

                    // Remove empty state hint (if any)
                    const emptyHint = contentContainer.querySelector('.empty-state-hint');
                    if (emptyHint) {
                        emptyHint.remove();
                    }

                    // Switch to the new tab
                    this._switchServiceTab(newService.id);
                }
            } else {
                throw new Error(result.error || tUI('Creation failed'));
            }
        } catch (error) {
            logger.error('Failed to create provider', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: tUI("Creation failed"),
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * Create Ollama tab
     */
    _createOllamaTab() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'ollama';
        // Style moved to CSS

        const ollamaService = this.services.find(s => s.type === 'ollama');

        if (ollamaService) {
            const card = this._createServiceCard(ollamaService);
            pane.appendChild(card);
        } else {
            const hint = document.createElement('div');
            hint.className = 'empty-state-hint-small';
            hint.textContent = tUI('Ollama service not configured');
            pane.appendChild(hint);
        }

        return pane;
    }

    /**
     * Create provider card
     */
    _createServiceCard(service) {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.dataset.serviceId = service.id;  // Add serviceId to dataset

        // Provider title - detect if external link is needed based on service name
        const titleText = service.name || service.id;
        const descText = service.description ? ` ${tUI('Configuration')}` : '';
        const fullTitle = `1️⃣ ${titleText}${descText}`;

        // Detect service name, add corresponding application links
        const links = [];
        const serviceName = (service.name || '').toLowerCase();
        const serviceId = (service.id || '').toLowerCase();
        const searchText = `${serviceName} ${serviceId}`.toLowerCase();

        // Zhipu service detection
        if (searchText.includes('zhipu') || searchText.includes('zhipu')) {
            links.push({
                text: tUI('Activate Zhipu API Service'),
                url: 'https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D',
                icon: 'pi-star'
            });
        }

        // SiliconFlow service detection
        if (searchText.includes('silicon') || searchText.includes('siliconflow') || searchText.includes('silicon')) {
            links.push({
                text: tUI('Activate SiliconFlow API Service'),
                url: 'https://cloud.siliconflow.cn/i/FCDL2zBQ',
                icon: 'pi-star'
            });
        }

        // xflow service detection
        if (searchText.includes('xflow')) {
            links.push({
                text: tUI('Activate xflow API Service'),
                url: 'https://api.xflow.cc/register?aff=Z063',
                icon: 'pi-star'
            });
        }

        // Use createFormGroup for titled section with links, or plain title
        let titleSection;
        if (links.length > 0) {
            titleSection = createFormGroup(fullTitle, links.map(link => ({
                text: link.text,
                url: link.url
            })));
            // Add icons to links
            const linkElements = titleSection.querySelectorAll('.settings-service-link');
            linkElements.forEach((linkElem, index) => {
                if (links[index] && links[index].icon) {
                    const icon = document.createElement('i');
                    icon.className = `pi ${links[index].icon}`;
                    icon.style.marginRight = '4px';
                    linkElem.insertBefore(icon, linkElem.firstChild);
                }
            });
        } else {
            // No links, create plain title
            titleSection = document.createElement('div');
            titleSection.className = 'settings-form-section';
            const titleElement = document.createElement('h3');
            titleElement.className = 'settings-form-section-title';
            titleElement.textContent = fullTitle;
            titleSection.appendChild(titleElement);
        }

        // If it's an Ollama service, add a tooltip hint after the title
        if (service.type === 'ollama') {
            const titleElement = titleSection.querySelector('.settings-form-section-title');
            if (titleElement) {
                // Ensure h3 can contain other elements, set to flex for alignment
                titleElement.style.display = 'inline-flex';
                titleElement.style.alignItems = 'center';

                const icon = document.createElement('i');
                icon.className = 'pi pi-info-circle service-setting-info-icon';
                icon.style.marginLeft = '8px';
                icon.style.fontSize = '14px';
                icon.style.color = 'var(--p-text-muted-color)';
                icon.style.cursor = 'help';
                titleElement.appendChild(icon);
                
                createTooltip({
                    target: icon,
                    content: tUI('It is recommended not to add /v1 at the end of the address. Without /v1, it will use the native Ollama API; with /v1, it will use the OpenAI compatible request format.'),
                    position: 'top'
                });
            }
        }

        card.appendChild(titleSection);

        // Basic information
        const baseUrlInput = createInputGroup(tUI('Base URL'), 'https://api.example.com/v1');
        baseUrlInput.input.value = service.base_url || '';
        // Disable modification for Zhipu and xflow services' Base URL
        if (service.id === 'zhipu' || service.id === 'xFlow') {
            baseUrlInput.input.disabled = true;
            baseUrlInput.input.title = tUI('The Base URL of this preset provider cannot be modified');
            baseUrlInput.input.classList.add('pa-input-disabled');
        }

        baseUrlInput.input.addEventListener('change', async (e) => {
            await this._updateService(service.id, { base_url: e.target.value });
        });

        // API Key input (simplified, using plain text)
        const apiKeyInput = createInputGroup(tUI('API Key'), tUI('Please enter API Key'));
        apiKeyInput.input.type = 'password';
        apiKeyInput.input.value = service.api_key || '';

        // Save on blur
        apiKeyInput.input.addEventListener('blur', async (e) => {
            const newApiKey = e.target.value.trim();
            if (newApiKey !== service.api_key) {
                await this._updateService(service.id, { api_key: newApiKey });
                service.api_key = newApiKey;
            }
        });

        card.appendChild(baseUrlInput.group);
        card.appendChild(apiKeyInput.group);

        // === Service configuration area (simplified) ===
        // Create configuration items container
        const settingsInlineContainer = document.createElement('div');
        settingsInlineContainer.className = 'service-settings-inline';

        // Thinking chain control switch
        const thinkingContainer = document.createElement('div');
        thinkingContainer.className = 'service-setting-item';

        const thinkingLabel = document.createElement('span');
        thinkingLabel.className = 'service-setting-label';
        thinkingLabel.textContent = tUI('Disable Thinking Chain');

        const thinkingIcon = document.createElement('i');
        thinkingIcon.className = 'pi pi-info-circle service-setting-info-icon';

        // Add tooltip
        createTooltip({
            target: thinkingIcon,
            content: tUI('Disable thinking chain for models that support it. ⚠️: Not all models support this; disabled models will have a "✏️" symbol after the model info in logs.'),
            position: 'top'
        });

        const thinkingLabelWrapper = document.createElement('div');
        thinkingLabelWrapper.className = 'service-setting-label-wrapper';
        thinkingLabelWrapper.appendChild(thinkingLabel);
        thinkingLabelWrapper.appendChild(thinkingIcon);

        // Create switch
        const thinkingSwitchWrapper = document.createElement('label');
        thinkingSwitchWrapper.className = 'switch-wrapper';

        const thinkingInput = document.createElement('input');
        thinkingInput.type = 'checkbox';
        thinkingInput.checked = service.disable_thinking ?? true;

        const thinkingSlider = document.createElement('span');
        thinkingSlider.className = `switch-slider${thinkingInput.checked ? ' checked' : ''}`;

        const thinkingButton = document.createElement('span');
        thinkingButton.className = `switch-button${thinkingInput.checked ? ' checked' : ''}`;
        thinkingSlider.appendChild(thinkingButton);

        thinkingInput.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                thinkingSlider.classList.add('checked');
                thinkingButton.classList.add('checked');
            } else {
                thinkingSlider.classList.remove('checked');
                thinkingButton.classList.remove('checked');
            }
            await this._updateService(service.id, { disable_thinking: isChecked });
            service.disable_thinking = isChecked;
        });

        thinkingSwitchWrapper.appendChild(thinkingInput);
        thinkingSwitchWrapper.appendChild(thinkingSlider);

        thinkingContainer.appendChild(thinkingLabelWrapper);
        thinkingContainer.appendChild(thinkingSwitchWrapper);
        settingsInlineContainer.appendChild(thinkingContainer);

        // ---Enable advanced parameters switch---
        const advancedParamsContainer = document.createElement('div');
        advancedParamsContainer.className = 'service-setting-item';

        const advancedParamsLabel = document.createElement('span');
        advancedParamsLabel.className = 'service-setting-label';
        advancedParamsLabel.textContent = tUI('Enable Advanced Parameters');

        const advancedParamsIcon = document.createElement('i');
        advancedParamsIcon.className = 'pi pi-info-circle service-setting-info-icon';

        // Add tooltip
        createTooltip({
            target: advancedParamsIcon,
            content: tUI('When enabled, sends temperature, top_p, max_tokens parameters for fine control of model behavior; limits max tokens to increase speed. Disable for better compatibility.'),
            position: 'top'
        });

        const advancedParamsLabelWrapper = document.createElement('div');
        advancedParamsLabelWrapper.className = 'service-setting-label-wrapper';
        advancedParamsLabelWrapper.appendChild(advancedParamsLabel);
        advancedParamsLabelWrapper.appendChild(advancedParamsIcon);

        // Create switch
        const advancedParamsSwitchWrapper = document.createElement('label');
        advancedParamsSwitchWrapper.className = 'switch-wrapper';

        const advancedParamsInput = document.createElement('input');
        advancedParamsInput.type = 'checkbox';
        advancedParamsInput.checked = service.enable_advanced_params ?? false;

        const advancedParamsSlider = document.createElement('span');
        advancedParamsSlider.className = `switch-slider${advancedParamsInput.checked ? ' checked' : ''}`;

        const advancedParamsButton = document.createElement('span');
        advancedParamsButton.className = `switch-button${advancedParamsInput.checked ? ' checked' : ''}`;
        advancedParamsSlider.appendChild(advancedParamsButton);

        advancedParamsInput.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                advancedParamsSlider.classList.add('checked');
                advancedParamsButton.classList.add('checked');
            } else {
                advancedParamsSlider.classList.remove('checked');
                advancedParamsButton.classList.remove('checked');
            }
            await this._updateService(service.id, { enable_advanced_params: isChecked });
            service.enable_advanced_params = isChecked;
        });

        advancedParamsSwitchWrapper.appendChild(advancedParamsInput);
        advancedParamsSwitchWrapper.appendChild(advancedParamsSlider);

        advancedParamsContainer.appendChild(advancedParamsLabelWrapper);
        advancedParamsContainer.appendChild(advancedParamsSwitchWrapper);
        settingsInlineContainer.appendChild(advancedParamsContainer);

        // ---Filter thinking chain output switch---
        const filterThinkingContainer = document.createElement('div');
        filterThinkingContainer.className = 'service-setting-item';

        const filterThinkingLabel = document.createElement('span');
        filterThinkingLabel.className = 'service-setting-label';
        filterThinkingLabel.textContent = tUI('Filter Thinking Chain Output');

        const filterThinkingIcon = document.createElement('i');
        filterThinkingIcon.className = 'pi pi-info-circle service-setting-info-icon';

        // Add tooltip
        createTooltip({
            target: filterThinkingIcon,
            content: tUI('For models that cannot disable thinking chain, removes the thinking process content. Enabled by default.'),
            position: 'top'
        });

        const filterThinkingLabelWrapper = document.createElement('div');
        filterThinkingLabelWrapper.className = 'service-setting-label-wrapper';
        filterThinkingLabelWrapper.appendChild(filterThinkingLabel);
        filterThinkingLabelWrapper.appendChild(filterThinkingIcon);

        // Create switch
        const filterThinkingSwitchWrapper = document.createElement('label');
        filterThinkingSwitchWrapper.className = 'switch-wrapper';

        const filterThinkingInput = document.createElement('input');
        filterThinkingInput.type = 'checkbox';
        filterThinkingInput.checked = service.filter_thinking_output ?? true;

        const filterThinkingSlider = document.createElement('span');
        filterThinkingSlider.className = `switch-slider${filterThinkingInput.checked ? ' checked' : ''}`;

        const filterThinkingButton = document.createElement('span');
        filterThinkingButton.className = `switch-button${filterThinkingInput.checked ? ' checked' : ''}`;
        filterThinkingSlider.appendChild(filterThinkingButton);

        filterThinkingInput.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                filterThinkingSlider.classList.add('checked');
                filterThinkingButton.classList.add('checked');
            } else {
                filterThinkingSlider.classList.remove('checked');
                filterThinkingButton.classList.remove('checked');
            }
            await this._updateService(service.id, { filter_thinking_output: isChecked });
            service.filter_thinking_output = isChecked;
        });

        filterThinkingSwitchWrapper.appendChild(filterThinkingInput);
        filterThinkingSwitchWrapper.appendChild(filterThinkingSlider);

        filterThinkingContainer.appendChild(filterThinkingLabelWrapper);
        filterThinkingContainer.appendChild(filterThinkingSwitchWrapper);
        settingsInlineContainer.appendChild(filterThinkingContainer);

        // Ollama-specific: Auto unload model switch (frontend UI only)
        if (service.type === 'ollama') {
            const autoUnloadContainer = document.createElement('div');
            autoUnloadContainer.className = 'service-setting-item';

            const autoUnloadLabel = document.createElement('span');
            autoUnloadLabel.className = 'service-setting-label';
            autoUnloadLabel.textContent = tUI('Auto Unload Model');

            const autoUnloadIcon = document.createElement('i');
            autoUnloadIcon.className = 'pi pi-info-circle service-setting-info-icon';

            // Add tooltip
            createTooltip({
                target: autoUnloadIcon,
                content: tUI('Automatically unload the model after request to free VRAM. ⚠️ This option applies to the frontend assistant; nodes have their own options.'),
                position: 'top'
            });

            const autoUnloadLabelWrapper = document.createElement('div');
            autoUnloadLabelWrapper.className = 'service-setting-label-wrapper';
            autoUnloadLabelWrapper.appendChild(autoUnloadLabel);
            autoUnloadLabelWrapper.appendChild(autoUnloadIcon);

            // Create switch
            const autoUnloadSwitchWrapper = document.createElement('label');
            autoUnloadSwitchWrapper.className = 'switch-wrapper';

            const autoUnloadInput = document.createElement('input');
            autoUnloadInput.type = 'checkbox';
            autoUnloadInput.checked = service.auto_unload !== false;

            const autoUnloadSlider = document.createElement('span');
            autoUnloadSlider.className = `switch-slider${autoUnloadInput.checked ? ' checked' : ''}`;

            const autoUnloadButton = document.createElement('span');
            autoUnloadButton.className = `switch-button${autoUnloadInput.checked ? ' checked' : ''}`;
            autoUnloadSlider.appendChild(autoUnloadButton);

            autoUnloadInput.addEventListener('change', async (e) => {
                const isChecked = e.target.checked;
                if (isChecked) {
                    autoUnloadSlider.classList.add('checked');
                    autoUnloadButton.classList.add('checked');
                } else {
                    autoUnloadSlider.classList.remove('checked');
                    autoUnloadButton.classList.remove('checked');
                }
                await this._updateService(service.id, { auto_unload: isChecked });
                service.auto_unload = isChecked;
            });

            autoUnloadSwitchWrapper.appendChild(autoUnloadInput);
            autoUnloadSwitchWrapper.appendChild(autoUnloadSlider);

            autoUnloadContainer.appendChild(autoUnloadLabelWrapper);
            autoUnloadContainer.appendChild(autoUnloadSwitchWrapper);
            settingsInlineContainer.appendChild(autoUnloadContainer);
        }

        card.appendChild(settingsInlineContainer);

        // LLM model section
        const llmSection = this._createModelSection(service, 'llm');
        card.appendChild(llmSection);

        // VLM model section
        const vlmSection = this._createModelSection(service, 'vlm');
        card.appendChild(vlmSection);

        return card;
    }


    /**
     * Create model configuration section
     */
    _createModelSection(service, modelType) {
        const section = document.createElement('div');
        section.className = 'settings-form-section';
        section.style.marginTop = '16px';

        // Title row (contains model type and + button)
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        `;

        const title = document.createElement('h5');
        title.className = 'settings-form-section-title';
        title.textContent = modelType === 'llm'
            ? tUI('2️⃣ Add Large Language Model (LLM) for translation and prompt optimization')
            : tUI('3️⃣ Add Vision Model (VLM) for image and video captioning');
        title.style.margin = '0';
        title.style.display = 'inline-flex';
        title.style.alignItems = 'center';

        const modelHintIcon = document.createElement('i');
        modelHintIcon.className = 'pi pi-exclamation-circle service-setting-info-icon';
        modelHintIcon.style.marginLeft = '8px';
        modelHintIcon.style.fontSize = '14px';
        modelHintIcon.style.color = 'var(--p-text-muted-color)';
        modelHintIcon.style.cursor = 'help';
        title.appendChild(modelHintIcon);

        createTooltip({
            target: modelHintIcon,
            content: tUI('It is recommended to prioritize non-thinking models or instruction-tuned (-instruct) models to reduce thinking chain output, truncation, and response instability.'),
            position: 'top'
        });

        // Add model button
        const addButton = document.createElement('button');
        addButton.className = 'p-button p-component p-button-sm';
        addButton.innerHTML = `<span class="p-button-icon-left pi pi-plus"></span><span class="p-button-label">${tUI('Add Model')}</span>`;
        addButton.addEventListener('click', () => this._showAddModelDialog(service, modelType, modelsContainer));

        titleRow.appendChild(title);
        titleRow.appendChild(addButton);
        section.appendChild(titleRow);

        // Model tag container (draggable sorting)
        const modelsContainer = document.createElement('div');
        modelsContainer.className = 'models-container';
        modelsContainer.dataset.serviceId = service.id;
        modelsContainer.dataset.modelType = modelType;

        const models = modelType === 'llm' ? service.llm_models : service.vlm_models;

        if (models && models.length > 0) {
            models.forEach((model) => {
                const modelTag = this._createModelTag(model, service, modelType);
                modelsContainer.appendChild(modelTag);
            });

            // Initialize Sortable drag-and-drop and save instance
            modelsContainer.sortableInstance = new Sortable(modelsContainer, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                handle: '.model-tag',  // Entire tag is draggable
                onEnd: async (evt) => {
                    // Update model order after drag ends
                    await this._updateModelOrder(service.id, modelType, modelsContainer);
                }
            });
        } else {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'empty-hint';
            emptyHint.textContent = tUI('No models configured yet. Click "+ Add Model" to start.');
            emptyHint.style.cssText = `
                font-size: 12px;
                color: var(--p-text-muted-color);
                padding: 8px;
            `;
            modelsContainer.appendChild(emptyHint);
        }

        section.appendChild(modelsContainer);

        // Removed fixed advanced settings area - now editing appears in bubble when clicking model tag

        return section;
    }

    /**
     * Create model tag
     */
    _createModelTag(model, service, modelType) {
        const tag = document.createElement('div');
        tag.className = `model-tag${model.is_default ? ' default' : ''}`;
        tag.dataset.modelName = model.name;
        tag.dataset.selected = 'false';

        // Model icon
        const iconSpan = document.createElement('i');
        iconSpan.className = 'pi pi-sparkles model-tag-icon';
        tag.appendChild(iconSpan);

        // Model name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'model-tag-name';
        nameSpan.textContent = model.name;
        tag.appendChild(nameSpan);

        // Default badge
        if (model.is_default) {
            const defaultBadge = document.createElement('span');
            defaultBadge.className = 'model-tag-badge';
            defaultBadge.textContent = tUI('Default');
            tag.appendChild(defaultBadge);
        }

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '×';
        deleteBtn.className = 'model-delete-btn';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._deleteModel(service, modelType, model.name, tag);
        });
        tag.appendChild(deleteBtn);

        // ---Click selection state---
        tag.addEventListener('click', (e) => {
            // If clicking the delete button, do not trigger selection
            if (e.target.closest('.model-delete-btn')) {
                return;
            }
            // Remove selected state from other tags in the same container
            const container = tag.parentElement;
            if (container) {
                container.querySelectorAll('.model-tag.selected').forEach(t => {
                    t.classList.remove('selected');
                });
            }
            // Add selected state to current tag
            tag.classList.add('selected');
        });

        // ---Right-click menu---
        // Use function form to dynamically get menu items, ensuring latest model state each time menu is displayed
        const getMenuItems = () => {
            // Get latest model state from local data
            const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
            const currentModel = models.find(m => m.name === model.name);
            const isDefault = currentModel ? currentModel.is_default : false;

            return [
                {
                    label: tUI('Set as Default Model'),
                    icon: 'pi-star',
                    disabled: isDefault, // Dynamically get whether it's default
                    onClick: () => {
                        this._setDefaultModel(service, modelType, model.name, tag);
                    }
                },
                { separator: true }, // Separator line
                {
                    label: tUI('Edit Model Parameter Settings'),
                    icon: 'pi-cog',
                    onClick: () => {
                        this._selectModelForEdit(service, modelType, model.name, tag);
                    }
                }
            ];
        };

        createContextMenu({
            target: tag,
            items: getMenuItems
        });

        return tag;
    }

    /**
     * Select model for editing (popup bubble)
     */
    _selectModelForEdit(service, modelType, modelName, tagElement) {
        // Save this reference
        const self = this;

        // Get model data
        const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
        const selectedModel = models.find(m => m.name === modelName);

        if (!selectedModel) return;

        // Popup bubble to edit parameters
        createConfirmPopup({
            target: tagElement,
            message: tUI('Model Parameter Settings'),
            icon: 'pi-cog',
            position: 'top',
            confirmLabel: tUI('Save'),
            cancelLabel: tUI('Cancel'),
            renderFormContent: (formContainer) => {
                // Add horizontal layout class to form container
                formContainer.classList.add('model-params-form');

                // Temperature
                const tempInput = createInputGroup(tUI('Temperature'), tUI('0.0 - 2.0'), 'number');
                tempInput.input.min = '0';
                tempInput.input.max = '2';
                tempInput.input.step = '0.1';
                tempInput.input.value = selectedModel.temperature ?? 0.7;
                tempInput.input.dataset.fieldName = 'temperature';
                tempInput.group.style.width = '135px';
                formContainer.appendChild(tempInput.group);

                // Top-P
                const topPInput = createInputGroup(tUI('Top-P'), tUI('0.0 - 1.0'), 'number');
                topPInput.input.min = '0';
                topPInput.input.max = '1';
                topPInput.input.step = '0.1';
                topPInput.input.value = selectedModel.top_p ?? 0.9;
                topPInput.input.dataset.fieldName = 'top_p';
                topPInput.group.style.width = '135px';
                formContainer.appendChild(topPInput.group);

                // Max Tokens
                const maxTokensInput = createInputGroup(tUI('Max Tokens'), tUI('1 - 8192'), 'number');
                maxTokensInput.input.min = '1';
                maxTokensInput.input.max = '8192';
                maxTokensInput.input.step = '1';
                maxTokensInput.input.value = selectedModel.max_tokens ?? 4096;
                maxTokensInput.input.dataset.fieldName = 'max_tokens';
                maxTokensInput.group.style.width = '135px';
                formContainer.appendChild(maxTokensInput.group);
            },
            onConfirm: async (formContainer) => {
                try {
                    // Get form data
                    const temperature = parseFloat(formContainer.querySelector('[data-field-name="temperature"]').value);
                    const top_p = parseFloat(formContainer.querySelector('[data-field-name="top_p"]').value);
                    const max_tokens = parseInt(formContainer.querySelector('[data-field-name="max_tokens"]').value);

                    // Validate data
                    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: tUI("Invalid temperature value"),
                            detail: tUI("Temperature must be between 0 and 2"),
                            life: 2000
                        });
                        throw new Error(tUI('Invalid temperature value'));
                    }

                    if (isNaN(top_p) || top_p < 0 || top_p > 1) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: tUI("Invalid top-p value"),
                            detail: tUI("Top-p must be between 0 and 1"),
                            life: 2000
                        });
                        throw new Error(tUI('Invalid top-p value'));
                    }

                    if (isNaN(max_tokens) || max_tokens < 1 || max_tokens > 8192) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: tUI("Invalid max tokens value"),
                            detail: tUI("Max tokens must be between 1 and 8192"),
                            life: 2000
                        });
                        throw new Error(tUI('Invalid max tokens value'));
                    }

                    // Use self instead of this to call method
                    await self._updateModelParams(service.id, modelType, modelName, {
                        temperature,
                        top_p,
                        max_tokens
                    });

                    // Update local data
                    selectedModel.temperature = temperature;
                    selectedModel.top_p = top_p;
                    selectedModel.max_tokens = max_tokens;

                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: tUI("Parameters updated"),
                        detail: `${modelName} ${tUI(' parameters saved')}`,
                        life: 2000
                    });
                } catch (error) {
                    logger.error('Failed to update model parameters', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: tUI("Update failed"),
                        detail: error.message,
                        life: 3000
                    });
                    throw error;
                }
            }
        });
    }

    /**
     * Batch update model parameters
     */
    async _updateModelParams(serviceId, modelType, modelName, params) {
        if (!serviceId) {
            logger.error("Failed to update model parameters: serviceId is empty");
            throw new Error("Service ID cannot be empty");
        }
        try {
            // Update each parameter sequentially
            for (const [paramName, paramValue] of Object.entries(params)) {
                const url = APIService.getApiUrl(`/services/${encodeURIComponent(serviceId)}/models/parameter`);
                logger.debug(`[v2] Updating parameter: ${url}`, { modelType, modelName, paramName, paramValue });

                const res = await fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model_type: modelType,
                        model_name: modelName,
                        parameter_name: paramName,
                        parameter_value: paramValue
                    })
                });

                if (!res.ok) {
                    const text = await res.text();
                    logger.error(`Parameter update request failed: ${res.status} ${res.statusText}`, text);
                    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
                }

                const text = await res.text();
                try {
                    const result = JSON.parse(text);
                    if (!result.success) {
                        throw new Error(result.error || tUI('Parameter update failed'));
                    }
                } catch (e) {
                    logger.error(`Failed to parse response JSON: ${text}`, e);
                    throw new Error(`Response parse failed: ${e.message}`);
                }
            }

            logger.debug(`Batch updated model parameters: ${modelName}`, params);

        } catch (error) {
            logger.error('Failed to batch update model parameters', error);
            throw error;
        }
    }


    /**
     * Get available model list
     */
    async _getAvailableModels(service, modelType) {
        try {
            // Call backend API to get model list
            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models?model_type=${modelType}`));
            const result = await res.json();

            // Result contains success, models or error
            return result;

        } catch (error) {
            logger.error(`Exception while fetching model list: ${error.message}`);
            return {
                success: false,
                error: `Network error: ${error.message}`
            };
        }
    }

    /**
     * Show add model list box (using multi-select component)
     */
    _showAddModelDialog(service, modelType, container) {
        // Get trigger button
        const addBtn = event.target.closest('button');

        // Use new multi-select listbox component
        createMultiSelectListbox({
            triggerElement: addBtn,
            placeholder: `${tUI('Search')}${modelType === 'llm' ? 'LLM' : 'VLM'}${tUI(' models...')}`,
            fetchItems: async () => {
                const result = await this._getAvailableModels(service, modelType);

                if (!result.success) {
                    throw new Error(result.error || tUI('Failed to get model list'));
                }

                return result.models[modelType] || [];
            },
            onConfirm: async (selectedModels, searchInputValue) => {
                // If no models are checked but search box has content, add the search box content as model name
                if (selectedModels.length === 0 && searchInputValue && searchInputValue.trim()) {
                    const modelName = searchInputValue.trim();
                    await this._addModel(service, modelType, modelName, container);
                } else {
                    // Batch add selected models
                    for (const modelName of selectedModels) {
                        await this._addModel(service, modelType, modelName, container);
                    }
                }
            }
        });
    }

    /**
     * Get recommended model list (removed, returns empty array)
     */
    async _getRecommendedModels(modelType) {
        // Recommended models removed; all models fetched from provider API
        return [];
    }

    /**
     * Add model
     */
    async _addModel(service, modelType, modelName, container) {
        try {
            // Call backend API to add model
            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_type: modelType,
                    model_name: modelName,
                    temperature: 0.7,
                    top_p: 0.9,
                    max_tokens: 4096
                })
            });

            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || tUI('Failed to add model'));
            }

            // Update local data
            const modelList = modelType === 'llm' ? service.llm_models : service.vlm_models;
            if (!modelList) {
                if (modelType === 'llm') {
                    service.llm_models = [];
                } else {
                    service.vlm_models = [];
                }
            }

            const updatedList = modelType === 'llm' ? service.llm_models : service.vlm_models;
            updatedList.push({
                name: modelName,
                is_default: updatedList.length === 0,
                temperature: 0.7,
                top_p: 0.9,
                max_tokens: 4096
            });

            // Remove empty hint
            const emptyHint = container.querySelector('.empty-hint');
            if (emptyHint) {
                emptyHint.remove();
            }

            // Add new tag
            const newTag = this._createModelTag({
                name: modelName,
                is_default: updatedList.length === 1
            }, service, modelType);
            container.appendChild(newTag);

            // Initialize or update Sortable (ensure newly added tag is draggable)
            // Destroy old Sortable instance first (if exists)
            if (container.sortableInstance) {
                container.sortableInstance.destroy();
            }

            // Create new Sortable instance
            container.sortableInstance = new Sortable(container, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                handle: '.model-tag',
                onEnd: async (evt) => {
                    await this._updateModelOrder(service.id, modelType, container);
                }
            });

            app.extensionManager.toast.add({
                severity: "success",
                summary: tUI("Model added"),
                life: 2000
            });

        } catch (error) {
            logger.error('Failed to add model', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: tUI("Add failed"),
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * Delete model
     */
    async _deleteModel(service, modelType, modelName, tagElement) {
        // Use createSettingsDialog to create confirmation window
        createSettingsDialog({
            title: `<i class="pi pi-exclamation-triangle" style="margin-right: 8px; color: var(--p-orange-500);"></i>${tUI('Confirm Deletion')}`,
            isConfirmDialog: true,
            dialogClassName: 'confirm-dialog',
            saveButtonText: tUI('Delete'),
            saveButtonIcon: 'pi-trash',
            isDangerButton: true,
            cancelButtonText: tUI('Cancel'),
            renderContent: (content) => {
                content.className = 'confirm-dialog-content-simple';

                const confirmMessage = document.createElement('p');
                confirmMessage.className = 'confirm-dialog-message-simple';
                confirmMessage.textContent = `${tUI('Are you sure you want to delete model')} "${modelName}" ${tUI('?')}`;

                content.appendChild(confirmMessage);
            },
            onSave: async () => {
                try {
                    // Call backend API to delete model
                    const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models/${modelType}/${encodeURIComponent(modelName)}`), {
                        method: 'DELETE'
                    });

                    const result = await res.json();

                    if (!result.success) {
                        throw new Error(result.error || tUI('Failed to delete model'));
                    }

                    // Update local data
                    const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
                    const index = models.findIndex(m => m.name === modelName);
                    if (index >= 0) {
                        models.splice(index, 1);
                    }

                    // Remove tag
                    tagElement.remove();

                    // If empty after deletion, show empty hint
                    const container = tagElement.parentElement;
                    if (container && container.children.length === 0) {
                        const emptyHint = document.createElement('div');
                        emptyHint.className = 'empty-hint';
                        emptyHint.textContent = tUI('No models configured yet. Click "+ Add Model" to start.');
                        emptyHint.style.cssText = `
                            font-size: 12px;
                            color: var(--p-text-muted-color);
                            padding: 8px;
                        `;
                        container.appendChild(emptyHint);
                    }

                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: tUI("Model deleted"),
                        life: 2000
                    });

                    return true; // Allow dialog to close

                } catch (error) {
                    logger.error('Failed to delete model', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: tUI("Delete failed"),
                        detail: error.message,
                        life: 3000
                    });
                    return false; // Prevent dialog from closing
                }
            }
        });
    }

    /**
     * Set default model
     */
    async _setDefaultModel(service, modelType, modelName, tagElement) {
        try {
            // Call backend API to set default model
            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models/default`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_type: modelType,
                    model_name: modelName
                })
            });

            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || tUI('Failed to set default model'));
            }

            // Update local data
            const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
            models.forEach(m => {
                m.is_default = m.name === modelName;
            });

            // ---Directly update DOM, no need to reload---
            const container = tagElement?.parentElement;
            if (container) {
                // Remove default state from all tags
                container.querySelectorAll('.model-tag').forEach(tag => {
                    tag.classList.remove('default');
                    // Remove old default badge
                    const oldBadge = tag.querySelector('.model-tag-badge');
                    if (oldBadge) {
                        oldBadge.remove();
                    }
                });

                // Add style and badge to new default model
                if (tagElement) {
                    tagElement.classList.add('default');
                    // Add default badge after name
                    const nameSpan = tagElement.querySelector('.model-tag-name');
                    if (nameSpan) {
                        const defaultBadge = document.createElement('span');
                        defaultBadge.className = 'model-tag-badge';
                        defaultBadge.textContent = tUI('Default');
                        nameSpan.after(defaultBadge);
                    }
                }
            }

            app.extensionManager.toast.add({
                severity: "success",
                summary: `${tUI('Set')} "${modelName}" ${tUI(' as default model')}`,
                life: 2000
            });

        } catch (error) {
            logger.error('Failed to set default model', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: tUI("Set failed"),
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * Update model order
     */
    async _updateModelOrder(serviceId, modelType, container) {
        try {
            const modelTags = container.querySelectorAll('.model-tag');
            const newOrder = Array.from(modelTags).map(tag => tag.dataset.modelName);

            // Call backend API to update order
            const res = await fetch(APIService.getApiUrl(`/services/${serviceId}/models/order`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_type: modelType,
                    model_names: newOrder
                })
            });

            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || tUI('Failed to update model order'));
            }

            app.extensionManager.toast.add({
                severity: "success",
                summary: tUI("Model order updated"),
                life: 2000
            });

        } catch (error) {
            logger.error('Failed to update model order', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: tUI("Update failed"),
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * Delete provider
     */
    async _deleteService(serviceId) {
        // Find service name
        const service = this.services.find(s => s.id === serviceId);
        const serviceName = service ? service.name : serviceId;

        // Use createSettingsDialog to create confirmation window
        createSettingsDialog({
            title: `<i class="pi pi-exclamation-triangle" style="margin-right: 8px; color: var(--p-orange-500);"></i>${tUI('Confirm Deletion')}`,
            isConfirmDialog: true,
            dialogClassName: 'confirm-dialog',
            saveButtonText: tUI('Delete'),
            saveButtonIcon: 'pi-trash',
            isDangerButton: true,
            cancelButtonText: tUI('Cancel'),
            renderContent: (content) => {
                content.className = 'confirm-dialog-content-simple';

                const confirmMessage = document.createElement('p');
                confirmMessage.className = 'confirm-dialog-message-simple';
                confirmMessage.textContent = `${tUI('Are you sure you want to delete provider')} "${serviceName}" ${tUI('?')}`;

                content.appendChild(confirmMessage);
            },
            onSave: async () => {
                try {
                    const res = await fetch(APIService.getApiUrl(`/services/${serviceId}`), {
                        method: 'DELETE'
                    });

                    const result = await res.json();

                    if (result.success) {
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: tUI("Delete successful"),
                            life: 3000
                        });

                        // Reload configuration and refresh UI
                        await this._loadAllConfigs();

                        // Find and remove corresponding tab and content
                        const tabButton = document.querySelector(`.tab-button[data-tab="${serviceId}"]`);
                        if (tabButton) {
                            tabButton.remove();
                        }

                        const tabPane = document.querySelector(`.tab-pane[data-tab="${serviceId}"]`);
                        if (tabPane) {
                            tabPane.remove();
                        }

                        // Auto switch to Baidu Translate tab
                        const header = document.querySelector('.tab-header');
                        const contentContainer = document.querySelector('.tab-content');
                        if (header && contentContainer) {
                            this._switchTab('baidu', header, contentContainer);
                        }

                        // If it's the last provider, show empty hint
                        const listContainer = document.querySelector('.services-list');
                        if (listContainer && this.services.length === 0) {
                            const emptyHint = document.createElement('div');
                            emptyHint.style.cssText = `
                                text-align: center;
                                padding: 40px;
                                color: var(--p-text-muted-color);
                            `;
                            emptyHint.textContent = tUI('No providers yet. Click "Add New Provider" to start.');
                            listContainer.appendChild(emptyHint);
                        }

                        // Trigger config sync event
                        this.notifyConfigChange();

                        return true; // Allow dialog to close
                    } else {
                        throw new Error(result.error || tUI('Delete failed'));
                    }
                } catch (error) {
                    logger.error('Failed to delete provider', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: tUI("Delete failed"),
                        detail: error.message,
                        life: 3000
                    });
                    return false; // Prevent dialog from closing
                }
            }
        });
    }

    /**
     * Update provider configuration
     */
    async _updateService(serviceId, updates) {
        try {
            const res = await fetch(APIService.getApiUrl(`/services/${serviceId}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || tUI('Update failed'));
            }

            // Sync update local in-memory provider data
            const service = this.services.find(s => s.id === serviceId);
            if (service) {
                Object.assign(service, updates);
            }

            // Trigger config sync event
            this.notifyConfigChange();

            logger.debug('Provider configuration updated', serviceId);

            // Show success notification
            app.extensionManager.toast.add({
                severity: "success",
                summary: tUI("Provider configuration updated"),
                life: 2000
            });
        } catch (error) {
            logger.error('Failed to update provider', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: tUI("Update failed"),
                detail: error.message,
                life: 3000
            });
        }
    }



    /**
     * Load masked API Key
     * @param {string} serviceId Provider ID
     * @returns {Promise<string|null>} Masked API Key
     */
    async _loadMaskedApiKey(serviceId) {
        try {
            const res = await fetch(APIService.getApiUrl(`/services/${serviceId}/masked`));
            const result = await res.json();

            if (result.success && result.service) {
                return result.service.api_key_masked || null;
            }

            return null;
        } catch (error) {
            logger.error('Failed to load masked API Key', error);
            return null;
        }
    }
}

// Export API configuration manager instance
export const apiConfigManager = new APIConfigManager();
