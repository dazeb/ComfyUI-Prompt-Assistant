/**
 * Assistant Settings Service
 * Manages assistant settings options, providing toggle control functionality
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { PromptAssistant } from "./PromptAssistant.js";
import { ImageCaption } from "./imageCaption.js";
import { EventManager } from "../utils/eventManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG } from "../services/cache.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { FEATURES, handleFeatureChange } from "../services/features.js";
import { APIService } from "../services/api.js";
import {
    UI_LANGUAGE_SETTING_ID,
    getStoredUiLanguage,
    persistUiLanguage,
    ensureUiLocaleLoaded,
    tUI,
    patchToastLocalization,
    syncGlobalUiLocalization,
    LANGUAGE_OPTIONS
} from "../utils/uiI18n.js";

import { apiConfigManager } from "./apiConfigManager.js";
import { rulesConfigManager } from "./rulesConfigManager.js";
import {
    createSettingsDialog,
    closeModalWithAnimation,
    createFormGroup,
    createInputGroup,
    createSelectGroup,
    createHorizontalFormGroup,
    createLoadingButton
} from "./uiComponents.js";

// Mark whether this is the first page load
let isFirstLoad = true;

function localizeSettingsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload.map(item => localizeSettingsPayload(item));
    }

    if (!payload || typeof payload !== "object") {
        return payload;
    }

    const localized = {};
    for (const [key, value] of Object.entries(payload)) {
        if (key === "category" && Array.isArray(value)) {
            localized[key] = value.map(item => tUI(item, item));
            continue;
        }

        if (["name", "tooltip", "text", "summary", "detail"].includes(key) && typeof value === "string") {
            localized[key] = tUI(value, value);
            continue;
        }

        if (typeof value === "function") {
            localized[key] = value;
            continue;
        }

        localized[key] = localizeSettingsPayload(value);
    }

    return localized;
}

// --- Service Selector Configuration ---
const SERVICE_TYPES = {
    translate: {
        name: tUI('Translation'),
        configEndpoint: '/config/translate',
        serviceType: 'translate',
        filterKey: 'llm_models',
        includeBaidu: true
    },
    llm: {
        name: tUI('Prompt Optimization'),
        configEndpoint: '/config/llm',
        serviceType: 'llm',
        filterKey: 'llm_models',
        includeBaidu: false
    },
    vlm: {
        name: tUI('Image Reverse Prompt'),
        configEndpoint: '/config/vision',
        serviceType: 'vlm',
        filterKey: 'vlm_models',
        includeBaidu: false
    }
};

// --- Service Selector ---
const serviceSelector = {
    _servicesCache: null,
    _cacheTime: 0,
    _cacheDuration: 2000, // Cache for 2 seconds

    /**
     * Clear service cache
     */
    clearCache() {
        this._servicesCache = null;
        this._cacheTime = 0;
        logger.debug('Service list cache cleared');
    },

    // Get service list (with cache)
    async getServices(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this._servicesCache && (now - this._cacheTime) < this._cacheDuration) {
            return this._servicesCache;
        }

        try {
            const response = await fetch(APIService.getApiUrl('/services'));
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this._servicesCache = data.services || [];
                    this._cacheTime = now;
                    return this._servicesCache;
                }
            }
        } catch (error) {
            logger.error(`Failed to get service list: ${error.message}`);
        }
        return [];
    },

    // Get current service ID for specified type
    async getCurrentService(type) {
        const config = SERVICE_TYPES[type];
        if (!config) return null;

        try {
            const response = await fetch(APIService.getApiUrl(config.configEndpoint));
            if (response.ok) {
                const data = await response.json();
                return data.provider || null;
            }
        } catch (error) {
            logger.error(`Failed to get ${config.name} current service: ${error.message}`);
        }
        return null;
    },

    // Set specified type service
    async setCurrentService(type, serviceId) {
        const config = SERVICE_TYPES[type];
        if (!config) return false;

        try {
            const response = await fetch(APIService.getApiUrl('/services/current'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_type: config.serviceType,
                    service_id: serviceId
                })
            });

            if (response.ok) {
                logger.log(`${config.name} service switched | Service ID: ${serviceId}`);

                // Dispatch global event to notify other components to sync
                window.dispatchEvent(new CustomEvent('pa-service-changed', {
                    detail: { service_type: config.serviceType, service_id: serviceId }
                }));

                return true;
            }
        } catch (error) {
            logger.error(`Failed to switch ${config.name} service: ${error.message}`);
        }
        return false;
    },

    // Get available service options list for specified type
    async getServiceOptions(type) {
        const config = SERVICE_TYPES[type];
        if (!config) return [];

        const services = await this.getServices();
        const options = [];

        // Add Baidu translation option (translation type only)
        if (config.includeBaidu) {
            options.push({ value: 'baidu', text: tUI('Baidu Translation') });
        }

        // Filter and add other services
        services
            .filter(service => {
                const models = service[config.filterKey];
                return models && models.length > 0;
            })
            .forEach(service => {
                options.push({
                    value: service.id,
                    text: service.name || service.id
                });
            });

        return options;
    }
};

// Attach service selector to global app object for easy access by other modules (like PromptAssistant.js, imageCaption.js)
// While avoiding circular reference issues between modules.
app.paServiceSelector = serviceSelector;

// ---Version Check Utility Functions---

// Version check status cache
let versionCheckCache = {
    checked: false,        // Whether checked before
    latestVersion: null,   // Latest version number
    hasUpdate: false       // Whether has update
};

/**
 * Fetch latest version number from jsDelivr (by reading pyproject.toml)
 * @returns {Promise<string|null>} Returns latest version number in format like "1.2.3", or null on failure
 */
