/**
 * Node Help Documentation Translation Module (Node Help Translator)
 * Independent module for detecting and translating node documentation in the ComfyUI sidebar.
 */

import { APIService } from "../services/api.js";
import { logger } from "../utils/logger.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { createSplitButton, createTooltip } from "./uiComponents.js";
import { PromptFormatter } from "../utils/promptFormatter.js";

class NodeHelpTranslator {
    constructor() {
        this.observer = null;
        this.isObserving = false;
        this.stateCache = new Map();

        this.currentHelpPanel = {
            nodeName: null,
            element: null,
            bilingualSwitch: null
        };

        // Service list cache (for menu construction)
        this._servicesCache = null;
        this._servicesCacheTime = 0;
        // Current translation service config cache (for menu selection state display)
        this._currentTranslateConfig = null;

        // Listen for global service change events to ensure real-time synchronization
        window.addEventListener('pa-service-changed', () => {
            logger.debug("[NodeHelpTranslator] Received global service change notification, syncing configuration...");
            this._getTranslateConfig();
        });
    }

    // ---Translation service configuration management (using global config)---

    /**
     * Get current global translation service configuration
     * @returns {Promise<{ serviceId: string, modelName: string } | null>}
     */
    async _getTranslateConfig() {
        try {
            const response = await fetch(APIService.getApiUrl('/config/translate'));
            if (response.ok) {
                const config = await response.json();
                this._currentTranslateConfig = config;
                return {
                    serviceId: config.provider || null,
                    modelName: config.model || null
                };
            }
        } catch (e) {
            logger.warn(`[NodeHelpTranslator] Failed to get translation config: ${e.message}`);
        }
        return null;
    }

