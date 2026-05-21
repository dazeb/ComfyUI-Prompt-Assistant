/**
 * Node Mount Service (NodeMountService)
 * Unified management of assistant creation and mounting under different rendering modes
 * 
 * Supports two rendering modes:
 * - litegraph.js: Traditional Canvas rendering + DOM Widget overlay
 * - Vue node2.0: Pure Vue component rendering
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { EventManager } from '../utils/eventManager.js';

// ---Render mode enum---
export const RENDER_MODE = {
    LITEGRAPH: 'litegraph',
    VUE_NODES: 'vue_nodes',
    UNKNOWN: 'unknown'
};

/**
 * Node Mount Service Class
 * Provides render mode detection, container lookup, mount management and other functions
 */
class NodeMountService {
    constructor() {
        // Current render mode
        this.currentMode = RENDER_MODE.UNKNOWN;
        // Mode change callback list
        this._modeChangeCallbacks = [];
        // Whether initialized
        this._initialized = false;
        // Set up listener cleanup functions
        this._cleanupFunctions = [];
        // Mode detection cache, avoid frequent detection
        this._modeCache = null;
        this._modeCacheTime = 0;
        this._modeCacheTTL = 1000; // Cache validity 1 second

        // Mount observer map { nodeId: observer }
        this._observers = new Map();

        // ---Mode switch mutex---
        this._modeSwitching = false;
        // Pending mode switch requests
        this._pendingModeChange = null;
    }

    // ---Initialization and lifecycle---

    /**
     * Initialize the service and set up mode listener
     */
    initialize() {
        if (this._initialized) {
            logger.debug('[NodeMountService] Already initialized, skipping');
            return;
        }

        // Detect initial render mode
        this.currentMode = this.detectRenderMode();

        // Set up mode change listener
        this._setupModeWatcher();

        this._initialized = true;
        logger.log(`[NodeMountService] Initialization complete | Render mode: ${this.currentMode}`);
    }

    /**
     * Clean up service resources
     */
    cleanup() {
        // Clean up all observers
        this._observers.forEach(observer => observer.disconnect());
        this._observers.clear();

        // Execute all cleanup functions
        this._cleanupFunctions.forEach(fn => {
            try {
                if (typeof fn === 'function') fn();
            } catch (e) {
                logger.debug(`[NodeMountService] Cleanup function execution failed: ${e.message}`);
            }
        });
        this._cleanupFunctions = [];
        this._modeChangeCallbacks = [];
        this._initialized = false;
        this._modeCache = null;
        logger.debug('[NodeMountService] Resource cleanup complete');
    }

    // ---Node type detection utilities---

    /**
     * Check if the node is a node using comfy-markdown
     * Including Note, MarkdownNote, PreviewTextNode, etc.
     * @param {object} node - Node object
     * @returns {boolean}
     */
    _isMarkdownNode(node) {
        if (!node || !node.type) return false;

        // Known node types using comfy-markdown
        const markdownNodeTypes = ['Note', 'MarkdownNote', 'PreviewAny', 'PreviewTextNode'];
        if (markdownNodeTypes.includes(node.type)) {
            return true;
        }

        // Check if the node type name contains related keywords
        const typeLower = node.type.toLowerCase();
        return typeLower.includes('markdown') ||
            (typeLower.includes('preview') && typeLower.includes('text'));
    }