async function fetchLatestVersion() {
    // If already checked, return cached result directly
    if (versionCheckCache.checked) {
        return versionCheckCache.latestVersion;
    }

    try {
        const response = await fetch('https://cdn.jsdelivr.net/gh/yawiii/ComfyUI-Prompt-Assistant@main/pyproject.toml', {
            cache: 'no-cache'
        });

        if (!response.ok) {
            logger.warn(`[Version Check] Request failed: ${response.status}`);
            versionCheckCache.checked = true;
            return null;
        }

        const tomlContent = await response.text();
        const versionMatch = tomlContent.match(/^version\s*=\s*["']([^"']+)["']/m);
        const version = versionMatch ? versionMatch[1] : null;

        // Cache check results
        versionCheckCache.checked = true;
        versionCheckCache.latestVersion = version;

        return version;
    } catch (error) {
        logger.warn(`[Version Check] Failed to get: ${error.message}`);
        versionCheckCache.checked = true;
        return null;
    }
}

/**
 * Compare two version numbers
 * @param {string} v1 - First version number
 * @param {string} v2 - Second version number
 * @returns {number} Returns 1 if v1 > v2, -1 if v1 < v2, 0 if v1 === v2
 */
function compareVersion(v1, v2) {
    // Split version numbers into numeric arrays
    const parts1 = v1.split('.').map(n => parseInt(n, 10) || 0);
    const parts2 = v2.split('.').map(n => parseInt(n, 10) || 0);

    // Ensure both arrays have the same length
    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }

    return 0;
}


// ====================== Settings Management ======================

/**
 * Show API configuration modal
 */
function showAPIConfigModal() {
    try {
        // Call API configuration manager's show modal method
        apiConfigManager.showAPIConfigModal();
    } catch (error) {
        logger.error(`Failed to open API configuration modal: ${error.message}`);
        app.extensionManager.toast.add({
            severity: "error",
            summary: tUI("Failed to open configuration"),
            detail: error.message || tUI("An error occurred while opening the configuration modal"),
            life: 3000
        });
    }
}

/**
 * Show rules configuration modal
 */
function showRulesConfigModal() {
    try {
        // Call rules configuration manager's show modal method
        rulesConfigManager.showRulesConfigModal();
    } catch (error) {
        logger.error(`Failed to open rules configuration modal: ${error.message}`);
        app.extensionManager.toast.add({
            severity: "error",
            summary: tUI("Failed to open configuration"),
            detail: error.message || tUI("An error occurred while opening the configuration modal"),
            life: 3000
        });
    }
}

/**
 * Create service selector dropdown
 * @param {string} type - Service type: 'translate' | 'llm' | 'vlm'
 * @param {string} label - Display name
 * @returns {HTMLElement} Settings row element
 */
function createServiceSelector(type, label) {
    const row = document.createElement("tr");
    row.className = "promptwidget-settings-row";

    const labelCell = document.createElement("td");
    labelCell.className = "comfy-menu-label";
    row.appendChild(labelCell);

    const selectCell = document.createElement("td");

    // Create loading placeholder container
    const container = document.createElement("div");
    container.style.minWidth = "180px";
    container.innerHTML = `<span style="color: var(--p-text-muted-color); font-size: 12px;">${tUI("Loading...")}</span>`;

    selectCell.appendChild(container);
    row.appendChild(selectCell);

    let currentOptions = []; // Store current options reference
    let updateDropdownOptions = null; // Store update function

    /**
     * Update dropdown content
     * @param {boolean} force - Whether to force refresh data
     */
    const updateContent = async (force = false) => {
        try {
            if (force) {
                // If forced refresh (e.g., configuration change or click triggered), clear cache first
                serviceSelector.clearCache();
            }

            // Get service list and currently selected service
            const [options, currentService] = await Promise.all([
                serviceSelector.getServiceOptions(type),
                serviceSelector.getCurrentService(type)
            ]);

            // If dropdown instance already exists, try incremental update
            if (updateDropdownOptions) {
                updateDropdownOptions(options, currentService);
                currentOptions = options;
                return;
            }

            // ---First load logic---
            container.innerHTML = '';

            if (options.length === 0) {
                container.innerHTML = `<span style="color: var(--p-text-muted-color); font-size: 12px;">${tUI("No available services")}</span>`;
                return;
            }

            currentOptions = options;
            const res = createSelectGroup(label, options, currentService, { showLabel: false });
            const { group, select } = res;
            updateDropdownOptions = res.updateOptions;

            // Add group's children to container
            while (group.firstChild) {
                container.appendChild(group.firstChild);
            }

            // Listen for click/press events: when user is about to click dropdown, try to quietly sync latest configuration
            const dropdownContainer = container.querySelector('.pa-dropdown');
            if (dropdownContainer) {
                dropdownContainer.addEventListener('mousedown', () => {
                    // Trigger refresh on click, but do not show "syncing" to avoid UI disturbance
                    updateContent(true);
                });
            }

            // Listen for change events
            select.addEventListener('change', async () => {
                const newValue = select.value;
                if (!newValue) return;

                const dropdown = container.querySelector('.pa-dropdown');
                if (dropdown) {
                    dropdown.style.opacity = '0.6';
                    dropdown.style.pointerEvents = 'none';
                }

                try {
                    const success = await serviceSelector.setCurrentService(type, newValue);
                    if (success) {
                        logger.log(`Set ${label} service | Service: ${newValue}`);
                    } else {
                        logger.error(`Failed to set ${label} service`);
                        const oldValue = await serviceSelector.getCurrentService(type);
                        if (oldValue && updateDropdownOptions) {
                            updateDropdownOptions(currentOptions, oldValue);
                        }
                    }
                } catch (error) {
                    logger.error(`Exception setting ${label} service: ${error.message}`);
                } finally {
                    if (dropdown) {
                        dropdown.style.opacity = '';
                        dropdown.style.pointerEvents = '';
                    }
                }
            });

        } catch (error) {
            logger.error(`Failed to sync ${label} configuration: ${error.message}`);
            if (!updateDropdownOptions) {
                container.innerHTML = `<span style="color: var(--p-red-400); font-size: 12px;">${tUI("Load failed")}</span>`;
            }
        }
    };

    // Initial load
    updateContent();

    // Listen for configuration update events (triggered when API configuration manager modifies config)
    const onConfigUpdated = () => {
        logger.debug(`Received configuration update notification, syncing ${label} status...`);
        updateContent(true);
    };
    window.addEventListener('pa-config-updated', onConfigUpdated);

    // Cleanup function for destroying listeners (simple handling, as settings panel usually destroyed with page)
    // If more complex component mount logic appears later, a cleanup function can be returned here for external call

    return row;
}