    /**
     * Set global translation service configuration
     * @param {string} serviceId
     * @param {string} modelName
     * @returns {Promise<boolean>}
     */
    async _setTranslateConfig(serviceId, modelName) {
        try {
            const response = await fetch(APIService.getApiUrl('/services/current'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_type: 'translate',
                    service_id: serviceId,
                    model_name: modelName
                })
            });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    logger.log(`[NodeHelpTranslator] Updated global translation service: ${serviceId} - ${modelName}`);
                    return true;
                }
            }
        } catch (e) {
            logger.warn(`[NodeHelpTranslator] Failed to update translation service: ${e.message}`);
        }
        return false;
    }

    /**
     * Get available services list (with cache)
     */
    async _getAvailableServices() {
        const now = Date.now();
        // Cache for 5 minutes
        if (this._servicesCache && (now - this._servicesCacheTime) < 300000) {
            return this._servicesCache;
        }

        try {
            const response = await fetch(APIService.getApiUrl('/services'));
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.services) {
                    // Save all services list (Baidu and other translation services may not have llm_models)
                    this._servicesCache = data.services;
                    this._servicesCacheTime = now;
                    return this._servicesCache;
                }
            }
        } catch (e) {
            logger.warn(`[NodeHelpTranslator] Failed to get service list: ${e.message}`);
        }
        return [];
    }


    initialize() {
        // Check feature toggle
        if (typeof window !== 'undefined' && window.FEATURES && !window.FEATURES.nodeHelpTranslator) {
            logger.log("[NodeHelpTranslator] Feature disabled, skipping initialization");
            return;
        }

        if (this.isObserving) return;

        logger.log("[NodeHelpTranslator] Initializing observer");

        this.observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            for (const mutation of mutations) {
                // Node addition/removal or attribute change (aria-selected)
                if (mutation.type === 'childList' ||
                    (mutation.type === 'attributes' && mutation.attributeName === 'aria-selected')) {
                    shouldCheck = true;
                    break;
                }
            }
            if (shouldCheck) {
                this._checkAndInject();
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-selected']
        });

        this._injectStyles();
        this.isObserving = true;
    }

    _injectStyles() {
        if (document.getElementById('pa-node-help-translator-styles')) return;
        const style = document.createElement('style');
        style.id = 'pa-node-help-translator-styles';
        style.textContent = `
            .pa-help-translate-btn-container {
                opacity: 0;
                animation: pa-fade-in 0.3s ease-out forwards;
                display: flex;
                align-items: center;
            }
            @keyframes pa-fade-in {
                from { opacity: 0; transform: scale(0.95); }
                to { opacity: 1; transform: scale(1); }
            }
            .pa-help-translate-btn-container.pa-fade-out {
                animation: pa-fade-out 0.2s ease-in forwards;
                pointer-events: none;
            }
            @keyframes pa-fade-out {
                from { opacity: 1; transform: scale(1); }
                to { opacity: 0; transform: scale(0.95); }
            }
            .pa-translate-btn-icon.spinning {
                animation: pa-spin 1s linear infinite;
            }
            @keyframes pa-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            /* ---Streaming container styles--- */
            .pa-help-streaming-container {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                max-height: 150px;
                overflow-y: auto;
                padding: 12px;
                background: linear-gradient(to top, 
                    color-mix(in srgb, var(--p-content-background), transparent 10%) 0%,
                    color-mix(in srgb, var(--p-content-background), transparent 40%) 100%);
                border-top: 1px solid var(--p-panel-border-color);
                z-index: 100;
                opacity: 0;
                transform: translateY(10px);
                transition: opacity 0.3s ease, transform 0.3s ease;
                pointer-events: none;
            }
            .pa-help-streaming-container.show {
                opacity: 1;
                transform: translateY(0);
                pointer-events: auto;
            }
            .pa-help-streaming-content {
                font-size: 13px;
                line-height: 1.6;
                color: var(--p-text-color);
                white-space: pre-wrap;
                word-break: break-word;
            }
            .pa-help-streaming-cursor {
                display: inline-block;
                width: 2px;
                height: 1em;
                background: var(--p-primary-color);
                margin-left: 2px;
                animation: pa-cursor-blink 0.8s infinite;
                vertical-align: text-bottom;
            }
            @keyframes pa-cursor-blink {
                0%, 50% { opacity: 1; }
                51%, 100% { opacity: 0; }
            }
            .pa-help-streaming-container::-webkit-scrollbar {
                width: 6px;
            }
            .pa-help-streaming-container::-webkit-scrollbar-track {
                background: transparent;
            }
            .pa-help-streaming-container::-webkit-scrollbar-thumb {
                background: color-mix(in srgb, var(--p-panel-border-color), transparent 50%);
                border-radius: 3px;
            }
            .pa-streaming-trans-text {
                display: block;
                color: var(--p-primary-color);
                font-size: 0.95em;
                line-height: 1.5;
                padding: 4px 0;
                margin-top: 4px;
                opacity: 0.9;
            }
        `;
        document.head.appendChild(style);
    }

    _handleDomChange() {
        // This method has been replaced by direct calls to _checkAndInject from the observer. Empty function kept to prevent references from elsewhere.
        this._checkAndInject();
    }

    _checkAndInject() {
        // Check feature toggle
        if (typeof window !== 'undefined' && window.FEATURES && !window.FEATURES.nodeHelpTranslator) {
            return;
        }

        if (this._injectTimer) clearTimeout(this._injectTimer);
        this._injectTimer = setTimeout(() => {
            const v3Panel = document.querySelector('[data-testid="properties-panel"]');

            if (!v3Panel) {
                // If V3 panel not found, clean up all possible buttons and return (no longer supports left sidebar)
                this._clearAllButtons();
                return;
            }

            // --- V3 logic ---
            const allTabs = Array.from(v3Panel.querySelectorAll('button[role="tab"]'));
            const activeTab = allTabs.find(t => t.getAttribute('aria-selected') === 'true');
            const activeTabText = activeTab ? activeTab.textContent.trim().toLowerCase() : '';

            // Simplified keyword recognition: just contain 'info'
            const isInfoActive = activeTabText.includes('info') || activeTabText.includes('info');

            // Important: must search for help content within the current panel
            const helpContent = v3Panel.querySelector('.node-help-content');

            if (!isInfoActive || !helpContent) {
                this._clearAllButtons();
                return;
            }

            // Process injection
            this._processInjection(v3Panel, helpContent);
        }, 250);
    }

    /**
     * Unified cleanup function
     */
    _clearAllButtons() {
        const strayBtns = document.querySelectorAll('.pa-help-translate-btn-container:not(.pa-fade-out)');
        if (strayBtns.length > 0) {
            strayBtns.forEach(el => {
                // Clean up tooltip (prevent residue)
                const mainBtn = el.querySelector('.pa-translate-btn');
                if (mainBtn && mainBtn._paTooltip) {
                    mainBtn._paTooltip.destroy();
                    mainBtn._paTooltip = null;
                }

                el.classList.add('pa-fade-out');
                el.addEventListener('animationend', () => el.remove(), { once: true });
                // Safe fallback: force removal if animation didn't trigger
                setTimeout(() => {
                    if (el.parentNode) el.remove();
                }, 300);
            });
        }
    }

    /**
     * Core processing logic: only supports V3 environment
     */
    _processInjection(v3Panel, helpContent) {
        if (!v3Panel) return;

        // Preload service list (for menu display)
        this._getAvailableServices();

        // Find header (position to inject button)
        let header = v3Panel.querySelector('section .flex.gap-2');

        if (header) {
            const titleEl = v3Panel.querySelector('h3');
            const currentNodeName = titleEl ? titleEl.textContent.trim() : 'Unknown';

            const existingBtnContainer = header.querySelector('.pa-help-translate-btn-container');

            if (!existingBtnContainer) {
                // All Info content should show translate button
                this._injectTranslateButton(header, currentNodeName, helpContent);
            } else {
                const btn = existingBtnContainer.querySelector('button');
                if (btn && btn.dataset.nodeName !== currentNodeName) {
                    logger.log(`[NodeHelpTranslator] Node switch detected: ${btn.dataset.nodeName} -> ${currentNodeName}, resetting button state`);
                    this._resetButtonState(btn, currentNodeName);
                }
            }
        }
    }

    _injectTranslateButton(header, nodeName, helpContent) {
        if (!header) return;
        if (header.querySelector('.pa-help-translate-btn-container')) return;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'pa-help-translate-btn-container';

        const splitBtn = createSplitButton({
            label: "Translate Document",
            icon: "pi pi-language",
            className: "p-splitbutton-compact p-splitbutton-primary",
            align: "right",
            onClick: (e) => {
                const btn = splitBtn.container.querySelector('.p-button:first-child');
                this._handleTranslateClick(e, btn);
            },
            // Use functional dynamic items to get latest state each time dropdown opens
            // No longer pass hardcoded 'bilingual'; determined dynamically inside _getMenuItems
            items: () => this._getMenuItems(nodeName)
        });

        const mainBtn = splitBtn.container.querySelector('.p-button:first-child');
        mainBtn.classList.add('pa-translate-btn');
        mainBtn.dataset.nodeName = nodeName;
        mainBtn.dataset.targetLang = 'zh'; // Default: translate to Chinese
        mainBtn._paSplitBtn = splitBtn;
        this.currentHelpPanel.splitBtn = splitBtn;

        this._setButtonContent(mainBtn, 'translate');

        btnContainer.appendChild(splitBtn.container);

        // Try to insert it before the "Close Panel" button
        const toggleBtn = header.querySelector('[aria-label*="panel"], [aria-label*="Panel"]');
        if (toggleBtn) {
            header.insertBefore(btnContainer, toggleBtn);
        } else {
            header.appendChild(btnContainer);
        }

        logger.log(`[NodeHelpTranslator] Injected translate button (SplitBtn) to node: ${nodeName}`);

        if (helpContent) {
            this._restoreFromCache(mainBtn, helpContent, nodeName);
        }
    }

    _resetButtonState(btn, newNodeName) {
        btn.dataset.nodeName = newNodeName;
        btn.dataset.targetLang = 'zh'; // Default: reset to Chinese
        this._setButtonContent(btn, 'translate');
        btn.disabled = false;

        if (btn._paSplitBtn) {
            btn._paSplitBtn.updateMenu(this._getMenuItems(newNodeName, 'bilingual'));
        }

        const v3Panel = btn.closest('[data-testid="properties-panel"]');
        const helpContent = v3Panel ? v3Panel.querySelector('.node-help-content') : null;
        if (helpContent) {
            this._restoreFromCache(btn, helpContent, newNodeName);
        }
    }

    _setButtonContent(btn, type) {
        let label = 'Translate';
        let iconClass = 'pi pi-language pa-translate-btn-icon';
        let spinning = false;
        let tooltip = '';

        switch (type) {
            case 'translate':
                label = 'Translate';
                iconClass = 'pi pi-language pa-translate-btn-icon';
                tooltip = 'Translate document using ✨Prompt Assistant';
                break;
            case 'translating':
                label = 'Translating...';
                iconClass = 'pi pi-spinner pa-translate-btn-icon';
                spinning = true;
                tooltip = 'Translating document...';
                break;
            case 'translated':
                label = 'Translated';
                iconClass = 'pi pi-check pa-translate-btn-icon';
                tooltip = 'Click to re-translate';
                break;
        }

        if (btn._paSplitBtn) {
            btn._paSplitBtn.updateMainButton(label, iconClass, spinning);
        } else {
            btn.innerHTML = `
                <span class="p-button-icon p-button-icon-left ${iconClass} pa-translate-btn-icon ${spinning ? 'spinning' : ''}"></span>
                <span class="p-button-label">${label}</span>
            `;
        }

        // Update custom tooltip
        if (btn._paTooltip) {
            btn._paTooltip.destroy();
            btn._paTooltip = null;
        }

        if (tooltip) {
            btn._paTooltip = createTooltip({
                target: btn,
                content: tooltip,
                position: 'top'
            });
        }
    }

    async _handleTranslateClick(e, btn) {
        e.stopPropagation();

        const nodeName = btn.dataset.nodeName;
        const targetLang = btn.dataset.targetLang || 'zh';
        const from = targetLang === 'zh' ? 'en' : 'zh';
        const to = targetLang;

        // Enhanced logic to find content container (consistent with _handleModeChange)
        let contentEl = null;

        // Strategy 1: If button is inside properties-panel (V3)
        const v3Panel = btn.closest('[data-testid="properties-panel"]');
        if (v3Panel) {
            contentEl = v3Panel.querySelector('.node-help-content');
        }

        // Strategy 2: Fallback to old hierarchy search
        if (!contentEl) {
            const header = btn.closest('.border-b') || btn.closest('.pa-help-translate-btn-container').parentElement;
            if (header) {
                const container = header.parentElement;
                contentEl = container.querySelector('.node-help-content');
            }
        }

        if (!contentEl) {
            UIToolkit.showStatusTip(btn, 'warn', 'Help content not found');
            return;
        }

        // Allow re-translate
        await this._performTranslation(btn, contentEl, nodeName, from, to);
    }

    async _performTranslation(btn, contentEl, nodeName, from = 'en', to = 'zh') {
        this._setButtonContent(btn, 'translating');
        btn.disabled = true;

        // For cleaning up streaming state on error
        let textBlocks = [];

        try {
            // Reset previous translation state (if any)
            // If already translated, restore DOM first to re-extract text
            const existingTranslatable = contentEl.querySelectorAll('.pa-translatable');
            if (existingTranslatable.length > 0) {
                existingTranslatable.forEach(el => {
                    if (el.dataset.paOriginal) {
                        el.innerHTML = el.dataset.paOriginal;
                    }
                    el.classList.remove('pa-translatable');
                    delete el.dataset.paTranslation;
                    // dataset.paOriginal can be kept or deleted; keeping it doesn't hurt, extractTextBlocks reads innerText
                    // But for cleanliness, let's clean it up
                    delete el.dataset.paOriginal;
                });
            }

            contentEl.classList.remove('pa-mode-bilingual', 'pa-mode-translation-only', 'pa-mode-original-only');

            textBlocks = this._extractTextBlocks(contentEl);
            if (textBlocks.length === 0) {
                UIToolkit.showStatusTip(btn, 'warn', 'No translatable content found');
                this._setButtonContent(btn, 'translate'); // Restore to untranslated state
                return;
            }
            // ... remaining logic unchanged, but extractTextBlocks comes next


            const textsToTranslate = textBlocks.map(block => block.text);
            let translations = [];
            let isBaidu = false;

            // 1. Get global translation configuration
            // Use backend global config directly (shared with PromptAssistant)
            try {
                const configResp = await fetch(APIService.getApiUrl('/config/translate'));
                if (configResp.ok) {
                    const config = await configResp.json();
                    if (config.provider === 'baidu') {
                        isBaidu = true;
                    }
                }
            } catch (e) {
                logger.warn(`[NodeHelpTranslator] Failed to get translation config: ${e.message}, will use LLM as default`);
            }

            // 2. Execute translation based on service type
            if (isBaidu) {
                logger.log(`[NodeHelpTranslator] Using Baidu Translate API to translate (${from}->${to})`);
                // Baidu batch translation uses sequential requests, returns array of results
                const results = await APIService.batchBaiduTranslate(textsToTranslate, from, to);

                // Extract translated results; BaiduTranslateService return format should be consistent with LLM (data.translated)
                // If a request fails, result.success is false; fill with null here and skip
                translations = results.map(r => {
                    if (r && r.success && r.data && r.data.translated) {
                        return r.data.translated;
                    }
                    return null;
                });

                // Check if all translations failed
                const successCount = translations.filter(t => t !== null).length;
                if (successCount === 0 && textsToTranslate.length > 0) {
                    throw new Error('All text translations failed (Baidu)');
                }

            } else {
                // ---Use LLM translation---
                const textCount = textsToTranslate.length;
                const enableStreaming = typeof window !== 'undefined' &&
                    window.FEATURES && window.FEATURES.enableStreaming !== false;

                if (enableStreaming) {
                    // ---LLM single-request batch streaming translation---
                    logger.log(`[NodeHelpTranslator] Using LLM batch streaming translation (${from}->${to}) | Text count:${textCount}`);

                    const totalBlocks = textsToTranslate.length;

                    // 1. First create streaming display area for all text blocks
                    textBlocks.forEach((block, i) => {
                        const el = block.element;
                        if (!el.dataset.paOriginal) {
                            el.dataset.paOriginal = el.innerHTML;
                        }
                        el.classList.add('pa-translatable');

                        const wrappedOriginal = `<span class="pa-original-content">${el.dataset.paOriginal}</span>`;
                        const separator = `<span class="pa-trans-separator"></span>`;
                        const streamingArea = `<span class="pa-streaming-trans-text" data-block-index="${i}"></span>`;
                        el.innerHTML = `${wrappedOriginal}${separator}${streamingArea}`;
                    });

                    // 2. Build numbered batch translation request text
                    // Format: [1] Text1\n[2] Text2\n...
                    const numberedText = textsToTranslate
                        .map((text, i) => `[${i + 1}] ${text}`)
                        .join('\n\n');

                    // 3. Streaming parsing state
                    let fullContent = '';
                    let currentBlockIndex = -1;
                    let blockTranslations = new Array(totalBlocks).fill('');

                    // 4. Initiate single streaming translation request (using global config)
                    const result = await this._llmTranslateStreamWithConfig(
                        numberedText,
                        from,
                        to,
                        null,  // Use global config, no need to pass independent parameters
                        (chunk) => {
                            fullContent += chunk;

                            // Parse streaming content, identify numbers and update corresponding DOM
                            this._parseAndUpdateStreamingContent(
                                fullContent,
                                textBlocks,
                                blockTranslations
                            );

                            // Update progress
                            const completedCount = blockTranslations.filter(t => t.length > 0).length;
                            const percent = Math.round((completedCount / totalBlocks) * 100);
                            if (btn._paSplitBtn) {
                                btn._paSplitBtn.updateMainButton(`${percent}%`, 'pi pi-spinner pa-translate-btn-icon', true);
                            }
                        }
                    );

                    // 5. Final parse to ensure all content is processed
                    this._parseAndUpdateStreamingContent(fullContent, textBlocks, blockTranslations, true);

                    // 6. Collect translation results and update to final style
                    textBlocks.forEach((block, i) => {
                        const el = block.element;
                        const translation = blockTranslations[i]?.trim();

                        if (translation) {
                            translations.push(translation);
                            el.dataset.paTranslation = translation;
                            // Switch to formal translation style
                            const wrappedOriginal = `<span class="pa-original-content">${el.dataset.paOriginal}</span>`;
                            const separator = `<span class="pa-trans-separator"></span>`;
                            const styledTranslation = `<span class="pa-trans-text">${translation.replace(/\n/g, '<br>')}</span>`;
                            el.innerHTML = `${wrappedOriginal}${separator}${styledTranslation}`;
                        } else {
                            translations.push(null);
                            logger.warn(`[NodeHelpTranslator] Text block ${i + 1} translation failed`);
                            el.innerHTML = el.dataset.paOriginal;
                            el.classList.remove('pa-translatable');
                        }
                    });

                    // Check translation success rate
                    const successCount = translations.filter(t => t !== null).length;
                    if (successCount === 0 && textsToTranslate.length > 0) {
                        throw new Error('All text translations failed (LLM Stream)');
                    }

                } else if (textCount <= 5) {
                    // When text count is low, use single batch translation directly
                    logger.log(`[NodeHelpTranslator] Using LLM single batch translation (${from}->${to}) | Text count:${textCount}`);
                    const result = await APIService.llmBatchTranslate(textsToTranslate, from, to);

                    if (result.success && result.data && result.data.translations) {
                        translations = result.data.translations;
                    } else {
                        throw new Error(result.error || 'Translation API returned error');
                    }
                } else {
                    // When text count is high, use parallel chunked translation
                    logger.log(`[NodeHelpTranslator] Using LLM parallel chunked translation (${from}->${to}) | Text count:${textCount}`);
                    const result = await APIService.llmParallelBatchTranslate(textsToTranslate, from, to, {
                        chunkSize: 5,
                        concurrency: 3,
                        onProgress: (completed, total) => {
                            const percent = Math.round((completed / total) * 100);
                            if (btn._paSplitBtn) {
                                btn._paSplitBtn.updateMainButton(`${percent}%`, 'pi pi-spinner pa-translate-btn-icon', true);
                            }
                        }
                    });

                    if (result.success && result.data && result.data.translations) {
                        translations = result.data.translations;
                    } else {
                        throw new Error(result.error || 'Parallel translation failed');
                    }
                }
            }

            // 3. No need to render again in streaming mode (already done in loop), non-streaming needs rendering
            const enableStreaming = typeof window !== 'undefined' &&
                window.FEATURES && window.FEATURES.enableStreaming !== false;

            if (!enableStreaming || isBaidu) {
                // Non-streaming mode or Baidu translation: batch render results
                const cleanedTranslations = translations.map(t => t ? t.replace(/^\|\s*/, '') : t);
                this._renderTranslations(textBlocks, cleanedTranslations, nodeName);
            } else {
                // Streaming mode: clean results and save cache
                const cleanedTranslations = translations.map(t => t ? t.replace(/^\|\s*/, '') : t);
                // Update translation results in dataset (for cache and mode switching)
                textBlocks.forEach((block, index) => {
                    const translation = cleanedTranslations[index];
                    if (translation) {
                        block.element.dataset.paTranslation = translation;
                    }
                });
                // Save cache
                const cacheData = cleanedTranslations.map((t, i) => ({ index: i, translation: t })).filter(item => item.translation);
                this._saveToCache(nodeName, {
                    translations: cacheData,
                    timestamp: Date.now(),
                    bilingual: true
                });
            }

            this.stateCache.set(nodeName, { translated: true, viewMode: 'bilingual' });

            if (this.currentHelpPanel.splitBtn) {
                this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, 'bilingual'));
            }

            this._setButtonContent(btn, 'translated');

        } catch (error) {
            logger.error(`[NodeHelpTranslator] Translation failed: ${error.message}`);
            UIToolkit.showStatusTip(btn, 'error', 'Translation failed: ' + error.message);
            this._setButtonContent(btn, 'translate');
            btn.disabled = false;

            // Clean up streaming state
            textBlocks?.forEach(block => {
                const el = block.element;
                if (el.dataset.paOriginal && !el.dataset.paTranslation) {
                    el.innerHTML = el.dataset.paOriginal;
                    el.classList.remove('pa-translatable');
                }
            });
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * Streaming translation with optional service/model configuration
     * @param {string} text - Text to translate
     * @param {string} fromLang - Source language
     * @param {string} toLang - Target language
     * @param {Object|null} config - Optional configuration { serviceId, modelName }
     * @param {Function} onChunk - Callback receiving each chunk
     */
    async _llmTranslateStreamWithConfig(text, fromLang, toLang, config, onChunk) {
        try {
            if (!text || text.trim() === '') {
                throw new Error('Please enter content to translate');
            }

            const request_id = APIService.generateRequestId('trans');
            const apiUrl = APIService.getApiUrl('llm/translate/stream');

            // Build request body, add optional service/model parameters
            const body = {
                text,
                from: fromLang,
                to: toLang,
                request_id
            };

            // If independent config provided, add service and model parameters
            if (config && config.serviceId && config.modelName) {
                body.service_id = config.serviceId;
                body.model_name = config.modelName;
                logger.debug(`[NodeHelpTranslator] Streaming translation using specified service: ${config.serviceId} - ${config.modelName}`);
            }

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.chunk && onChunk) {
                                onChunk(data.chunk);
                            }
                            if (data.done) {
                                finalResult = data.result;
                            }
                            if (data.error) {
                                throw new Error(data.error);
                            }
                        } catch (parseError) {
                            if (parseError.message !== 'Unexpected end of JSON input') {
                                logger.warn(`Failed to parse SSE data: ${parseError.message}`);
                            }
                        }
                    }
                }
            }

            return finalResult;

        } catch (error) {
            logger.error(`[NodeHelpTranslator] Streaming translation failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Parse streaming translation content and update corresponding DOM elements
     * @param {string} content - Accumulated streaming content
     * @param {Array} textBlocks - Text block array
     * @param {Array} blockTranslations - Translation result array for each block
     * @param {boolean} isFinal - Whether it's the final parse
     */
    _parseAndUpdateStreamingContent(content, textBlocks, blockTranslations, isFinal = false) {
        if (!content) return;

        // Parse numbered translation content using regex
        // Format: [1] Translation1\n[2] Translation2\n...
        // Or: [1]Translation1[2]Translation2... (no line breaks)
        const blockPattern = /\[(\d+)\]\s*/g;
        const matches = [...content.matchAll(blockPattern)];

        if (matches.length === 0) {
            // No numbers found, possibly still outputting content of first block
            // Try to update first block
            if (textBlocks.length > 0) {
                const streamingEl = textBlocks[0].element.querySelector('.pa-streaming-trans-text');
                if (streamingEl) {
                    streamingEl.textContent = content.trim();
                }
                blockTranslations[0] = content.trim();
            }
            return;
        }

        // Parse each block's content
        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const blockNum = parseInt(match[1], 10);
            const blockIndex = blockNum - 1; // Convert to 0-indexed

            if (blockIndex < 0 || blockIndex >= textBlocks.length) continue;

            // Calculate start and end positions of this block's content
            const startPos = match.index + match[0].length;
            const endPos = (i + 1 < matches.length) ? matches[i + 1].index : content.length;

            // Extract translation content of this block
            const blockContent = content.substring(startPos, endPos).trim();

            // Update translation array
            blockTranslations[blockIndex] = blockContent;

            // Update DOM display
            const streamingEl = textBlocks[blockIndex].element.querySelector('.pa-streaming-trans-text');
            if (streamingEl) {
                streamingEl.textContent = blockContent;
            }
        }
    }

    /**
     * Extract text blocks
     */
    _extractTextBlocks(rootEl) {
        const blocks = [];
        // Optimization 1: Don't extract th (table headers) as they don't need translation
        const candidates = rootEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td');

        for (const el of candidates) {
            const text = el.innerText.trim();
            if (!text) continue;

            // Filter out pure numbers and punctuation
            if (/^[0-9\s\p{P}]+$/u.test(text)) continue;

            // Optimization 2: Filter out all-caps words that look like type definitions (e.g., IMAGE, FLOAT, BOOLEAN, COMBO)
            // Allow specific symbols like underscores, but no spaces (types are usually a single word)
            // Limit length <30 to avoid filtering long all-caps sentences
            // Note: parameter names are usually snake_case (lowercase), so they won't be filtered
            if (/^[A-Z0-9_]+$/.test(text) && text.length < 30) continue;

            if (el.closest('pre') || el.closest('code')) continue;
            if (el.classList.contains('pa-translatable')) continue;
            if (el.closest('.pa-translatable')) continue;

            const hasBlockChildren = Array.from(el.children).some(child =>
                ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'UL', 'OL'].includes(child.tagName)
            );
            if (hasBlockChildren) continue;

            blocks.push({ element: el, text: text });
        }

        return blocks;
    }

    _renderTranslations(blocks, translations, nodeName) {
        // Save data for cache
        const cacheData = [];

        blocks.forEach((block, index) => {
            const translation = translations[index];
            if (!translation) return;

            const el = block.element;
            el.classList.add('pa-translatable');

            if (!el.dataset.paOriginal) {
                el.dataset.paOriginal = el.innerHTML;
            }
            el.dataset.paTranslation = translation;

            this._updateBlockContent(el, 'bilingual');

            // Collect cache data (storing original HTML hash or simple selector as identifier may be unreliable due to DOM changes)
            // Here we use a simple strategy: store in order.
            // As long as the help content hasn't changed, the sequentially extracted text blocks should remain the same.
            cacheData.push({
                index: index, // Save index for matching during restoration
                translation: translation
            });
        });

        // Save to cache
        if (nodeName) {
            this._saveToCache(nodeName, {
                translations: cacheData,
                timestamp: Date.now(),
                bilingual: true
            });
        }
    }

    _updateBlockContent(el, mode) {
        const original = el.dataset.paOriginal || '';
        const translation = el.dataset.paTranslation || '';

        // Wrap original content to allow toggling visibility
        const wrappedOriginal = `<span class="pa-original-content">${original}</span>`;
        const separator = `<span class="pa-trans-separator"></span>`;
        const styledTranslation = `<span class="pa-trans-text">${translation.replace(/\n/g, '<br>')}</span>`;

        el.innerHTML = `${wrappedOriginal}${separator}${styledTranslation}`;
    }

    // --- Cache management ---

    _getCacheKey() {
        return 'pa_node_help_translations';
    }

    _loadFromCache(nodeName) {
        try {
            const raw = sessionStorage.getItem(this._getCacheKey());
            if (!raw) return null;
            const cache = JSON.parse(raw);
            return cache[nodeName] || null;
        } catch (e) {
            console.error('[NodeHelpTranslator] Failed to read cache', e);
            return null;
        }
    }

    _saveToCache(nodeName, data) {
        try {
            const key = this._getCacheKey();
            const raw = sessionStorage.getItem(key);
            let cache = raw ? JSON.parse(raw) : {};

            cache[nodeName] = data;

            // Simple cleanup strategy: if too large, clear old ones (though sessionStorage is per domain, prevent unbounded growth)
            // For now, no complex LRU; assume user views limited nodes per session

            sessionStorage.setItem(key, JSON.stringify(cache));
        } catch (e) {
            console.error('[NodeHelpTranslator] Failed to write cache', e);
        }
    }

    _restoreFromCache(btn, contentEl, nodeName) {
        const cached = this._loadFromCache(nodeName);
        if (!cached) return false;

        // Check if expired (e.g., more than 24 hours? Actually sessionStorage already limits session lifecycle, so no need to check time)
        // But it's important to check if it matches the current content structure.
        // We'll try to restore by index.

        const textBlocks = this._extractTextBlocks(contentEl);
        if (textBlocks.length === 0) return false;

        // Simple integrity check: if cached index exceeds current text block count, content may have changed
        const maxIndex = Math.max(...cached.translations.map(t => t.index));
        if (maxIndex >= textBlocks.length) {
            logger.warn(`[NodeHelpTranslator] Cache does not match current content (index overflow), skipping restore: ${nodeName}`);
            return false;
        }

        // Restore translation
        // Build full translations array
        // cached.translations is sparse, containing only blocks with translations
        const appliedTranslations = new Array(textBlocks.length).fill(null);
        let matchCount = 0;

        cached.translations.forEach(item => {
            if (item.index < textBlocks.length) {
                // Optional: compare original text to see if it roughly matches? (prevent misalignment due to content adjustments)
                // For performance, we skip original text comparison and strictly rely on extraction order
                appliedTranslations[item.index] = item.translation;
                matchCount++;
            }
        });

        if (matchCount === 0) return false;

        // Render
        this._renderTranslations(textBlocks, appliedTranslations, null); // passing null as nodeName to avoid recursive save

        // Restore state
        const viewMode = cached.viewMode || (cached.bilingual !== false ? 'bilingual' : 'translation-only');
        this.stateCache.set(nodeName, { translated: true, viewMode: viewMode });

        // Update button state
        this._setButtonContent(btn, 'translated');

        // Update SplitButton menu
        if (btn._paSplitBtn) {
            btn._paSplitBtn.updateMenu(this._getMenuItems(nodeName, viewMode));
        }

        // Apply display mode
        this._applyViewMode(contentEl, viewMode);

        logger.log(`[NodeHelpTranslator] Restored translation from cache: ${nodeName}`);
        return true;
    }

    cleanup() {
        // Clear timers
        if (this._injectTimer) {
            clearTimeout(this._injectTimer);
            this._injectTimer = null;
        }

        // Stop and clean MutationObserver
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.isObserving = false;

        // Remove all injected translation buttons
        const translationButtons = document.querySelectorAll('.pa-help-translate-btn-container');
        translationButtons.forEach(btn => {
            // Clean up tooltip
            const mainBtn = btn.querySelector('.pa-translate-btn');
            if (mainBtn && mainBtn._paTooltip) {
                mainBtn._paTooltip.destroy();
                mainBtn._paTooltip = null;
            }
            // Remove button container
            btn.remove();
        });

        // Clear state cache
        this.stateCache.clear();

        // Reset current help panel reference
        this.currentHelpPanel = {
            nodeName: null,
            element: null,
            bilingualSwitch: null
        };

        logger.log("[NodeHelpTranslator] Cleaned up all resources");
    }

    /**
     * Apply view mode
     * @param {HTMLElement} contentEl Content element
     * @param {string} mode 'bilingual' | 'translation-only' | 'original-only'
     */
    _applyViewMode(contentEl, mode) {
        if (!contentEl) return;
        contentEl.classList.remove('pa-mode-bilingual', 'pa-mode-translation-only', 'pa-mode-original-only');

        switch (mode) {
            case 'bilingual':
                contentEl.classList.add('pa-mode-bilingual');
                break;
            case 'translation-only':
                contentEl.classList.add('pa-mode-translation-only');
                break;
            case 'original-only':
                contentEl.classList.add('pa-mode-original-only');
                break;
        }
    }

    /**
     * Get dropdown menu configuration
     * @param {string} nodeName
     * @param {string} currentMode
     * @returns {Array}
     */
    _getMenuItems(nodeName, currentMode) {
        // If mode not explicitly passed, get it from state cache in real-time (to solve state sync issue when opening dynamic menu)
        if (!currentMode) {
            currentMode = this.stateCache.get(nodeName)?.viewMode || 'bilingual';
        }

        const btn = document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`);
        const targetLang = btn ? (btn.dataset.targetLang || 'zh') : 'zh';

        // Asynchronously get latest config (ensure data is correct next time opened or updated in background)
        this._getTranslateConfig();

        // Config to use immediately
        const cachedConfig = this._currentTranslateConfig;
        const currentServiceId = cachedConfig?.provider || null;
        const currentModelName = cachedConfig?.model || null;

        // Build service selection submenu
        const serviceMenuItems = this._buildServiceMenuItems(nodeName, currentMode, currentServiceId, currentModelName);

        return [
            {
                label: 'Translate to Chinese',
                icon: targetLang === 'zh' ? 'pi pi-check' : '',
                className: targetLang === 'zh' ? 'pa-menu-item-active' : '',
                command: () => {
                    const b = document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`);
                    if (b) {
                        b.dataset.targetLang = 'zh';
                        if (this.currentHelpPanel.splitBtn) {
                            this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, currentMode));
                        }
                    }
                }
            },
            {
                label: 'Translate to English',
                icon: targetLang === 'en' ? 'pi pi-check' : '',
                className: targetLang === 'en' ? 'pa-menu-item-active' : '',
                command: () => {
                    const b = document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`);
                    if (b) {
                        b.dataset.targetLang = 'en';
                        if (this.currentHelpPanel.splitBtn) {
                            this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, currentMode));
                        }
                    }
                }
            },
            { separator: true },
            {
                label: 'Chinese-English Bilingual',
                checked: currentMode === 'bilingual',
                command: () => this._handleModeChange(nodeName, 'bilingual')
            },
            {
                label: 'Show Translation',
                checked: currentMode === 'translation-only',
                command: () => this._handleModeChange(nodeName, 'translation-only')
            },
            {
                label: 'Show Original',
                checked: currentMode === 'original-only',
                command: () => this._handleModeChange(nodeName, 'original-only')
            },
            { separator: true },
            {
                label: 'Select Service',
                icon: 'pi pi-server',
                items: serviceMenuItems
            },
            { separator: true },
            {
                label: 'Retranslate',
                icon: 'pi pi-refresh',
                command: () => {
                    const b = document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`);
                    if (b) this._handleTranslateClick(new CustomEvent('re-translate'), b);
                }
            }
        ];
    }

    /**
     * Build service selection submenu
     */
    _buildServiceMenuItems(nodeName, currentMode, currentServiceId, currentModelName) {
        const services = this._servicesCache || [];

        if (services.length === 0 && !this._servicesCache) {
            // Asynchronously load service list, refresh menu after loading
            this._getAvailableServices().then(() => {
                if (this.currentHelpPanel.splitBtn) {
                    this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, currentMode));
                }
            });
            return [{ label: 'Loading...', disabled: true }];
        }

        const menuItems = [];

        // 1. Add Baidu Translate option (always visible)
        const isBaidu = currentServiceId === 'baidu';
        menuItems.push({
            label: 'Baidu Translate',
            icon: isBaidu ? 'pi pi-check' : '',
            command: async () => {
                const success = await this._setTranslateConfig('baidu', '');
                if (success) {
                    // Immediately update local cache for real-time sync
                    this._currentTranslateConfig = { provider: 'baidu', model: '' };

                    UIToolkit.showStatusTip(
                        document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`),
                        'success',
                        'Selected: Baidu Translate'
                    );
                    if (this.currentHelpPanel.splitBtn) {
                        this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, currentMode));
                    }

                    // Broadcast global service change event to notify other components to sync
                    window.dispatchEvent(new CustomEvent('pa-service-changed', {
                        detail: { service_type: 'translate', service_id: 'baidu' }
                    }));
                }
            }
        });

        menuItems.push({ separator: true });

        // 2. Create menu items for each LLM service
        services.filter(s => s.llm_models && s.llm_models.length > 0).forEach(service => {
            const isCurrentService = currentServiceId === service.id;
            const models = service.llm_models || [];

            if (models.length === 0) return;

            // Create model submenu
            const modelItems = models.map(model => {
                const isCurrentModel = isCurrentService && currentModelName === model.name;
                return {
                    label: model.display_name || model.name,
                    icon: isCurrentModel ? 'pi pi-check' : '',
                    command: async () => {
                        const success = await this._setTranslateConfig(service.id, model.name);
                        if (success) {
                            // Immediately update local cache for real-time sync
                            this._currentTranslateConfig = { provider: service.id, model: model.name };

                            const modelLabel = model.display_name || model.name;
                            UIToolkit.showStatusTip(
                                document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`),
                                'success',
                                `Selected: ${service.name} - ${modelLabel}`
                            );
                            if (this.currentHelpPanel.splitBtn) {
                                this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, currentMode));
                            }

                            // Broadcast global service change event to notify other components to sync
                            window.dispatchEvent(new CustomEvent('pa-service-changed', {
                                detail: { service_type: 'translate', service_id: service.id, model_name: model.name }
                            }));
                        }
                    }
                };
            });

            menuItems.push({
                label: service.name || service.id,
                icon: isCurrentService ? 'pi pi-check-circle' : '',
                items: modelItems
            });
        });

        return menuItems;
    }

    async _handleModeChange(nodeName, mode) {
        const state = this.stateCache.get(nodeName);
        if (!state) return;

        state.viewMode = mode;
        this.stateCache.set(nodeName, state);

        const btn = document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`);
        if (!btn) return;

        // Enhanced logic to find content container
        // Find header then panel then content
        let contentEl = null;

        // Button is inside properties-panel (V3)
        const v3Panel = btn.closest('[data-testid="properties-panel"]');
        if (v3Panel) {
            contentEl = v3Panel.querySelector('.node-help-content');
        }

        if (contentEl) {
            this._applyViewMode(contentEl, mode);
        }

        const cachedData = this._loadFromCache(nodeName);
        if (cachedData) {
            this._saveToCache(nodeName, { ...cachedData, viewMode: mode });
        }

        if (this.currentHelpPanel.splitBtn) {
            this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, mode));
        }
    }
}

export const nodeHelpTranslator = new NodeHelpTranslator();