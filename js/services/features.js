/**
 * Assistant Feature Management Module
 * Responsible for managing all feature toggles, button visibility, feature status changes, etc.
 */

import { logger } from '../utils/logger.js';

// Externally injected promptAssistant instance
let promptAssistant = null;
// Externally injected PromptAssistant class
let PromptAssistant = null;
// Externally injected UIToolkit
let UIToolkit = null;
// Externally injected HistoryCacheService
let HistoryCacheService = null;
// Externally injected imageCaption instance
let imageCaption = null;
// Externally injected ImageCaption class
let ImageCaption = null;
// Externally injected nodeHelpTranslator instance
let nodeHelpTranslator = null;

/**
 * Inject dependency instances (called by main entry)
 */
export function setFeatureModuleDeps({ promptAssistant: pa, PromptAssistant: PAC, UIToolkit: ui, HistoryCacheService: hc, imageCaption: ic, ImageCaption: ICC, nodeHelpTranslator: nht }) {
    promptAssistant = pa;
    PromptAssistant = PAC;
    UIToolkit = ui;
    HistoryCacheService = hc;
    imageCaption = ic;
    ImageCaption = ICC;
    nodeHelpTranslator = nht;
    // Sync log level on initialization
    try {
        if (typeof window !== 'undefined' && window.FEATURES) {
            if (typeof window.FEATURES.logLevel === 'undefined') {
                window.FEATURES.logLevel = 0;
            }
            if (typeof logger.setLevel === 'function') {
                logger.setLevel(window.FEATURES.logLevel);
            }
        }
    } catch (e) { }
}

/**
 * Feature configuration object
 * Controls the enabled status of each feature
 */
export const FEATURES = {
    // Basic feature toggle
    enabled: true,

    // Specific feature toggles
    history: true, // History feature (includes history, undo, redo)
    tag: true,
    expand: true,
    translate: true,
    autoTranslate: false, // Auto-translate feature
    imageCaption: true, // Image captioning prompt feature
    nodeHelpTranslator: true, // Node help document translation feature

    // Translation formatting options
    translateFormatPunctuation: true, // Automatically convert punctuation to half-width
    translateFormatSpace: true, // Remove extra spaces
    translateFormatDots: false, // Handle consecutive dots
    translateFormatNewline: false, // Preserve newlines

    // Mixed language translation cache
    cacheMixedLangTranslation: false, // Whether to cache mixed language translation results

    // Mixed language translation rules
    mixedLangTranslateRule: 'auto_minor', // Automatically translate minority language

    // System settings
    showStreamingProgress: true, // Show streaming progress (terminal log)
    enableStreaming: true, // Enable frontend streaming output effect

    /**
     * Load feature toggle status from configuration
     * Must be called after app.ui.settings has been loaded
     */
    loadSettings() {
        if (typeof app === 'undefined' || !app.ui || !app.ui.settings) return;

        // Helper function: load boolean setting, keep default if not set
        const loadBool = (key, settingId) => {
            const val = app.ui.settings.getSettingValue(settingId);
            if (typeof val === 'boolean') {
                this[key] = val;
            }
        };

        // Load basic feature toggle
        loadBool('enabled', "PromptAssistant.Features.Enabled");
        loadBool('history', "PromptAssistant.Features.History");
        loadBool('tag', "PromptAssistant.Features.Tag");
        loadBool('expand', "PromptAssistant.Features.Expand");
        loadBool('translate', "PromptAssistant.Features.Translate");
        loadBool('imageCaption', "PromptAssistant.Features.ImageCaption");
        loadBool('nodeHelpTranslator', "PromptAssistant.Features.NodeHelpTranslator");
        loadBool('useTranslateCache', "PromptAssistant.Features.UseTranslateCache");

        // Load translation formatting options
        loadBool('translateFormatPunctuation', "PromptAssistant.Features.TranslateFormatPunctuation");
        loadBool('translateFormatSpace', "PromptAssistant.Features.TranslateFormatSpace");
        loadBool('translateFormatDots', "PromptAssistant.Features.TranslateFormatDots");

        // Load mixed language cache options
        loadBool('cacheMixedLangTranslation', "PromptAssistant.Features.CacheMixedLangTranslation");
        loadBool('translateFormatNewline', "PromptAssistant.Features.TranslateFormatNewline");

        // Load mixed language translation rules
        const mixedLangRule = app.ui.settings.getSettingValue("PromptAssistant.Features.MixedLangTranslateRule");
        if (mixedLangRule) {
            this.mixedLangTranslateRule = mixedLangRule;
        }

        // Load system settings
        loadBool('showStreamingProgress', "PromptAssistant.Settings.ShowStreamingProgress");
        loadBool('enableStreaming', "PromptAssistant.Settings.EnableStreaming");

        // Load log level
        const logLevel = app.ui.settings.getSettingValue("PromptAssistant.Settings.LogLevel");
        if (logLevel !== undefined) {
            // Ensure it's a number
            const level = parseInt(logLevel);
            if (!isNaN(level)) {
                if (typeof window !== 'undefined') {
                    if (!window.FEATURES) window.FEATURES = {};
                    window.FEATURES.logLevel = level;
                }
                if (logger) logger.setLevel(level);
            }
        }
    },

    /**
     * Update button display status for all instances
     * Control UI element visibility based on feature toggle status
     */
    updateButtonsVisibility() {
        if (!PromptAssistant) return;
        // Iterate over all assistant instances
        PromptAssistant.instances.forEach((instance) => {
            if (instance.buttons) {
                // History-related buttons - controlled by single history toggle
                if (instance.buttons['history']) {
                    instance.buttons['history'].style.display = this.history ? 'block' : 'none';
                }
                if (instance.buttons['undo']) {
                    instance.buttons['undo'].style.display = this.history ? 'block' : 'none';
                }
                if (instance.buttons['redo']) {
                    instance.buttons['redo'].style.display = this.history ? 'block' : 'none';
                }

                // Divider 1 - after history feature
                if (instance.buttons['divider1']) {
                    const hasHistoryFeature = this.history;
                    const hasOtherFeatures = this.tag || this.expand || this.translate;
                    const showDivider1 = hasHistoryFeature && hasOtherFeatures;
                    instance.buttons['divider1'].style.display = showDivider1 ? 'block' : 'none';
                }

                // Other feature buttons
                if (instance.buttons['tag']) {
                    instance.buttons['tag'].style.display = this.tag ? 'block' : 'none';
                }
                if (instance.buttons['expand']) {
                    instance.buttons['expand'].style.display = this.expand ? 'block' : 'none';
                }
                if (instance.buttons['translate']) {
                    instance.buttons['translate'].style.display = this.translate ? 'block' : 'none';
                }

                // Logging (too frequent, removed)
                // logger.debug(`Button update | Node ID: ${instance.nodeId}`);
            }
        });

        // Handle image assistant button display
        if (ImageCaption) {
            ImageCaption.instances.forEach((assistant) => {
                if (assistant.buttons) {
                    // Image captioning buttons
                    if (assistant.buttons['caption_zh']) {
                        assistant.buttons['caption_zh'].style.display = this.imageCaption ? 'block' : 'none';
                    }
                    if (assistant.buttons['caption_en']) {
                        assistant.buttons['caption_en'].style.display = this.imageCaption ? 'block' : 'none';
                    }

                    // If image captioning is disabled, hide the entire assistant
                    if (assistant.element) {
                        if (!this.imageCaption) {
                            assistant.element.style.display = 'none';
                        } else {
                            // Always show image assistant
                            assistant.element.style.display = 'flex';
                        }
                    }
                }
            });
        }
    }
};