/**
 * Register settings
 * Add settings options to ComfyUI settings panel
 */
export async function registerSettings() {
    try {
        await ensureUiLocaleLoaded();
        patchToastLocalization();
        syncGlobalUiLocalization();

        app.registerExtension({
            name: "PromptAssistant.Settings",
            settings: localizeSettingsPayload([
                {
                    id: UI_LANGUAGE_SETTING_ID,
                    name: "Interface Language",
                    category: ["✨Prompt Assistant", "System", "Interface Language"],
                    type: "combo",
                    options: LANGUAGE_OPTIONS,
                    defaultValue: "zh",
                    tooltip: "Switch plugin interface language, auto refresh page after modification to take effect",
                    onChange: (value) => {
                        const previous = getStoredUiLanguage();
                        const normalized = persistUiLanguage(value);
                        if (normalized === previous) return;
                        logger.log(`Interface language switched: ${normalized}`);
                        setTimeout(() => window.location.reload(), 80);
                    }
                },
                // Main switch - independently control assistant system-level functions
                {
                    id: "PromptAssistant.Features.Enabled",
                    name: "Enable Assistant",
                    category: ["✨Prompt Assistant", "Assistant Feature Switches", "Main Switch"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "When disabled, all Prompt Assistant features will be disabled",
                    onChange: async (value) => {
                        try {
                            // Get current state to determine if it's initialization
                            const currentState = window.FEATURES.enabled;

                            // Only log when state actually changes
                            if (currentState !== value) {
                                logger.log(`Main switch status changed | Status:${value ? "Enabled" : "Disabled"}`);
                            } else {
                                // If state hasn't changed, use debug level log
                                logger.debug(`Main switch status unchanged | Status:${value ? "Enabled" : "Disabled"}`);
                            }

                            // Update global state
                            window.FEATURES.enabled = value;

                            // Get promptAssistant instance from global app object
                            const promptAssistantInstance = app.promptAssistant;
                            const imageCaptionInstance = app.imageCaption;

                            if (!promptAssistantInstance) {
                                logger.error("Main switch toggle failed | Error: PromptAssistant instance not found");
                                return;
                            }

                            // Perform corresponding actions based on switch state
                            if (value) {
                                // Enable features
                                await promptAssistantInstance.toggleGlobalFeature(true, currentState !== value);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(true, currentState !== value);
                                }

                                // Only log and show toast when state actually changed and not first load
                                if (currentState !== value) {
                                    logger.debug("Feature enabled");
                                    // Only show toast when state changes and not first load
                                    if (!isFirstLoad) {
                                        app.extensionManager.toast.add({
                                            severity: "info",
                                            summary: tUI("Prompt Assistant enabled"),
                                            life: 3000
                                        });
                                    }
                                }
                            } else {
                                // Disable features
                                await promptAssistantInstance.toggleGlobalFeature(false, currentState !== value);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(false, currentState !== value);
                                }

                                // Only log and show toast when state actually changed and not first load
                                if (currentState !== value) {
                                    logger.debug("Feature disabled");
                                    // Only show toast when state changes and not first load
                                    if (!isFirstLoad) {
                                        app.extensionManager.toast.add({
                                            severity: "warn",
                                            summary: tUI("Prompt Assistant disabled"),
                                            life: 3000
                                        });
                                    }
                                }
                            }

                            // Set first load flag to false, indicating first load completed
                            isFirstLoad = false;
                        } catch (error) {
                            logger.error(`Main switch toggle exception | Error:${error.message}`);
                        }
                    }
                },

                // Assistant creation mode setting
                {
                    id: "PromptAssistant.Settings.CreationMode",
                    name: "Assistant Creation Mode (Prompt)",
                    category: ["✨Prompt Assistant", "System", "Prompt Assistant Creation Mode"],
                    type: "combo",
                    options: [
                        { text: "Auto Create", value: "auto" },
                        { text: "Create on Node Selection", value: "manual" }
                    ],
                    defaultValue: "auto",
                    tooltip: "Auto Create: Automatically show assistant when node is created or loaded; Create on Node Selection: Show only when node is selected",
                    onChange: (value) => {
                        logger.log(`Assistant creation mode changed | Mode:${value === 'auto' ? 'Auto Create' : 'Create on Node Selection'}`);
                        // If switching to auto create, immediately try to initialize all nodes
                        if (value === 'auto' && window.FEATURES.enabled && app.graph) {
                            const nodes = app.graph._nodes || [];
                            nodes.forEach(node => {
                                if (node && !node._promptAssistantInitialized) {
                                    app.promptAssistant.checkAndSetupNode(node);
                                }
                            });
                        }
                    }
                },

                // Reverse prompt assistant creation mode setting
                {
                    id: "PromptAssistant.Settings.ImageCaptionCreationMode",
                    name: "Assistant Creation Mode (Image Reverse)",
                    category: ["✨Prompt Assistant", "System", "Image Assistant Creation Mode"],
                    type: "combo",
                    options: [
                        { text: "Auto Create", value: "auto" },
                        { text: "Create on Node Selection", value: "manual" }
                    ],
                    defaultValue: "auto",
                    tooltip: "Auto Create: Automatically show reverse assistant when node is created or loaded; Create on Node Selection: Show only when node is selected",
                    onChange: (value) => {
                        logger.log(`Reverse assistant creation mode changed | Mode:${value === 'auto' ? 'Auto Create' : 'Create on Node Selection'}`);
                        // If switching to auto create, immediately try to initialize all nodes
                        if (value === 'auto' && window.FEATURES.enabled && window.FEATURES.imageCaption && app.graph) {
                            const nodes = app.graph._nodes || [];
                            nodes.forEach(node => {
                                if (node && !node._imageCaptionInitialized) {
                                    app.imageCaption.checkAndSetupNode(node);
                                }
                            });
                        }
                    }
                },

                // Assistant layout (Prompt)
                {
                    id: "PromptAssistant.Location",
                    name: "Assistant Layout (Prompt)",
                    category: ["✨Prompt Assistant", "Interface", "Prompt Assistant Layout"],
                    type: "combo",
                    options: [
                        // { text: "Top Left (Horizontal)", value: "top-left-h" },
                        // { text: "Top Left (Vertical)", value: "top-left-v" },
                        // { text: "Top Center (Horizontal)", value: "top-center-h" },
                        // { text: "⇗ ━", value: "top-right-h" },
                        // { text: "⇗ ┃", value: "top-right-v" },
                        { text: "Right Center (Vertical)", value: "right-center-v" },
                        { text: "Bottom Right (Horizontal)", value: "bottom-right-h" },
                        { text: "Bottom Right (Vertical)", value: "bottom-right-v" },
                        { text: "Bottom Center (Horizontal)", value: "bottom-center-h" },
                        { text: "Bottom Left (Horizontal)", value: "bottom-left-h" },
                        // { text: "Bottom Left (Vertical)", value: "bottom-left-v" },
                        // { text: "Left Center (Vertical)", value: "left-center-v" }
                    ],
                    defaultValue: "bottom-right-h", // Default bottom right horizontal
                    tooltip: "Set the layout and expand direction of the prompt assistant around the input box",
                    onChange: (value) => {
                        logger.log(`Prompt assistant layout changed | Layout:${value}`);
                        // Notify all instances to update layout (handled via CSS classes)
                        PromptAssistant.instances.forEach(widget => {
                            if (widget.container && widget.container.setAnchorPosition) {
                                widget.container.setAnchorPosition(value);
                            }
                        });
                    }
                },
                // Assistant position setting (Image Reverse)
                {
                    id: "ImageCaption.Location",
                    name: "Assistant Layout (Image Reverse)",
                    category: ["✨Prompt Assistant", "Interface", "Image Assistant Layout"],
                    type: "combo",
                    options: [
                        { text: "Horizontal", value: "bottom-left-h" },
                        { text: "Vertical", value: "bottom-left-v" }
                    ],
                    defaultValue: "bottom-left-h", // Default horizontal
                    tooltip: "Set the expand direction of the image reverse assistant (position fixed at bottom left)",
                    onChange: (value) => {
                        logger.log(`Image reverse assistant layout changed | Layout:${value}`);
                        // Notify all instances to update layout
                        ImageCaption.instances.forEach(assistant => {
                            if (assistant.container && assistant.container.setAnchorPosition) {
                                assistant.container.setAnchorPosition(value);
                            }
                        });
                    },
                },

                // API configuration button
                {
                    id: "PromptAssistant.Features.APIConfig",
                    name: "Baidu and LLM API Configuration",
                    category: ["✨Prompt Assistant", " Configuration", "API Configuration"],
                    tooltip: "Configure or modify API information",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton(tUI("API Manager"), async () => {
                            showAPIConfigModal();
                        }, false); // Set showSuccessToast to false

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },

                // ---Service Category Settings---
                // Translation service selection
                {
                    id: "PromptAssistant.Service.Translate",
                    name: "Select Translation Service",
                    category: ["✨Prompt Assistant", " Configuration", "Translation"],
                    tooltip: "Select a service provider for translation, you can also switch via right-click translation button",
                    type: () => {
                        return createServiceSelector('translate', 'Translation');
                    }
                },

                // Prompt optimization service selection
                {
                    id: "PromptAssistant.Service.LLM",
                    name: "Select Prompt Optimization Service",
                    category: ["✨Prompt Assistant", " Configuration", "Prompt Optimization"],
                    tooltip: "Select a service provider for prompt optimization, you can also switch via right-click prompt optimization button",
                    type: () => {
                        return createServiceSelector('llm', 'Prompt Optimization');
                    }
                },

                // Image reverse service selection
                {
                    id: "PromptAssistant.Service.VLM",
                    name: "Select Image Reverse Service",
                    category: ["✨Prompt Assistant", " Configuration", "Image Reverse"],
                    tooltip: "Select a service provider for image reverse, you can also switch via right-click reverse button",
                    type: () => {
                        return createServiceSelector('vlm', 'Image Reverse');
                    }
                },

                // History feature (includes history, undo, redo buttons)
                {
                    id: "PromptAssistant.Features.History",
                    name: "Enable History Feature",
                    category: ["✨Prompt Assistant", "Assistant Feature Switches", "History Feature"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "Enable or disable history, undo, redo features",
                    onChange: (value) => {
                        const oldValue = FEATURES.history;
                        FEATURES.history = value;
                        handleFeatureChange('History Feature', value, oldValue);
                        logger.log(`History Feature - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                // Tag tool
                {
                    id: "PromptAssistant.Features.Tag",
                    name: "Enable Tag Tool",
                    category: ["✨Prompt Assistant", "Assistant Feature Switches", "Tag Feature"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "Enable or disable tag tool feature",
                    onChange: (value) => {
                        const oldValue = FEATURES.tag;
                        FEATURES.tag = value;
                        handleFeatureChange('Tag Tool', value, oldValue);
                        logger.log(`Tag Tool - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                // Expand feature
                {
                    id: "PromptAssistant.Features.Expand",
                    name: "Enable Prompt Optimization Feature",
                    category: ["✨Prompt Assistant", "Assistant Feature Switches", "Prompt Optimization Feature"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "Enable or disable prompt optimization feature",
                    onChange: (value) => {
                        const oldValue = FEATURES.expand;
                        FEATURES.expand = value;
                        handleFeatureChange('Prompt Optimization Feature', value, oldValue);
                        logger.log(`Prompt Optimization Feature - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                // Translation feature
                {
                    id: "PromptAssistant.Features.Translate",
                    name: "Enable Translation Feature",
                    category: ["✨Prompt Assistant", "Assistant Feature Switches", "Translation Feature"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "Enable or disable translation feature",
                    onChange: (value) => {
                        const oldValue = FEATURES.translate;
                        FEATURES.translate = value;
                        handleFeatureChange('Translation Feature', value, oldValue);
                        logger.log(`Translation Feature - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                // Use translation cache feature
                {
                    id: "PromptAssistant.Features.UseTranslateCache",
                    name: "Use Translation Cache",
                    category: ["✨Prompt Assistant", " Translation Feature Settings", "Translation Cache"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "When enabled, if content has been translated before, use the historical translation result to avoid duplicate translations that change the original meaning. If re-translation is needed, just add a space to skip the cache.",
                    onChange: (value) => {
                        const oldValue = FEATURES.useTranslateCache;
                        FEATURES.useTranslateCache = value;
                        logger.log(`Use Translation Cache - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                // Mixed language cache option
                {
                    id: "PromptAssistant.Features.CacheMixedLangTranslation",
                    name: "Cache Mixed Language Translations",
                    category: ["✨Prompt Assistant", " Translation Feature Settings", "Mixed Language Cache"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "When disabled, translation results of mixed Chinese-English content will not be written to cache to avoid polluting the cache. When enabled, they will be cached normally.",
                    onChange: (value) => {
                        FEATURES.cacheMixedLangTranslation = value;
                        logger.log(`Mixed Language Cache - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                // Mixed language translation rule
                {
                    id: "PromptAssistant.Features.MixedLangTranslateRule",
                    name: "Mixed Language Translation Rule",
                    category: ["✨Prompt Assistant", " Translation Feature Settings", "Mixed Language Rule"],
                    type: "combo",
                    options: [
                        { text: "Translate to English", value: "to_en" },
                        { text: "Translate to Chinese", value: "to_zh" },
                        { text: "Auto Translate Minor Language", value: "auto_minor" },
                        { text: "Auto Translate Major Language", value: "auto_major" }
                    ],
                    defaultValue: "to_en",
                    tooltip: "Set the translation rule for mixed Chinese-English content according to personal preferences",
                    onChange: (value) => {
                        FEATURES.mixedLangTranslateRule = value;
                        logger.log(`Mixed Language Translation Rule - Set to:${value}`);
                    }
                },

                // Translation formatting options
                {
                    id: "PromptAssistant.Features.TranslateFormatPunctuation",
                    name: "Always Use Half-width Punctuation",
                    category: ["✨Prompt Assistant", " Translation Feature Settings", "Punctuation Processing"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "When enabled, translation results will automatically replace Chinese punctuation with English punctuation",
                    onChange: (value) => {
                        FEATURES.translateFormatPunctuation = value;
                        logger.log(`Punctuation Conversion - ${value ? "Enabled" : "Disabled"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatSpace",
                    name: "Auto Remove Extra Spaces",
                    category: ["✨Prompt Assistant", " Translation Feature Settings", "Space Processing"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "When enabled, translation results will automatically remove extra spaces",
                    onChange: (value) => {
                        FEATURES.translateFormatSpace = value;
                        logger.log(`Remove Extra Spaces - ${value ? "Enabled" : "Disabled"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatDots",
                    name: "Remove Extra Consecutive Dots",
                    category: ["✨Prompt Assistant", " Translation Feature Settings", "Dot Processing"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "When enabled, translation results will unify excessive \"......\" into \"...\"",
                    onChange: (value) => {
                        FEATURES.translateFormatDots = value;
                        logger.log(`Process Consecutive Dots - ${value ? "Enabled" : "Disabled"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatNewline",
                    name: "Preserve Line Breaks",
                    category: ["✨Prompt Assistant", " Translation Feature Settings", "Line Break Processing"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "When enabled, translation results will try to preserve original line breaks to avoid losing paragraphs",
                    onChange: (value) => {
                        FEATURES.translateFormatNewline = value;
                        logger.log(`Preserve Line Breaks - ${value ? "Enabled" : "Disabled"}`);
                    }
                },



                // Image reverse feature
                {
                    id: "PromptAssistant.Features.ImageCaption",
                    name: "Enable Image Reverse Feature",
                    category: ["✨Prompt Assistant", "Assistant Feature Switches", "Image Reverse"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "Enable or disable image reverse prompt feature",
                    onChange: (value) => {
                        const oldValue = FEATURES.imageCaption;
                        FEATURES.imageCaption = value;
                        handleFeatureChange('Image Reverse', value, oldValue);
                        logger.log(`Image Reverse Feature - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                // Node help translation feature
                {
                    id: "PromptAssistant.Features.NodeHelpTranslator",
                    name: "Enable Node Info Translation",
                    category: ["✨Prompt Assistant", "Assistant Feature Switches", "Node Info Translation"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "Enable or disable translation feature for ComfyUI sidebar node help documentation",
                    onChange: (value) => {
                        const oldValue = FEATURES.nodeHelpTranslator;
                        FEATURES.nodeHelpTranslator = value;
                        handleFeatureChange('Node Info Translation', value, oldValue);
                        logger.log(`Node Info Translation Feature - ${value ? "Enabled" : "Disabled"}`);
                    }
                },
                // System settings
                {
                    id: "PromptAssistant.Settings.LogLevel",
                    name: "Log Level",
                    category: ["✨Prompt Assistant", "System", "Log Level"],
                    type: "hidden",
                    defaultValue: "0",
                    options: [
                        { text: "Error Log", value: "0" },
                        { text: "Basic Log", value: "1" },
                        { text: "Detailed Log", value: "2" }
                    ],
                    tooltip: "Set log output level: Error Log (errors only), Basic Log (errors + basic info), Detailed Log (errors + basic info + debug info)",
                    onChange: (value) => {
                        const oldValue = window.FEATURES.logLevel;
                        window.FEATURES.logLevel = parseInt(value);
                        logger.setLevel(window.FEATURES.logLevel);
                        logger.log(`Log level updated | Old level:${oldValue} | New level:${value}`);
                    }
                },

                // Show streaming progress
                {
                    id: "PromptAssistant.Settings.ShowStreamingProgress",
                    name: "Console Streaming Progress Log",
                    category: ["✨Prompt Assistant", "System", "Console Log"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "When enabled, console shows streaming output progress, which may cause screen spam on some terminals; when disabled, only static 'Generating...' is shown.",
                    onChange: async (value) => {
                        FEATURES.showStreamingProgress = value;
                        // Notify backend to update setting
                        try {
                            await fetch(APIService.getApiUrl('/settings/streaming_progress'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ enabled: value })
                            });
                        } catch (error) {
                            logger.error(`Failed to update streaming progress setting: ${error.message}`);
                        }
                        logger.log(`Streaming Progress - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                // Streaming output switch
                {
                    id: "PromptAssistant.Settings.EnableStreaming",
                    name: "Streaming Output Switch",
                    category: ["✨Prompt Assistant", "System", "Streaming Experience"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "When enabled, translation, expansion, recognition and other features will display streaming effect word by word; when disabled, revert to blocking mode that shows everything after generation.",
                    onChange: (value) => {
                        FEATURES.enableStreaming = value;
                        logger.log(`Streaming Output Switch - ${value ? "Enabled" : "Disabled"}`);
                    }
                },

                {
                    id: "PromptAssistant.Settings.IconOpacity",
                    name: "Assistant Icon Opacity",
                    category: ["✨Prompt Assistant", "Interface", "Assistant Icon"],
                    type: "slider",
                    min: 0,
                    max: 100,
                    step: 1,
                    defaultValue: 20,
                    tooltip: "Set opacity of the collapsed assistant icon",
                    onChange: (value) => {
                        // Convert 0-100 value to 0-1 opacity
                        const opacity = value * 0.01;
                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
                        logger.log(`Assistant icon opacity updated | Value:${value}% | Opacity:${opacity}`);
                    },
                    onLoad: (value) => {
                        // Apply default value on initialization
                        const opacity = value * 0.01;
                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
                        logger.debug(`Assistant icon opacity initialized | Value:${value}% | Opacity:${opacity}`);
                    }
                },

                {
                    id: "PromptAssistant.Settings.ClearCache",
                    name: "Clear History, Tag, Translation Cache",
                    category: ["✨Prompt Assistant", "System", "Clear Cache"],
                    tooltip: "Clear all caches, including history records, tags, translation cache, node documentation translation cache",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton(tUI("Clear All Caches"), async () => {
                            try {
                                // Get cache statistics before clearing
                                const beforeStats = {
                                    history: HistoryCacheService.getHistoryStats(),
                                    tags: 0,
                                    translate: TranslateCacheService.getTranslateCacheStats(),
                                    nodeHelpTranslate: 0 // Node documentation translation cache
                                };

                                // Count all tags
                                const tagCacheKeys = Object.keys(localStorage)
                                    .filter(key => key.startsWith(CACHE_CONFIG.TAG_KEY_PREFIX));

                                // Calculate total tags in all caches
                                tagCacheKeys.forEach(key => {
                                    try {
                                        const cacheData = JSON.parse(localStorage.getItem(key));
                                        if (cacheData && typeof cacheData === 'object') {
                                            // Get tag count in cache
                                            const tagCount = Object.keys(cacheData).length;
                                            beforeStats.tags += tagCount;
                                        }
                                    } catch (e) {
                                        // Remove error log, silently handle parse errors
                                    }
                                });

                                // Count node documentation translation cache
                                try {
                                    const nodeHelpCache = sessionStorage.getItem('pa_node_help_translations');
                                    if (nodeHelpCache) {
                                        const parsed = JSON.parse(nodeHelpCache);
                                        beforeStats.nodeHelpTranslate = Object.keys(parsed).length;
                                    }
                                } catch (e) {
                                    // Silently handle
                                }

                                // Execute history clearing operation
                                HistoryCacheService.clearAllHistory();

                                // Clear all tag caches
                                TagCacheService.clearAllTagCache();

                                // Clear translation cache
                                TranslateCacheService.clearAllTranslateCache();

                                // Clear node documentation translation cache (sessionStorage)
                                sessionStorage.removeItem('pa_node_help_translations');

                                // Clear old version tag caches (all records starting with PromptAssistant_tag_cache_)
                                Object.keys(localStorage)
                                    .filter(key => key.startsWith('PromptAssistant_tag_cache_'))
                                    .forEach(key => localStorage.removeItem(key));

                                // Clear three configuration items left from versions before 1.0.3 to avoid leakage
                                localStorage.removeItem("PromptAssistant_Settings_llm_api_key");
                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_secret");
                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_appid");

                                // Get cache statistics after clearing
                                const afterStats = {
                                    history: HistoryCacheService.getHistoryStats(),
                                    tags: 0, // Tags should be 0 after clearing
                                    translate: TranslateCacheService.getTranslateCacheStats()
                                };

                                // Calculate cleared counts
                                const clearedHistory = beforeStats.history.total - afterStats.history.total;
                                const clearedTags = beforeStats.tags;
                                const clearedTranslate = beforeStats.translate.total - afterStats.translate.total;
                                const clearedNodeHelp = beforeStats.nodeHelpTranslate;

                                // Only output final statistics
                                logger.log(`Cache clearing complete | History: ${clearedHistory} items | Tags: ${clearedTags} items | Translation: ${clearedTranslate} items | Node Docs: ${clearedNodeHelp} items`);

                                // Update undo/redo button states for all instances
                                PromptAssistant.instances.forEach((instance) => {
                                    if (instance && instance.nodeId && instance.inputId) {
                                        UIToolkit.updateUndoRedoButtonState(instance, HistoryCacheService);
                                    }
                                });

                            } catch (error) {
                                // Simplified error log
                                logger.error(`Cache clearing failed`);
                                throw error;
                            }
                        });

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },



                // About plugin info
                {
                    id: "PromptAssistant.Settings.About",
                    name: "About",
                    category: ["✨Prompt Assistant", " ✨Prompt Assistant"],
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";
                        const cell = document.createElement("td");
                        cell.colSpan = 2;
                        cell.style.display = "flex";
                        cell.style.alignItems = "center";
                        cell.style.gap = "12px";
                        // Version badge container (clickable to jump to latest version)
                        const versionLink = document.createElement("a");
                        versionLink.href = "https://github.com/yawiii/ComfyUI-Prompt-Assistant/releases/latest";
                        versionLink.target = "_blank";
                        versionLink.style.textDecoration = "none";
                        versionLink.style.display = "flex";
                        versionLink.style.alignItems = "center";
                        versionLink.style.cursor = "pointer";

                        const versionContainer = document.createElement("div");
                        versionContainer.style.display = "flex";
                        versionContainer.style.alignItems = "center";
                        versionContainer.style.gap = "8px";
                        versionLink.appendChild(versionContainer);

                        // Version badge
                        const versionBadge = document.createElement("img");
                        versionBadge.alt = "Version";
                        versionBadge.style.display = "block";
                        versionBadge.style.height = "20px";

                        // Get version number from global variable
                        if (!window.PromptAssistant_Version) {
                            logger.error(tUI("Version number not found, badge will not display correctly"));
                            versionBadge.src = `https://img.shields.io/badge/%E7%89%88%E6%9C%AC-%E6%9C%AA%E7%9F%A5-red?style=flat`;
                            versionContainer.appendChild(versionBadge);
                        } else {
                            const currentVersion = window.PromptAssistant_Version;
                            versionBadge.src = `https://img.shields.io/badge/%E7%89%88%E6%9C%AC-${currentVersion}-green?style=flat`;
                            versionContainer.appendChild(versionBadge);

                            // Use cache to check version, avoid duplicate requests
                            if (versionCheckCache.checked && versionCheckCache.hasUpdate) {
                                // Already checked and has update, directly apply cached result
                                const latestVersion = versionCheckCache.latestVersion;
                                const labelEncoded = encodeURIComponent(tUI("New Version Available"));
                                const messageEncoded = encodeURIComponent(`${currentVersion}→${latestVersion}`);
                                versionBadge.src = `https://img.shields.io/badge/${labelEncoded}-${messageEncoded}-orange?style=flat&labelColor=555555`;
                                versionBadge.style.cursor = "pointer";
                                versionBadge.title = `${tUI("Current Version:")} ${currentVersion}\n${tUI("Latest Version:")} ${latestVersion}\n${tUI("Click to download")}`;
                            } else if (!versionCheckCache.checked) {
                                // First check, initiate async request
                                fetchLatestVersion().then(latestVersion => {
                                    if (latestVersion && compareVersion(latestVersion, currentVersion) > 0) {
                                        versionCheckCache.hasUpdate = true;
                                        const labelEncoded = encodeURIComponent(tUI("New Version Available"));
                                        const messageEncoded = encodeURIComponent(`${currentVersion}→${latestVersion}`);
                                        versionBadge.src = `https://img.shields.io/badge/${labelEncoded}-${messageEncoded}-orange?style=flat&labelColor=555555`;
                                        versionBadge.style.cursor = "pointer";
                                        versionBadge.title = `${tUI("Current Version:")} ${currentVersion}\n${tUI("Latest Version:")} ${latestVersion}\n${tUI("Click to download")}`;
                                        logger.log(`[Version Check] New version found: ${currentVersion} → ${latestVersion}`);
                                    } else if (latestVersion) {
                                        versionBadge.title = `${tUI("Current version is up to date:")} ${currentVersion}`;
                                        logger.debug(`[Version Check] Current version: ${currentVersion}`);
                                    }
                                }).catch(error => {
                                    logger.warn(`[Version Check] Error: ${error.message}`);
                                });
                            } else {
                                // Already checked but no update
                                versionBadge.title = `${tUI("Current version is up to date:")} ${currentVersion}`;
                            }
                        }

                        cell.appendChild(versionLink);

                        // GitHub badge
                        const authorTag = document.createElement("a");
                        authorTag.href = "https://github.com/yawiii/ComfyUI-Prompt-Assistant";
                        authorTag.target = "_blank";
                        authorTag.style.textDecoration = "none";
                        authorTag.style.display = "flex";
                        authorTag.style.alignItems = "center";
                        const authorBadge = document.createElement("img");
                        authorBadge.alt = "Static Badge";
                        authorBadge.src = "https://img.shields.io/github/stars/yawiii/ComfyUI-Prompt-Assistant?style=flat&logo=github&logoColor=%23292F34&label=Yawiii&labelColor=%23FFFFFF&color=blue";
                        authorBadge.style.display = "block";
                        authorBadge.style.height = "20px";
                        authorTag.appendChild(authorBadge);
                        cell.appendChild(authorTag);

                        // Bilibili badge
                        const biliTag = document.createElement("a");
                        biliTag.href = "https://space.bilibili.com/520680644";
                        biliTag.target = "_blank";
                        biliTag.style.textDecoration = "none";
                        biliTag.style.display = "flex";
                        biliTag.style.alignItems = "center";
                        const biliBadge = document.createElement("img");
                        biliBadge.alt = "Bilibili";
                        biliBadge.src = "https://img.shields.io/badge/%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B-blue?style=flat&logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF&color=%2307A3D7";
                        biliBadge.style.display = "block";
                        biliBadge.style.height = "20px";
                        biliTag.appendChild(biliBadge);
                        cell.appendChild(biliTag);
                        // Community group badge
                        const wechatTag = document.createElement("a");
                        // Cancel jump; clicking no longer opens link to avoid local cache link
                        wechatTag.href = 'javascript:void(0)';
                        wechatTag.addEventListener('click', (e) => { e.preventDefault(); toggleWechatQr(); });
                        wechatTag.style.textDecoration = "none";
                        wechatTag.style.display = "flex";
                        wechatTag.style.alignItems = "center";
                        wechatTag.classList.add("has-tooltip", "pa-wechat-badge");
                        const wechatBadge = document.createElement("img");
                        wechatBadge.alt = tUI("Community Feedback Group");
                        wechatBadge.src = "https://img.shields.io/badge/%E4%BA%A4%E6%B5%81%E5%8F%8D%E9%A6%88-blue?logo=wechat&logoColor=green&labelColor=%23FFFFFF&color=%2307A3D7";
                        wechatBadge.style.display = "block";
                        wechatBadge.style.height = "20px";
                        wechatTag.appendChild(wechatBadge);

                        // Hover to show QR code
                        const wechatQr = document.createElement("div");
                        wechatQr.className = "pa-wechat-qr";
                        const wechatQrImg = document.createElement("img");
                        // Prefer loading remote QR code, fallback to local backup image on failure
                        const remoteQrUrl = 'http://data.xflow.cc/wechat.png';
                        let qrFallbackTimer = null;
                        const localQrUrl = ResourceManager.getAssetUrl('wechat.png');

                        // Always force reload remote QR code on each show (with timestamp) to avoid cache
                        const loadWechatQr = () => {
                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
                            wechatQrImg.dataset.fallbackApplied = '';
                            wechatQrImg.dataset.source = 'remote';
                            wechatQrImg.src = `${remoteQrUrl}?t=${Date.now()}`;
                            // Timeout fallback to local, but need to check if image has started loading
                            qrFallbackTimer = setTimeout(() => {
                                // Check if already marked as fallback
                                if (wechatQrImg.dataset.fallbackApplied === '1') return;

                                // Check if image has started loading (naturalHeight > 0 means image is loading)
                                if (wechatQrImg.naturalHeight > 0) {
                                    Logger.log(2, 'Remote QR code loading, extending wait time');
                                    // Image has started loading, continue waiting for onload, cancel timeout fallback
                                    if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
                                } else {
                                    // Image not started loading, possibly network issue, fallback to local
                                    Logger.log(1, 'Remote QR code loading timeout, switching to local backup image');
                                    loadLocalQr();
                                }
                            }, 3000); // Extend to 3 seconds for more loading time for remote image
                        };
                        // Manually switch to local QR code (with timestamp), clear timeout
                        const loadLocalQr = () => {
                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
                            wechatQrImg.dataset.fallbackApplied = '1';
                            wechatQrImg.dataset.source = 'local';
                            wechatQrImg.src = localQrUrl; // Local image fixed, no timestamp
                        };

                        // Toggle between remote/local on badge click
                        const toggleWechatQr = () => {
                            if (wechatQrImg.dataset.source === 'local') {
                                loadWechatQr();
                            } else {
                                loadLocalQr();
                            }
                        };


                        wechatQrImg.alt = tUI("WeChat Group QR Code");
                        wechatQrImg.className = "pa-wechat-qr-img";

                        // Clear timeout timer on successful load
                        wechatQrImg.onload = () => { if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; } };

                        // Fallback to local backup image on remote load failure (also with timestamp to avoid cache)
                        wechatQrImg.onerror = () => {
                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
                            if (wechatQrImg.dataset.fallbackApplied !== '1') {
                                loadLocalQr();
                            }
                        };

                        // Trigger reload on initial render and each mouse enter
                        loadWechatQr();
                        wechatTag.addEventListener('mouseenter', loadWechatQr);

                        wechatQr.appendChild(wechatQrImg);
                        wechatTag.appendChild(wechatQr);

                        cell.appendChild(wechatTag);

                        row.appendChild(cell);
                        return row;
                    }
                },

                // Rules configuration button
                {
                    id: "PromptAssistant.Features.RulesConfig",
                    name: "Prompt Optimization and Reverse Rule Modification",
                    category: ["✨Prompt Assistant", " Configuration", "Rules"],
                    tooltip: "Customize prompt optimization rules and reverse prompt rules to make prompt generation more suitable for your needs",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton(tUI("Rules Manager"), async () => {
                            showRulesConfigModal();
                        }, false);

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },

            ])
        });

        logger.log("Assistant settings registration successful");
        return true;
    } catch (error) {
        logger.error(`Assistant settings registration failed: ${error.message}`);
        return false;
    }
}
