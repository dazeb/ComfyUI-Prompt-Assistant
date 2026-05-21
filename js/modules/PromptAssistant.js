/**
 * Prompt Assistant Core Class
 * Unified management of assistant lifecycle, instance creation, UI interaction, etc.
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { FEATURES } from "../services/features.js";
import { HistoryManager } from "./history.js";
import { TagManager } from "./tag.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG, CacheService } from "../services/cache.js";
import { EventManager } from "../utils/eventManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { PromptFormatter } from "../utils/promptFormatter.js";
import { APIService } from "../services/api.js";

import { buttonMenu } from "../services/btnMenu.js";
import { rulesConfigManager } from "./rulesConfigManager.js";
import { nodeMountService, RENDER_MODE } from "../services/NodeMountService.js";
import { AssistantContainer, ANCHOR_POSITION } from "./AssistantContainer.js";
import { PopupManager } from "../utils/popupManager.js";
import { MarkdownNoteTranslate } from "../utils/markdownNoteTranslate.js";



// ====================== utility functions ======================

/**
 * Calculate the preset width of assistantUI
 * Returns the corresponding fixed width value based on the number of currently enabled functions
 * @returns {number} Width value (pixels)
 */
function calculateAssistantWidth() {
    // statsEnabled functions
    const hasHistory = window.FEATURES.history;
    const hasTag = window.FEATURES.tag;
    const hasExpand = window.FEATURES.expand;
    const hasTranslate = window.FEATURES.translate;

    // number of non-history functions
    const otherFeaturesCount = [hasTag, hasExpand, hasTranslate].filter(Boolean).length;

    // Return preset constant width based on function combination
    if (hasHistory && otherFeaturesCount === 3) {
        return 143; // all functions enabled (History3 + divider1 + other3)
    } else if (hasHistory && otherFeaturesCount === 2) {
        return 121; // History + two other items
    } else if (hasHistory && otherFeaturesCount === 1) {
        return 99;  // History + one other item
    } else if (hasHistory && otherFeaturesCount === 0) {
        return 77;  // Only History function
    } else if (!hasHistory && otherFeaturesCount === 3) {
        return 72;  // History disabled, three other functions
    } else if (!hasHistory && otherFeaturesCount === 2) {
        return 50;  // Only two buttons
    } else if (!hasHistory && otherFeaturesCount === 1) {
        return 28;  // Only one button
    }

    return 28; // default
}



/**
 * Debounce function
 * Limits function call frequency to avoid performance issues from frequent triggering
 */
function debounce(func, wait = 100) {
    return EventManager.debounce(func, wait);
}

/**
 * Get input element content
 * Supports standard textarea, Tiptap editor, ProseMirror editor, etc.
 * @param {object} widget - assistant widget object
 * @returns {string} input content
 */
function getInputValue(widget, options = {}) {
    if (!widget || !widget.inputEl) {
        return '';
    }

    const inputEl = widget.inputEl;
    const returnHtml = options.html === true;

    // Standard textarea
    if (inputEl.tagName === 'TEXTAREA' && inputEl.value !== undefined) {
        return inputEl.value;
    }

    // Tiptap/ProseMirror/comfy-markdown editor
    if (inputEl.classList.contains('tiptap') ||
        inputEl.classList.contains('ProseMirror') ||
        inputEl.classList.contains('comfy-markdown')) {

        let targetEl = inputEl;
        // For comfy-markdown, find the internal editor element
        if (inputEl.classList.contains('comfy-markdown')) {
            const editorEl = inputEl.querySelector('.tiptap, .ProseMirror');
            if (editorEl) {
                targetEl = editorEl;
            }
        }

        if (returnHtml) {
            return targetEl.innerHTML || '';
        }

        const textContent = targetEl.textContent || targetEl.innerText || '';
        if (textContent.trim()) {
            return textContent;
        }

        // Get from widget.value
        if (widget.value !== undefined) {
            return widget.value;
        }

        // Get from node.widgets corresponding widget.value
        if (widget.node && widget.node.widgets) {
            const matchingWidget = widget.node.widgets.find(w =>
                w.name === widget.inputId || w.name === 'text'
            );
            if (matchingWidget && matchingWidget.value !== undefined) {
                return matchingWidget.value;
            }
        }
    }

    // contenteditable element
    if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
        if (returnHtml) {
            return inputEl.innerHTML || '';
        }
        return inputEl.textContent || inputEl.innerText || '';
    }

    // widget.value
    if (widget.value !== undefined && typeof widget.value === 'string') {
        return widget.value;
    }

    // inputWidget.value
    if (widget.inputWidget && widget.inputWidget.value !== undefined) {
        return widget.inputWidget.value;
    }

    return '';
}

/**
 * Set input element content
 * Supports standard textarea, Tiptap editor, ProseMirror editor, etc.
 * @param {object} widget - assistant widget object
 * @param {string} content - content to set
 * @param {object} options - configuration options
 * @param {boolean} options.html - whether to set as HTML content
 * @param {boolean} options.silent - whether to update silently (no event triggered, used for streaming output)
 * @returns {boolean} whether setting was successful
 */
