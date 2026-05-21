/**
 * Image Node Assistant Class
 * For detecting and processing image nodes, providing image captioning
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { EventManager } from "../utils/eventManager.js";
import { APIService } from '../services/api.js';
import { HistoryCacheService } from '../services/cache.js';
import { buttonMenu } from "../services/btnMenu.js";
import { rulesConfigManager } from "./rulesConfigManager.js";
import { nodeMountService, RENDER_MODE } from "../services/NodeMountService.js";
import { AssistantContainer, ANCHOR_POSITION } from "./AssistantContainer.js";
import { PopupManager } from "../utils/popupManager.js";



class ImageCaption {
    /** Map collection of all assistant instances */
    static instances = new Map();

    constructor() {
        this.initialized = false;
    }

    /**
     * Get low quality render threshold
     * Extracted as class method to ensure consistent threshold calculation everywhere
     */
    _getQualityThreshold() {
        // Prefer fetching from system settings
        if (app.ui?.settings) {
            try {
                // Fix: don't use deprecated defaultValue parameter
                const settingValue = app.ui.settings.getSettingValue('Comfy.Graph.CanvasInfo');
                if (typeof settingValue === 'number') {
                    return settingValue;
                }
            } catch (e) {
                // Ignore errors, use default value
            }
        }
        // Get from canvas object
        return app.canvas?.low_quality_zoom_threshold || 0.6;
    }

    /**
     * Check if node type is an allowed image node type (public method)
     */
    isSupportedNode(node) {
        return this._isAllowedNodeType(node);
    }

    /**
     * Check if node type is an allowed image node type
     * @param {object} node - LiteGraph node object
     * @param {boolean} debug - Whether to print debug log
     * @returns {boolean} Whether it's an allowed node type
     */
    _isAllowedNodeType(node, debug = false) {
        if (!node || !node.type) return false;

        // List of allowed node types (adjustable as needed)
        const allowedTypes = [
            // Load image nodes
            'LoadImage',
            'LoadImageFromUrl',

            // Preview image nodes
            'PreviewImage',
            'ImagePreview',

            // Save image nodes
            'SaveImage',
            'SaveImages'
        ];

        // Check if node type is in allowed list
        // Use partial matching for compatibility with similar nodes from different plugins
        const isAllowed = allowedTypes.some(type =>
            node.type.includes(type) ||
            (node.title && node.title.includes(type))
        );

        // Debug logs can be enabled during development
        if (debug && !isAllowed) {
            logger.debug(`[imageassistant] Node type not allowed: ${node.type || 'Unknown'} | Title: ${node.title || 'Unknown'}`);
        }

        return isAllowed;
    }

    /**
     * Check if node and canvas state are suitable for showing assistant
     * @param {object} node - LiteGraph node object
     * @returns {object} Return detection result object
     */
    _checkNodeAndCanvasState(node) {
        const result = {
            isValid: false,
            isCollapsed: false,
            isLowQuality: false,
            hasValidImage: false
        };

        if (!node) {
            return result;
        }

        // Check if node is an allowed image node type
        if (!this._isAllowedNodeType(node)) {
            return result;
        }

        // Check if node is collapsed
        if (node.flags && node.flags.collapsed) {
            result.isCollapsed = true;
            return result;
        }

        // Check if in low quality render state
        if (app.canvas) {
            // Get low quality render threshold
            const threshold = this._getQualityThreshold();
            const scale = app.canvas.ds.scale;

            // Add larger epsilon to fix float comparison and threshold delay issues
            const epsilon = 0.001;
            if (scale <= threshold + epsilon) {
                result.isLowQuality = true;
                return result;
            }
        }

        // Check if node has valid image
        if (node.imgs && Array.isArray(node.imgs) && node.imgs.length > 0) {
            const imageIndex = node.imageIndex || 0;
            if (imageIndex >= 0 && imageIndex < node.imgs.length && node.imgs[imageIndex]) {
                result.hasValidImage = true;
                result.isValid = true;
            }
        }

        // --- Supplementary check: Vue Node 2.0 DOM detection ---
        if (!result.hasValidImage && nodeMountService.isVueNodesMode()) {
            const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);
            if (nodeContainer) {
                const imgElement = nodeContainer.querySelector('img');
                if (imgElement && imgElement.src && !imgElement.src.includes('error')) {
                    // logger.debugSample(() => `[imageassistant] Image detected via DOM | ID: ${node.id}`);
                    result.hasValidImage = true;
                    result.isValid = true;
                }
            }
        }

        return result;
    }

    /**
     * Check if node has valid image
     * @param {object} node - LiteGraph node object
     * @returns {boolean} Whether valid image exists
     */
    hasValidImage(node) {
        if (!node) return false;

        // Check if node type is allowed
        if (!this._isAllowedNodeType(node)) {
            return false;
        }

        // Check if node has imgs property
        if (!node.imgs || !Array.isArray(node.imgs) || node.imgs.length === 0) {
            return false;
        }

        // Get currently displayed image
        const imageIndex = node.imageIndex || 0;
        return imageIndex >= 0 && imageIndex < node.imgs.length && node.imgs[imageIndex] != null;
    }

    /**
     * Get node's currently displayed image object
     * @param {object} node - LiteGraph node object
     * @returns {object|null} Return image object or null
     */
    getNodeImage(node) {
        // Check if node type is allowed
        if (!this._isAllowedNodeType(node)) {
            return null;
        }

        const state = this._checkNodeAndCanvasState(node);

        if (!state.isValid) {
            return null;
        }

        // Return currently displayed image
        const imageIndex = node.imageIndex || 0;
        return node.imgs[imageIndex];
    }

    /**
     * Initialize image assistant
     */
    async initialize() {
        if (this.initialized) return true;

        try {
            // Check initial master switch state
            const initialEnabled = app.ui.settings.getSettingValue("PromptAssistant.Features.ImageCaption");
            window.FEATURES.imageCaption = initialEnabled !== undefined ? initialEnabled : true;

            // Only log init state in debug mode
            logger.debug(`Image caption feature initialization | state:${window.FEATURES.imageCaption ? "Enabled" : "Disabled"}`);

            // Register node selection listener
            this.registerNodeSelectionListener();

            // Mark as initialized
            this.initialized = true;
            logger.log("Image assistant initialization complete");
            return true;
        } catch (error) {
            logger.error(() => `Image assistant initialization failed | Error: ${error.message}`);
            this.initialized = false;
            return false;
        }
    }

    /**
     * Register node selection event listener
     */
    registerNodeSelectionListener() {
        if (!app.canvas) {
            logger.error("Canvas not initialized, cannot register node selection event listener");
            return;
        }

        // If selection event handler already registered, skip
        if (app.canvas._imageCaptionSelectionHandler) {
            logger.debug("Image assistant node selection listener already exists, skipping registration");
            return;
        }

        // Create selection event handler
        const selectionHandler = (selected_nodes) => {
            // Skip all node processing when master switch or image caption is off
            if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
                return;
            }

            // Handle empty selection case
            if (!selected_nodes || Object.keys(selected_nodes).length === 0) {
                return;
            }

            // Process selected nodes
            for (const nodeId in selected_nodes) {
                const node = app.canvas.graph._nodes_by_id[nodeId];
                if (!node || node.id === -1) continue;

                // Remove init flag check, re-detect node state on each selection
                this.checkAndSetupNode(node);
            }
        };

        // Save original selection event handler
        if (app.canvas.onSelectionChange && app.canvas.onSelectionChange !== selectionHandler) {
            app.canvas._originalImageCaptionSelectionChange = app.canvas.onSelectionChange;
        }

        // Set new selection event handler
        app.canvas._imageCaptionSelectionHandler = selectionHandler;

        // Add to LiteGraph's event system
        if (app.canvas.graph) {
            app.canvas.graph._imageCaptionNodeSelectionChange = selectionHandler;
        }

        logger.debug("Image assistant node selection listener registered successfully");

        // Initial check of currently selected nodes
        if (app.canvas.selected_nodes && Object.keys(app.canvas.selected_nodes).length > 0) {
            selectionHandler(app.canvas.selected_nodes);
        }
    }

    /**
     * Check node and set up assistant
     */
    checkAndSetupNode(node) {
        // Check master switch and image caption feature state
        if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
            return;
        }

        // Check if node is valid
        if (!node) return;

        // Check if node type is allowed
        if (!this._isAllowedNodeType(node)) {
            return;
        }

        // Check if node has been deleted (only clean up on deletion)
        if (!app.canvas || !app.canvas.graph || !app.canvas.graph._nodes_by_id[node.id]) {
            // Node has been deleted, cleaning up instance
            this.cleanup(node.id);
            return;
        }

        // Check node and canvas state
        const nodeState = this._checkNodeAndCanvasState(node);

        // If node collapsed or canvas zoomed out, hide existing instance but don't create new
        if (nodeState.isCollapsed || nodeState.isLowQuality) {
            if (ImageCaption.hasInstance(node.id)) {
                const instance = ImageCaption.getInstance(node.id);
                if (instance) {
                    this.updateAssistantVisibility(instance);
                }
            }
            return;
        }

        // Validate existing instance
        const existingInstance = ImageCaption.getInstance(node.id);
        const isElementValid = existingInstance && existingInstance.element && document.body.contains(existingInstance.element);
        const isVueMode = nodeMountService.isVueNodesMode();

        // In Vue mode, element may be mounted inside node container instead of body
        const isVueElementValid = isVueMode && existingInstance && existingInstance.element &&
            document.querySelector(`[data-node-id="${node.id}"]`)?.contains(existingInstance.element);

        if (existingInstance && (isElementValid || isVueElementValid)) {
            // Instance valid, update visibility (handles image detection internally)
            this.updateAssistantVisibility(existingInstance);
        } else {
            // Instance invalid or missing, clean up and force create (whitelist mechanism)
            if (existingInstance) {
                this.cleanup(node.id);
            }

            // Create new assistant instance
            const assistant = this.setupNodeAssistant(node);
            if (assistant) {
                logger.debug(() => `[imageassistant] Pre-mount successful | ID: ${node.id} | Waiting for image loading...`);
            }
        }
    }

    /**
     * Set up assistant for node
     */
    setupNodeAssistant(node) {
        if (!node) return null;

        // Create assistant instance
        const assistant = this.createAssistant(node);
        if (assistant) {
            // Initialize display state
            this.showAssistantUI(assistant);
            return assistant;
        }
        return null;
    }

    /**
     * Create assistant instance
     */
    createAssistant(node) {
        // Check if node is valid
        if (!node || !node.id || node.id === -1) {
            return null;
        }

        // Check if instance already exists
        if (ImageCaption.hasInstance(node.id)) {
            return ImageCaption.getInstance(node.id);
        }

        // Save nodeId for dynamic node retrieval
        const nodeId = node.id;

        // Create assistant object
        const assistant = {
            nodeId: nodeId,
            buttons: {},
            isActive: false,
            isTransitioning: false,
            isDestroyed: false,
            _eventCleanupFunctions: [],
            _timers: {},
            // Save initial node reference as fallback (Vue Node 2.0 subgraph switching)
            _initialNode: node
        };

        // Dynamic node getter to avoid holding deleted node references
        // 【Fix】Prefer fetching from graph, fallback to initial reference if failed (fix issue when subgraph toggle results in canvas not synced)
        Object.defineProperty(assistant, 'node', {
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

        // Create UI
        this.createAssistantUI(assistant);

        // Add to instance collection
        ImageCaption.addInstance(nodeId, assistant);

        // Set up node collapse state listener
        this._setupNodeCollapseListener(assistant);

        // Set up canvas zoom listener
        this._setupCanvasScaleListener(assistant);

        // Show assistant
        this.updateAssistantVisibility(assistant);

        return assistant;
    }

    /**
     * Create assistant UI
     */
    createAssistantUI(assistant) {
        // 【Fix】Use nodeId for validity check, avoid getter returning null during canvas toggle causing Create Failed
        if (!assistant?.nodeId) return null;

        try {
            // Get location setting
            let locationSetting = app.ui.settings.getSettingValue(
                "ImageCaption.Location"
            );

            // Automatically assign non-conflicting optimal positions based on render mode
            if (nodeMountService.isVueNodesMode()) {
                locationSetting = ANCHOR_POSITION.BOTTOM_RIGHT_H; // Vue mode bottom-right to avoid ID
            } else {
                locationSetting = ANCHOR_POSITION.BOTTOM_LEFT_H; // LiteGraph mode keep bottom-left
            }

            // Create AssistantContainer instance
            const container = new AssistantContainer({
                nodeId: assistant.nodeId,
                type: 'image', // Uses image-assistant-container class
                anchorPosition: locationSetting,
                enableDragSort: true,
                onButtonOrderChange: (order) => {
                    // Order preservation handled by container
                },
                shouldCollapse: () => {
                    return !this._checkAssistantActiveState(assistant);
                }
            });

            // Render
            const containerEl = container.render();

            // Set Icon
            const mainIcon = ResourceManager.getIcon('icon-main.svg');
            if (mainIcon && container.indicator) {
                container.indicator.innerHTML = '';
                container.indicator.appendChild(mainIcon);
            }

            // Save references
            assistant.container = container;
            assistant.element = containerEl;
            assistant.innerContent = container.content;
            assistant.hoverArea = container.hoverArea;
            assistant.indicator = container.indicator;
            assistant.buttons = {};

            // Sync state properties
            Object.defineProperty(assistant, 'isCollapsed', {
                get: () => container.isCollapsed,
                set: (val) => {
                    if (val) container.collapse(); else container.expand();
                }
            });
            Object.defineProperty(assistant, 'isTransitioning', {
                get: () => container.isTransitioning,
                set: (val) => { container.isTransitioning = val; }
            });

            // Add buttons
            this.addFunctionButtons(assistant);

            // Restore order
            container.restoreOrder();

            // Initial setup
            // Note: original code sets position fixed and appends to body
            // AssistantContainer creates elements but does not mount.
            // Original code:
            // containerDiv.style.position = 'fixed';
            // document.body.appendChild(containerDiv);

            // We follow original logic, append Image Assistant to body
            containerEl.style.position = 'fixed';
            containerEl.style.zIndex = '1';
            document.body.appendChild(containerEl);

            // Deferred position setting
            // Optimization: use requestAnimationFrame to ensure position update before next repaint
            requestAnimationFrame(() => {
                this._setupUIPosition(assistant);
                if (container) container.updateDimensions();
            });

            // Collapse/expand handled by container
            // Remove manual event settings

            return containerEl;

        } catch (error) {
            logger.error(`Image assistant UI creation failed | ID: ${assistant.nodeId} | ${error.message}`);
            return null;
        }
    }

    /**
     * Add function buttons
     */
    addFunctionButtons(assistant) {
        if (!assistant?.element) return;

        // Create caption button (Chinese)
        const buttonZh = this.addButtonWithIcon(assistant, {
            id: 'caption_zh',
            title: 'Caption (Chinese)',
            icon: 'icon-caption-zh',
            onClick: async (e, assistant) => {
                e.preventDefault();
                e.stopPropagation();
                await this.handleImageAnalysis(assistant, 'zh');
            },
            // Add Chinese caption context menu
            contextMenu: async (assistant) => {
                // Get service list and current activation state
                let services = [];
                let currentVLMService = null;
                let currentVLMModel = null;

                // Get Chinese caption rules
                let activePromptId = null;
                let visionPrompts = [];

                try {
                    // Get service list
                    const servicesResp = await fetch(APIService.getApiUrl('/services'));
                    if (servicesResp.ok) {
                        const servicesData = await servicesResp.json();
                        if (servicesData.success) {
                            services = servicesData.services || [];
                        }
                    }

                    // Get currently active VLM service and model
                    const vlmResp = await fetch(APIService.getApiUrl('/config/vision'));
                    if (vlmResp.ok) {
                        const vlmConfig = await vlmResp.json();
                        currentVLMService = vlmConfig.provider || null;
                        currentVLMModel = vlmConfig.model || null;
                    }

                    // Get Chinese caption rules
                    const response = await fetch(APIService.getApiUrl('/config/system_prompts'));
                    if (response.ok) {
                        const data = await response.json();
                        activePromptId = data.active_prompts?.vision_zh || null;

                        if (data.vision_prompts) {
                            const originalOrder = Object.keys(data.vision_prompts);
                            originalOrder.forEach(key => {
                                if (key.startsWith('vision_zh')) {
                                    const prompt = data.vision_prompts[key];
                                    const showIn = prompt.showIn || ['frontend', 'node'];

                                    // Only show in frontend menu when config includes 'frontend'
                                    if (showIn.includes('frontend')) {
                                        visionPrompts.push({
                                            id: key,
                                            name: prompt.name || key,
                                            category: prompt.category || '',
                                            showIn: showIn,
                                            isActive: key === activePromptId
                                        });
                                    }
                                }
                            });
                            visionPrompts.sort((a, b) =>
                                originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id)
                            );
                        }
                    }
                } catch (error) {
                    logger.error(() => `Failed to get Chinese caption config: ${error.message}`);
                }

                // Create service menu items (only show services with VLM models)
                const serviceMenuItems = services
                    .filter(service => service.vlm_models && service.vlm_models.length > 0)
                    .map(service => {
                        const isCurrentService = currentVLMService === service.id;

                        // Create model submenu
                        const modelChildren = (service.vlm_models || []).map(model => {
                            const isCurrentModel = isCurrentService && currentVLMModel === model.name;
                            return {
                                label: model.display_name || model.name,
                                icon: `<span class="pi ${isCurrentModel ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                onClick: async (context) => {
                                    try {
                                        const res = await fetch(APIService.getApiUrl('/services/current'), {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service_type: 'vlm', service_id: service.id, model_name: model.name })
                                        });
                                        if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                        const modelLabel = model.display_name || model.name;
                                        UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${service.name} - ${modelLabel}`);
                                        logger.log(`Vision service switch | Service: ${service.name} | model: ${modelLabel}`);
                                    } catch (err) {
                                        logger.error(`Failed to switch vision model: ${err.message}`);
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
                                        body: JSON.stringify({ service_type: 'vlm', service_id: service.id })
                                    });
                                    if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                    UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${service.name}`);
                                    logger.log(`Vision service switch | Service: ${service.name}`);
                                } catch (err) {
                                    logger.error(`Failed to switch vision service: ${err.message}`);
                                    UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${err.message}`);
                                }
                            },
                            children: modelChildren.length > 0 ? modelChildren : undefined
                        };
                    });

                // ---Create rule menu items (support category grouping)---
                const ruleMenuItems = [];

                // Helper function: create single rule menu item
                const createRuleMenuItem = (prompt) => ({
                    label: prompt.name,
                    icon: `<span class="pi ${prompt.isActive ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                    onClick: async (context) => {
                        try {
                            const response = await fetch(APIService.getApiUrl('/config/active_prompt'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type: 'vision_zh', prompt_id: prompt.id })
                            });
                            if (response.ok) {
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${prompt.name}`);
                            } else {
                                throw new Error(`Server returned error: ${response.status}`);
                            }
                        } catch (error) {
                            logger.error(`Failed to switch Chinese caption prompt: ${error.message}`);
                            UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${error.message}`);
                        }
                    }
                });

                // Group rules by category
                const uncategorizedPrompts = visionPrompts.filter(p => !p.category);
                const categorizedPrompts = visionPrompts.filter(p => p.category);

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
        });

        // Create caption button (English)
        const buttonEn = this.addButtonWithIcon(assistant, {
            id: 'caption_en',
            title: 'Caption (English)',
            icon: 'icon-caption-en',
            onClick: async (e, assistant) => {
                e.preventDefault();
                e.stopPropagation();
                await this.handleImageAnalysis(assistant, 'en');
            },
            // Add English caption context menu
            contextMenu: async (assistant) => {
                // Get service list and current activation state
                let services = [];
                let currentVLMService = null;
                let currentVLMModel = null;

                // Get English caption rules
                let activePromptId = null;
                let visionPrompts = [];

                try {
                    // Get service list
                    const servicesResp = await fetch(APIService.getApiUrl('/services'));
                    if (servicesResp.ok) {
                        const servicesData = await servicesResp.json();
                        if (servicesData.success) {
                            services = servicesData.services || [];
                        }
                    }

                    // Get currently active VLM service and model
                    const vlmResp = await fetch(APIService.getApiUrl('/config/vision'));
                    if (vlmResp.ok) {
                        const vlmConfig = await vlmResp.json();
                        currentVLMService = vlmConfig.provider || null;
                        currentVLMModel = vlmConfig.model || null;
                    }

                    // Get English caption rules
                    const response = await fetch(APIService.getApiUrl('/config/system_prompts'));
                    if (response.ok) {
                        const data = await response.json();
                        activePromptId = data.active_prompts?.vision_en || null;

                        if (data.vision_prompts) {
                            const originalOrder = Object.keys(data.vision_prompts);
                            originalOrder.forEach(key => {
                                if (key.startsWith('vision_en')) {
                                    const prompt = data.vision_prompts[key];
                                    const showIn = prompt.showIn || ['frontend', 'node'];

                                    // Only show in frontend menu when config includes 'frontend'
                                    if (showIn.includes('frontend')) {
                                        visionPrompts.push({
                                            id: key,
                                            name: prompt.name || key,
                                            category: prompt.category || '',
                                            showIn: showIn,
                                            isActive: key === activePromptId
                                        });
                                    }
                                }
                            });
                            visionPrompts.sort((a, b) =>
                                originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id)
                            );
                        }
                    }
                } catch (error) {
                    logger.error(`Failed to get English caption config: ${error.message}`);
                }

                // Create service menu items (only show services with VLM models)
                const serviceMenuItems = services
                    .filter(service => service.vlm_models && service.vlm_models.length > 0)
                    .map(service => {
                        const isCurrentService = currentVLMService === service.id;

                        // Create model submenu
                        const modelChildren = (service.vlm_models || []).map(model => {
                            const isCurrentModel = isCurrentService && currentVLMModel === model.name;
                            return {
                                label: model.display_name || model.name,
                                icon: `<span class="pi ${isCurrentModel ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                onClick: async (context) => {
                                    try {
                                        const res = await fetch(APIService.getApiUrl('/services/current'), {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service_type: 'vlm', service_id: service.id, model_name: model.name })
                                        });
                                        if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                        const modelLabel = model.display_name || model.name;
                                        UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${service.name} - ${modelLabel}`);
                                        logger.log(`Vision service switch | Service: ${service.name} | model: ${modelLabel}`);
                                    } catch (err) {
                                        logger.error(`Failed to switch vision model: ${err.message}`);
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
                                        body: JSON.stringify({ service_type: 'vlm', service_id: service.id })
                                    });
                                    if (!res.ok) throw new Error(`Server returned error: ${res.status}`);
                                    UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${service.name}`);
                                    logger.log(`Vision service switch | Service: ${service.name}`);
                                } catch (err) {
                                    logger.error(`Failed to switch vision service: ${err.message}`);
                                    UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${err.message}`);
                                }
                            },
                            children: modelChildren.length > 0 ? modelChildren : undefined
                        };
                    });

                // ---Create rule menu items (support category grouping)---
                const ruleMenuItems = [];

                // Helper function: create single rule menu item
                const createRuleMenuItem = (prompt) => ({
                    label: prompt.name,
                    icon: `<span class="pi ${prompt.isActive ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                    onClick: async (context) => {
                        try {
                            const response = await fetch(APIService.getApiUrl('/config/active_prompt'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type: 'vision_en', prompt_id: prompt.id })
                            });
                            if (response.ok) {
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `Switched to: ${prompt.name}`);
                            } else {
                                throw new Error(`Server returned error: ${response.status}`);
                            }
                        } catch (error) {
                            logger.error(`Failed to switch English caption prompt: ${error.message}`);
                            UIToolkit.showStatusTip(context.buttonElement, 'error', `Switch failed: ${error.message}`);
                        }
                    }
                });

                // Group rules by category
                const uncategorizedPrompts = visionPrompts.filter(p => !p.category);
                const categorizedPrompts = visionPrompts.filter(p => p.category);

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
        });

        // Create buttons


        if (buttonZh) {
            assistant.container.addButton(buttonZh, 'caption_zh');
        }
        if (buttonEn) {
            assistant.container.addButton(buttonEn, 'caption_en');
        }
    }

    // ---Streaming output helper methods---

    /**
     * Create streaming display overlay
     /**
     * Create node-embedded streaming display container
     */
    _createStreamingOverlay(assistant) {
        try {
            const nodeId = assistant.node?.id;
            // Strategy 1: prefer getting Vue node container
            let mountContainer = document.querySelector(`[data-node-id="${nodeId}"]`);
            let isLiteGraph = false;

            if (!mountContainer) {
                // Strategy 2: LiteGraph mode, use Body mount + Fixed positioning for "clip isolation"
                mountContainer = document.body;
                isLiteGraph = true;
            }

            // Create outer container
            const container = document.createElement('div');
            container.className = 'node-streaming-text-container';
            if (isLiteGraph) {
                container.classList.add('is-litegraph');
            }

            // Create text content container
            const content = document.createElement('div');
            content.className = 'node-streaming-text-content';

            container.appendChild(content);
            mountContainer.appendChild(container);

            // LiteGraph mode: start frame-sync position lock
            let syncHandler = null;
            if (isLiteGraph) {
                const syncPos = () => {
                    if (!assistant.streamingOverlay || !assistant.streamingOverlay.container) return;
                    this._syncLiteGraphPosition(assistant, container);
                    syncHandler = requestAnimationFrame(syncPos);
                };
                syncHandler = requestAnimationFrame(syncPos);
            }

            // Trigger entrance animation
            requestAnimationFrame(() => {
                container.classList.add('show');
            });

            return { container, content, isLiteGraph, syncHandler };
        } catch (error) {
            logger.error(`Failed to create streaming display container: ${error.message}`);
            return null;
        }
    }

    /**
     * Position and geometry sync in LiteGraph mode (Viewport absolute positioning)
     */
    _syncLiteGraphPosition(assistant, container) {
        const node = assistant.node;
        if (!node || !app.canvas) return;

        const ds = app.canvas.ds;
        const pos = node.pos;
        const size = node.size;
        const scale = ds?.scale || 1;

        // 1. Get screen coordinates of node's top-left corner
        let screenX, screenY;
        if (ds && typeof ds.canvas_to_screen === 'function') {
            const screenPos = ds.canvas_to_screen(pos[0], pos[1]);
            screenX = screenPos[0];
            screenY = screenPos[1];
        } else {
            screenX = (pos[0] + (ds?.offset?.[0] || 0)) * scale;
            screenY = (pos[1] + (ds?.offset?.[1] || 0)) * scale;
        }

        // 2. Sync geometry: convert node's logical width/height to screen physical pixels
        // Key point: container width/height must sync with scale to prevent text from "overflowing" node physical boundary
        const physicalWidth = size[0] * scale;
        const physicalHeight = 100 * scale; // Logical height 100px converted to physical pixels

        // 3. Calculate alignment position
        // Bottom toolbar height logic value is 35px, converted to 35 * scale
        const bottomOffset = 35 * scale;
        const top = screenY + (size[1] * scale) - bottomOffset - physicalHeight;

        // 4. Apply styles to sync container
        container.style.width = `${physicalWidth - 16 * scale}px`; // subtract edge margins
        container.style.height = `${physicalHeight}px`;
        container.style.left = `${screenX + 8 * scale}px`;
        container.style.top = `${top}px`;

        // 5. Sync content scale: ensure font size changes with node size
        // Note: we affect content by changing container's fontSize.
        // Content container uses relative units or inherits from parent.
        const content = container.querySelector('.node-streaming-text-content');
        if (content) {
            content.style.fontSize = `${10 * scale}px`;
            content.style.lineHeight = `${1.6}`;
        }
    }

    /**
     * Remove streaming overlay container
     */
    _removeStreamingOverlay(assistant, overlayObj) {
        if (!overlayObj || !overlayObj.container) return;
        const { container, syncHandler } = overlayObj;

        // Stop sync loop
        if (syncHandler) {
            cancelAnimationFrame(syncHandler);
        }

        try {
            container.classList.remove('show');
            setTimeout(() => {
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }, 300);
        } catch (error) {
            logger.error(`Failed to remove streaming container: ${error.message}`);
            if (container.parentNode) container.parentNode.removeChild(container);
        }
    }

    /**
     * Handle image analysis
     */
    async handleImageAnalysis(assistant, lang) {
        // Store current request ID for cancellation
        let currentRequestId = null;

        try {
            const node = assistant.node;

            // Vue Node 2.0 mode: get currently displayed image from DOM
            // Traditional LiteGraph mode: use node.imgs property
            let currentImage = null;
            const isVueMode = nodeMountService.isVueNodesMode();

            if (isVueMode) {
                // Vue Node 2.0 mode: get image from node container DOM
                const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);
                if (nodeContainer) {
                    // Find img element in node container (prefer preview image)
                    const imgElement = nodeContainer.querySelector('img');
                    if (imgElement && imgElement.src) {
                        // Use image src from DOM
                        currentImage = imgElement.src;
                        logger.debug(`[imageassistant-Vue mode] Getting image from DOM | Node ID: ${node.id}`);
                    }
                }
            }

            // If Vue mode didn't find image, or traditional mode, use node.imgs
            if (!currentImage) {
                if (!node.imgs || node.imgs.length === 0) {
                    throw new Error('No valid image found');
                }
                currentImage = node.imgs[node.imageIndex || 0];
                if (!currentImage) {
                    throw new Error('No valid image found');
                }
            }

            // Get button element
            const buttonId = lang === 'en' ? 'caption_en' : 'caption_zh';
            const buttonElement = assistant.buttons[buttonId];
            if (!buttonElement) {
                throw new Error('Button element not found');
            }

            // Check if button is already processing, if so cancel current request
            if (buttonElement.classList.contains('button-processing') && assistant.currentRequestId) {
                // Cancel current request
                await APIService.cancelRequest(assistant.currentRequestId);

                // Show cancel notification
                UIToolkit.showStatusTip(
                    buttonElement,
                    'info',
                    'Caption cancelled',
                    { x: buttonElement.getBoundingClientRect().left + buttonElement.offsetWidth / 2, y: buttonElement.getBoundingClientRect().top }
                );

                // Reset button state
                this._setButtonState(assistant, buttonId, 'processing', false);

                // Restore other button states
                Object.keys(assistant.buttons).forEach(id => {
                    if (id !== buttonId) {
                        this._setButtonState(assistant, id, 'disabled', false);
                    }
                });

                // Update assistant state to inactive
                this._updateAssistantActiveState(assistant, false);

                // Clear current request ID
                assistant.currentRequestId = null;

                return;
            }

            // Set current button to processing state
            this._setButtonState(assistant, buttonId, 'processing', true);

            // Disable other buttons
            Object.keys(assistant.buttons).forEach(id => {
                if (id !== buttonId) {
                    this._setButtonState(assistant, id, 'disabled', true);
                }
            });

            // Update assistant state to active
            this._updateAssistantActiveState(assistant, true);

            // Show loading status tip
            const tipMessage = lang === 'en' ? "Captioning... (English)" : "Captioning... (Chinese)";
            UIToolkit.showStatusTip(
                buttonElement,
                'loading',
                tipMessage,
                { x: buttonElement.getBoundingClientRect().left + buttonElement.offsetWidth / 2, y: buttonElement.getBoundingClientRect().top }
            );

            // Generate request ID
            currentRequestId = APIService.generateRequestId('icap', null, node.id);
            // Save to assistant object for cancel operation
            assistant.currentRequestId = currentRequestId;

            // Convert image to Base64
            let imageBase64;
            try {
                imageBase64 = await APIService.imageToBase64(currentImage);
                if (!imageBase64) {
                    throw new Error('Image conversion failed');
                }
            } catch (e) {
                throw new Error(`Image conversion failed: ${e.message || e}`);
            }

            // Ensure image data format is correct
            if (typeof imageBase64 !== 'string') {
                throw new Error(`Image data type error: ${typeof imageBase64}`);
            }

            // Ensure image data is in Base64 format
            if (!imageBase64.startsWith('data:image')) {
                imageBase64 = `data:image/jpeg;base64,${imageBase64}`;
            }

            // Get currently active prompt content
            let promptContent = '';
            try {
                const response = await fetch(APIService.getApiUrl('/config/system_prompts'));
                if (response.ok) {
                    const data = await response.json();
                    const activePromptKey = `vision_${lang}`;
                    const activePromptId = data.active_prompts?.[activePromptKey];
                    if (activePromptId && data.vision_prompts?.[activePromptId]) {
                        promptContent = data.vision_prompts[activePromptId].content;
                    }
                }
                if (!promptContent) {
                    throw new Error(`No valid ${lang === 'zh' ? 'Chinese' : 'English'} caption prompt found`);
                }
            } catch (error) {
                throw new Error(`Failed to get caption rules: ${error.message}`);
            }

            // Choose streaming or blocking API based on switch
            let result;
            let fullContent = '';

            if (FEATURES.enableStreaming !== false) {
                // Create embedded streaming object
                const overlayObj = this._createStreamingOverlay(assistant);
                if (!overlayObj) {
                    logger.error("[imageassistant] Cannot create embedded streaming display object");
                    return;
                }
                assistant.streamingOverlay = overlayObj;
                // Use streaming API for image analysis
                result = await APIService.llmAnalyzeImageStream(
                    imageBase64,
                    promptContent,
                    currentRequestId,
                    (chunk) => {
                        // Streaming callback: real-time update of overlay content
                        fullContent += chunk;
                        if (assistant.streamingOverlay && assistant.streamingOverlay.content) {
                            const contentEl = assistant.streamingOverlay.content;

                            // Update text content
                            contentEl.textContent = fullContent;

                            // Scroll container (keep at bottom)
                            const container = assistant.streamingOverlay.container;
                            container.scrollTop = container.scrollHeight;
                        }
                    }
                );

                // Ensure streamed content is assigned to result object on completion
                if (result && result.success && fullContent) {
                    if (!result.data) result.data = {};
                    result.data.description = fullContent;
                }
            } else {
                // ---Blocking output: call image analysis service directly---
                result = await APIService.llmAnalyzeImage(
                    imageBase64,
                    promptContent,
                    currentRequestId
                );
            }

            // Remove streaming overlay container
            if (assistant.streamingOverlay) {
                this._removeStreamingOverlay(assistant, assistant.streamingOverlay);
                assistant.streamingOverlay = null;
            }

            // Clear current request ID
            assistant.currentRequestId = null;

            // Check if cancelled
            if (result && result.cancelled) {
                logger.debug(`Image analysis request cancelled | ID: ${currentRequestId}`);
                return;
            }

            if (!result || !result.success) {
                const errorMsg = result?.error || 'Unknown error';
                throw new Error(errorMsg);
            }

            // Get description text (prefer stream-collected content)
            const description = fullContent || result.data?.description;
            if (!description) {
                throw new Error('No image description obtained');
            }

            // Attempt to copy to clipboard
            let copySuccess = false;
            try {
                // Prefer modern Clipboard API
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(description);
                    copySuccess = true;
                } else {
                    // Create a temporary textarea element
                    const textarea = document.createElement('textarea');
                    textarea.value = description;
                    textarea.style.position = 'fixed';
                    textarea.style.left = '0';
                    textarea.style.top = '0';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);

                    // Try to focus and select text
                    textarea.focus();
                    textarea.select();
                    textarea.setSelectionRange(0, textarea.value.length);

                    // Try to copy
                    try {
                        copySuccess = document.execCommand('copy');
                    } catch (err) {
                        logger.warn(`execCommand copy failed: ${err.message}`);
                    }

                    // Remove temporary element
                    document.body.removeChild(textarea);
                }

                if (!copySuccess) {
                    throw new Error('Copy to clipboard operation failed');
                }
            } catch (copyError) {
                logger.warn(`Copy to clipboard failed: ${copyError.message}`);
                // Continue even if copy fails, don't throw error, but log state
                copySuccess = false;
            }

            // Create history record for current image node
            HistoryCacheService.addHistory({
                node_id: node.id,
                input_id: "image",
                content: description,
                operation_type: 'caption',
                timestamp: Date.now(),
                request_id: currentRequestId
            });

            // Show success notification
            const successMessage = copySuccess
                ? (lang === 'en' ? "Caption completed, copied to clipboard" : "Caption completed, copied to clipboard")
                : (lang === 'en' ? "Caption completed, but copy failed" : "Caption completed, but copy failed");

            UIToolkit.showStatusTip(
                buttonElement,
                copySuccess ? 'success' : 'warning',
                successMessage,
                { x: buttonElement.getBoundingClientRect().left + buttonElement.offsetWidth / 2, y: buttonElement.getBoundingClientRect().top }
            );

            // Limit toast display text length
            const maxLength = 40;
            const truncatedDescription = description.length > maxLength
                ? description.substring(0, maxLength) + '...'
                : description;

            // Show toast tip
            app.extensionManager.toast.add({
                severity: copySuccess ? "success" : "info",
                summary: copySuccess
                    ? (lang === 'en' ? "Image caption complete (English), please use ctrl+v to paste" : "Image caption complete (Chinese), please use ctrl+v to paste")
                    : (lang === 'en' ? "Image caption complete (English), but copy failed, please copy manually" : "Image caption complete (Chinese), but copy failed, please copy manually"),
                detail: truncatedDescription,
                life: 5000
            });

            // If copy failed, create a dialog to show result allowing manual copy
            if (!copySuccess) {
                this._showCopyDialog(description, lang);
            }

        } catch (error) {
            // Clear current request ID
            assistant.currentRequestId = null;

            logger.error(`Image analysis failed: ${error.message}`);

            // Get button element
            const buttonId = lang === 'en' ? 'caption_en' : 'caption_zh';
            const buttonElement = assistant.buttons[buttonId];

            if (buttonElement) {
                // Show error message
                UIToolkit.showStatusTip(
                    buttonElement,
                    'error',
                    error.message,
                    { x: buttonElement.getBoundingClientRect().left + buttonElement.offsetWidth / 2, y: buttonElement.getBoundingClientRect().top }
                );
            };

            app.extensionManager.toast.add({
                severity: "error",
                summary: lang === 'en' ? "Error" : "Error",
                detail: error.message,
                life: 3000
            });
        } finally {
            // Get button ID
            const buttonId = lang === 'en' ? 'caption_en' : 'caption_zh';

            // Reset current button state
            this._setButtonState(assistant, buttonId, 'processing', false);

            // Restore other button states
            Object.keys(assistant.buttons).forEach(id => {
                if (id !== buttonId) {
                    this._setButtonState(assistant, id, 'disabled', false);
                }
            });

            // Update assistant state to inactive
            this._updateAssistantActiveState(assistant, false);
        }
    }

    /**
     * Show copy dialog
     * When clipboard API fails, provide a dialog for user to manually copy content
     */
    _showCopyDialog(content, lang) {
        // Create dialog container
        const dialogContainer = document.createElement('div');
        dialogContainer.className = 'image-assistant-copy-dialog';

        // Create title
        const title = document.createElement('div');
        title.className = 'image-assistant-copy-dialog-title';
        title.textContent = 'Due to clipboard permission restrictions, please manually copy the caption content';
        dialogContainer.appendChild(title);

        // Create close button
        const closeButton = document.createElement('button');
        closeButton.className = 'image-assistant-copy-dialog-close';
        closeButton.onclick = () => {
            document.body.removeChild(dialogContainer);
        };

        // Add close icon
        UIToolkit.addIconToButton(closeButton, 'pi-times', 'Close');
        dialogContainer.appendChild(closeButton);

        // Create textarea
        const contentArea = document.createElement('textarea');
        contentArea.className = 'image-assistant-copy-dialog-textarea';
        contentArea.value = content;
        contentArea.readOnly = true;
        dialogContainer.appendChild(contentArea);

        // Create copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'image-assistant-copy-dialog-copy-btn';
        copyButton.textContent = 'Copy to clipboard';
        copyButton.onclick = () => {
            contentArea.select();
            try {
                const success = document.execCommand('copy');
                if (success) {
                    copyButton.textContent = 'Copied!';
                    // After copy success, close popup after 500ms delay so user sees success message
                    setTimeout(() => {
                        if (document.body.contains(dialogContainer)) {
                            document.body.removeChild(dialogContainer);
                        }
                    }, 500);
                } else {
                    copyButton.textContent = 'Copy failed, please select and copy manually';
                    contentArea.focus();
                }
            } catch (err) {
                copyButton.textContent = 'Copy failed, please select and copy manually';
                contentArea.focus();
            }
        };
        dialogContainer.appendChild(copyButton);

        // Add to document
        document.body.appendChild(dialogContainer);

        // Focus content area so user can copy immediately
        setTimeout(() => {
            contentArea.focus();
            contentArea.select();
        }, 100);
    }

    /**
     * Set button status
     */
    _setButtonState(assistant, buttonId, stateType, value = true) {
        try {
            const button = assistant.buttons[buttonId];
            if (!button) return;

            const stateClass = `button-${stateType}`;

            if (value) {
                button.classList.add(stateClass);
                // If disabled state, add disabled attribute
                if (stateType === 'disabled') {
                    button.setAttribute('disabled', 'disabled');
                }
            } else {
                button.classList.remove(stateClass);
                // If cancel disabled state, remove disabled attribute
                if (stateType === 'disabled') {
                    button.removeAttribute('disabled');
                }
            }

            // Update button clickability state
            this._updateButtonClickability(button, stateType, value);

        } catch (error) {
            logger.error(`Button state | Setting failed | button:${buttonId} | state:${stateType} | error:${error.message}`);
        }
    }

    /**
     * Update button clickability state
     */
    _updateButtonClickability(button, stateType, value) {
        // Check if button is disabled
        const isDisabled = button.classList.contains('button-disabled');

        // Processing buttons are still clickable (for cancellation)
        const isProcessing = button.classList.contains('button-processing');

        if (isDisabled) {
            // If button is disabled, prevent click events
            button.style.pointerEvents = 'none';
        } else {
            // Restore click events, including processing buttons
            button.style.pointerEvents = 'auto';
        }
    }

    /**
     * Check if assistant has active buttons
     */
    _checkAssistantActiveState(assistant) {
        if (!assistant || !assistant.buttons) return false;

        // 0. Check if popup is transitioning (no collapse during transition)
        if (PopupManager._isTransitioning) {

            return true;
        }

        // 1. Check if context menu is visible (and belongs to current assistant)
        if (buttonMenu.isMenuVisible && buttonMenu.menuContext?.widget === assistant) {

            return true;
        }

        // 2. Check if PopupManager's active popup belongs to current assistant
        if (PopupManager.activePopupInfo?.buttonInfo?.widget === assistant) {

            return true;
        }

        // 3. Check button active/processing state
        for (const buttonId in assistant.buttons) {
            const button = assistant.buttons[buttonId];
            if (button.classList.contains('button-active') ||
                button.classList.contains('button-processing')) {

                return true;
            }
        }

        return false;
    }

    /**
     * Update assistant active state
     */
    _updateAssistantActiveState(assistant, isActive) {
        if (!assistant) return;

        // Update active state
        assistant.isActive = isActive;

        // If active, force show assistant
        if (isActive) {
            this.showAssistantUI(assistant);
        } else {
            // If no longer active, update visibility first
            this.updateAssistantVisibility(assistant);

            // Then manually trigger auto-collapse (if assistant is still visible and expanded)
            if (assistant.element &&
                assistant.element.style.display !== 'none' &&
                !assistant.isCollapsed &&
                !assistant.isTransitioning) {
                // Delay before triggering collapse to give user time to see results
                setTimeout(() => {
                    this.triggerAutoCollapse(assistant);
                }, 1500); // Auto-collapse after 1.5 seconds, giving user enough time to see results
            }
        }
    }

    /**
     * Show assistant UI 
     */
    showAssistantUI(assistant) {
        if (!assistant?.element) return;

        // Avoid duplicate display
        if (assistant.element.classList.contains('image-assistant-show')) {
            // Ensure element visible
            assistant.element.style.display = 'flex';
            assistant.element.style.opacity = '1';
            return;
        }

        // Display directly, no animation transition
        assistant.element.style.opacity = '1';
        assistant.element.style.display = 'flex';
        assistant.element.classList.add('image-assistant-show');

        // Ensure hover area is visible (for collapsed interaction)
        if (assistant.isCollapsed && assistant.hoverArea) {
            assistant.hoverArea.style.display = 'block';
        }

        // Reset transition state
        assistant.isTransitioning = false;

        // Only trigger auto-collapse when explicitly not collapsed
        if (!assistant.isCollapsed) {
            this.triggerAutoCollapse(assistant);
        }
    }

    /**
     * Hide assistant UI
     */
    hideAssistantUI(assistant) {
        if (!assistant?.element) return;

        // Clear auto-collapse timer
        if (assistant._autoCollapseTimer) {
            clearTimeout(assistant._autoCollapseTimer);
            assistant._autoCollapseTimer = null;
        }

        // Hide element
        assistant.element.style.display = 'none';
        assistant.element.classList.remove('image-assistant-show');

        // Reset state
        assistant.isTransitioning = false;
    }

    /**
     * Update assistant visibility
     */
    updateAssistantVisibility(assistant) {
        // Check if instance is destroyed
        if (!assistant || assistant.isDestroyed) return;

        // Dynamically get node
        const node = assistant.node;

        // Record current display state for change detection
        const wasVisible = assistant.element &&
            assistant.element.style.display !== 'none' &&
            assistant.element.classList.contains('image-assistant-show');

        // Check master switch and image caption feature state
        if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
            this.cleanup(assistant.nodeId);
            return;
        }

        // Check if node has been deleted
        if (!node) {
            this.cleanup(assistant.nodeId);
            return;
        }

        // Check if node has been deleted
        if (!node) {
            this.cleanup(assistant.nodeId);
            return;
        }

        // --- Fix: LiteGraph subgraph "ghost" icon issue ---
        // Check if node's graph is the currently active graph
        // If currently in subgraph but node is in parent graph, hide it
        // Note: app.canvas.graph is the currently visible graph
        if (app.canvas && app.canvas.graph && node.graph && node.graph !== app.canvas.graph) {
            // Node is not in the currently displayed graph, force hide
            // logger.debugSample(() => `[imageassistant] Node not in current view, force hide | ID: ${assistant.nodeId}`);
            this.hideAssistantUI(assistant);
            return;
        }

        // Use unified state detection method
        const nodeState = this._checkNodeAndCanvasState(assistant.node);

        // Check if any button is active
        const hasActiveButtons = this._checkAssistantActiveState(assistant);

        // Determine new visibility state
        let shouldBeVisible = true;

        // If active buttons, force show assistant (overrides other hide conditions)
        if (hasActiveButtons) {
            this.showAssistantUI(assistant);

            // If currently collapsed, expand
            if (assistant.isCollapsed) {
                this._expandAssistant(assistant);
            }

            return;
        }

        // If node collapsed or canvas zoomed out, hide assistant but don't clean up instance
        if (nodeState.isCollapsed || nodeState.isLowQuality) {
            shouldBeVisible = false;
        }

        // If node has no valid image, hide assistant but don't clean up instance
        if (!nodeState.hasValidImage) {
            shouldBeVisible = false;

            // ---Async image detection logic (for performance optimization)---
            // If node is supported type but has no image yet, start a lightweight internal detector
            if (!assistant._imageDetectionTimer) {
                const detectImage = () => {
                    // Check if instance has been cleaned up or node is no longer in graph
                    if (assistant.isDestroyed || !assistant.node) {
                        assistant._imageDetectionTimer = null;
                        return;
                    }

                    const currentState = this._checkNodeAndCanvasState(assistant.node);
                    if (currentState.hasValidImage) {
                        logger.debug(() => `[imageassistant] Async image load successful | ID: ${assistant.nodeId}`);
                        assistant._imageDetectionTimer = null;

                        // Extra check: if element is lost (possible Vue re-render), reinitialize
                        const isVueMode = nodeMountService.isVueNodesMode();
                        const nodeContainer = isVueMode ? document.querySelector(`[data-node-id="${assistant.nodeId}"]`) : null;
                        const isElementPresent = isVueMode ? nodeContainer?.contains(assistant.element) : document.body.contains(assistant.element);

                        if (!assistant.element || !isElementPresent) {
                            this.checkAndSetupNode(assistant.node);
                        } else {
                            this.updateAssistantVisibility(assistant);
                        }
                    } else {
                        // Continue waiting, check once per second (very low overhead)
                        assistant._imageDetectionTimer = setTimeout(detectImage, 1000);
                    }
                };
                assistant._imageDetectionTimer = setTimeout(detectImage, 1000);
            }
        } else {
            // Image found, clean up detection timer
            if (assistant._imageDetectionTimer) {
                clearTimeout(assistant._imageDetectionTimer);
                assistant._imageDetectionTimer = null;
            }
        }

        // Skip transitioning instances to avoid animation interrupts
        if (assistant.isTransitioning) {
            return;
        }

        // Update UI based on visibility state
        if (shouldBeVisible) {
            // Show assistant when conditions are met
            this.showAssistantUI(assistant);
        } else {
            // Hide assistant
            this.hideAssistantUI(assistant);
        }
    }

    /**
     * Expand assistant
     */

    _expandAssistant(assistant) {
        if (assistant && assistant.container) {
            assistant.container.expand();
        }
    }


    /**
     * Trigger auto-collapse
     */

    triggerAutoCollapse(assistant) {
        if (assistant && assistant.container) {
            assistant.container.collapse();
        }
    }




    /**
     * Add button with icon
     */
    addButtonWithIcon(assistant, config) {
        if (!assistant?.element || !assistant?.innerContent) return null;

        const { id, title, icon, onClick, contextMenu } = config;

        // Create button
        const button = document.createElement('button');
        button.className = 'image-assistant-button';
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

                // Even if button is processing, allow click for cancellation
                if (button.classList.contains('button-disabled')) {
                    return;
                }

                // Execute click callback
                onClick(e, assistant);
            });
        }

        // Add context menu (if any)
        if (contextMenu && typeof contextMenu === 'function') {
            this._setupButtonContextMenu(button, contextMenu, assistant);
        }

        // Save reference
        if (id) {
            assistant.buttons[id] = button;
        }

        return button;
    }

    /**
     * Set up UI position
     * Supports both Vue node2.0 and litegraph.js rendering modes
     */
    _setupUIPosition(assistant) {
        if (!assistant?.element || !assistant?.node) return;

        const containerDiv = assistant.element;
        const renderMode = nodeMountService.detectRenderMode();

        // Save render mode to assistant
        assistant._renderMode = renderMode;

        if (renderMode === RENDER_MODE.VUE_NODES) {
            // Vue node2.0 mode: mount with relative positioning inside node container
            this._setupUIPositionVueNodes(assistant, containerDiv);
        } else {
            // litegraph.js mode: use fixed positioning with canvas coordinate calculation
            this._setupUIPositionLitegraph(assistant, containerDiv);
        }
    }

    /**
     * Positioning logic for Vue node2.0 mode
     */
    _setupUIPositionVueNodes(assistant, containerDiv) {
        const containerInfo = nodeMountService.findImageNodeContainer(assistant.node);

        if (!containerInfo || !containerInfo.container) {
            logger.warn(`[imageassistant-Vue positioning] Node container not found | ID: ${assistant.node.id}`);
            // Fallback to litegraph mode
            this._setupUIPositionLitegraph(assistant, containerDiv);
            return;
        }

        const { container: nodeContainer } = containerInfo;

        // Vue mode: use absolute positioning, mount inside node container (right-aligned, no need to shift up for left-side ID)
        containerDiv.style.position = 'absolute';
        containerDiv.style.right = '6px';
        containerDiv.style.bottom = '6px';
        containerDiv.style.left = 'auto';
        containerDiv.style.top = 'auto';
        containerDiv.style.zIndex = '10';

        // Remove fixed positioning styles
        containerDiv.style.transform = 'none';

        // Add Vue mode marker class
        containerDiv.classList.add('vue-node-mode');

        // Remove from document.body (if previously mounted)
        if (containerDiv.parentElement === document.body) {
            document.body.removeChild(containerDiv);
        }

        // Mount to node container
        nodeContainer.appendChild(containerDiv);

        // Add cleanup function
        assistant._eventCleanupFunctions = assistant._eventCleanupFunctions || [];
        assistant._eventCleanupFunctions.push(() => {
            if (containerDiv && containerDiv.parentElement) {
                containerDiv.parentElement.removeChild(containerDiv);
            }
        });

        logger.debug(`[imageassistant-Vue positioning] Complete | Node ID: ${assistant.node.id}`);
    }

    /**
     * Positioning logic for litegraph.js mode (original logic)
     */
    _setupUIPositionLitegraph(assistant, containerDiv) {
        // Position update function
        const updatePosition = () => {
            if (!assistant.element || !assistant.node) return;

            try {
                const canvas = app.canvas;
                // If canvas not initialized, retry after delay
                if (!canvas) {
                    requestAnimationFrame(() => updatePosition());
                    return;
                }

                // Get canvas zoom scale
                const scale = canvas.ds.scale;

                // Get node bounds
                const [nodeX, nodeY, nodeWidth, nodeHeight] = assistant.node.getBounding();

                // Calculate internal offset (for placing assistant inside node)
                const INNER_OFFSET_X = 6; // Horizontal offset
                const INNER_OFFSET_Y = 6; // Vertical offset

                // Calculate anchor point position (node bottom-left)
                const anchorX = nodeX + INNER_OFFSET_X;
                const anchorY = nodeY + nodeHeight - INNER_OFFSET_Y;

                // Get canvas element bounds
                const rect = canvas.canvas.getBoundingClientRect();

                // Convert anchor point to screen coordinates
                const canvasPoint = canvas.convertOffsetToCanvas([anchorX, anchorY]);

                if (!canvasPoint) return;

                // Calculate final screen coordinates (considering canvas element position)
                const screenX = canvasPoint[0] + rect.left;
                const screenY = canvasPoint[1] + rect.top;

                // Set container position so bottom-left aligns with anchor point
                containerDiv.style.left = `${screenX}px`;
                containerDiv.style.bottom = `${window.innerHeight - screenY}px`;
                containerDiv.style.right = 'auto';
                containerDiv.style.top = 'auto';

                // Apply zoom scale
                containerDiv.style.setProperty('--assistant-scale', scale);

            } catch (error) {
                // Only log on first error
                if (!assistant._lastPositionError) {
                    logger.error(() => `Update assistant position failed: ${error.message}`);
                    assistant._lastPositionError = Date.now();
                }
            }
        };

        // Initial position update
        updatePosition();

        // Use debounce function to optimize position updates
        const debouncedUpdatePosition = EventManager.debounce(updatePosition, 16);

        // Add window resize event listener
        assistant._eventCleanupFunctions = assistant._eventCleanupFunctions || [];
        const removeResizeListener = EventManager.addDOMListener(window, 'resize', debouncedUpdatePosition);
        assistant._eventCleanupFunctions.push(removeResizeListener);

        // Listen for canvas changes
        if (app.canvas) {
            // Listen for canvas redraws
            // Optimization: use requestAnimationFrame for per-frame position update, or use LiteGraph's render loop directly
            // For smooth following, update directly in drawBackground hook
            const originalDrawBackground = app.canvas.onDrawBackground;
            const onDrawWrapper = function () {
                const ret = originalDrawBackground?.apply(this, arguments);
                updatePosition();
                return ret;
            };
            app.canvas.onDrawBackground = onDrawWrapper;

            // Add canvas redraw cleanup function
            assistant._eventCleanupFunctions.push(() => {
                if (app.canvas.onDrawBackground === onDrawWrapper) {
                    app.canvas.onDrawBackground = originalDrawBackground;
                }
            });

            // Listen for node movement
            if (assistant.node) {
                // Use LiteGraph's onNodeMoved event
                const originalOnNodeMoved = app.canvas.onNodeMoved;
                app.canvas.onNodeMoved = function (node_dragged) {
                    if (originalOnNodeMoved) {
                        originalOnNodeMoved.apply(this, arguments);
                    }

                    // Only update position when moving the current node
                    if (node_dragged && node_dragged.id === assistant.node.id) {
                        updatePosition();
                    }
                };

                // Add node move cleanup function
                assistant._eventCleanupFunctions.push(() => {
                    if (app.canvas) {
                        app.canvas.onNodeMoved = originalOnNodeMoved;
                    }
                });

                // Add move listener to node itself (compatibility)
                const nodeOriginalOnNodeMoved = assistant.node.onNodeMoved;
                assistant.node.onNodeMoved = function () {
                    const ret = nodeOriginalOnNodeMoved?.apply(this, arguments);
                    updatePosition();
                    return ret;
                };

                // Add node self-move cleanup function
                assistant._eventCleanupFunctions.push(() => {
                    if (assistant.node && nodeOriginalOnNodeMoved) {
                        assistant.node.onNodeMoved = nodeOriginalOnNodeMoved;
                    }
                });
            }

            // Listen for canvas zoom
            const originalDSModified = app.canvas.ds.onModified;
            app.canvas.ds.onModified = function (...args) {
                if (originalDSModified) {
                    originalDSModified.apply(this, args);
                }
                // Update directly on zoom
                updatePosition();
            };

            // Add canvas zoom cleanup function
            assistant._eventCleanupFunctions.push(() => {
                if (app.canvas?.ds) {
                    app.canvas.ds.onModified = originalDSModified;
                }
            });
        }

        // Add DOM element cleanup function
        assistant._eventCleanupFunctions.push(() => {
            if (containerDiv && document.body.contains(containerDiv)) {
                document.body.removeChild(containerDiv);
            }
        });
    }

    /**
     * Set up node collapse state listener
     */
    _setupNodeCollapseListener(assistant) {
        if (!assistant?.node) return;

        const node = assistant.node;

        // Save original collapse method
        const originalCollapse = node.collapse;

        // Override collapse method
        node.collapse = function () {
            // Call original collapse method
            originalCollapse.apply(this, arguments);

            // Call unified visibility update method instead of directly manipulating DOM
            const imageCaptionInstance = window.imageCaptionInstance || imageCaption;
            if (imageCaptionInstance && typeof imageCaptionInstance.updateAssistantVisibility === 'function') {
                imageCaptionInstance.updateAssistantVisibility(assistant);
            }
        };

        // Save cleanup function
        assistant._eventCleanupFunctions.push(() => {
            // Restore original collapse method
            if (node.collapse !== originalCollapse) {
                node.collapse = originalCollapse;
            }
        });
    }

    /**
     * Set up canvas zoom listener
     */
    _setupCanvasScaleListener(assistant) {
        if (!assistant?.node || !app.canvas) return;

        let lastScale = app.canvas.ds.scale;

        // Use class method to get threshold for consistency
        const threshold = this._getQualityThreshold();

        // Directly detect zoom state and update UI visibility
        const checkScaleAndUpdate = () => {
            if (!assistant.element || !assistant.node || !app.canvas) return;

            const currentScale = app.canvas.ds.scale;
            const threshold = imageCaption._getQualityThreshold(); // Fix: use global instance method
            const epsilon = 0.001; // Increase tolerance

            // Calculate difference from last zoom
            const scaleDiff = Math.abs(currentScale - lastScale);

            // Update last zoom value
            lastScale = currentScale;

            // Determine current quality state (with epsilon)
            const isCurrentlyLowQuality = currentScale <= threshold + epsilon;

            // Unconditionally update UI visibility, let _checkNodeAndCanvasState decide
            this.updateAssistantVisibility(assistant);
        };

        // Ensure immediate response
        const immediateUpdate = checkScaleAndUpdate;

        // Listen for canvas mouse wheel events (zoom)
        const wheelHandler = (e) => {
            if (e.ctrlKey || e.metaKey) {
                // Update immediately and schedule delayed check
                immediateUpdate();
                setTimeout(immediateUpdate, 50);
            }
        };

        // Listen for canvas touch events (mobile zoom)
        const touchHandler = (e) => {
            if (e.touches && e.touches.length === 2) {
                // Update immediately and schedule delayed check
                immediateUpdate();
                setTimeout(immediateUpdate, 50);
            }
        };

        // Add event listener
        const canvas = app.canvas.canvas;
        if (canvas) {
            canvas.addEventListener('wheel', wheelHandler, { passive: true });
            canvas.addEventListener('touchmove', touchHandler, { passive: true });
        }

        // Periodically check zoom changes
        const scaleCheckInterval = setInterval(immediateUpdate, 50);

        // Initial check of current state
        immediateUpdate();

        // Save cleanup function
        assistant._eventCleanupFunctions.push(() => {
            if (canvas) {
                canvas.removeEventListener('wheel', wheelHandler);
                canvas.removeEventListener('touchmove', touchHandler);
            }
            clearInterval(scaleCheckInterval);
        });

        // Listen for canvas zoom events (directly monitor ds.scale changes)
        const originalDSScale = Object.getOwnPropertyDescriptor(app.canvas.ds, 'scale');
        if (originalDSScale && originalDSScale.set) {
            const originalSetter = originalDSScale.set;

            Object.defineProperty(app.canvas.ds, 'scale', {
                get: originalDSScale.get,
                set: function (value) {
                    // Get old value
                    const oldValue = this.scale;
                    const threshold = imageCaption._getQualityThreshold();

                    // Call original setter
                    originalSetter.call(this, value);

                    // Detect if threshold boundary was crossed
                    const epsilon = 0.001;
                    const crossedThreshold =
                        (oldValue <= threshold + epsilon && value > threshold + epsilon) ||
                        (oldValue > threshold + epsilon && value <= threshold + epsilon);

                    if (crossedThreshold) {
                        // If threshold crossed, only log once
                        // Use static variable to record last threshold crossing time to avoid repeated output
                        const now = Date.now();
                        if (!ImageCaption._lastThresholdCrossTime || now - ImageCaption._lastThresholdCrossTime > 500) {
                            logger.log(`[imageassistant-zoomlistener] Crossed threshold | Old value: ${oldValue.toFixed(4)} | New value: ${value.toFixed(4)} | Threshold: ${threshold}`);
                            ImageCaption._lastThresholdCrossTime = now;
                        }
                    }

                    // Update immediately regardless of threshold crossing
                    immediateUpdate();

                    // Multiple checks to ensure state is applied correctly
                    setTimeout(immediateUpdate, 10);
                    setTimeout(immediateUpdate, 50);
                    setTimeout(() => {
                        // Update all existing image assistant instances
                        ImageCaption.instances.forEach((instance) => {
                            if (instance && instance.node) {
                                imageCaption.updateAssistantVisibility(instance);
                            }
                        });
                    }, 100);
                },
                configurable: true
            });

            // Add cleanup function
            assistant._eventCleanupFunctions.push(() => {
                if (app.canvas && app.canvas.ds) {
                    Object.defineProperty(app.canvas.ds, 'scale', originalDSScale);
                }
            });
        }
    }

    /**
     * Set up expand/collapse events
     */
    _setupCollapseExpandEvents(assistant) {
        // Event handling is delegated to AssistantContainer
    }



    /**
     * Set up button context menu
     * @param {HTMLElement} button Button element
     * @param {Function} getMenuItems Function to get menu items
     * @param {Object} assistant Assistant instance
     */
    _setupButtonContextMenu(button, getMenuItems, assistant) {
        if (!button || typeof getMenuItems !== 'function') return;

        // Ensure assistant has correct type identifier for context menu closing recognition
        assistant.type = 'image_caption_assistant';

        const cleanup = buttonMenu.setupButtonMenu(button, () => {
            return getMenuItems(assistant);
        }, { widget: assistant, buttonElement: button }); // Pass correct context

        if (cleanup) {
            assistant._eventCleanupFunctions = assistant._eventCleanupFunctions || [];
            assistant._eventCleanupFunctions.push(cleanup);
        }
    }

    // --- Static methods ---
    /**
     * Add instance to manager
     */
    static addInstance(nodeId, assistant) {
        if (nodeId != null && assistant != null) {
            this.instances.set(String(nodeId), assistant);
            return true;
        }
        return false;
    }

    /**
     * Get instance
     */
    static getInstance(nodeId) {
        if (nodeId == null) return null;

        // Ensure nodeId is string type
        const key = String(nodeId);
        const instance = this.instances.get(key);


        return instance;
    }

    /**
     * Check if instance exists
     */
    static hasInstance(nodeId) {
        if (nodeId == null) return false;
        // Ensure nodeId is string type
        return this.instances.has(String(nodeId));
    }

    /**
     * Clean up assistant instances
     * @param {string|null} nodeId - Node ID, if null clean up all instances
     * @param {boolean} silent - Whether to clean silently (no logging)
     */
    cleanup(nodeId = null, silent = false) {
        // If switching workflows, fully clean up image assistant instances
        if (window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING) {
            // Simplify logs: don't print individual cleanup logs during workflow switch

            if (nodeId === null) {
                // Clean all instances and remove from collection
                const instanceCount = ImageCaption.instances.size;
                if (instanceCount > 0) {
                    ImageCaption.instances.forEach((assistant, id) => {
                        this._cleanupSingleInstance(assistant);
                    });
                    // Clear instance collection
                    ImageCaption.instances.clear();
                }
            } else {
                // Clean up specific node instances
                const searchId = String(nodeId);
                const keysToDelete = Array.from(ImageCaption.instances.keys())
                    .filter(key => key === searchId || key.startsWith(`${searchId}_`));

                keysToDelete.forEach(key => {
                    const assistant = ImageCaption.instances.get(key);
                    if (assistant) {
                        this._cleanupSingleInstance(assistant);
                        ImageCaption.instances.delete(key);
                    }
                });
            }

            return;
        }

        try {
            if (nodeId === null) {
                // Clean up all instances
                const instanceCount = ImageCaption.instances.size;
                if (instanceCount > 0) {
                    ImageCaption.instances.forEach((assistant, id) => {
                        this._cleanupSingleInstance(assistant);
                    });
                    ImageCaption.instances.clear();
                    if (!silent) {
                        logger.log(`Clean up all image assistant instances | Count: ${instanceCount}`);
                    }
                }
            } else {
                // Clean all instances for specified node
                const searchId = String(nodeId);
                const keysToDelete = Array.from(ImageCaption.instances.keys())
                    .filter(key => key === searchId || key.startsWith(`${searchId}_`));

                keysToDelete.forEach(key => {
                    const assistant = ImageCaption.instances.get(key);
                    if (assistant) {
                        this._cleanupSingleInstance(assistant);
                        ImageCaption.instances.delete(key);
                        if (!silent) {
                            logger.log(`Clean up image assistant instance | Key: ${key}`);
                        }
                    }
                });
            }
        } catch (error) {
            logger.error(`Clean up image assistant instance failed | ${error.message}`);
        }
    }

    /**
     * Internal method to clean up single instance
     * @param {object} assistant - Assistant instance
     */
    _cleanupSingleInstance(assistant) {
        if (!assistant) return;

        // Mark instance as destroyed
        assistant.isDestroyed = true;

        try {
            // Clean up DOM elements
            if (assistant.element && assistant.element.parentNode) {
                assistant.element.parentNode.removeChild(assistant.element);
            }

            // Clean up event listeners
            if (assistant._eventCleanupFunctions && Array.isArray(assistant._eventCleanupFunctions)) {
                assistant._eventCleanupFunctions.forEach(cleanup => {
                    if (typeof cleanup === 'function') {
                        cleanup();
                    }
                });
                assistant._eventCleanupFunctions = [];
            }

            // Clean up timers
            if (assistant._timers) {
                Object.values(assistant._timers).forEach(timer => {
                    if (timer) {
                        clearTimeout(timer);
                    }
                });
                assistant._timers = {};
            }

            if (assistant._imageDetectionTimer) {
                clearTimeout(assistant._imageDetectionTimer);
                assistant._imageDetectionTimer = null;
            }

            // Clean up references (node property is dynamic getter, no manual cleanup needed)
            assistant.element = null;
            assistant.innerContent = null;
            assistant.hoverArea = null;
            assistant.indicator = null;
            assistant.buttons = {};
        } catch (error) {
            logger.error(`Failed to clean up single instance | ${error.message}`);
        }
    }

    /**
     * Unified master switch control
     */
    async toggleGlobalFeature(enable, force = false) {
        // Update state
        const oldValue = window.FEATURES.imageCaption;
        window.FEATURES.imageCaption = enable;

        // Don't execute if state unchanged, unless force is true
        if (!force && oldValue === enable) {
            return;
        }

        // Only log when state changes or forced
        if (oldValue !== enable || force) {
            logger.log(`Image caption feature | Action:${enable ? "Enabled" : "Disabled"}`);
        }

        try {
            if (enable) {
                // === Enable image caption feature ===
                // Ensure manager is initialized
                if (!EventManager.initialized) {
                    EventManager.init();
                }

                // 1. Reset node init flags, prepare for re-detection
                if (app.canvas && app.canvas.graph) {
                    const nodes = app.canvas.graph._nodes || [];
                    nodes.forEach(node => {
                        if (node) {
                            node._imageCaptionInitialized = false;
                        }
                    });

                    // 2. If auto-create is enabled, immediately scan all valid nodes
                    const icCreationMode = app.ui.settings.getSettingValue("PromptAssistant.Settings.ImageCaptionCreationMode") || "auto";
                    if (icCreationMode === "auto") {
                        nodes.forEach(node => {
                            if (node && this.hasValidImage(node) && !node._imageCaptionInitialized) {
                                node._imageCaptionInitialized = true;
                                this.checkAndSetupNode(node);
                            }
                        });
                    }
                }

                // 3. Set up or restore node selection event listener
                this.registerNodeSelectionListener();

                // 4. Check currently selected nodes
                if (app.canvas && app.canvas.selected_nodes) {
                    app.canvas._imageCaptionSelectionHandler(app.canvas.selected_nodes);
                }
            } else {
                // === Disable image caption feature ===
                // 1. Clean up all instances
                this.cleanup(null, true);
            }

            // Update button visibility
            if (window.FEATURES.updateButtonsVisibility) {
                window.FEATURES.updateButtonsVisibility();
            }
        } catch (error) {
            logger.error(`Image assistant feature toggle operation failed | error: ${error.message}`);
        }
    }

    /**
     * Update all instances' preset dimensions
     * Called when feature toggle or config changes, triggers container's constant layout calculation
     */
    updateAllInstancesWidth() {
        logger.debug(`[imageassistant] Triggering dimension recalculation for all instances | Instance count: ${ImageCaption.instances.size}`);

        ImageCaption.instances.forEach((assistant) => {
            if (assistant && assistant.container && typeof assistant.container.updateDimensions === 'function') {
                assistant.container.updateDimensions();
            }
        });
    }

}

// Create singleton instance
const imageCaption = new ImageCaption();


// Export
export { imageCaption, ImageCaption };