    /**
     * Check if the node is a subgraph node
     * The type name of subgraph nodes is UUID format
     * @param {object} node - Node object
     * @returns {boolean}
     */
    _isSubgraphNode(node) {
        if (!node || !node.type) return false;
        // UUID format: 8-4-4-4-12 characters
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.type);
    }

    // ---Render mode detection---

    /**
     * Detect current render mode
     * [Optimization] Uses only the most reliable LiteGraph.vueNodesMode global flag
     * @param {boolean} forceRefresh - Whether to force refresh cache
     * @returns {string} Render mode enum value
     */
    detectRenderMode(forceRefresh = false) {
        // Check cache
        const now = Date.now();
        if (!forceRefresh && this._modeCache && (now - this._modeCacheTime) < this._modeCacheTTL) {
            return this._modeCache;
        }

        // [Simplified] Uses only the most reliable global flag
        const mode = (typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true)
            ? RENDER_MODE.VUE_NODES
            : RENDER_MODE.LITEGRAPH;

        // Update cache
        this._modeCache = mode;
        this._modeCacheTime = now;

        return mode;
    }

    /**
     * Check if it is Vue node2.0 mode
     * @returns {boolean}
     */
    isVueNodesMode() {
        return this.detectRenderMode() === RENDER_MODE.VUE_NODES;
    }

    /**
     * Check if it is litegraph.js mode
     * @returns {boolean}
     */
    isLitegraphMode() {
        return this.detectRenderMode() === RENDER_MODE.LITEGRAPH;
    }

    // ---Mode change listener---

    /**
     * Register a mode change callback
     * @param {Function} callback - Callback function, receives (newMode, oldMode) parameters
     */
    onModeChange(callback) {
        if (typeof callback === 'function') {
            this._modeChangeCallbacks.push(callback);
        }
    }

    /**
     * Remove a mode change callback
     * @param {Function} callback - Callback function to remove
     */
    offModeChange(callback) {
        const index = this._modeChangeCallbacks.indexOf(callback);
        if (index > -1) {
            this._modeChangeCallbacks.splice(index, 1);
        }
    }

    /**
     * Check if a mode switch is in progress
     * @returns {boolean}
     */
    isModeSwitching() {
        return this._modeSwitching;
    }

    /**
     * Trigger mode change event (with lock protection)
     * @param {string} newMode - New mode
     * @param {string} oldMode - Old mode
     */
    _triggerModeChange(newMode, oldMode) {
        // If already switching, record pending request and return
        if (this._modeSwitching) {
            this._pendingModeChange = { newMode, oldMode };
            logger.debug('[NodeMountService] Mode switch is locked, request enqueued');
            return;
        }

        this._modeSwitching = true;
        logger.log(`[NodeMountService] Render mode switch | ${oldMode} -> ${newMode}`);

        // Clear cache
        this._modeCache = null;

        // Execute all callbacks, wait for async callbacks to complete
        Promise.all(this._modeChangeCallbacks.map(async callback => {
            try {
                await callback(newMode, oldMode);
            } catch (e) {
                logger.error(`[NodeMountService] Mode switch callback execution failed: ${e.message}`);
            }
        })).finally(() => {
            this._modeSwitching = false;
            // Process pending requests
            if (this._pendingModeChange) {
                const pending = this._pendingModeChange;
                this._pendingModeChange = null;
                this._triggerModeChange(pending.newMode, pending.oldMode);
            }
        });
    }

    /**
     * Set up mode change listener
     * Use ComfyUI official event to listen for render mode switch
     */
    _setupModeWatcher() {
        // Record state for comparison
        let lastMode = this.currentMode;

        // Unified state change check function
        const checkModeChange = () => {
            const currentMode = this.detectRenderMode(true);
            if (currentMode !== lastMode) {
                const oldMode = lastMode;
                lastMode = currentMode;
                this.currentMode = currentMode;
                this._triggerModeChange(currentMode, oldMode);
            }
        };

        try {
            if (app.ui?.settings) {
                // Listen for ComfyUI official CustomEvent
                const eventName = 'Comfy.VueNodes.Enabled.change';
                const handleEvent = () => {
                    // Delay 50ms to ensure LiteGraph.vueNodesMode has completed global sync
                    setTimeout(checkModeChange, 50);
                };

                app.ui.settings.addEventListener(eventName, handleEvent);
                this._cleanupFunctions.push(() => {
                    app.ui.settings.removeEventListener(eventName, handleEvent);
                });

                logger.debug('[NodeMountService] Render mode listener ready (event listener mode)');
            } else {
                // Fallback strategy: if app.ui.settings is not ready, keep low-frequency polling
                const intervalId = setInterval(checkModeChange, 2000);
                this._cleanupFunctions.push(() => clearInterval(intervalId));
                logger.debug('[NodeMountService] app.ui.settings not ready, starting low-frequency polling fallback (2s)');
            }
        } catch (e) {
            logger.debug(`[NodeMountService] Mode listener setup failed: ${e.message}`);
        }
    }

    // ---Container lookup---

    /**
     * Find mount container for node's input widget
     * @param {object} node - LiteGraph node object
     * @param {object} widget - Input widget object
     * @returns {object|null} Container info object or null
     */
    findMountContainer(node, widget) {
        if (!node || !widget) {
            logger.debug('[NodeMountService] findMountContainer: Invalid parameters');
            return null;
        }

        const mode = this.detectRenderMode();

        if (mode === RENDER_MODE.VUE_NODES) {
            return this._findVueNodeContainer(node, widget);
        } else {
            return this._findDomWidgetContainer(node, widget);
        }
    }

    /**
     * Vue node2.0 mode container lookup
     * @param {object} node - LiteGraph node object
     * @param {object} widget - Input widget object
     * @returns {object|null} Container info
     */
    /**
     * Determine if a widget should be rendered as a Textarea
     * @param {object} widget 
     */
    _isTextareaWidget(widget) {
        if (!widget) return false;
        
        let targetWidget = widget;
        if (typeof widget.resolveDeepest === 'function') {
            try {
                const deepest = widget.resolveDeepest();
                if (deepest && deepest.widget) targetWidget = deepest.widget;
            } catch (e) {}
        }
        
        // 1. Explicit customtext type or string
        if (targetWidget.type === 'customtext' || targetWidget.type === 'string') return true;
        // 2. STRING type with multiline: true
        if (targetWidget.type === 'STRING' && targetWidget.options?.multiline) return true;
        // 3. Already bound to a textarea element
        if (targetWidget.element && targetWidget.element.tagName === 'TEXTAREA') return true;

        return false;
    }

    /**
     * Vue node2.0 mode container lookup
     * @param {object} node - LiteGraph node object
     * @param {object} widget - Input widget object
     * @returns {object|null} Container info
     */
    _findVueNodeContainer(node, widget) {
        try {
            let targetWidget = widget;
            if (typeof widget.resolveDeepest === 'function') {
                try {
                    const deepest = widget.resolveDeepest();
                    if (deepest && deepest.widget) targetWidget = deepest.widget;
                } catch (e) {}
            }

            // Find Vue node container with data-node-id
            const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);
            if (!nodeContainer) {

                return null;
            }

            // Get widget name for finding corresponding textarea
            const widgetName = targetWidget.name || targetWidget.id || widget.name;
            let textarea = null;

            // Identify node type
            const isSubgraph = this._isSubgraphNode(node);
            const isMarkdown = this._isMarkdownNode(node);

            // --- Strategy 1: Prefer widget.inputEl (if bound and is PrimeVue component) ---
            if (targetWidget.inputEl && targetWidget.inputEl.tagName === 'TEXTAREA') {
                if (nodeContainer.contains(targetWidget.inputEl)) {
                    textarea = targetWidget.inputEl;

                }
            }

            // --- Strategy 2: Compute index position match (required for subgraph nodes with multiple inputs) ---
            // Applicable to multiple same-type input fields (e.g., Subgraph, CLIPTextEncodeSDXL)
            if (!textarea && node.widgets) {
                // 1. Calculate index of current widget among all Textarea-type widgets
                let targetIndex = -1;
                let currentIndex = 0;

                for (const w of node.widgets) {
                    // Skip hidden widgets because they are not rendered in the DOM
                    if (w.hidden || w.type === 'hidden') {
                        continue;
                    }
                    if (this._isTextareaWidget(w)) {
                        // Try to unwrap dynamic proxy (e.g., Subgraph's PromotedWidgetView) to compare underlying real reference
                        let wInternal = w;
                        if (typeof w.resolveDeepest === 'function') {
                            try {
                                const deepest = w.resolveDeepest();
                                if (deepest && deepest.widget) wInternal = deepest.widget;
                            } catch (e) {}
                        }

                        if (w === widget || wInternal === targetWidget) {
                            targetIndex = currentIndex;
                            break;
                        }
                        // Support SubgraphNode proxy widgets (use core source identifier strict comparison to completely resolve name conflict issues)
                        else if (
                            w.sourceNodeId && widget.sourceNodeId &&
                            w.sourceWidgetName && widget.sourceWidgetName &&
                            w.sourceNodeId === widget.sourceNodeId &&
                            w.sourceWidgetName === widget.sourceWidgetName
                        ) {
                            targetIndex = currentIndex;
                            break;
                        }
                        // Support other dynamic proxy widgets
                        // and cannot resolve to underlying reference
                        // Use exact name matching. If names are duplicated and cannot resolve to underlying component, record the first match.
                        else if (targetIndex === -1 && w.name && widget.name && w.name === widget.name) {
                            // Temporarily store matched index, but do not break, in case a strict reference match appears later
                            targetIndex = currentIndex;
                        }
                        currentIndex++;
                    }
                }

                if (targetIndex !== -1) {
                    // 2. Get all PrimeVue textareas (preferred) or regular textareas from the DOM
                    // [Correction] Must ensure the found textarea is truly corresponding to the widget
                    // It's possible some widgets in subgraph are hidden and not rendered, causing the number of textareas in DOM to be less than the count collected in node.widgets.
                    const primeTextareas = Array.from(nodeContainer.querySelectorAll('textarea.p-textarea'));
                    const textareas = primeTextareas.length > 0
                        ? primeTextareas
                        : Array.from(nodeContainer.querySelectorAll('textarea'));

                    // 3. Match by index
                    if (targetIndex < textareas.length) {
                        textarea = textareas[targetIndex];
                        logger.debugSample(() => `[NodeMountService] Vue mode: Index match successful [${targetIndex}] | Widget: ${widgetName} | Subgraph: ${isSubgraph}`);
                    }
                }
            }

            // --- Strategy 3: Label/Placeholder fuzzy matching (compatibility with old logic as supplement) ---
            if (!textarea) {
                const textareas = nodeContainer.querySelectorAll('textarea');
                const searchName = widgetName.toLowerCase().replace(/_/g, ' '); // snake_case -> space separated

                for (const ta of textareas) {
                    // Check placeholder
                    const placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
                    // Check aria-label
                    const ariaLabel = (ta.getAttribute('aria-label') || '').toLowerCase();
                    // Check parent label
                    const label = ta.closest('label')?.textContent?.toLowerCase() || '';
                    // Check preceding label (Vue floating label structure)
                    const floatLabel = ta.parentElement?.querySelector('label')?.textContent?.toLowerCase() || '';

                    if (placeholder.includes(searchName) ||
                        ariaLabel.includes(searchName) ||
                        label.includes(searchName) ||
                        floatLabel.includes(searchName)) {
                        textarea = ta;
                        // logger.debug(`[NodeMountService] Vue mode: Fuzzy match successful | Widget: ${widgetName}`);
                        break;
                    }
                }
            }

            // --- Strategy 4: Last resort (only safe when there is exactly one textarea) ---
            if (!textarea) {
                const textareas = nodeContainer.querySelectorAll('textarea');
                if (textareas.length === 1) {
                    textarea = textareas[0];
                    logger.debug(`[NodeMountService] Vue mode: Fallback match | Widget: ${widgetName}`);
                }
            }

            if (!textarea) {

                // For nodes using comfy-markdown (Note/MarkdownNote/PreviewTextNode, etc.), return nodeContainer as container but textarea is null
                if (this._isMarkdownNode(node)) {
                    return {
                        container: nodeContainer,
                        textarea: null, // Mark that further lookup is needed
                        nodeContainer: nodeContainer,
                        mode: RENDER_MODE.VUE_NODES,
                        widgetName: widgetName,
                        isNoteNode: true
                    };
                }
                return null;
            }

            // Find textarea's parent container as mount point
            // Prefer floatlabel container, otherwise parent
            const mountContainer = textarea.closest('.p-floatlabel, [class*="float"]') || textarea.parentElement;

            return {
                container: mountContainer,
                textarea: textarea,
                nodeContainer: nodeContainer,
                mode: RENDER_MODE.VUE_NODES,
                widgetName: widgetName,
                isSubgraph: isSubgraph,  // Mark if it is a subgraph node
                isNoteNode: isMarkdown   // Mark if it is a Markdown type node
            };
        } catch (e) {
            logger.error(`[NodeMountService] Vue container lookup failed: ${e.message}`);
            return null;
        }
    }

    /**
     * Find container in litegraph.js mode
     * @param {object} node - LiteGraph node object
     * @param {object} widget - Input widget object
     * @returns {object|null} Container info
     */
    _findDomWidgetContainer(node, widget) {
        try {
            let targetWidget = widget;
            if (typeof widget.resolveDeepest === 'function') {
                try {
                    const deepest = widget.resolveDeepest();
                    if (deepest && deepest.widget) targetWidget = deepest.widget;
                } catch (e) {}
            }

            const inputEl = targetWidget.inputEl || targetWidget.element;
            if (!inputEl) {
                logger.debug('[NodeMountService] Litegraph mode: Input element does not exist');
                return null;
            }

            // Look up for dom-widget container
            let parent = inputEl.parentElement;
            let domWidgetContainer = null;

            while (parent) {
                if (parent.classList?.contains('dom-widget')) {
                    domWidgetContainer = parent;
                    break;
                }
                parent = parent.parentElement;
            }

            if (!domWidgetContainer) {
                logger.debug(`[NodeMountService] Litegraph mode: dom-widget container not found | Node ID: ${node.id}`);
                return null;
            }

            return {
                container: domWidgetContainer,
                textarea: inputEl,
                mode: RENDER_MODE.LITEGRAPH,
                widgetName: targetWidget.name || targetWidget.id
            };
        } catch (e) {
            logger.error(`[NodeMountService] dom-widget container lookup failed: ${e.message}`);
            return null;
        }
    }

    // ---Image node container lookup---

    /**
     * Find mount container for image node (for ImageCaption)
     * @param {object} node - LiteGraph node object
     * @returns {object|null} Container info
     */
    findImageNodeContainer(node) {
        if (!node) return null;

        const mode = this.detectRenderMode();

        if (mode === RENDER_MODE.VUE_NODES) {
            return this._findVueImageNodeContainer(node);
        } else {
            // In litegraph mode, image assistant uses fixed positioning, container not needed
            return {
                container: document.body,
                mode: RENDER_MODE.LITEGRAPH,
                useFixedPositioning: true
            };
        }
    }

    /**
     * Find image node container in Vue node2.0 mode
     * @param {object} node - LiteGraph node object
     * @returns {object|null} Container info
     */
    _findVueImageNodeContainer(node) {
        try {
            const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);
            if (!nodeContainer) {
                logger.debug(`[NodeMountService] Vue mode: Image node container not found | ID: ${node.id}`);
                return null;
            }

            return {
                container: nodeContainer,
                mode: RENDER_MODE.VUE_NODES,
                useFixedPositioning: false
            };
        } catch (e) {
            logger.error(`[NodeMountService] Vue image node container lookup failed: ${e.message}`);
            return null;
        }
    }

    // ---Mount helper methods---

    /**
     * Mount assistant element to container
     * @param {HTMLElement} assistantElement - Assistant DOM element
     * @param {object} containerInfo - Container info returned by findMountContainer
     * @param {object} options - Mount options
     * @returns {boolean} Whether mount successful
     */
    mountAssistant(assistantElement, containerInfo, options = {}) {
        if (!assistantElement || !containerInfo?.container) {
            logger.debug('[NodeMountService] mountAssistant: Invalid parameters');
            return false;
        }

        try {
            const { container, mode } = containerInfo;
            const { position = 'bottom-right', offset = { x: 4, y: 4 } } = options;

            if (mode === RENDER_MODE.VUE_NODES) {
                // Vue node2.0 mode: Use relative positioning
                assistantElement.style.position = 'absolute';
                assistantElement.style.zIndex = '10';

                if (position === 'bottom-right') {
                    assistantElement.style.right = `${offset.x}px`;
                    assistantElement.style.bottom = `${offset.y}px`;
                    assistantElement.style.left = 'auto';
                    assistantElement.style.top = 'auto';
                } else if (position === 'bottom-left') {
                    assistantElement.style.left = `${offset.x}px`;
                    assistantElement.style.bottom = `${offset.y}px`;
                    assistantElement.style.right = 'auto';
                    assistantElement.style.top = 'auto';
                }

                // Ensure container has relative positioning
                const containerPosition = window.getComputedStyle(container).position;
                if (containerPosition === 'static') {
                    container.style.position = 'relative';
                }

                container.appendChild(assistantElement);

            } else {
                // litegraph.js mode: Use absolute positioning (inside dom-widget)
                assistantElement.style.position = 'absolute';
                assistantElement.style.right = `${offset.x}px`;
                assistantElement.style.bottom = `${offset.y}px`;
                assistantElement.style.height = '20px';
                assistantElement.style.minHeight = '20px';

                container.appendChild(assistantElement);
            }

            // Trigger reflow to ensure styles take effect
            void assistantElement.offsetWidth;


            return true;

        } catch (e) {
            logger.error(`[NodeMountService] Mount failed: ${e.message}`);
            return false;
        }
    }

    /**
     * Wait for element to appear (using MutationObserver)
     * Replace polling to achieve near-zero latency response
     * @param {HTMLElement} parent - Parent element to observe
     * @param {string} selector - Target selector (or check function)
     * @param {number} timeout - Timeout in ms
     * @returns {Promise<HTMLElement|null>}
     */
    waitForElement(parent, selector, timeout = 2000) {
        return new Promise((resolve) => {
            // 1. Immediately check if exists
            let element = null;
            if (typeof selector === 'function') {
                element = selector(parent);
            } else {
                element = parent.querySelector(selector);
            }

            if (element) {
                return resolve(element);
            }

            // 2. Set up observer
            const observer = new MutationObserver((mutations) => {
                let found = null;
                if (typeof selector === 'function') {
                    found = selector(parent);
                } else {
                    found = parent.querySelector(selector);
                }

                if (found) {
                    observer.disconnect();
                    resolve(found);
                }
            });

            observer.observe(parent, {
                childList: true,
                subtree: true,
                attributes: true // Sometimes element may only change attribute (e.g., hidden removed)
            });

            // 3. Set timeout
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    /**
     * Container lookup with retry/wait
     * Optimization: Use MutationObserver instead of plain polling
     * @param {object} node - Node object
     * @param {object} widget - Widget object
     * @param {object} options - Options
     * @returns {Promise<object|null>} Container info
     */
    async findMountContainerWithRetry(node, widget, options = {}) {
        // [Optimization] Based on test verification, textarea in Vue nodes 2.0 already exists when node container is added
        // Therefore, complex waiting logic is not needed in most cases
        const { timeout = 500 } = options;

        // Try immediate lookup (should succeed in most cases)
        const immediateResult = this.findMountContainer(node, widget);
        if (immediateResult && immediateResult.textarea) {
            return immediateResult;
        }

        // If it's a Markdown/Note node and we found container but no textarea
        if (immediateResult && immediateResult.isNoteNode) {
            // Continue below, wait for textarea to appear
        }

        const mode = this.detectRenderMode();

        // Vue mode: Simplified wait strategy
        if (mode === RENDER_MODE.VUE_NODES) {
            const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);

            if (nodeContainer) {
                // Use Observer to briefly wait for textarea to appear


                await this.waitForElement(nodeContainer, () => {
                    const result = this.findMountContainer(node, widget);
                    return (result && result.textarea) ? result : null;
                }, timeout);

                // Get final result
                const finalResult = this.findMountContainer(node, widget);
                if (finalResult && finalResult.textarea) {

                    return finalResult;
                }
            }
        } else if (mode === RENDER_MODE.VUE_NODES) {
            // [Critical] nodeContainer does not exist yet, need to wait for node container to render
            // Observe canvas container, wait for nodeContainer to appear
            const graphCanvas = document.querySelector('.graph-canvas-container') ||
                document.querySelector('[class*="graph"]') ||
                document.body;



            // Use Observer to wait for nodeContainer to appear
            const waitResult = await this.waitForElement(graphCanvas, () => {
                const container = document.querySelector(`[data-node-id="${node.id}"]`);
                if (container) {
                    // After finding node container, then look for textarea
                    const result = this.findMountContainer(node, widget);
                    return (result && result.textarea) ? result : null;
                }
                return null;
            }, timeout);

            if (waitResult) {

                return this.findMountContainer(node, widget);
            }
        }

        // Degradation strategy: quick retry once (only for LiteGraph mode or Observer failure)
        await new Promise(r => setTimeout(r, 100));
        const retryResult = this.findMountContainer(node, widget);
        if (retryResult && retryResult.textarea) return retryResult;

        logger.debugSample(() => `[NodeMountService] Container lookup not ready | Node ID: ${node?.id}`);
        return null;
    }
}

// Create singleton instance
export const nodeMountService = new NodeMountService();

// Export class (for type checking or inheritance)
export { NodeMountService };