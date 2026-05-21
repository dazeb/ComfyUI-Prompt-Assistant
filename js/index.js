/**
 * PromptAssistant Main Entry File
 * Responsible for extension initialization, node detection, and feature injection
 */

import { app } from "../../../scripts/app.js";
import { promptAssistant, PromptAssistant } from './modules/PromptAssistant.js';
import { registerSettings } from './modules/settings.js';
import { FEATURES as ASSISTANT_FEATURES, handleFeatureChange, setFeatureModuleDeps } from './services/features.js';
import { EventManager } from './utils/eventManager.js';
import { ResourceManager } from './utils/resourceManager.js';
import { UIToolkit } from "./utils/UIToolkit.js";
import { logger } from './utils/logger.js';
import { HistoryCacheService, TagCacheService } from './services/cache.js';
import { imageCaption, ImageCaption } from './modules/imageCaption.js';
import { nodeHelpTranslator } from './modules/nodeHelpTranslator.js';
import { nodeMountService, RENDER_MODE } from './services/NodeMountService.js';
import { tUI } from "./utils/uiI18n.js";
import './node/captionFrame.js'; // Import video manual frame extraction feature



// ====================== Global Configuration and State ======================

// Set global objects for access by other modules
window.FEATURES = ASSISTANT_FEATURES;

// Add instances to global object
window.promptAssistant = promptAssistant;
window.imageCaption = imageCaption;

// Add instances to global app object
app.promptAssistant = promptAssistant;
app.imageCaption = imageCaption;

// ====================== Extension Registration ======================

/**
 * Register ComfyUI extension
 */