function setInputValue(widget, content, options = {}) {
    if (!widget || !widget.inputEl) {
        return false;
    }

    const inputEl = widget.inputEl;
    const useHtml = options.html === true;
    const silent = options.silent === true;  // no event during streaming update

    try {
        // Standard textarea
        if (inputEl.tagName === 'TEXTAREA' && inputEl.value !== undefined) {
            inputEl.value = content;

            // Critical fix: even in silent mode, need to sync widget.value and node.widgets[].value
            // Otherwise subsequent getInputValue will read old value
            if (widget.value !== undefined) {
                widget.value = content;
            }
            if (widget.node && widget.node.widgets) {
                const matchingWidget = widget.node.widgets.find(w =>
                    w.name === widget.inputId || w.name === 'text'
                );
                if (matchingWidget) {
                    matchingWidget.value = content;
                }
            }

            if (!silent) {
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }

        // comfy-markdown or Tiptap/ProseMirror editor
        if (inputEl.classList.contains('comfy-markdown') ||
            inputEl.classList.contains('tiptap') ||
            inputEl.classList.contains('ProseMirror')) {

            // For comfy-markdown, find internal editor
            let targetEl = inputEl;
            if (inputEl.classList.contains('comfy-markdown')) {
                const editorEl = inputEl.querySelector('.tiptap, .ProseMirror');
                if (editorEl) {
                    targetEl = editorEl;
                }
            }

            // Set textContent/innerHTML
            if (targetEl.isContentEditable || targetEl.getAttribute('contenteditable') === 'true') {
                if (useHtml) {
                    targetEl.innerHTML = content;
                } else {
                    targetEl.textContent = content;
                }
            } else {
                targetEl.innerHTML = content;
            }

            // Trigger input event (skip in silent mode)
            if (!silent) {
                targetEl.dispatchEvent(new Event('input', { bubbles: true }));
                targetEl.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Also update widget.value (sync needed even in silent mode)
            if (widget.value !== undefined) {
                widget.value = content;
            }

            // Also update node.widgets[].value (sync needed even in silent mode)
            if (widget.node && widget.node.widgets) {
                const matchingWidget = widget.node.widgets.find(w =>
                    w.name === widget.inputId || w.name === 'text'
                );
                if (matchingWidget) {
                    matchingWidget.value = content;
                }
            }

            return true;
        }

        // contenteditable element
        if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
            if (useHtml) {
                inputEl.innerHTML = content;
            } else {
                inputEl.textContent = content;
            }

            // Critical fix: sync widget.value and node.widgets[].value
            if (widget.value !== undefined) {
                widget.value = content;
            }
            if (widget.node && widget.node.widgets) {
                const matchingWidget = widget.node.widgets.find(w =>
                    w.name === widget.inputId || w.name === 'text'
                );
                if (matchingWidget) {
                    matchingWidget.value = content;
                }
            }

            if (!silent) {
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }

        // widget.value
        if (widget.value !== undefined) {
            widget.value = content;
            return true;
        }

        return false;
    } catch (error) {
        logger.error(`[setInputValue] Setting failed | error: ${error.message}`);
        return false;
    }
}

// ====================== Main Class Implementation ======================

/**
 * Prompt assistant main class
 * Unified management of assistant lifecycle, instances, and resources
 */
class PromptAssistant {
    /** Map collection of all assistant instances */
    static instances = new Map();

    constructor() {
        this.initialized = false;
    }

    /**
     * [Core optimization] Unified method to get the unique key for an assistant instance
     * Resolves conflicts with subgraph node IDs and inconsistent keys across different scanning modes
     */
    _getAssistantKey(node, inputId) {
        if (!node) return null;
        const graph = node.graph || app.graph;
        // Priority order: graph.id (Locator ID) -> graph._workflow_id -> 'main'
        const graphId = graph?.id || graph?._workflow_id || 'main';
        return `${graphId}_${node.id}_${inputId}`;
    }

    // --- Lifecycle management functions ---
    /**
     * Check if function is disabled
     */
    areAllFeaturesDisabled() {
        return !window.FEATURES.enabled;
    }

    /**
     * Initialize prompt assistant
     */
    initialize() {
        if (this.initialized) return;

        try {
            // Check version number
            if (!window.PromptAssistant_Version) {
                logger.error("Version number not found during initialization! This may cause UI display issues");
            } else {
                logger.debug(`Detected version number during init: ${window.PromptAssistant_Version}`);
            }

            // Initialize event manager
            EventManager.init();

            // Load all function switch states from config
            FEATURES.loadSettings();
            // Sync to window.FEATURES for backward compatibility
            window.FEATURES.enabled = FEATURES.enabled;

            // Record master switch state (changed to debug level)
            logger.debug(`Checking master switch state during init | Status:${FEATURES.enabled ? "Enabled" : "Disabled"}`);

            // Initialize resource manager
            ResourceManager.init();

            // Only do full initialization when master switch is on
            if (window.FEATURES.enabled) {

            }

            this.initialized = true;
            logger.log("Initialization complete | Assistant fully started");
        } catch (error) {
            logger.error(`Initialization failed | Error: ${error.message}`);
            // Reset state
            this.initialized = false;
            window.FEATURES.enabled = false;
            // Ensure cleanup
            this.cleanup();
        }
    }

    /**
     * Unified master switch control
     * Centrally manages all service functions controlled by the master switch
     */
    async toggleGlobalFeature(enable, force = false) {
        // Update state
        const oldValue = window.FEATURES.enabled;
        window.FEATURES.enabled = enable;

        // Don't execute if state unchanged, unless force is true
        if (!force && oldValue === enable) {
            return;
        }

        // Only log when state actually changes or forced execution
        if (oldValue !== enable || force === true) {
            logger.log(`Master switch | Action:${enable ? "Enabled" : "Disabled"}`);
        }

        try {
            if (enable) {
                // === Enable all services ===
                // Ensure manager is initialized
                if (!EventManager.initialized) {
                    EventManager.init();
                }

                if (!ResourceManager.isInitialized()) {
                    ResourceManager.init();
                }

                // 1. Reset node init flags, prepare for re-detection
                if (app.canvas && app.canvas.graph) {
                    const nodes = app.canvas.graph._nodes || [];
                    nodes.forEach(node => {
                        if (node) {
                            node._promptAssistantInitialized = false;
                        }
                    });
                }

                // 2. Set up or restore node selection event listener
                if (app.canvas) {
                    // Avoid setting duplicate listener
                    if (!app.canvas._promptAssistantSelectionHandler) {
                        app.canvas._promptAssistantSelectionHandler = function (selected_nodes) {
                            // When master switch is off, skip all node processing
                            if (!window.FEATURES.enabled) {
                                return;
                            }

                            if (selected_nodes && Object.keys(selected_nodes).length > 0) {
                                Object.keys(selected_nodes).forEach(nodeId => {
                                    const node = app.canvas.graph.getNodeById(nodeId);
                                    if (!node) return;

                                    // Initialize uninitialized node
                                    if (!node._promptAssistantInitialized) {
                                        node._promptAssistantInitialized = true;
                                        this.checkAndSetupNode(node);
                                    }
                                });
                            }
                        }.bind(this);
                    }

                    // Save current listener and set new one
                    if (app.canvas.onSelectionChange && app.canvas.onSelectionChange !== app.canvas._promptAssistantSelectionHandler) {
                        app.canvas._originalSelectionChange = app.canvas.onSelectionChange;
                    }

                    app.canvas.onSelectionChange = app.canvas._promptAssistantSelectionHandler;

                    // 3. If auto-create is enabled, immediately scan all valid nodes
                    const creationMode = app.ui.settings.getSettingValue("PromptAssistant.Settings.CreationMode") || "auto";
                    if (creationMode === "auto") {
                        const nodes = app.canvas.graph._nodes || [];
                        nodes.forEach(node => {
                            if (node && !node._promptAssistantInitialized) {
                                // Avoid duplicate processing during scan
                                node._promptAssistantInitialized = true;
                                this.checkAndSetupNode(node);
                            }
                        });
                    }
                }
            } else {
                // === Disable all services ===

                // 1. Count and clean up all instances
                const instanceCount = PromptAssistant.instances.size;
                this.cleanup(null, true);

                // 2. Restore original node selection event listener
                if (app.canvas) {
                    if (app.canvas._originalSelectionChange) {
                        app.canvas.onSelectionChange = app.canvas._originalSelectionChange;
                    } else {
                        app.canvas.onSelectionChange = null;
                    }
                }
            }

            // Button visibility update is handled separately in features
            window.FEATURES.updateButtonsVisibility();


        } catch (error) {
            logger.error(`Master switch operation failed | error: ${error.message}`);
            // Restore original state
            window.FEATURES.enabled = oldValue;
        }
    }

    // --- Resource management functions ---
    /**
     * Clean up all resources
     */
    cleanup(nodeId = null, silent = false) {
        // If currently switching workflows, only clean up UI instances, don't delete cache
        if (window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING) {
            // Simplify logs: don't print individual cleanup logs during workflow switch to avoid high-frequency screen spam
            // For debugging, change the line below to debug level single output
            // if (nodeId !== null) { logger.debug(`[cleanupSkip] Switching workflows, only cleaning prompt assistant UI, node ID: ${nodeId}`); }

            const keysToDelete = Array.from(PromptAssistant.instances.keys())
                .filter(key => nodeId === null || key.startsWith(`${String(nodeId)}_`));

            keysToDelete.forEach(key => {
                const instance = PromptAssistant.getInstance(key);
                if (instance) {
                    this._cleanupInstance(instance, key, false); // false means remove from instance collection
                }
            });

            // If global cleanup, clear instance collection
            if (nodeId === null) {
                PromptAssistant.instances.clear();
            }
            return;
        }

        // Check if ID is valid
        if (nodeId !== null && nodeId !== undefined) {
            // Ensure nodeId is string type for comparison
            const searchId = String(nodeId);

            // Get all matching instance keys
            // Logic: match exact key (graphId_nodeId_inputId), or old key starting with nodeId_, or full key containing _nodeId_
            const keysToDelete = Array.from(PromptAssistant.instances.keys())
                .filter(key => {
                    // 1. Exact match (if passed as assistantKey)
                    if (key === searchId) return true;
                    // 2. Match nodeId (old format)
                    if (key.startsWith(`${searchId}_`)) return true;
                    // 3. Match format with graphId prefix (graphId_nodeId_inputId)
                    const parts = key.split('_');
                    return parts.length >= 2 && parts[1] === searchId;
                });

            // If there are instances to clean up
            if (keysToDelete.length > 0) {
                let historyCount = 0;
                let tagCount = 0;
                let instanceNames = [];

                try {
                    // Count and clean up history records
                    const allHistory = HistoryCacheService.getAllHistory();
                    historyCount = allHistory.filter(item => item.node_id === nodeId).length;
                    HistoryCacheService.clearNodeHistory(nodeId);

                    // Count and clean up tag cache
                    keysToDelete.forEach(key => {
                        const instance = PromptAssistant.getInstance(key);
                        if (instance && instance.inputId) {
                            const tags = TagCacheService.getAllRawTags(nodeId, instance.inputId);
                            tagCount += tags ? tags.length : 0;
                            TagCacheService.clearCache(nodeId, instance.inputId);
                            instanceNames.push(instance.inputId);
                        }
                    });

                    // Clean up instances
                    keysToDelete.forEach(key => {
                        const instance = PromptAssistant.getInstance(key);
                        if (instance) {
                            this._cleanupInstance(instance, key, true);
                            PromptAssistant.instances.delete(key);
                        }
                    });

                    if (!silent) {
                        // Get remaining statistics
                        const remainingInstances = PromptAssistant.instances.size;
                        // Get tag cache statistics
                        const tagStats = TagCacheService.getTagStats();
                        const remainingTags = tagStats.total;
                        const remainingHistory = HistoryCacheService.getAllHistory().length;

                        logger.log(`[Cleanup Summary] Node ID: ${nodeId} | Cleaned instances: ${instanceNames.join(', ')} | History cleaned: ${historyCount} items | Tag cache cleaned: ${tagCount} items`);
                    }
                } catch (error) {
                    logger.error(`[Node cleanup] failed | Node ID: ${nodeId} | error: ${error.message}`);
                }
            }
            return;
        }

        // Clean all instances and history
        const beforeCleanupSize = PromptAssistant.instances.size;
        if (beforeCleanupSize > 0) {
            let totalHistoryCount = 0;
            let totalTagCount = 0;
            let allInstanceNames = [];

            try {
                // Count and clean up all history records
                const allHistory = HistoryCacheService.getAllHistory();
                totalHistoryCount = allHistory.length;
                HistoryCacheService.clearAllHistory();

                // Count tag cache
                const tagStats = TagCacheService.getTagStats();
                totalTagCount = tagStats.total;

                // Clean all tag cache
                TagCacheService.clearAllTagCache();

                // Clean up all instances
                for (const [key, instance] of PromptAssistant.instances) {
                    if (instance) {
                        allInstanceNames.push(instance.inputId || key);
                        this._cleanupInstance(instance, key, true);
                    }
                }

                // Clear instance collection
                PromptAssistant.instances.clear();

                if (!silent) {
                    logger.log(`[Global cleanup] instances: ${allInstanceNames.join(', ')} | History: ${totalHistoryCount} items | tags: ${totalTagCount} items`);
                    logger.log(`[Remaining stats] Assistant instances: 0 | Tag cache: 0 | Node history cache: 0`);
                }
            } catch (error) {
                logger.error(`[Global cleanup] failed | error: ${error.message}`);
            }
        }
    }

    // --- Node type detection tools ---

    /**
     * Check if node uses comfy-markdown
     * Includes Note, MarkdownNote, PreviewTextNode, etc.
     * @param {object} node - Node object
     * @returns {boolean}
     */
    _isMarkdownNode(node) {
        if (!node || !node.type) return false;
        const markdownNodeTypes = ['Note', 'MarkdownNote', 'PreviewAny', 'PreviewTextNode'];
        if (markdownNodeTypes.includes(node.type)) {
            return true;
        }
        const typeLower = node.type.toLowerCase();
        return typeLower.includes('markdown') ||
            (typeLower.includes('preview') && typeLower.includes('text')) ||
            typeLower.includes('subgraph'); // Add basic subgraph detection support
    }

    /**
     * Check if node is a subgraph node (Subgraph)
     * Subgraph node type name is UUID format
     * @param {object} node - Node object
     * @returns {boolean}
     */
    _isSubgraphNode(node) {
        if (!node || !node.type) return false;
        // UUID format: 8-4-4-4-12 characters
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.type);
    }

    // --- Instance management functions ---
    /**
     * Check if node is valid
     * Note/MarkdownNote/Subgraph nodes in Vue mode need special handling
     */
    static isValidNode(node) {
        if (!node || typeof node.id === 'undefined' || node.id === -1) {
            return false;
        }

        if (typeof node.type !== 'string') {
            return false;
        }

        // Special node types in Vue mode (may not have standard widgets property)
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
        const vueSpecialNodeTypes = ['Note', 'MarkdownNote', 'PreviewAny', 'PreviewTextNode'];

        // Check if markdown type node
        const isMarkdownNode = vueSpecialNodeTypes.includes(node.type) ||
            (node.type && node.type.toLowerCase().includes('markdown')) ||
            (node.type && node.type.toLowerCase().includes('preview') && node.type.toLowerCase().includes('text'));

        // Check if subgraph node
        // 1. UUID format type name (Node 2.0 dynamic creation)
        const isUUIDType = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.type);
        // 2. Native Subgraph keyword or workflow/ prefix
        const isSubgraphType = node.type === 'Subgraph' ||
            node.type.startsWith('workflow/') ||
            (node.constructor && node.constructor.name === 'Subgraph');

        if (isVueMode && (isMarkdownNode || isUUIDType || isSubgraphType)) {
            // logger.debug(`[isValidNode] Vue+Special match: ${node.type}`);
            return true;
        }

        const valid = !!node.widgets;
        if (!valid) {
            // logger.debug(`[isValidNode] Fallback check: ${node.type}`);
        }
        // Standard check: must have widgets property
        return valid;
    }

    /**
     * Add instance to manager
     */
    static addInstance(nodeId, widget) {
        if (nodeId != null && widget != null) {
            this.instances.set(String(nodeId), widget);
            return true;
        }
        return false;
    }

    /**
     * Get instance
     */
    static getInstance(key) {
        if (key == null) return null;
        return this.instances.get(String(key));
    }

    /**
     * Check if instance exists
     */
    static hasInstance(key) {
        if (key == null) return false;
        return this.instances.has(String(key));
    }

    /**
     * Check node and set up assistant
     * Find valid input controls in node and create assistant
     */
    checkAndSetupNode(node) {
        // Quick check
        if (!window.FEATURES.enabled || !node) return;

        const isVueMode = LiteGraph.vueNodesMode === true;
        const graph = node.graph || app.graph;
        const graphId = graph?.id || graph?._workflow_id || 'main';



        // Special Vue mode nodes (Note/Markdown/Subgraph) are valid even without LiteGraph widgets
        if (!node.widgets) {

            if (isVueMode && PromptAssistant.isValidNode(node)) {
                this._handleVueDomScanNode(node);
            }
            return;
        }

        // Subsequent check: if widgets exist but node isn't recognized, fall back
        const isValid = PromptAssistant.isValidNode(node);
        if (!isValid) {

            return;
        }

        // Get all valid input controls
        const validInputs = node.widgets.filter(widget => {
            if (!widget.node) widget.node = node;
            const isValidInput = UIToolkit.isValidInput(widget, { debug: false, node: node });

            return isValidInput;
        });



        if (validInputs.length === 0) {
            // Non-target node types (like LoadImage) without text controls are normal, use debug level
            logger.debug(`[checkAndSetupNode] Node has no valid controls | ID: ${node.id} | type: ${node.type}`);

            // Vue mode nodes may not yet have recognized LiteGraph controls, force fallback to DOM scan mode
            if (isVueMode && isValid) {
                this._handleVueDomScanNode(node);
            }
            return;
        }

        // Create assistant for each valid control
        validInputs.forEach((inputWidget, widgetIndex) => {
            const inputId = inputWidget.name || inputWidget.id;

            // --- Core fix: unique key for multi-image support ---
            let assistantKey = this._getAssistantKey(node, inputId);

            // Check if input boxes with same name exist, use index or DOM element unique identifier
            const sameNameWidgets = validInputs.filter(w => (w.name || w.id) === inputId);
            if (sameNameWidgets.length > 1) {
                // Multiple same-name inputs, use index or input element memory address as unique identifier
                const inputEl = inputWidget.inputEl || inputWidget.element;
                if (inputEl) {
                    // Add unique identifier to input element
                    if (!inputEl.dataset.promptAssistantUniqueId) {
                        inputEl.dataset.promptAssistantUniqueId = `${graphId}_${node.id}_${inputId}_${widgetIndex}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    }
                    assistantKey = inputEl.dataset.promptAssistantUniqueId;
                } else {
                    // Fallback: use index
                    assistantKey = `${graphId}_${node.id}_${inputId}_${widgetIndex}`;
                }
            }

            // Check if instance already exists
            if (PromptAssistant.hasInstance(assistantKey)) {
                // If instance exists, check if input control has changed or UI element is missing
                const instance = PromptAssistant.getInstance(assistantKey);
                const currentInputEl = inputWidget.inputEl;
                const instanceInputEl = instance?.text_element;
                const instanceUIEl = instance?.element;

                // Check if UI element is still in DOM
                const isVueMode = nodeMountService.isVueNodesMode();
                const nodeContainer = isVueMode ? document.querySelector(`[data-node-id="${node.id}"]`) : null;
                const isUIPresent = isVueMode ? nodeContainer?.contains(instanceUIEl) : document.body.contains(instanceUIEl);

                // --- Fix: handle mount race condition ---
                // If UI element is missing, or input reference changed and original element is removed, clean up and rebuild
                // Add _isMounting flag check to prevent false-positive loss detection during async mounting
                if (!instanceUIEl || (!isUIPresent && !instance._isMounting)) {
                    logger.debug(() => `[checkAndSetupNode] UI element lost, cleaning up instance to trigger rebuild | Node ID: ${node.id} | Key: ${assistantKey}`);
                    // Pass the full assistantKey to ensure precise cleanup
                    this.cleanup(assistantKey);
                } else if (!isUIPresent && instance._isMounting) {
                    // Currently mounting, skip
                    return;
                } else if (instanceInputEl && currentInputEl && instanceInputEl !== currentInputEl) {
                    // Further check: ensure rebuild is really needed (avoid false positives)
                    // Only clean up if current element has been removed from DOM
                    if (!document.body.contains(instanceInputEl)) {
                        logger.debug(() => `[checkAndSetupNode] Input element invalid, cleaning up instance | Node ID: ${node.id}`);
                        this.cleanup(node.id);
                    } else {
                        return;
                    }
                } else {
                    // Instance exists and is fine, skip
                    return;
                }
            }

            // Recheck master switch to ensure not disabled during creation
            if (!window.FEATURES.enabled) {
                return;
            }

            // [Anti-duplicate mount check] Check if inputEl is already mounted by another instance before creation
            const inputEl = inputWidget.inputEl || inputWidget.element;
            if (inputEl && inputEl._promptAssistantMounted) {
                return;
            }

            // Create assistant instance
            const assistant = this.setupNodeAssistant(node, inputWidget, assistantKey);
            if (assistant) {
                logger.debugSample(() => `[assistant] Create instance | node:${node.id} | control:${inputId} | index:${widgetIndex}`);
            }
        });
    }

    /**
     * DOM scan handling for special/dynamic nodes (Note/Subgraph etc.) in Vue mode
     * When LiteGraph widgets are not ready, scan DOM for textarea and mount directly
     */
    _handleVueDomScanNode(node) {
        if (!node) return;

        const isMarkdown = this._isMarkdownNode(node);
        const isSubgraph = this._isSubgraphNode(node);

        // logger.debug(`[_handleVueDomScanNode] Scanning: ${node.type}`);

        // Only process recognized valid nodes
        if (!isMarkdown && !isSubgraph) return;

        const nodeId = node.id;

        // Use NodeMountService logic to find all potential input boxes in DOM container
        const nodeContainer = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (!nodeContainer) {
            // If container hasn't rendered, start a single retry mount attempt (for main input)
            if (isMarkdown) {
                this._retryDomScan(node, 'text');
            }
            return;
        }

        // Find all textareas (prefer PrimeVue's .p-textarea)
        const primeTextareas = Array.from(nodeContainer.querySelectorAll('textarea.p-textarea'));
        const textareas = primeTextareas.length > 0 ? primeTextareas : Array.from(nodeContainer.querySelectorAll('textarea'));

        if (textareas.length === 0) {
            // Maybe a TipTap editor (for Note node)
            const editor = nodeContainer.querySelector('.tiptap') || nodeContainer.querySelector('.ProseMirror');
            // logger.debug(`[Vue scan] Node has no text box | ID: ${node.id}`);
            if (editor) {
                this._mountDomAssistant(node, editor, 'text', 0);
            }
            return;
        }

        // Iterate all found textareas and attempt mount
        textareas.forEach((el, index) => {
            // Generate key: Note nodes usually have one, subgraphs have multiple
            const inputId = textareas.length === 1 ? 'text' : `input_${index}`;
            this._mountDomAssistant(node, el, inputId, index);
        });
    }

    /**
     * Execute actual DOM mount
     */
    _mountDomAssistant(node, element, inputId, index) {
        const assistantKey = this._getAssistantKey(node, inputId);
        if (PromptAssistant.hasInstance(assistantKey)) {
            const instance = PromptAssistant.getInstance(assistantKey);
            const isVueMode = nodeMountService.isVueNodesMode();
            const nodeContainer = isVueMode ? document.querySelector(`[data-node-id="${node.id}"]`) : null;
            const isUIPresent = isVueMode ? nodeContainer?.contains(instance?.element) : document.body.contains(instance?.element);

            if (instance?.element && isUIPresent) {
                return;
            }

            // Instance exists but UI lost, clean up old instance for rebuild
            logger.debug(() => `[_mountDomAssistant] Detected orphan instance, cleaning up for rebuild | Node ID: ${node.id}`);
            this.cleanup(node.id);
        }

        // Check if element is already mounted (based on DOM attribute)
        if (element._promptAssistantMounted) {
            // If attribute still exists but instance is gone from Map, or UI is truly invisible, allow remount
            // Keep as-is, ensure consistency through cleanup above
            return;
        }

        // Create virtual widget
        const virtualWidget = {
            name: inputId, id: inputId, type: 'textarea',
            inputEl: element, element: element, node: node,
            _domIndex: index // Record DOM index
        };

        const nodeInfo = {
            workflow_id: app.graph?._workflow_id || 'unknown',
            nodeType: node.type, inputType: 'text',
            isNoteNode: this._isMarkdownNode(node),
            isSubgraph: this._isSubgraphNode(node),
            isVueMode: true,
            domIndex: index
        };

        const assistant = this.createAssistant(node, inputId, virtualWidget, nodeInfo, assistantKey);
        if (assistant) {
            this.showAssistantUI(assistant);
            // logger.debugSample(() => `[DOM scan] ${node.type} node mount successful | ID: ${node.id} | Key: ${assistantKey}`);
        }
    }

    /**
     * Perform a retry scan when initial DOM is not ready
     */
    _retryDomScan(node, inputId) {
        const widgetStub = { name: inputId, node: node };
        nodeMountService.findMountContainerWithRetry(node, widgetStub, { timeout: 2000 })
            .then(result => {
                if (result && result.textarea) {
                    this._mountDomAssistant(node, result.textarea, inputId, 0);
                }
            });
    }

    /**
     * Set up assistant for node
     * Create assistant instance and initialize display state
     */
    setupNodeAssistant(node, inputWidget, assistantKey = null) {


        // Simplified parameter check
        if (!node || !inputWidget) {
            logger.error(`[setupNodeAssistant] Invalid parameters | node: ${!!node} | inputWidget: ${!!inputWidget}`);
            return null;
        }

        try {
            const nodeId = node.id;
            const inputId = inputWidget.name || inputWidget.id || Math.random().toString(36).substring(2, 10);
            const isNoteNode = this._isMarkdownNode(node);
            const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;



            // Simplify node info
            const nodeInfo = {
                workflow_id: app.graph?._workflow_id || 'unknown',
                nodeType: node.type,
                inputType: inputId,
                isNoteNode: isNoteNode,
                isVueMode: isVueMode
            };

            // Handle inputWidget's inputEl reference
            let processedWidget = inputWidget;
            if (isNoteNode) {
                const inputEl = inputWidget.element || inputWidget.inputEl;
                processedWidget = {
                    ...inputWidget,
                    inputEl: inputEl,
                    _needsDelayedTextareaLookup: isVueMode && !inputEl
                };
            }
            // Supplement with found real textarea (fix Litegraph PromotedWidgetView not getting inputEl)
            const mountContainer = nodeMountService.findMountContainer(node, inputWidget);
            if (mountContainer && mountContainer.textarea) {
                processedWidget = Object.create(processedWidget);
                processedWidget.inputEl = mountContainer.textarea;
                processedWidget.element = mountContainer.textarea;
            }

            // Create assistant instance

            const assistant = this.createAssistant(
                node,
                inputId,
                processedWidget,
                nodeInfo,
                assistantKey
            );

            if (assistant) {

                // Initialize display state
                this.showAssistantUI(assistant);
                return assistant;
            } else {
                console.warn(`[setupNodeAssistant] ⚠️ createAssistant returned null`);
            }

            return null;
        } catch (error) {
            logger.error(`[setupNodeAssistant] ❌ exception | node: ${node.id} | error:`, error);
            logger.error(`Create assistant failed | Node ID: ${node.id} | Reason: ${error.message}`);
            return null;
        }
    }

    /**
     * Create assistant instance
     * Build assistant object based on node and input control and initialize UI
     */
    createAssistant(node, inputId, inputWidget, nodeInfo = {}, assistantKey = null) {


        // Simplified pre-checks
        if (!window.FEATURES.enabled || !node || !inputId || !inputWidget) {
            logger.error(`[createAssistant] ❌ Pre-check failed | enabled: ${window.FEATURES.enabled} | node: ${!!node} | inputId: ${inputId} | inputWidget: ${!!inputWidget}`);
            return null;
        }


        // Ensure widget has node reference set
        if (!inputWidget.node) {
            inputWidget.node = node;
        }

        // Validate if it's a valid input

        if (!UIToolkit.isValidInput(inputWidget, { node: node })) {
            console.warn(`[createAssistant] ⚠️ Invalid Input | node: ${node?.id} | control: ${inputId}`);
            return null;
        }


        // Get input element
        let inputEl = inputWidget.inputEl || inputWidget.element;
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;



        // In non-Vue mode, inputEl must exist
        if (!inputEl && !isVueMode) {
            logger.error(`[createAssistant] ❌ InputEl does not exist in non-Vue mode | node: ${node?.id}`);
            return null;
        }

        const nodeId = node.id;
        const widgetKey = assistantKey || this._getAssistantKey(node, inputId);



        // Check if instance already exists
        if (PromptAssistant.hasInstance(widgetKey)) {

            return PromptAssistant.getInstance(widgetKey);
        }



        // Create assistant object
        const widget = {
            type: "prompt_assistant",
            name: inputId,
            nodeId,
            inputId,
            widgetKey,
            buttons: {},
            text_element: inputEl,
            inputEl: inputEl,
            isDestroyed: false,
            _isMounting: true, // Mark mounting state
            nodeInfo: {
                ...nodeInfo,
                nodeId: nodeId,
                nodeType: node.type,
                isVueMode: isVueMode
            },
            isTransitioning: false,
            // Save initial node reference as fallback (Vue Node 2.0 subgraph switching)
            _initialNode: node
        };

        // Dynamic node getter to avoid holding deleted node references
        // [Fix] Prefer getting from graph, fallback to initial reference when failed (solves subgraph toggle canvas not synced)
        Object.defineProperty(widget, 'node', {
            get() {
                if (this.isDestroyed) return null;
                // Prefer dynamic fetch from current canvas graph
                const graphNode = app.canvas?.graph?._nodes_by_id?.[this.nodeId];
                if (graphNode) return graphNode;
                // Fallback: use initial node reference (if still valid)
                if (this._initialNode && this._initialNode.id === this.nodeId) {
                    return this._initialNode;
                }
                return null;
            },
            configurable: true
        });



        // Create global input box mapping
        if (!window.PromptAssistantInputWidgetMap) {
            window.PromptAssistantInputWidgetMap = {};
        }

        window.PromptAssistantInputWidgetMap[widgetKey] = {
            inputEl: inputEl,
            widget: widget
        };



        // Create UI and add to instance collection
        this.createAssistantUI(widget, inputWidget);

        PromptAssistant.addInstance(widgetKey, widget);



        // Initialize bindings
        if (inputEl) {
            this._initializeInputElBindings(widget, inputWidget, node, inputId, nodeInfo);
        } else {

        }


        return widget;
    }

    /**
     * Initialize event bindings related to inputEl
     * Called immediately in traditional mode, called after finding textarea in Vue mode
     */
    _initializeInputElBindings(widget, inputWidget, node, inputId, nodeInfo) {
        const inputEl = inputWidget.inputEl || widget.inputEl;
        if (!inputEl) {
            logger.warn(`[_initializeInputElBindings] inputEl does not exist | Node ID: ${node?.id}`);
            return;
        }

        const nodeId = node.id;

        // Initialize undo state (only once, using widget-level flag)
        if (!widget._undoStateInitialized) {
            const initialValue = inputEl.value || '';
            // If initial value is not empty, directly add to history record, ensuring undo can revert to initial state
            if (initialValue.trim()) {
                HistoryCacheService.addHistoryAndUpdateUndoState(nodeId, inputId, initialValue, 'input');
            } else {
                HistoryCacheService.initUndoState(nodeId, inputId, initialValue);
            }
            widget._undoStateInitialized = true;
        }
        // Immediately update undo/redo button state on initialization
        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

        // Check if events are already bound (avoid duplicate binding)
        // [Critical fix] Use widget-level flag to precisely control binding state
        // Ensure not to misjudge due to _eventCleanupFunctions containing other cleanup functions (like button menu)
        if (widget._inputEventsBound) {
            logger.debug(`[_initializeInputElBindings] Skip binding | Node ID: ${nodeId} | Reason: Already bound`);
            return;
        }

        // If legacy flag detected, handle silently

        inputEl._promptAssistantBound = true;
        widget._inputEventsBound = true;
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

        // Bind input box blur event, write to history
        // Use event manager addDOM event listener
        const removeBlurListener = EventManager.addDOMListener(inputEl, 'blur', async () => {
            // logger.debug(`History write preparation | Reason: blur event triggered node_id=${node.id} input_id=${inputId}`);
            HistoryCacheService.addHistory({
                workflow_id: nodeInfo?.workflow_id || '',
                node_id: node.id,
                input_id: inputId,
                content: inputEl.value,
                operation_type: 'input',
                timestamp: Date.now()
            });
            // Reset undo state
            HistoryCacheService.initUndoState(node.id, inputId, inputEl.value);
            // Update button state
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            // logger.debug(`History write complete | Reason: input box blur node_id=${node.id} input_id=${inputId}`);
        });

        // Save cleanup function reference for later cleanup
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
        widget._eventCleanupFunctions.push(removeBlurListener);

        // Add input event listener, real-time update undo/redo button state and position adjustment
        const removeInputListener = EventManager.addDOMListener(inputEl, 'input', () => {
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            // Detect scrollbar state and adjust position
            this._adjustPositionForScrollbar(widget, inputEl);
        });
        widget._eventCleanupFunctions.push(removeInputListener);

        // Add ResizeObserver to listen for input box size changes
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                // Delay execution to ensure browser completes layout update
                setTimeout(() => {
                    this._adjustPositionForScrollbar(widget, inputEl);
                }, 10);
            });

            resizeObserver.observe(inputEl);

            // Add cleanup function
            widget._eventCleanupFunctions.push(() => {
                resizeObserver.disconnect();
            });
        } else {
            // Fallback: listen to window resize event
            const removeResizeListener = EventManager.addDOMListener(window, 'resize',
                EventManager.debounce(() => {
                    this._adjustPositionForScrollbar(widget, inputEl);
                }, 100)
            );
            widget._eventCleanupFunctions.push(removeResizeListener);
        }
    }

    // --- UI management functions ---
    /**
     * Create assistant UI
     * Build DOM elements and set up event listeners and initial styles
     */
    createAssistantUI(widget, inputWidget) {
        const nodeId = widget.nodeId;
        const inputId = widget.inputId;



        try {

            // Get location setting
            const locationSetting = app.ui.settings.getSettingValue(
                "PromptAssistant.Location"
            );



            // Create AssistantContainer instance
            const container = new AssistantContainer({
                nodeId: nodeId,
                type: 'prompt',
                anchorPosition: locationSetting,
                enableDragSort: true,
                onButtonOrderChange: (order) => {
                    logger.debug(`[Sort update] node:${nodeId} | New order: ${order.join(',')}`);
                },
                shouldCollapse: () => {
                    return !this._checkAssistantActiveState(widget);
                }
            });



            // Render container
            const containerEl = container.render();



            // Set Icon
            const mainIcon = ResourceManager.getIcon('icon-main.svg');
            if (mainIcon) {
                if (container.indicator) {
                    container.indicator.innerHTML = '';
                    container.indicator.appendChild(mainIcon);
                }
            }



            // Save references
            widget.container = container;
            widget.element = containerEl;
            widget.innerContent = container.content;
            widget.hoverArea = container.hoverArea;
            widget.indicator = container.indicator;
            widget.buttons = {};

            Object.defineProperty(widget, 'isCollapsed', {
                get: () => container.isCollapsed,
                set: (val) => {
                    if (val) container.collapse(); else container.expand();
                }
            });
            Object.defineProperty(widget, 'isTransitioning', {
                get: () => container.isTransitioning,
                set: (val) => { container.isTransitioning = val; }
            });



            // Initialize buttons
            this.addFunctionButtons(widget);



            // Restore button order
            container.restoreOrder();



            // Setup Positioning
            const inputEl = inputWidget.inputEl || widget.inputEl;
            const graphCanvasContainer = document.querySelector('.graphcanvas');
            const canvasContainerRect = graphCanvasContainer?.getBoundingClientRect();




            this._setupUIPosition(widget, inputEl, containerEl, canvasContainerRect, inputWidget, (success) => {

                if (widget.isDestroyed) {
                    logger.debug(`[Positioning] Callback skipped: instance destroyed | ID: ${nodeId}`);
                    return;
                }

                if (!success) {
                    logger.debugSample(() => `[assistant] Create deferred | Node ID: ${nodeId} | Reason: Positioning container not ready (waiting for DOM render)`);
                    container.destroy();
                    const widgetKey = widget.widgetKey;
                    if (widgetKey && PromptAssistant.instances.has(widgetKey)) {
                        PromptAssistant.instances.delete(widgetKey);
                    }
                    if (window.PromptAssistantInputWidgetMap && widgetKey) {
                        delete window.PromptAssistantInputWidgetMap[widgetKey];
                    }
                    return;
                }

                // After successful positioning, update size
                container.updateDimensions();
                // Mount complete, clear flag
                widget._isMounting = false;
            });

            return containerEl;
        } catch (error) {
            console.error(`[createAssistantUI] ❌ exception | node: ${nodeId} | error:`, error);
            logger.error(`Create assistant failed | Node ID: ${nodeId} | Reason: ${error.message}`);
            return null;
        }
    }

    /**
     * Show assistant UI
     * Control UI display animation and state, start collapsed on creation
     */
    showAssistantUI(widget, forceAnimation = false) {
        if (!widget?.element) return;

        // Avoid duplicate display
        if (widget.element.classList.contains('assistant-show')) {
            // Ensure element visible
            widget.element.style.display = 'flex';
            widget.element.style.opacity = '1';
            return;
        }

        // Display directly, no animation transition
        widget.element.style.opacity = '1';
        widget.element.style.display = 'flex';
        widget.element.classList.add('assistant-show');

        // Ensure hover area is visible (for collapsed interaction)
        if (widget.isCollapsed && widget.hoverArea) {
            widget.hoverArea.style.display = 'block';
        }

        // Reset transition state
        widget.isTransitioning = false;

        // Only trigger auto-collapse when explicitly not collapsed
        if (!widget.isCollapsed) {
            this.triggerAutoCollapse(widget);
        }
    }

    /**
     * Check and trigger auto-collapse (if needed)
     */
    _triggerAutoCollapseIfNeeded(widget) {
        if (widget && widget.container) {
            widget.container.collapse();
        }
    }




    /**
     * Expand assistant
     */
    _expandAssistant(widget) {
        if (widget && widget.container) {
            widget.container.expand();
        }
    }



    /**
     * Public method: trigger assistant auto-collapse
     * For external modules to collapse assistant UI after operations
     */
    triggerAutoCollapse(widget) {
        return this._triggerAutoCollapseIfNeeded(widget);
    }

    /**
     * Update assistant visibility
     * Always show assistant, no longer based on mouse hover state
     */
    updateAssistantVisibility(widget) {
        if (!widget) return;

        // Skip visibility update when master switch is off
        if (!window.FEATURES || !window.FEATURES.enabled) {
            return;
        }

        // Check if any button is active or processing
        const hasActiveButtons = this._checkAssistantActiveState(widget);

        // If active buttons, force show assistant (with animation) and cancel auto-collapse
        if (hasActiveButtons) {
            this.showAssistantUI(widget, true);

            // Cancel possible auto-collapse timer
            if (widget._autoCollapseTimer) {
                clearTimeout(widget._autoCollapseTimer);
                widget._autoCollapseTimer = null;
            }

            // If currently collapsed, expand - using requestAnimationFrame
            if (widget.isCollapsed) {
                requestAnimationFrame(() => {
                    this._expandAssistant(widget);
                });
            }

            return;
        }

        // Always show assistant, no longer check mouse state
        const isCurrentlyShown = widget.element?.classList.contains('assistant-show');
        if (!isCurrentlyShown) {
            this.showAssistantUI(widget, false);
            logger.debug(`UI show | node:${widget.nodeId} | Reason: Always show`);
        } else {
            // Already showing, check if auto-collapse needed
            this.triggerAutoCollapse(widget);
        }
    }

    /**
     * Check if assistant has active buttons
     */
    _checkAssistantActiveState(widget) {
        if (!widget || !widget.buttons) return false;

        // 0. Check if popup is transitioning (no collapse during transition)
        if (PopupManager._isTransitioning) {
            return true;
        }

        // 1. Check if context menu is visible (and belongs to current widget)
        if (buttonMenu.isMenuVisible && buttonMenu.menuContext?.widget === widget) {
            return true;
        }

        // 2. Check if central button state manager has active button for this widget
        const activeButtonInfo = UIToolkit.getActiveButtonInfo();
        if (activeButtonInfo && activeButtonInfo.widget === widget) {
            return true;
        }

        // 3. Check if PopupManager's active popup belongs to current widget
        if (PopupManager.activePopupInfo?.buttonInfo?.widget === widget) {
            return true;
        }

        // 4. Check button active/processing state
        for (const buttonId in widget.buttons) {
            const button = widget.buttons[buttonId];
            if (button.classList.contains('button-active') ||
                button.classList.contains('button-processing')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Update all instances visibility
     * Called when button state changes
     */
    updateAllInstancesVisibility() {
        PromptAssistant.instances.forEach(widget => {
            this.updateAssistantVisibility(widget);
        });
    }

    /**
     * Update all instances preset width
     * Called when feature toggles change, recalculates and sets width
     */
    updateAllInstancesWidth() {
        // Optimization: No longer calculate and inject width manually, trigger each container's own constant layout logic
        logger.debug(`[Layout update] Triggering dimension recalculation for all instances | Instance count:${PromptAssistant.instances.size}`);

        PromptAssistant.instances.forEach((widget) => {
            if (widget && widget.container && typeof widget.container.updateDimensions === 'function') {
                widget.container.updateDimensions();
            }
        });
    }

    /**
     * Show status tip
     * Create temporary info bubble
     */
    showStatusTip(anchorElement, type, message, position = null) {
        return UIToolkit.showStatusTip(anchorElement, type, message, position);
    }

    // --- Event handling functions ---
    /**
     * Set up UI event handling
     * Configure button event listeners - simplified version
     */
    _setupUIEventHandling(widget, inputEl, containerDiv) {
        // Event handling delegated to AssistantContainer
        // We keep this method for external call compatibility, but it does nothing now.
    }



    // --- Helper functions ---
    /**
     * Update input value with highlight effect
     */
    updateInputWithHighlight(widget, content, options = {}) {
        if (!widget?.inputEl) return;

        try {
            // Update input box content - Use unified setInputValue function
            const success = setInputValue(widget, content, options);

            if (!success) {
                logger.warn(`Input box update | Result: failed | setInputValue returned false`);
                return;
            }

            // Use unified highlight utility (handles timer management and repaint)
            UIToolkit._highlightInput(widget.inputEl);
        } catch (error) {
            logger.error(`Input box update | Result: exception | error:${error.message}`);
        }
    }

    // --- Button management functions ---
    /**
     * Add function buttons
     */
    addFunctionButtons(widget) {
        if (!widget?.element) {
            logger.error('Add button | Result: failed | Reason: container does not exist');
            return;
        }

        // Check master switch state
        if (!FEATURES.enabled) {
            logger.debug('Add button | Result: skipped | Reason: master switch disabled');
            return;
        }

        // Check if at least one feature is enabled
        const hasEnabledFeatures = FEATURES.history || FEATURES.tag || FEATURES.expand || FEATURES.translate;
        if (!hasEnabledFeatures) {
            logger.debug('Add button | Result: skipped | Reason: no features enabled');
            return;
        }

        // Check if Note/MarkdownNote node
        const isNoteNode = widget.nodeInfo && (widget.nodeInfo.isNoteNode === true || widget.nodeInfo.nodeType === 'MarkdownNote');

        // Get history state (for initializing undo/redo button state)
        const canUndo = HistoryCacheService.canUndo(widget.nodeId, widget.inputId);
        const canRedo = HistoryCacheService.canRedo(widget.nodeId, widget.inputId);

        // Button configurations
        const buttonConfigs = [
            {
                id: 'history',
                title: 'History',
                icon: 'icon-history',
                onClick: (e, widget) => {
                    UIToolkit.handlePopupButtonClick(
                        e,
                        widget,
                        'history',
                        HistoryManager.showHistoryPopup.bind(HistoryManager),
                        HistoryManager.hideHistoryPopup.bind(HistoryManager)
                    );
                },
                visible: !isNoteNode && FEATURES.history, // Note node does not show this button
                initialState: { disabled: false }
            },
            {
                id: 'undo',
                title: 'Undo',
                icon: 'icon-undo',
                onClick: (e, widget) => {
                    e.preventDefault();
                    e.stopPropagation();
                    logger.debug('Button click | Action: Undo');

                    // Execute undo operation
                    const undoContent = HistoryCacheService.undo(widget.nodeId, widget.inputId);
                    if (undoContent !== null) {
                        // Update input value with highlight effect
                        this.updateInputWithHighlight(widget, undoContent);

                        // Update button state
                        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                        logger.debug(`Undo operation | Result: successful | node:${widget.nodeId}`);
                    } else {
                        logger.debug(`Undo operation | Result: failed | node:${widget.nodeId} | Reason: no available content`);
                    }
                },
                visible: !isNoteNode && FEATURES.history,
                initialState: { disabled: !canUndo }
            },
            {
                id: 'redo',
                title: 'Redo',
                icon: 'icon-redo',
                onClick: (e, widget) => {
                    e.preventDefault();
                    e.stopPropagation();
                    logger.debug('Button click | Action: Redo');

                    // Execute redo operation
                    const redoContent = HistoryCacheService.redo(widget.nodeId, widget.inputId);
                    if (redoContent !== null) {
                        // Update input value with highlight effect
                        this.updateInputWithHighlight(widget, redoContent);

                        // Update button state
                        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                        logger.debug(`Redo operation | Result: successful | node:${widget.nodeId}`);
                    } else {
                        logger.debug(`Redo operation | Result: failed | node:${widget.nodeId} | Reason: no available content`);
                    }
                },
                visible: !isNoteNode && FEATURES.history,
                initialState: { disabled: !canRedo }
            },
            {
                id: 'divider1',
                type: 'divider',
                visible: !isNoteNode && FEATURES.history // Note node does not show, follows History function switch
            },
            {
                id: 'tag',
                title: 'Tag Tool',
                icon: 'icon-tag',
                onClick: (e, widget) => {
                    // Create a show function with tag selection functionality
                    const showTagPopup = (options) => {
                        // Handle tag selection function
                        const enhancedOptions = {
                            ...options,
                            onTagSelect: (tag) => {
                                // Get current input box value and cursor position
                                const currentValue = widget.inputEl.value;
                                const cursorPos = widget.inputEl.selectionStart;
                                const beforeText = currentValue.substring(0, cursorPos);
                                const afterText = currentValue.substring(widget.inputEl.selectionEnd);

                                // Add tag (English value)
                                const newValue = beforeText + tag.en + afterText;

                                // Update input value with highlight effect
                                this.updateInputWithHighlight(widget, newValue);

                                // Update cursor position
                                const newPos = cursorPos + tag.en.length;
                                widget.inputEl.setSelectionRange(newPos, newPos);

                                // Keep focus on input box
                                widget.inputEl.focus();
                            }
                        };

                        // Call Tag Manager show popup
                        TagManager.showTagPopup(enhancedOptions);
                    };

                    // Use unified popup button click handling
                    UIToolkit.handlePopupButtonClick(
                        e,
                        widget,
                        'tag',
                        showTagPopup,
                        TagManager.hideTagPopup.bind(TagManager)
                    );
                },
                visible: !isNoteNode && FEATURES.tag // Note node does not show this button
            },
            {
                id: 'expand',
                title: 'Prompt Optimization',
                icon: 'icon-expand',
                onClick: async (e, widget) => {
                    logger.debug('Button click | Action: Prompt Optimization');

                    // If button is in processing state and clicked, return directly,
                    // let Cancel logic in UIToolkit take over
                    if (e.currentTarget.classList.contains('button-processing')) {
                        return;
                    }

                    await UIToolkit.handleAsyncButtonOperation(
                        widget,
                        'expand',
                        e.currentTarget,
                        async (notifyCancelReady) => {
                            try {
                                // Get input value - use unified getInputValue function
                                const inputValue = getInputValue(widget);
                                logger.debug(`[Prompt Optimization] Input value length: ${inputValue?.length || 0}`);

                                if (!inputValue || inputValue.trim() === '') {
                                    throw new Error('Please enter a prompt to optimize');
                                }

                                // Generate unique request_id
                                const request_id = APIService.generateRequestId('exp', null, widget.nodeId);

                                // Notify UI that cancel operation is ready
                                notifyCancelReady(request_id);

                                // Choose streaming or blocking API based on switch
                                let result;
                                let streamContent = '';

                                if (FEATURES.enableStreaming !== false) {
                                    // Show streaming optimization tip
                                    const btnRect = e.currentTarget.getBoundingClientRect();
                                    UIToolkit.showStatusTip(
                                        e.currentTarget,
                                        'loading',
                                        'Optimizing prompt...',
                                        { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                                    );

                                    result = await APIService.llmExpandPromptStream(
                                        inputValue,
                                        request_id,
                                        (chunk) => {
                                            // Streaming callback: update input box content in real time
                                            streamContent += chunk;
                                            // Use setInputValue to update input box (no event trigger, avoid frequent jitter)
                                            setInputValue(widget, streamContent, { silent: true });
                                        }
                                    );
                                } else {
                                    // Show blocking optimization tip
                                    const btnRect = e.currentTarget.getBoundingClientRect();
                                    UIToolkit.showStatusTip(
                                        e.currentTarget,
                                        'loading',
                                        'Optimizing prompt...',
                                        { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                                    );

                                    result = await APIService.llmExpandPrompt(inputValue, request_id);
                                }

                                // After streaming complete, get final content
                                const finalContent = streamContent || result?.data?.expanded || '';

                                if (result && result.success && finalContent) {
                                    // Final update (trigger event and highlight)
                                    this.updateInputWithHighlight(widget, finalContent);

                                    // Add expansion result to history record (only record final result)
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: finalContent,
                                        operation_type: 'expand',
                                        request_id: request_id,
                                        timestamp: Date.now()
                                    });

                                    // Reset undo state
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, finalContent);

                                    // Update button state
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    return {
                                        success: true,
                                        useCache: false,
                                        tipType: 'success',
                                        tipMessage: 'Prompt optimization complete'
                                    };
                                } else {
                                    // Don't show error message here, throw error directly for handleAsyncButtonOperation to handle
                                    throw new Error(result?.error || 'Expand failed');
                                }
                            } catch (error) {
                                // Don't show error message here, throw error directly for handleAsyncButtonOperation to handle
                                throw error;
                            }
                        }
                    );
                },
                visible: !isNoteNode && FEATURES.expand, // Note node does not show this button
                // Add context menu config
                contextMenu: async (widget) => {
                    // Get service list and current activation state
                    let services = [];
                    let currentLLMService = null;
                    let currentLLMModel = null;

                    // Get expansion rules
                    let activePromptId = null;
                    let expandPrompts = [];

                    try {
                        // Get service list
                        const servicesResp = await fetch(APIService.getApiUrl('/services'));
                        if (servicesResp.ok) {
                            const servicesData = await servicesResp.json();
                            if (servicesData.success) {
                                services = servicesData.services || [];
                            }
                        }

                        // Get currently active LLM service and model
                        const llmResp = await fetch(APIService.getApiUrl('/config/llm'));
                        if (llmResp.ok) {
                            const llmConfig = await llmResp.json();
                            currentLLMService = llmConfig.provider || null;
                            currentLLMModel = llmConfig.model || null;
                        }

                        // Get expansion rules
                        const response = await fetch(APIService.getApiUrl('/config/system_prompts'));
                        if (response.ok) {
                            const data = await response.json();
                            activePromptId = data.active_prompts?.expand || null;

                            if (data.expand_prompts) {
                                const originalOrder = Object.keys(data.expand_prompts);
                                originalOrder.forEach(key => {
                                    const prompt = data.expand_prompts[key];
                                    const showIn = prompt.showIn || ['frontend', 'node'];

                                    // Only show in frontend menu when config includes 'frontend'
                                    if (showIn.includes('frontend')) {
                                        expandPrompts.push({
                                            id: key,
                                            name: prompt.name || key,
                                            category: prompt.category || '',
                                            content: prompt.content,
                                            showIn: showIn,
                                            isActive: key === activePromptId
                                        });
                                    }
                                });
                                expandPrompts.sort((a, b) =>
                                    originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id)
                                );
                            }
                        }
                    } catch (error) {
                        logger.error(`Failed to get prompt optimization config: ${error.message}`);
                    }

                    // Create service menu items (only show services with LLM models, excluding Baidu)
                    const serviceMenuItems = services
                        .filter(service => service.llm_models && service.llm_models.length > 0)
                        .map(service => {
                            const isCurrentService = currentLLMService === service.id;

                            // Create model submenu
                            const modelChildren = (service.llm_models || []).map(model => {
                                const isCurrentModel = isCurrentService && currentLLMModel === model.name;
                                return {
                                    label: model.display_name || model.name,
                                    icon: `<span class="pi ${isCurrentModel ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                    onClick: async (context) => {
                                        try {
                                            const res = await fetch(APIService.getApiUrl('/services/current'), {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ service_type: 'llm', service_id: service.id, model_name: model.name })
                                            });
                                            if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                            const modelLabel = model.display_name || model.name;
                                            UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${service.name} - ${modelLabel}`);
                                            logger.log(`Prompt optimization switch | Service: ${service.name} | model: ${modelLabel}`);
                                        } catch (err) {
                                            logger.error(`Toggle prompt optimization model failed: ${err.message}`);
                                            UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${err.message}`);
                                        }
                                    }
                                };
                            });

                            return {
                                label: service.name || service.id,
                                icon: `<span class="pi ${isCurrentService ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                onClick: async (context) => {
                                    try {
                                        const res = await fetch(APIService.getApiUrl('/services/current'), {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service_type: 'llm', service_id: service.id })
                                        });
                                        if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${service.name}`);
                                        logger.log(`Prompt optimization switch | Service: ${service.name}`);
                                    } catch (err) {
                                        logger.error(`Failed to switch prompt optimization service: ${err.message}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${err.message}`);
                                    }
                                },
                                children: modelChildren.length > 0 ? modelChildren : undefined
                            };
                        });

                    // ---Create rule menu items (supports category grouping)---
                    const ruleMenuItems = [];

                    // Helper function: create single rule menu item
                    const createRuleMenuItem = (prompt) => ({
                        label: prompt.name,
                        icon: `<span class="pi ${prompt.isActive ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                        onClick: async (context) => {
                            logger.log(`Right-click menu | Action: Toggle prompt optimization | ID: ${prompt.id}`);
                            try {
                                const response = await fetch(APIService.getApiUrl('/config/active_prompt'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ type: 'expand', prompt_id: prompt.id })
                                });
                                if (response.ok) {
                                    UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${prompt.name}`);
                                } else {
                                    throw new Error(`Server returned error: ${response.status}`);
                                }
                            } catch (error) {
                                logger.error(`Toggle prompt optimization failed: ${error.message}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${error.message}`);
                            }
                        }
                    });

                    // Group rules by category
                    const uncategorizedPrompts = expandPrompts.filter(p => !p.category);
                    const categorizedPrompts = expandPrompts.filter(p => p.category);

                    // Collect and sort all categories
                    const categories = [...new Set(categorizedPrompts.map(p => p.category))].sort();

                    // Add uncategorized rules (at top level)
                    uncategorizedPrompts.forEach(prompt => {
                        ruleMenuItems.push(createRuleMenuItem(prompt));
                    });

                    // Add category groups (each category as submenu)
                    categories.forEach(category => {
                        const promptsInCategory = categorizedPrompts.filter(p => p.category === category);
                        const hasActivePrompt = promptsInCategory.some(p => p.isActive);

                        ruleMenuItems.push({
                            label: category,
                            icon: `<span class="pi ${hasActivePrompt ? 'pi-folder-open' : 'pi-folder'}"></span>`,
                            submenuAlign: 'center',
                            children: promptsInCategory.map(prompt => createRuleMenuItem(prompt))
                        });
                    });


                    // Add rule management option
                    ruleMenuItems.push({ type: 'separator' });
                    ruleMenuItems.push({
                        label: 'Rule Management',
                        icon: '<span class="pi pi-pen-to-square"></span>',
                        onClick: () => {
                            rulesConfigManager.showRulesConfigModal();
                        }
                    });

                    return [
                        ...ruleMenuItems,
                        // { type: 'separator' },
                        {
                            label: "Select Service",
                            icon: '<span class="pi pi-sparkles"></span>',
                            submenuAlign: 'bottom',
                            children: serviceMenuItems
                        }
                    ];
                }
            },
            {
                id: 'translate',
                title: 'Translate',
                icon: 'icon-translate',
                onClick: async (e, widget) => {
                    logger.debug('Button click | Action: Translate');

                    // If button is in processing state and clicked, return directly,
                    // let Cancel logic in UIToolkit take over
                    if (e.currentTarget.classList.contains('button-processing')) {
                        return;
                    }

                    await UIToolkit.handleAsyncButtonOperation(
                        widget,
                        'translate',
                        e.currentTarget,
                        async (notifyCancelReady) => {
                            try {
                                // --- Markdown LiteGraph mode handling ---
                                // Enhanced judgment logic: check both nodeType and DOM class name
                                const hasMarkdownClass = widget.inputEl?.classList?.contains('comfy-markdown');
                                const isMarkdownLiteGraph = (widget.nodeInfo?.nodeType === 'MarkdownNote' || hasMarkdownClass) &&
                                    widget.nodeInfo?.isVueMode !== true;

                                logger.debug(`[Translate debug] Markdown detection: ${isMarkdownLiteGraph} (Type: ${widget.nodeInfo?.nodeType}, HasClass: ${hasMarkdownClass})`);

                                // Get input value - decide whether to get HTML based on mode
                                const inputValue = getInputValue(widget, { html: isMarkdownLiteGraph });

                                if (!inputValue || inputValue.trim() === '') {
                                    throw new Error('Please enter content to translate');
                                }

                                let contentToTranslate = inputValue;
                                let mdData = null;

                                if (isMarkdownLiteGraph) {
                                    mdData = MarkdownNoteTranslate.protectAndExtract(inputValue);
                                    if (mdData.texts && mdData.texts.length > 0) {
                                        contentToTranslate = mdData.texts.join('\n');
                                    } else {
                                        // If no text extracted (only tags/code), consider empty or no translation needed
                                        if (!contentToTranslate || contentToTranslate.trim() === '') {
                                            // Keep as is or throw error, here choose to throw tip
                                            throw new Error('No translatable content detected');
                                        }
                                        // If original content has something but extraction is empty, likely all code blocks, keep original as pending translate (API might skip)
                                        // Or here contentToTranslate is inputValue?
                                        // No, protectAndExtract didn't extract anything, meaning shouldn't translate.
                                        // But to continue flow, if not throwing error, we assume contentToTranslate empty leads to later error.
                                    }
                                }

                                if (!contentToTranslate || contentToTranslate.trim() === '') {
                                    throw new Error('Please enter content to translate');
                                }

                                // Show Translating... tip
                                const btnRect = e.currentTarget.getBoundingClientRect();
                                UIToolkit.showStatusTip(
                                    e.currentTarget,
                                    'loading',
                                    'Translating...',
                                    { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                                );

                                // 1. Query cache
                                let cacheResult = null;
                                if (FEATURES.useTranslateCache) {
                                    cacheResult = TranslateCacheService.queryTranslateCache(contentToTranslate);
                                }

                                if (cacheResult) {
                                    let rawResultText = '';
                                    let tipMessage = '';
                                    let useCache = true;

                                    // Process based on cache match type
                                    if (cacheResult.type === 'source') {
                                        // Hit original, return translation
                                        rawResultText = cacheResult.translatedText;
                                        tipMessage = 'Translation';
                                    } else if (cacheResult.type === 'translated') {
                                        // Hit translation, return original
                                        rawResultText = cacheResult.sourceText;
                                        tipMessage = 'Original';
                                    }

                                    // Handle Markdown format restoration
                                    let finalResultText = rawResultText;
                                    if (isMarkdownLiteGraph && mdData) {
                                        const translatedSegments = rawResultText.split('\n');
                                        finalResultText = MarkdownNoteTranslate.restoreWithTranslations(mdData.placeholderHTML, mdData.placeholders, translatedSegments);
                                    }

                                    // Update input value with highlight effect
                                    this.updateInputWithHighlight(widget, finalResultText, { html: isMarkdownLiteGraph });

                                    // Add translation result to history record
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: finalResultText,
                                        operation_type: 'translate',
                                        timestamp: Date.now()
                                    });

                                    // Reset undo state
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, finalResultText);

                                    // Update button state
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    return {
                                        success: true,
                                        useCache: useCache,
                                        tipType: 'info',
                                        tipMessage: tipMessage,
                                        buttonElement: e.currentTarget // Pass Button element
                                    };
                                }

                                // Cache miss, use API to translate

                                // Generate unique request_id
                                const request_id = APIService.generateRequestId('trans', null, widget.nodeId);

                                // Notify UI that cancel operation is ready
                                notifyCancelReady(request_id);

                                // Detect language (using extracted text)
                                const langResult = PromptFormatter.detectLanguage(contentToTranslate);

                                // Get translation service config
                                let result;
                                let streamContent = '';  // For streaming content collection
                                try {
                                    // Get translation config
                                    const configResp = await fetch(APIService.getApiUrl('/config/translate'));
                                    let isBaidu = false;

                                    if (configResp.ok) {
                                        const config = await configResp.json();
                                        // Check if provider is 'baidu'
                                        if (config.provider === 'baidu') {
                                            isBaidu = true;
                                        }
                                    }

                                    if (isBaidu) {
                                        // Baidu Translate does not support streaming, use original interface (automatic fallback)
                                        result = await APIService.baiduTranslate(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    } else if (FEATURES.enableStreaming !== false) {
                                        // --- Streaming output: LLM Translate uses streaming API---
                                        result = await APIService.llmTranslateStream(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id,
                                            (chunk) => {
                                                // Streaming callback: update input box content in real time
                                                streamContent += chunk;
                                                // Use silent mode update to avoid frequent event triggering
                                                setInputValue(widget, streamContent, { silent: true, html: isMarkdownLiteGraph });
                                            }
                                        );
                                    } else {
                                        // --- Blocking output: LLM Translate uses normal API---
                                        result = await APIService.llmTranslate(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    }

                                    if (!result) {
                                        throw new Error('Translation service returned empty result');
                                    }
                                } catch (error) {
                                    logger.error(`Translation failed | error:${error.message}`);
                                    throw new Error(`Translation failed: ${error.message}`);
                                }

                                if (result.success) {
                                    // Format translation result (prefer streaming collected content, otherwise use API returned content)
                                    const rawTranslated = streamContent || result.data?.translated || '';
                                    const formattedText = PromptFormatter.formatTranslatedText(rawTranslated);

                                    // Handle Markdown format restoration
                                    let finalResultText = formattedText;
                                    if (isMarkdownLiteGraph && mdData) {
                                        const translatedSegments = formattedText.split('\n');
                                        finalResultText = MarkdownNoteTranslate.restoreWithTranslations(mdData.placeholderHTML, mdData.placeholders, translatedSegments);
                                    }

                                    // Add translation result to history record
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: finalResultText,
                                        operation_type: 'translate',
                                        request_id: request_id,
                                        timestamp: Date.now()
                                    });

                                    // Update input value with highlight effect
                                    this.updateInputWithHighlight(widget, finalResultText, { html: isMarkdownLiteGraph });

                                    // Reset undo state
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, finalResultText);

                                    // Update button state
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    // Only write to cache if caching is enabled (use extracted text and translated segment text for future reuse)
                                    if (FEATURES.useTranslateCache) {
                                        // Check if it's mixed language
                                        const isMixedLang = PromptFormatter.isMixedChineseEnglish(contentToTranslate);

                                        // Only write to cache when not mixed language, or when user allows caching mixed language
                                        if (!isMixedLang || FEATURES.cacheMixedLangTranslation) {
                                            TranslateCacheService.addTranslateCache(contentToTranslate, formattedText);
                                        } else {
                                            logger.debug(`Translation cache | Skipped: mixed language content`);
                                        }
                                    }

                                    return {
                                        success: true,
                                        useCache: false,
                                        tipType: 'success',
                                        tipMessage: 'Translation complete'
                                    };
                                } else {
                                    // Don't show error message here, throw error directly for handleAsyncButtonOperation to handle
                                    throw new Error(result.error);
                                }
                            } catch (error) {
                                // Don't show error message here, throw error directly for handleAsyncButtonOperation to handle
                                throw error;
                            }
                        }
                    );
                },
                visible: FEATURES.translate, // Note node only shows this button
                // Add context menu config
                contextMenu: async (widget) => {
                    const useTranslateCache = app.ui.settings.getSettingValue("PromptAssistant.Features.UseTranslateCache");

                    // Get all service list and current active state
                    let services = [];
                    let currentTranslateService = null;
                    let currentTranslateModel = null;

                    try {
                        // Get service list
                        const servicesResp = await fetch(APIService.getApiUrl('/services'));
                        if (servicesResp.ok) {
                            const servicesData = await servicesResp.json();
                            if (servicesData.success) {
                                services = servicesData.services || [];
                            }
                        }

                        // Get currently active translation service and model
                        const translateResp = await fetch(APIService.getApiUrl('/config/translate'));
                        if (translateResp.ok) {
                            const translateConfig = await translateResp.json();
                            currentTranslateService = translateConfig.provider || null;
                            currentTranslateModel = translateConfig.model || null;
                        }
                    } catch (e) {
                        logger.error(`Failed to get service list: ${e.message}`);
                    }

                    // Create service menu items
                    const serviceMenuItems = [];

                    // Baidu Translate item (always shown first)
                    const isBaiduCurrent = currentTranslateService === 'baidu';
                    serviceMenuItems.push({
                        label: 'Baidu Translate',
                        icon: `<span class="pi ${isBaiduCurrent ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                        onClick: async (context) => {
                            try {
                                const res = await fetch(APIService.getApiUrl('/services/current'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ service_type: 'translate', service_id: 'baidu' })
                                });
                                if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: Baidu Translate`);
                                logger.log(`Translation service switch | Service: Baidu Translate`);

                                // Dispatch global event to notify other components to sync
                                window.dispatchEvent(new CustomEvent('pa-service-changed', {
                                    detail: { service_type: 'translate', service_id: 'baidu' }
                                }));
                            } catch (err) {
                                logger.error(`Failed to switch translation service: ${err.message}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${err.message}`);
                            }
                        }
                    });

                    // Dynamically add other LLM services
                    const otherServiceMenuItems = services
                        .filter(service => service.llm_models && service.llm_models.length > 0)
                        .map(service => {
                            const isCurrentService = currentTranslateService === service.id;

                            // Create model submenu
                            const modelChildren = (service.llm_models || []).map(model => {
                                const isCurrentModel = isCurrentService && currentTranslateModel === model.name;
                                return {
                                    label: model.display_name || model.name,
                                    icon: `<span class="pi ${isCurrentModel ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                    onClick: async (context) => {
                                        try {
                                            const res = await fetch(APIService.getApiUrl('/services/current'), {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ service_type: 'translate', service_id: service.id, model_name: model.name })
                                            });
                                            if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                            const modelLabel = model.display_name || model.name;
                                            UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${service.name} - ${modelLabel}`);
                                            logger.log(`Translation service switch | Service: ${service.name} | model: ${modelLabel}`);

                                            // Dispatch global event to notify other components to sync
                                            window.dispatchEvent(new CustomEvent('pa-service-changed', {
                                                detail: { service_type: 'translate', service_id: service.id, model_name: model.name }
                                            }));
                                        } catch (err) {
                                            logger.error(`Toggle translation model failed: ${err.message}`);
                                            UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${err.message}`);
                                        }
                                    }
                                };
                            });

                            return {
                                label: service.name || service.id,
                                icon: `<span class="pi ${isCurrentService ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                onClick: async (context) => {
                                    try {
                                        const res = await fetch(APIService.getApiUrl('/services/current'), {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service_type: 'translate', service_id: service.id })
                                        });
                                        if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${service.name}`);
                                        logger.log(`Translation service switch | Service: ${service.name}`);

                                        // Dispatch global event to notify other components to sync
                                        window.dispatchEvent(new CustomEvent('pa-service-changed', {
                                            detail: { service_type: 'translate', service_id: service.id }
                                        }));
                                    } catch (err) {
                                        logger.error(`Failed to switch translation service: ${err.message}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${err.message}`);
                                    }
                                },
                                children: modelChildren.length > 0 ? modelChildren : undefined
                            };
                        });

                    // Add other services to serviceMenuItems
                    serviceMenuItems.push(...otherServiceMenuItems);

                    return [
                        {
                            label: "Select Service",
                            icon: '<span class="pi pi-sparkles"></span>',
                            children: serviceMenuItems
                        },
                        { type: 'separator' },
                        {
                            label: "Translation cache",
                            icon: `<span class="pi ${useTranslateCache ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                            onClick: (context) => {
                                const newStatus = !useTranslateCache;
                                app.ui.settings.setSettingValue("PromptAssistant.Features.UseTranslateCache", newStatus);
                                const statusText = newStatus ? 'Enabled' : 'Disabled';
                                logger.log(`Context menu | Action: Toggle translate cache | Status: ${statusText}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `Translation cache${statusText}`);
                            }
                        }
                    ];
                }
            },
        ];

        // Record added buttons
        let historyButtons = [];
        let otherButtons = [];
        let divider = null;

        // ---Add buttons to AssistantContainer---
        for (const config of buttonConfigs) {
            if (config.type === 'divider') {
                // Check visibility for divider
                if (config.visible === false) continue;

                const divider = document.createElement('div');
                divider.className = 'prompt-assistant-divider';
                // Add divider to container
                widget.container.addButton(divider, config.id || `divider_${Date.now()}`);
                // Save reference if needed
                if (config.id) widget.buttons[config.id] = divider;
                continue;
            }

            // Check visibility
            if (config.visible === false) continue;

            // Create button using existing helper
            // Note: addButtonWithIcon returns the button element and saves it to widget.buttons
            const button = this.addButtonWithIcon(widget, config);
            if (!button) continue;

            // Set initial state
            if (config.initialState) {
                Object.entries(config.initialState).forEach(([stateType, value]) => {
                    UIToolkit.setButtonState(widget, config.id, stateType, value);
                });
            }

            // Add to container
            widget.container.addButton(button, config.id);
        }


    }

    /**
     * Add button with icon
     */
    addButtonWithIcon(widget, config) {
        if (!widget?.element || !widget?.innerContent) return null;

        const { id, title, icon, onClick, contextMenu } = config;

        // Create button
        const button = document.createElement('button');
        button.className = 'prompt-assistant-button';
        button.title = title || '';
        button.dataset.id = id || `btn_${Date.now()}`;

        // Add icon - using UIToolkit SVG icon method
        if (icon) {
            UIToolkit.addIconToButton(button, icon, title || '');
        }

        // Add event
        if (typeof onClick === 'function') {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // If button is disabled, skip operation
                if (button.classList.contains('button-disabled')) {
                    return;
                }

                // Execute click callback
                onClick(e, widget);
            });
        }

        // Add context menu (if any)
        if (contextMenu && typeof contextMenu === 'function') {
            this._setupButtonContextMenu(button, contextMenu, widget);
        }

        // Save reference
        if (id) {
            widget.buttons[id] = button;
        }

        return button;
    }

    /**
     * Detect if input has scrollbar
     * @param {HTMLElement} inputEl - Input element
     * @returns {boolean} Whether vertical scrollbar exists
     */
    _detectScrollbar(inputEl) {
        if (!inputEl || inputEl.tagName !== 'TEXTAREA') {
            return false;
        }

        try {
            // Check vertical scrollbar: scrollHeight > clientHeight
            const hasVerticalScrollbar = inputEl.scrollHeight > inputEl.clientHeight;
            // Log simplified: detailed scrollbar detection moved to _adjustPositionForScrollbar, only outputs on state change
            return hasVerticalScrollbar;
        } catch (error) {
            logger.error(`[Scrollbar detection] detection failed | error: ${error.message}`);
            return false;
        }
    }

    /**
     * Adjust assistant position based on scrollbar state
     * @param {Object} widget - Assistant instance
     * @param {HTMLElement} inputEl - Input element
     * @param {Boolean} forceUpdate - Whether to force update (for initialization)
     */
    _adjustPositionForScrollbar(widget, inputEl, forceUpdate = false) {
        if (!widget?.element || !inputEl) return;

        const hasScrollbar = this._detectScrollbar(inputEl);
        const containerDiv = widget.element;

        // Only update position when scrollbar state changes (unless forced)
        const prevState = containerDiv.dataset.hasScrollbar === 'true';
        if (!forceUpdate && prevState === hasScrollbar) {
            return; // State unchanged, do nothing
        }

        // [Critical fix] Remove input box highlight state before position/layout adjustment
        // Prevent animation artifacts during browser relayout
        UIToolkit.removeHighlight(inputEl);

        containerDiv.dataset.hasScrollbar = String(hasScrollbar);

        // Shift left when scrollbar present to avoid overlap
        const rightOffset = hasScrollbar ? '16px' : '4px';
        containerDiv.style.right = rightOffset;
    }

    /**
     * Set up UI position
     * Supports both Vue node2.0 and litegraph.js rendering modes
     * @param {Function} onComplete - Completion callback, receives boolean parameter, true=success, false=failure
     */
    _setupUIPosition(widget, inputEl, containerDiv, canvasContainerRect, inputWidget, onComplete) {


        // Cleanup function list
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

        // [Critical fix] Directly use widget.node instead of looking up via app.graph.getNodeById
        // Because entering subgraph switches app.graph to subgraph, can't find main canvas node
        const node = widget.node;
        if (!node) {
            logger.debug(`[Positioning] widget.node does not exist | ID: ${widget.nodeId}`);
            if (onComplete) onComplete(false);
            return;
        }


        // Use real inputWidget for Subgraph PromotedWidgetView unwrapping
        const widgetObj = inputWidget || {
            inputEl: inputEl,
            element: inputEl,
            name: widget.inputId,
            id: widget.inputId
        };

        // Use NodeMountService for container lookup with retry
        // Vue mode needs more retries with longer intervals
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
        nodeMountService.findMountContainerWithRetry(node, widgetObj, {
            maxRetries: isVueMode ? 5 : 3,
            retryInterval: isVueMode ? 800 : 500
        }).then(containerInfo => {
            if (!containerInfo) {
                // logger.debug(`[Positioning] Container lookup failed | Node ID: ${widget.nodeId}`);
                if (onComplete) onComplete(false);
                return;
            }

            // Apply different positioning strategies based on render mode
            if (containerInfo.mode === RENDER_MODE.VUE_NODES) {
                this._applyVueNodesPositioning(widget, containerDiv, containerInfo);
            } else {
                this._applyLitegraphPositioning(widget, containerDiv, containerInfo);
            }

            // Save render mode to widget for later adjustments
            widget._renderMode = containerInfo.mode;

            // Trigger reflow to ensure styles take effect
            void containerDiv.offsetWidth;

            // Keep final success log concise
            logger.debug(`[Positioning] successful | ID: ${widget.nodeId} | Mode: ${containerInfo.mode} | Anchor: ${widget.container?.anchorPosition}`);
            if (onComplete) onComplete(true);

        }).catch(error => {
            logger.error(`[Positioning] exception | Node ID: ${widget.nodeId} | error: ${error.message}`);
            if (onComplete) onComplete(false);
        });
    }

    /**
     * Positioning logic for Vue node2.0 mode
     */
    _applyVueNodesPositioning(widget, containerDiv, containerInfo) {
        let { container, textarea, nodeContainer, isNoteNode } = containerInfo;

        // [Special handling] Note node may need secondary textarea lookup in Vue mode
        if (!textarea && isNoteNode && nodeContainer) {
            const textareas = nodeContainer.querySelectorAll('textarea');
            if (textareas.length > 0) {
                textarea = textareas[0];
                container = textarea.parentElement;
            } else {
                logger.warn(`[Vue positioning] Note node still no textarea found | Node ID: ${widget.nodeId}`);
            }
        }

        // Periodically update input reference and event bindings
        if (textarea && textarea !== widget.inputEl) {
            widget.inputEl = textarea;
            widget.text_element = textarea;
            if (window.PromptAssistantInputWidgetMap && window.PromptAssistantInputWidgetMap[widget.widgetKey]) {
                window.PromptAssistantInputWidgetMap[widget.widgetKey].inputEl = textarea;
            }

            if (!textarea._promptAssistantBound) {
                textarea._promptAssistantBound = true;
                widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

                widget._eventCleanupFunctions.push(EventManager.addDOMListener(textarea, 'blur', async () => {
                    HistoryCacheService.addHistory({
                        workflow_id: widget.nodeInfo?.workflow_id || '',
                        node_id: widget.nodeId,
                        input_id: widget.inputId,
                        content: textarea.value,
                        operation_type: 'input',
                        timestamp: Date.now()
                    });
                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, textarea.value);
                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                }));

                widget._eventCleanupFunctions.push(EventManager.addDOMListener(textarea, 'input', () => {
                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                    this._adjustPositionForScrollbar(widget, textarea);
                }));

                if (window.ResizeObserver) {
                    const resizeObserver = new ResizeObserver(() => {
                        setTimeout(() => this._adjustPositionForScrollbar(widget, textarea), 10);
                    });
                    resizeObserver.observe(textarea);
                    widget._eventCleanupFunctions.push(() => resizeObserver.disconnect());
                }

                if (!widget._undoStateInitialized) {
                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, textarea.value);
                    widget._undoStateInitialized = true;
                }
            }
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
        }

        // Anti-duplicate mount check
        if (textarea && textarea._promptAssistantMounted && textarea._promptAssistantWidgetKey !== widget.widgetKey) {
            this._cleanupRedundantWidget(widget);
            return;
        }

        const existingAssistant = container.querySelector('.assistant-container-common');
        if (existingAssistant && !container.contains(containerDiv)) {
            this._cleanupRedundantWidget(widget);
            return;
        }

        if (textarea) {
            textarea._promptAssistantMounted = true;
            textarea._promptAssistantWidgetKey = widget.widgetKey;
        }

        containerDiv.style.position = 'absolute';
        containerDiv.style.zIndex = '10';
        if (window.getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        containerDiv.classList.add('vue-node-mode');
        if (!container.contains(containerDiv)) {
            container.appendChild(containerDiv);
        }

        if (textarea) {
            requestAnimationFrame(() => this._adjustPositionForScrollbar(widget, textarea, true));
            setTimeout(() => this._adjustPositionForScrollbar(widget, textarea, true), 150);
        }
    }

    /**
     * Clean up redundant Widget instances (when duplicated due to concurrency)
     * @private
     */
    _cleanupRedundantWidget(widget) {
        if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
            PromptAssistant.instances.delete(widget.widgetKey);
        }
        if (widget.container) {
            widget.container.destroy();
        }
    }

    /**
     * Positioning logic for litegraph.js mode
     * [Fix] Add fallback event binding logic, consistent with Vue mode
     */
    _applyLitegraphPositioning(widget, containerDiv, containerInfo) {
        const { container: domWidgetContainer, textarea } = containerInfo;

        // [Critical fix] Ensure inputEl reference is correct
        if (textarea && textarea !== widget.inputEl) {
            widget.inputEl = textarea;
            widget.text_element = textarea;

            // Update global input mapping
            if (window.PromptAssistantInputWidgetMap && window.PromptAssistantInputWidgetMap[widget.widgetKey]) {
                window.PromptAssistantInputWidgetMap[widget.widgetKey].inputEl = textarea;
            }

            // logger.debug(`[Litegraph positioning] Updated inputEl reference | Node ID: ${widget.nodeId}`);
        }

        // [Critical fix] Ensure event binding (consistent fallback logic with Vue mode)
        const inputEl = widget.inputEl || textarea;

        // Use widget-level flag check
        const isBound = widget._inputEventsBound;

        // Concise positioning start log
        // logger.debug(`[_setupUIPosition] Start positioning | Node ID: ${widget.nodeId}`);
        // logger.debug(`[Litegraph positioning] Event binding check | Node ID: ${widget.nodeId} | inputEl exists: ${!!inputEl} | isBound: ${isBound}`);

        // If not bound, bind events
        if (inputEl && !isBound) {
            // If legacy flag exists, log it
            if (inputEl._promptAssistantBound) {
                logger.debug(`[Litegraph positioning] Detected legacy flag, re-binding | Node ID: ${widget.nodeId}`);
            }

            inputEl._promptAssistantBound = true;
            widget._inputEventsBound = true; // set flag
            widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
            // logger.debug(`[Litegraph positioning] Starting event binding | Node ID: ${widget.nodeId}`);

            // Bind blur event for history recording
            const removeBlurListener = EventManager.addDOMListener(inputEl, 'blur', async () => {
                // logger.debug(`[Litegraph] History write preparation | Reason: blur event triggered node_id=${widget.nodeId} input_id=${widget.inputId}`);
                HistoryCacheService.addHistory({
                    workflow_id: widget.nodeInfo?.workflow_id || '',
                    node_id: widget.nodeId,
                    input_id: widget.inputId,
                    content: inputEl.value,
                    operation_type: 'input',
                    timestamp: Date.now()
                });
                // Reset undo state
                HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, inputEl.value);
                // Update button state
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            });
            widget._eventCleanupFunctions.push(removeBlurListener);

            // Bind input event for real-time button state update
            const removeInputListener = EventManager.addDOMListener(inputEl, 'input', () => {
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                this._adjustPositionForScrollbar(widget, inputEl);
            });
            widget._eventCleanupFunctions.push(removeInputListener);

            if (!widget._undoStateInitialized) {
                HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, inputEl.value);
                widget._undoStateInitialized = true;
            }

            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            // logger.debug(`[Litegraph positioning] Event binding complete | Node ID: ${widget.nodeId}`);
        } else if (inputEl && inputEl._promptAssistantBound) {
            // Already bound, only update button state
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
        }

        // [Anti-duplicate mount check] check if inputEl is already bound by assistant
        if (inputEl && inputEl._promptAssistantMounted) {
            logger.debug(`[Litegraph positioning] Skip mount | Reason: inputEl already bound by another assistant | Node ID: ${widget.nodeId}`);
            // Clean up current widget instance (can't mount correctly)
            if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
                PromptAssistant.instances.delete(widget.widgetKey);
            }
            if (widget.container) {
                widget.container.destroy();
            }
            return;
        }

        // [Anti-duplicate mount check] check if assistant element already exists in container
        const existingAssistant = domWidgetContainer.querySelector('.assistant-container-common');
        if (existingAssistant) {
            logger.debug(`[Litegraph positioning] Skip mount | Reason: assistant already exists in container | Node ID: ${widget.nodeId}`);
            // Clean up current widget instance (can't mount correctly)
            if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
                PromptAssistant.instances.delete(widget.widgetKey);
            }
            if (widget.container) {
                widget.container.destroy();
            }
            return;
        }

        // Add mount flag on inputEl
        if (inputEl) {
            inputEl._promptAssistantMounted = true;
            inputEl._promptAssistantWidgetKey = widget.widgetKey;
        }

        // Ensure dom-widget container has relative positioning
        const containerPosition = window.getComputedStyle(domWidgetContainer).position;
        if (containerPosition === 'static') {
            domWidgetContainer.style.position = 'relative';
        }

        // Standard mode uses absolute positioning
        containerDiv.style.position = 'absolute';



        // Directly add to dom-widget container
        domWidgetContainer.appendChild(containerDiv);

        // Trigger reflow to ensure style update
        void containerDiv.offsetWidth;

        // After mounting, detect and adjust scrollbar position
        if (inputEl) {
            requestAnimationFrame(() => this._adjustPositionForScrollbar(widget, inputEl, true));
        }
    }

    /**
     * Clean up single instance resources
     */
    _cleanupInstance(instance, instanceKey, skipRemove = false) {
        try {
            // Check if instance is valid
            if (!instance) {
                logger.debug(`Instance cleanup | Result: skipped | instance:${instanceKey || 'unknown'} | Reason: Instance does not exist`);
                return;
            }

            // Mark instance as destroyed
            instance.isDestroyed = true;

            // 1. Reset all button states
            if (instance.buttons) {
                Object.keys(instance.buttons).forEach(buttonId => {
                    try {
                        const button = instance.buttons[buttonId];
                        if (button) {
                            // Remove all state classes
                            button.classList.remove('button-active', 'button-processing', 'button-disabled');
                            // Remove all event listeners
                            button.replaceWith(button.cloneNode(true));
                        }
                    } catch (err) {
                        logger.debug(`Button cleanup | button:${buttonId} | error:${err.message}`);
                    }
                });
                // Clear button references
                instance.buttons = {};
            }

            // 2. Clean up event listeners
            if (instance.cleanupListeners && typeof instance.cleanupListeners === 'function') {
                try {
                    instance.cleanupListeners();
                } catch (err) {
                    logger.debug(`Listener cleanup | error:${err.message}`);
                }
            }

            // 3. Clean up all saved event cleanup functions
            if (instance._eventCleanupFunctions && Array.isArray(instance._eventCleanupFunctions)) {
                instance._eventCleanupFunctions.forEach(cleanup => {
                    if (typeof cleanup === 'function') {
                        try {
                            cleanup();
                        } catch (err) {
                            logger.debug(`Event cleanup | error:${err.message}`);
                        }
                    }
                });
                instance._eventCleanupFunctions = [];
            }

            // 3.5 [Critical fix] Reset event binding flag on inputEl
            // Ensure events can be rebound after mode switch
            if (instance.inputEl && instance.inputEl._promptAssistantBound) {
                instance.inputEl._promptAssistantBound = false;
            }
            if (instance.text_element && instance.text_element._promptAssistantBound) {
                instance.text_element._promptAssistantBound = false;
            }

            // 3.6 [Anti-duplicate mount fix] Reset mount flag on textarea
            // Ensure assistant can be remounted after cleanup
            if (instance.inputEl && instance.inputEl._promptAssistantMounted) {
                instance.inputEl._promptAssistantMounted = false;
                delete instance.inputEl._promptAssistantWidgetKey;
            }
            if (instance.text_element && instance.text_element._promptAssistantMounted && instance.text_element !== instance.inputEl) {
                instance.text_element._promptAssistantMounted = false;
                delete instance.text_element._promptAssistantWidgetKey;
            }

            // Also reset widget-level flags
            instance._undoStateInitialized = false;
            instance._inputEventsBound = false; // reset input event binding flag


            // 4. Remove element from DOM
            if (instance.element) {
                try {
                    // Ensure child element events are cleaned before removal
                    const allButtons = instance.element.querySelectorAll('button');
                    allButtons.forEach(button => {
                        button.replaceWith(button.cloneNode(true));
                    });

                    // Cleanup indicator element
                    if (instance.indicator && instance.indicator.parentNode) {
                        instance.indicator.innerHTML = '';
                    }

                    if (instance.element.parentNode) {
                        instance.element.parentNode.removeChild(instance.element);
                    }
                } catch (err) {
                    logger.debug(`DOM element cleanup | error:${err.message}`);
                }
            }

            // 5. Cleanup input box mapping
            if (window.PromptAssistantInputWidgetMap && instanceKey) {
                try {
                    delete window.PromptAssistantInputWidgetMap[instanceKey];
                } catch (err) {
                    logger.debug(`Input box mapping cleanup | error:${err.message}`);
                }
            }

            // 6. Cleanup popup state
            if (window.FEATURES && window.FEATURES.updateButtonsVisibility) {
                try {
                    window.FEATURES.updateButtonsVisibility();
                } catch (err) {
                    logger.debug(`Button visibility update | error:${err.message}`);
                }
            }

            // 7. Remove from instance collection (unless explicitly specified to skip)
            if (!skipRemove && instanceKey) {
                try {
                    PromptAssistant.instances.delete(instanceKey);
                } catch (err) {
                    logger.debug(`Instance collection cleanup | error:${err.message}`);
                }
            }

            // 8. Clean up instance attributes
            try {
                Object.keys(instance).forEach(key => {
                    try {
                        delete instance[key];
                    } catch (err) {
                        logger.debug(`Attribute cleanup | attribute:${key} | error:${err.message}`);
                    }
                });
            } catch (err) {
                logger.debug(`Attribute cleanup | error:${err.message}`);
            }

            // logger.debug(`Instance cleanup | Result: successful | instance:${instanceKey || 'unknown'}`);
        } catch (error) {
            logger.error(`Instance cleanup failed | instance:${instanceKey || 'unknown'} | error:${error.message}`);
        }
    }

    /**
     * Set up button context menu
     * @param {HTMLElement} button Button element
     * @param {Function} getMenuItems Function to get menu items
     * @param {Object} widget Assistant instance
     */
    _setupButtonContextMenu(button, getMenuItems, widget) {
        if (!button || typeof getMenuItems !== 'function') return;

        // Set up right-click menu
        const cleanup = buttonMenu.setupButtonMenu(button, () => {
            // Call getMenuItems function to get menu items, passing widget as context
            return getMenuItems(widget);
        }, { widget, buttonElement: button });

        // Save cleanup function to widget's eventCleanup function list
        if (cleanup) {
            widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
            widget._eventCleanupFunctions.push(cleanup);
        }
    }
}

// Create singleton instance
const promptAssistant = new PromptAssistant();

// Export
export { promptAssistant, PromptAssistant };