/**
 * Handle feature toggle status changes
 */
export function handleFeatureChange(featureName, value, oldValue) {
    if (!PromptAssistant || !promptAssistant) return;
    // Regardless of master toggle status, feature toggles always work independently
    // If changing from disabled to enabled, need to recreate buttons
    if (value && !oldValue) {
        // Only rebuild buttons if assistant system has been initialized
        if (PromptAssistant.instances.size > 0) {
            // Recreate buttons for all instances
            PromptAssistant.instances.forEach((instance) => {
                if (instance.element && instance.innerContent) {
                    // Clear existing button container
                    instance.innerContent.innerHTML = '';
                    instance.buttons = {};
                    // Recreate all buttons
                    promptAssistant.addFunctionButtons(instance);
                }
            });
            logger.debug(`Feature rebuild | Result: Complete | Feature: ${featureName}`);

            // Recalculate and update all instance widths
            promptAssistant.updateAllInstancesWidth();
            if (imageCaption && imageCaption.updateAllInstancesWidth) {
                imageCaption.updateAllInstancesWidth();
            }
        }

        // If image captioning feature is enabled
        if (featureName === 'Image captioning' && imageCaption) {
            // Enable image assistant feature
            if (imageCaption.initialized) {
                // Reset node initialization flag
                if (app.canvas && app.canvas.graph) {
                    const nodes = app.canvas.graph._nodes || [];
                    nodes.forEach(node => {
                        if (node) {
                            node._imageCaptionInitialized = false;
                        }
                    });
                }

                // If there is a currently selected node, process immediately
                if (app.canvas && app.canvas.selected_nodes && Object.keys(app.canvas.selected_nodes).length > 0) {
                    app.canvas._imageCaptionSelectionHandler(app.canvas.selected_nodes);
                }
            } else {
                // If image assistant has not been initialized, initialize it
                imageCaption.initialize().then(() => {
                    // After initialization, process currently selected nodes
                    if (app.canvas && app.canvas.selected_nodes && Object.keys(app.canvas.selected_nodes).length > 0) {
                        app.canvas._imageCaptionSelectionHandler(app.canvas.selected_nodes);
                    }
                });
            }
        }

        // If node help translation feature is enabled
        if (featureName === 'Node help translation' && nodeHelpTranslator) {
            // Enable node help translation feature
            nodeHelpTranslator.initialize();
        }
    } else {
        // Otherwise only update display status
        FEATURES.updateButtonsVisibility();

        // If image captioning feature is disabled
        if (featureName === 'Image captioning' && !value && imageCaption) {
            // Clean up all image assistant instances
            imageCaption.cleanup();
        }

        // If node help translation feature is disabled
        if (featureName === 'Node help translation' && !value && nodeHelpTranslator) {
            // Clean up node help translation feature
            nodeHelpTranslator.cleanup();
        }

        // When feature toggle changes, update all instance widths
        if (PromptAssistant.instances.size > 0 || (ImageCaption && ImageCaption.instances.size > 0)) {
            promptAssistant.updateAllInstancesWidth();
            if (imageCaption && imageCaption.updateAllInstancesWidth) {
                imageCaption.updateAllInstancesWidth();
            }
        }
    }
}