app.registerExtension({
    name: "Comfy.PromptAssistant",

    // ---Extension lifecycle hooks---
    /**
     * Initialize extension
     */
    async setup() {
        try {
            // Initialize node mount service (needs to be done before other initializations)
            nodeMountService.initialize();

            // Register render mode switch handler
            nodeMountService.onModeChange(async (newMode, oldMode) => {
                logger.log(`[index] Render mode switch detected | ${oldMode} -> ${newMode}`);
                // Reinitialize all assistants
                if (window.FEATURES.enabled) {
                    // First clean up all existing instances
                    promptAssistant.cleanup(null, true);
                    imageCaption.cleanup(null, true);

                    // Wait one frame to ensure DOM update
                    await new Promise(resolve => requestAnimationFrame(resolve));

                    await promptAssistant.toggleGlobalFeature(true, true);
                    if (window.FEATURES.imageCaption) {
                        await imageCaption.toggleGlobalFeature(true, true);
                    }
                    logger.log(`[index] Reinitialization completed after render mode switch`);
                }
            });

            // Register settings options
            await registerSettings();

            // Initialize automatic translation interceptor (independent of PromptAssistant)


            // Initialize PromptAssistant (internally handles version check and master switch status)
            await promptAssistant.initialize();

            // Initialize ImageCaption assistant (only initialize once)
            if (!imageCaption.initialized) {
                await imageCaption.initialize();
            }

            // Clean up old references
            if (app.canvas) {
                app.canvas.updateNodeAssistantsVisibility = null;
                app.canvas._onNodeSelectionChange = null;
            }

            // Add managers to app object so they can be accessed via window.app
            app.EventManager = EventManager;
            app.ResourceManager = ResourceManager;
            app.UIToolkit = UIToolkit;

            // First initialize features.js dependencies
            setFeatureModuleDeps({
                promptAssistant,
                PromptAssistant,
                UIToolkit,
                HistoryCacheService,
                TagCacheService,
                imageCaption,
                ImageCaption,
                nodeHelpTranslator
            });

            // Then automatically register service features
            if (window.FEATURES.enabled) {
                await promptAssistant.toggleGlobalFeature(true, true);
                // Avoid duplicate initialization, only enable ImageCaption when necessary
                if (window.FEATURES.imageCaption) {
                    await imageCaption.toggleGlobalFeature(true, false);
                }
                // Initialize node help translator module (based on feature toggle)
                if (window.FEATURES.nodeHelpTranslator) {
                    nodeHelpTranslator.initialize();
                }
            }

            logger.debug("Extension initialization completed");
        } catch (error) {
            logger.error(`Extension initialization failed: ${error.message}`);
        }

        // Deferred hook Note/MarkdownNote/PreviewAny node types
        setTimeout(() => {
            try {
                const NoteNodeType = LiteGraph.registered_node_types['Note'];
                const MarkdownNoteNodeType = LiteGraph.registered_node_types['MarkdownNote'];
                const PreviewAnyNodeType = LiteGraph.registered_node_types['PreviewAny'];
                const PreviewTextNodeType = LiteGraph.registered_node_types['PreviewTextNode'];

                if (NoteNodeType) this._hookNoteNodeType(NoteNodeType, 'Note');
                if (MarkdownNoteNodeType) this._hookNoteNodeType(MarkdownNoteNodeType, 'MarkdownNote');
                if (PreviewAnyNodeType) this._hookNoteNodeType(PreviewAnyNodeType, 'PreviewAny');
                if (PreviewTextNodeType) this._hookNoteNodeType(PreviewTextNodeType, 'PreviewTextNode');

                // Other possible name variants
                const altNames = ['PreviewText', 'Preview as Text', 'Markdown Preview'];
                altNames.forEach(name => {
                    const nodeType = LiteGraph.registered_node_types[name];
                    if (nodeType) {
                        this._hookNoteNodeType(nodeType, name);
                        logger.debug(`[setup] Preview node injection successful | Type: ${name}`);
                    }
                });
            } catch (error) {
                logger.error(`[setup] Hook Note node failed: ${error.message}`);
            }
        }, 50);

        // ---Global node listener---
        this._bindGraphHooks(app.graph);

        // ---Subgraph enter/exit listener (Vue Node 2.0 auto-creation support)---
        this._setupGraphSwitchListener();

        // Expose _injectUniversalHooks for external use
        app.registerExtension._injectUniversalHooks = this._injectUniversalHooks.bind(this);

        // --- Listen for backend warning events (e.g., frame truncation) ---
        app.api.addEventListener("prompt_assistant.warning", ({ detail }) => {
            if (detail?.type === "frame_truncated") {
                const summary = tUI("Frames Truncated", "⚠️ Frames Truncated");
                const detailMsg = tUI("Frame truncation details", "Model supports max {max} frames, {truncated} frame(s) ignored")
                    .replace("{max}", detail.max_images)
                    .replace("{truncated}", detail.truncated);
                
                app.extensionManager?.toast?.add({
                    severity: "warn",
                    summary: summary,
                    detail: detailMsg,
                    life: 8000,
                });
            }
        });
    },

    /**
     * Set canvas graph switch listener
     * Detect subgraph enter/exit events, rescan nodes in auto-creation mode
     */
    _setupGraphSwitchListener() {
        if (!app.canvas) return;

        // Record last graph reference
        let lastGraph = app.canvas.graph;
        const self = this;

        // Hook app.canvas.graph setter via Object.defineProperty
        // Trigger scan when graph switches (enter/exit subgraph)
        const originalDescriptor = Object.getOwnPropertyDescriptor(app.canvas, 'graph') || {
            value: app.canvas.graph,
            writable: true,
            configurable: true
        };
        
        // Backup for debugging recovery
        window.__PA_ORIG_GRAPH_DESC__ = originalDescriptor;

        // Save original value
        let _graphValue = app.canvas.graph;

        Object.defineProperty(app.canvas, 'graph', {
            get() {
                return _graphValue;
            },
            set(newGraph) {
                const oldGraph = _graphValue;
                _graphValue = newGraph;

                // If there is an original setter, call it
                if (originalDescriptor.set) {
                    originalDescriptor.set.call(this, newGraph);
                }

                // Detect graph switch
                if (newGraph && newGraph !== oldGraph) {
                    logger.debug(`[graphSwitch] Canvas switch detected | Old Graph: ${oldGraph?._workflow_id || 'unknown'} -> New Graph: ${newGraph?._workflow_id || 'unknown'}`);

                    // Delay execution to ensure canvas switch completes
                    const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
                    const delay = isVueMode ? 300 : 100;

                    setTimeout(() => {
                        self._onGraphSwitch(newGraph);
                    }, delay);
                }
            },
            configurable: true,
            enumerable: true
        });

        logger.debug('[graphSwitch] Canvas switch listener set');
    },

    /**
     * Processing logic after canvas switch
     * Reuse scanning logic of _bindGraphHooks to avoid code duplication
     * @param {object} graph - New graph object
     */
    _onGraphSwitch(graph) {
        if (!graph || !window.FEATURES.enabled) return;

        // Call existing bind hooks method with resetFlags option to reset node initialization flags
        this._bindGraphHooks(graph, { resetFlags: true });
    },

    /**
     * Bind node mount hooks for specified graph
     * Supports main canvas and subgraph internals
     * @param {object} graph - Graph object
     * @param {object} options - Options { resetFlags: whether to reset node initialization flags }
     */
    _bindGraphHooks(graph, options = {}) {
        if (!graph) return;
        const { resetFlags = false } = options;

        // Bind hooks (only execute once)
        if (!graph._promptAssistantHooksInjected) {
            graph._promptAssistantHooksInjected = true;

            const origOnNodeAdded = graph.onNodeAdded;
            graph.onNodeAdded = (node) => {
                if (origOnNodeAdded) origOnNodeAdded.apply(graph, [node]);

                if (!window.FEATURES.enabled || !node) return;

                // 1. Dynamically inject Hooks (onSelected, onRemoved)
                this._injectUniversalHooks(node);

                // 2. Auto-mount attempt
                this._handleNodeActive(node, { delay: true });
            };

            // logger.log(`[graphHooks] Graph hooks bound | ID: ${graph._workflow_id || graph.constructor?.name || 'unknown'}`);

            // [Key] Handle existing nodes when entering subgraph
            // Vue mode requires longer delay to ensure DOM rendering completion
            const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
            const scanDelay = isVueMode ? 500 : 100;

            const scanExistingNodes = () => {
                if (!window.FEATURES.enabled) return;

                const creationMode = app.ui.settings.getSettingValue("PromptAssistant.Settings.CreationMode") || "auto";
                const icCreationMode = app.ui.settings.getSettingValue("PromptAssistant.Settings.ImageCaptionCreationMode") || "auto";

                // If any module has auto-creation enabled, existing nodes need to be scanned
                if (creationMode !== "auto" && icCreationMode !== "auto") {
                    // logger.debugSample(() => `[graphHooks] Skip initial scan | PA mode: ${creationMode} | IC mode: ${icCreationMode}`);
                    return;
                }

                const nodes = graph._nodes || [];
                if (nodes.length === 0) return;

                nodes.forEach(node => {
                    if (!node || node.id === -1) return;

                    // 1. Inject hooks (ensure onSelected/onRemoved etc. work correctly)
                    this._injectUniversalHooks(node);

                    // 2. Unified dispatch to activation handler, which internally determines based on respective auto-creation settings
                    this._handleNodeActive(node, { delay: false });
                });
            };

            setTimeout(scanExistingNodes, scanDelay);
        }

        // [New] If reset flags needed (subgraph switch scenario), immediately scan existing nodes
        if (resetFlags) {
            // When switching graphs, first clean up current UI instances (do not clean cache) to prevent ID conflict residues
            promptAssistant.cleanup(null, true);

            const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
            const delay = isVueMode ? 300 : 100;

            setTimeout(() => {
                const nodes = graph._nodes || [];
                nodes.forEach(node => {
                    if (!node || node.id === -1) return;

                    // Reset initialization flag to allow recreation
                    node._promptAssistantInitialized = false;
                    node._imageCaptionInitialized = false;

                    // Inject hooks
                    this._injectUniversalHooks(node);

                    // Trigger auto-creation
                    this._handleNodeActive(node, { delay: false });
                });

                if (nodes.length > 0) {
                    const gId = graph.id || graph._workflow_id || 'main';
                    logger.debug(`[graphSwitch] Auto-scan completed | Nodes: ${nodes.length} | Graph: ${gId}`);
                }
            }, delay);
        }
    },

    /**
     * Inject universal interaction hooks (onSelected, onRemoved) for all nodes
     * Especially for dynamically created subgraph nodes, ensure they can respond to clicks and resource cleanup
     * @param {object} node - LiteGraph node instance
     */
    _injectUniversalHooks(node) {
        if (!node || node._promptAssistantHooksInjected) return;

        const self = this;
        const origOnSelected = node.onSelected;
        const origOnRemoved = node.onRemoved;

        // Instance-level override (for dynamically created or special nodes)
        node.onSelected = function () {
            if (origOnSelected) origOnSelected.apply(this, arguments);
            self._handleNodeActive(this, { reset: true, delay: true });
        };

        node.onRemoved = function () {
            self._handleNodeCleanup(this);
            if (origOnRemoved) origOnRemoved.apply(this, arguments);
        };

        node._promptAssistantHooksInjected = true;
    },

    /**
     * @deprecated Replaced by _injectUniversalHooks, retained for legacy support during registration
     */
    _hookNoteNodeType(NodeType, typeName) {
        if (!NodeType || !NodeType.prototype) return;

        // We no longer override prototype methods; instead, inject instance methods dynamically via onNodeAdded
        // This is more reliable for dynamic creation in Node 2.0
        // logger.debug(`[_hookNoteNodeType] Type registered: ${typeName}`);
    },

    // ---Other methods remain unchanged---
    async _setupOtherMethods() {
        const self = this;
        // Only preserve workflow ID identification, do not handle workflow switch events
        try {
            const LGraph = app.graph.constructor;
            const origConfigure = LGraph.prototype.configure;
            LGraph.prototype.configure = function (data) {
                // Store workflow ID on graph object
                this._workflow_id = data.id || LiteGraph.uuidv4();

                // Execute original method
                return origConfigure.apply(this, arguments);
            };

            // Add workflow load listener, only mark switch state, do not do special handling
            const origLoadGraphData = app.loadGraphData;
            app.loadGraphData = async function (data) {
                // Set workflow switch flag to avoid cache deletion
                window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING = true;

                // Simplified log: only print once when workflow ID changes
                const workflowId = data?.id || (data?.extra?.workflow_id) || "Unknown workflow";
                if (app.graph?._workflow_id !== workflowId) {
                    logger.log(`[Workflow] Switch: ${workflowId}`);
                }

                try {
                    // Call original load method
                    const result = await origLoadGraphData.apply(this, arguments);

                    // After workflow loads, uniformly handle activation of existing nodes (including auto-creation determination)
                    requestAnimationFrame(() => {
                        if (app.graph && app.graph._nodes) {
                            app.graph._nodes.forEach(node => {
                                if (node && node.id !== -1) {
                                    self._handleNodeActive(node, { delay: false });
                                }
                            });
                        }
                    });

                    return result;
                } finally {
                    // Delay reset workflow switch flag
                    setTimeout(() => {
                        window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING = false;
                    }, 500);
                }
            };
        } catch (e) {
            logger.error("[PromptAssistant] Inject LGraph setting workflow ID failed", e);
        }
    },

    // ---Node lifecycle hooks---
    /**
     * Node creation hook
     * Initialize assistant for specific type nodes when node is created
     */
    async nodeCreated(node) {
        // nodeCreated hook is now mainly used to supplement special interactions for subgraph nodes, most logic is already injected via onNodeCreated
        if (!node || node.id === -1) return;
        this._injectUniversalHooks(node);
    },

    async nodeRemoved(node) {
        if (window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING) return;
        this._handleNodeCleanup(node);
    },

    /**
     * Node definition pre-registration hook
     * Inject assistant-related functionality to all node types
     */


    // --- Unified lifecycle management logic (refactoring point) ---

    /**
     * Unified handling of node 'enter/active' logic
     * Covers: new node creation (onNodeCreated), global node addition (onNodeAdded), node selection (onSelected)
     * @param {object} node - Node instance
     * @param {object} options - Configuration parameters { reset: whether to force reset flag, delay: whether to use raf delay }
     */
    _handleNodeActive(node, options = {}) {
        if (!node || !window.FEATURES.enabled) return;
        if (node.id === -1) return;

        const { reset = false, delay = true } = options;
        if (reset) {
            node._promptAssistantInitialized = false;
            node._imageCaptionInitialized = false;
        }

        const run = () => {
            if (!node || !node.id || node.id === -1) return;

            // 1. PromptAssistant core entry
            if (PromptAssistant.isValidNode(node)) {
                const creationMode = app.ui.settings.getSettingValue("PromptAssistant.Settings.CreationMode") || "auto";
                if ((creationMode === "auto" || reset) && !node._promptAssistantInitialized) {
                    node._promptAssistantInitialized = true;
                    promptAssistant.checkAndSetupNode(node);
                }
            }

            // 2. ImageCaption assistant entry
            const isSupportedICNode = imageCaption.isSupportedNode && imageCaption.isSupportedNode(node);
            if (window.FEATURES.imageCaption && isSupportedICNode) {
                const icCreationMode = app.ui.settings.getSettingValue("PromptAssistant.Settings.ImageCaptionCreationMode") || "auto";
                if (reset && app.canvas?._imageCaptionSelectionHandler) {
                    node._imageCaptionInitialized = false;
                    app.canvas._imageCaptionSelectionHandler({ [node.id]: node });
                } else if (icCreationMode === "auto" && !node._imageCaptionInitialized) {
                    node._imageCaptionInitialized = true;
                    imageCaption.checkAndSetupNode(node);
                }
            }
        };

        if (delay) {
            requestAnimationFrame(() => requestAnimationFrame(run));
        } else {
            run();
        }
    },

    /**
     * Unified handling of node 'destroy/cleanup' logic
     * @param {object} node - Node instance
     */
    _handleNodeCleanup(node) {
        if (!node || node.id === undefined || node.id === -1) return;
        const nodeId = node.id;

        // Execute cleanup and mark state
        if (node._promptAssistantInitialized || !node._promptAssistantCleaned) {
            promptAssistant.cleanup(nodeId, false);
            node._promptAssistantCleaned = true;
        }
        if (node._imageCaptionInitialized || !node._imageCaptionCleaned) {
            imageCaption.cleanup(nodeId, false);
            node._imageCaptionCleaned = true;
        }
    },

    /**
     * Batch prototype injection before registration
     */
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const self = this;
        const proto = nodeType.prototype;

        const origOnCreated = proto.onNodeCreated;
        const origOnSelected = proto.onSelected;
        const origOnRemoved = proto.onRemoved;

        // Inject creation hook (prototype-level fallback)
        proto.onNodeCreated = function () {
            if (origOnCreated) origOnCreated.apply(this, arguments);
            self._handleNodeActive(this, { delay: true });
        };

        // Inject selection hook (prototype-level fallback)
        proto.onSelected = function () {
            if (origOnSelected) origOnSelected.apply(this, arguments);
            self._handleNodeActive(this, { reset: true, delay: true });
        };

        // Inject removal hook (prototype-level fallback)
        proto.onRemoved = function () {
            self._handleNodeCleanup(this);
            if (origOnRemoved) origOnRemoved.apply(this, arguments);
        };
    },

    /**
     * Extension unload hook
     * Clean up all resources when extension is unloaded
     */
    async beforeExtensionUnload() {
        promptAssistant.cleanup();
        imageCaption.cleanup();
    }
});

export { EventManager, UIToolkit };