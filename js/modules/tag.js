```javascript
/**
 * Tag Manager
 * Manages the display and operation of tags
 */

import { logger } from '../utils/logger.js';
import { CacheService, TagCacheService } from "../services/cache.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { PopupManager } from "../utils/popupManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { EventManager } from "../utils/eventManager.js";
import { PromptFormatter } from "../utils/promptFormatter.js";
import { createSettingsDialog, showContextMenu, createConfirmPopup } from "./uiComponents.js";
/**
 * Tag Manager Class
 * Manages tag popups and tag selection
 */
class TagManager {
    // ---UI State Persistence Configuration---
    static LAST_TAB_KEY = 'PromptAssistant_TagPopup_LastTab';           // Last active tab
    static ACCORDION_STATE_KEY = 'PromptAssistant_TagPopup_AccordionState'; // Accordion expand state
    static POPUP_SIZE_KEY = 'PromptAssistant_TagPopup_Size';            // Popup size

    /**
     * Get the last active tab (category name)
     */
    static getLastActiveTab() {
        try {
            return CacheService.get(this.LAST_TAB_KEY) || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Record the currently active tab (category name)
     */
    static setLastActiveTab(category) {
        try {
            if (category && typeof category === 'string') {
                CacheService.set(this.LAST_TAB_KEY, category);
            }
        } catch (e) { }
    }

    /**
     * Get accordion expand state
     * @returns {Object} { tabName: { accordionPath: isExpanded } }
     */
    static getAccordionState() {
        try {
            const state = CacheService.get(this.ACCORDION_STATE_KEY);
            return state ? JSON.parse(state) : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Save accordion expand state
     * @param {string} tabName Tab name
     * @param {string} accordionPath Accordion path (represented by category name)
     * @param {boolean} isExpanded Whether expanded
     */
    static setAccordionState(tabName, accordionPath, isExpanded) {
        try {
            const state = this.getAccordionState();
            if (!state[tabName]) {
                state[tabName] = {};
            }
            state[tabName][accordionPath] = isExpanded;
            CacheService.set(this.ACCORDION_STATE_KEY, JSON.stringify(state));
        } catch (e) {
            logger.error(`Failed to save accordion state: ${e.message}`);
        }
    }

    /**
     * Get saved popup size
     * @returns {Object|null} { width: number, height: number }
     */
    static getPopupSize() {
        try {
            const size = CacheService.get(this.POPUP_SIZE_KEY);
            return size ? JSON.parse(size) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Save popup size
     * @param {number} width Width
     * @param {number} height Height
     */
    static setPopupSize(width, height) {
        try {
            const size = { width, height };
            CacheService.set(this.POPUP_SIZE_KEY, JSON.stringify(size));
        } catch (e) {
            logger.error(`Failed to save window size: ${e.message}`);
        }
    }

    /**
     * Recursively find category object
     * @param {Object} obj Data object
     * @param {string} catName Category name
     * @returns {Object|null} Found category object or null
     * @note For virtual category "tags" (only used when there are no actual categories), returns the root object itself
     */
    static _findCategoryRecursively(obj, catName) {
        if (!obj || typeof obj !== 'object') return null;
        // Virtual category "tags" represents root level, return root object itself
        // This category is only used when CSV has no actual categories, only root tags
        if (catName === "" || catName === "tags") return obj;

        for (const [key, value] of Object.entries(obj)) {
            if (key === catName && typeof value === 'object' && value !== null) {
                return value;
            }
            if (typeof value === 'object' && value !== null) {
                const result = this._findCategoryRecursively(value, catName);
                if (result) return result;
            }
        }
        return null;
    }

    /**
     * Recursively find tag and its parent object
     * @param {Object} obj Data object
     * @param {string} tagName Tag Name
     * @param {string} tagValue Tag value
     * @returns {Object|null} Object containing {parent, key} or null
     */
    static _findTagRecursively(obj, tagName, tagValue) {
        if (!obj || typeof obj !== 'object') return null;

        for (const [key, value] of Object.entries(obj)) {
            if (key === tagName && value === tagValue) {
                return { parent: obj, key: key };
            }
            if (typeof value === 'object' && value !== null) {
                const result = this._findTagRecursively(value, tagName, tagValue);
                if (result) return result;
            }
        }
        return null;
    }
    static popupInstance = null;
    static onCloseCallback = null;  // Store close callback
    static eventCleanups = [];      // Event cleanup function array
    static searchTimeout = null;    // Search debounce timer
    static currentNodeId = null;
    static currentInputId = null;
    static currentWidgetKey = null;
    static activeTooltip = null;
    static usedTags = new Map();    // Map of used tags: key=tag value, value=DOM element
    static currentCsvFile = null;   // Current selected CSV file
    static favorites = {};          // Favorites list cache {name: value}
    static tagLookup = new Map();   // Tag value to name mapping
    static Sortable = null;         // Sortable library reference
    static sortables = [];          // Store sortable instances for cleanup
    static tagData = null;          // Tag data for current CSV file

    /**
     * Initialize Sortable
     */
    static async _initSortable() {
        if (this.Sortable) return;
        try {
            this.Sortable = await ResourceManager.getSortable();
        } catch (error) {
            logger.warn('Sortable library not loaded', error);
        }
    }


    /**
     * Check if tag is already inserted into the input box
     */
    static isTagUsed(tagValue, nodeId, inputId) {
        const mapping = UIToolkit._findMapping(nodeId, inputId, this.currentWidgetKey);
        if (!mapping || !mapping.inputEl) return false;

        // Check if input value contains any format of the tag
        const inputValue = mapping.inputEl.value;
        return TagCacheService.isTagInInput(nodeId, inputId, tagValue, inputValue);
    }

    /**
     * Update tag state
     */
    static updateTagState(tagElement, isUsed) {
        if (isUsed) {
            tagElement.classList.add('used');
        } else {
            tagElement.classList.remove('used');
        }
    }

    /**
     * Handle tag click
     */
    static handleTagClick(tagElement, tagName, tagValue, e) {
        // Stop event propagation to prevent popup from closing
        e.stopPropagation();

        // Get input box info
        const mapping = UIToolkit._findMapping(this.currentNodeId, this.currentInputId, this.currentWidgetKey);
        if (!mapping || !mapping.inputEl) return;

        const inputEl = mapping.inputEl;
        const inputValue = inputEl.value;

        // Check if tag is already used
        const isUsed = this.isTagUsed(tagValue, this.currentNodeId, this.currentInputId);

        try {
            if (isUsed) {
                // Tag already used, remove it
                // Ensure tooltip is removed
                this._hideTooltip();
                this.removeTag(tagValue, this.currentNodeId, this.currentInputId, true);
                this.updateTagState(tagElement, false);
                this.usedTags.delete(tagValue);

                // Immediately update tag status in all tabs
                this.updateAllTagsState(this.currentNodeId, this.currentInputId);
                // If currently searching, also update search results state
                const searchResultList = document.querySelector('.tag_search_result_list');
                if (searchResultList) {
                    this.refreshSearchResultsState();
                }

                // logger.debug(`Tag operation | action:remove | tag:"${tagName}" | original value:"${tagValue}"`);
            } else {
                // Tag not used, insert it
                // Get text before and after cursor position
                const cursorPos = inputEl.selectionStart;
                const beforeText = inputValue.substring(0, cursorPos);
                const afterText = inputValue.substring(cursorPos);

                // Determine which format to use
                const formatType = PromptFormatter.determineFormatType(beforeText, afterText);

                // Get or create tag format
                let formats;
                const existingFormats = TagCacheService.getTagFormats(this.currentNodeId, this.currentInputId, tagValue);
                if (existingFormats) {
                    // If cache already has tag format, use cached format directly
                    formats = existingFormats;
                } else {
                    // If cache doesn't have it, create new format
                    formats = PromptFormatter.formatTag(tagValue);
                }

                // Select the format to insert based on formatType
                let insertFormat;
                switch (formatType) {
                    case 1:
                        insertFormat = formats.format1;
                        break;
                    case 2:
                        insertFormat = formats.format2;
                        break;
                    case 3:
                        insertFormat = formats.format3;
                        break;
                    case 4:
                        insertFormat = formats.format4;
                        break;
                    default:
                        insertFormat = formats.format2; // Default to format 2
                }

                // If newly created format, add to cache
                if (!existingFormats) {
                    formats.insertedFormat = insertFormat;
                    TagCacheService.addTag(this.currentNodeId, this.currentInputId, tagValue, formats);
                } else {
                    // If existing format, update insertedFormat
                    TagCacheService.updateInsertedFormat(this.currentNodeId, this.currentInputId, tagValue, insertFormat);
                }

                // Insert at cursor position
                UIToolkit.insertAtCursor(insertFormat, this.currentNodeId, this.currentInputId, {
                    highlight: true,
                    keepFocus: true,
                    widgetKey: this.currentWidgetKey
                });

                // Update cursor position to after inserted content
                setTimeout(() => {
                    if (inputEl === document.activeElement) {
                        const newPos = cursorPos + insertFormat.length;
                        inputEl.setSelectionRange(newPos, newPos);
                        inputEl.focus();
                    }
                }, 0);

                // Update tag state
                this.updateTagState(tagElement, true);
                this.usedTags.set(tagValue, tagElement);

                // Immediately update tag status in all tabs
                this.updateAllTagsState(this.currentNodeId, this.currentInputId);
                // If currently searching, also update search results state
                const searchResultList = document.querySelector('.tag_search_result_list');
                if (searchResultList) {
                    this.refreshSearchResultsState();
                }

                // logger.debug(`Tag operation | action:insert | tag:"${tagName}" | original value:"${tagValue}" | format type:${formatType} | insert format:"${insertFormat}"`);
            }
        } catch (error) {
            logger.error(`Tag operation failed | tag:"${tagName}" | error:${error.message}`);
        }
    }

    /**
     * Remove tag from input box
     */
    static removeTag(tagValue, nodeId, inputId, keepFocus = true) {
        const mapping = UIToolkit._findMapping(nodeId, inputId, this.currentWidgetKey);

        if (mapping && mapping.inputEl) {
            const inputEl = mapping.inputEl;
            const currentValue = inputEl.value;

            // Get all formats of the tag
            const formatInfo = TagCacheService.getTagFormats(nodeId, inputId, tagValue);
            if (!formatInfo) return false;

            // Prefer insertedFormat for exact matching
            if (formatInfo.insertedFormat) {
                const tagIndex = currentValue.indexOf(formatInfo.insertedFormat);
                if (tagIndex !== -1) {
                    // Use exact replacement directly, no extra cleanup
                    const newValue = currentValue.substring(0, tagIndex) +
                        currentValue.substring(tagIndex + formatInfo.insertedFormat.length);

                    // Update input value
                    inputEl.value = newValue;

                    // Trigger event
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

                    if (keepFocus) {
                        inputEl.focus();
                    }

                    logger.debug(`Tag remove | method:exact match | tag:${tagValue} | format:"${formatInfo.insertedFormat}"`);
                    return true;
                }
            }

            // If insertedFormat doesn't exist or not found, try other formats by priority
            const removeOrder = ['format4', 'format3', 'format2', 'format1'];

            for (const formatKey of removeOrder) {
                const format = formatInfo[formatKey];
                if (!format) continue;

                const tagIndex = currentValue.indexOf(format);
                if (tagIndex !== -1) {
                    // Check if it's an independent tag (surrounded by spaces or punctuation)
                    const isValidRemoval = this._isValidTagRemoval(currentValue, tagIndex, format);
                    if (isValidRemoval) {
                        // Use exact replacement directly, no extra cleanup
                        const newValue = currentValue.substring(0, tagIndex) +
                            currentValue.substring(tagIndex + format.length);

                        // Update input value
                        inputEl.value = newValue;

                        // Trigger event
                        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                        inputEl.dispatchEvent(new Event('change', { bubbles: true }));

                        if (keepFocus) {
                            inputEl.focus();
                        }

                        logger.debug(`Tag remove | method:format match | tag:${tagValue} | format:${formatKey}`);
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Check if tag removal is valid
     */
    static _isValidTagRemoval(value, index, format) {
        // Get characters before and after the tag
        const beforeChar = index > 0 ? value[index - 1] : '';
        const afterChar = index + format.length < value.length ? value[index + format.length] : '';

        // Check if surrounding characters are spaces or punctuation
        const isValidChar = char => !char || char === ' ' || char === ',' || char === '.' || char === ';';

        return isValidChar(beforeChar) && isValidChar(afterChar);
    }

    /**
     * Clean up text after tag removal
     */
    static _cleanupAfterRemoval(text, removePosition, removeLength) {
        // Get a small segment of text around removal position for cleanup
        const cleanRange = 10; // Cleanup range (10 chars before and after)
        const startClean = Math.max(0, removePosition - cleanRange);
        const endClean = Math.min(text.length, removePosition + cleanRange);

        // Split text into three parts: before, cleanup, after
        const beforeText = text.substring(0, startClean);
        let cleanText = text.substring(startClean, endClean);
        const afterText = text.substring(endClean);

        // Only clean the middle part
        cleanText = cleanText
            // Remove consecutive commas
            .replace(/,\s*,/g, ',')
            // Ensure a space after comma
            .replace(/,(\S)/g, ', $1')
            // Remove extra spaces
            .replace(/\s+/g, ' ')
            .trim();

        // Recombine text
        let result = beforeText + cleanText + afterText;

        // Handle start and end
        if (removePosition === 0) {
            result = result.replace(/^\s*,\s*/, ''); // If tag is at start, remove leading commas and spaces
        }
        if (removePosition + removeLength >= text.length) {
            result = result.replace(/\s*,\s*$/, ''); // If tag is at end, remove trailing commas and spaces
        }

        return result;
    }

    /**
     * Create and show tooltip
     */
    static _showTooltip(target, text) {
        // Remove existing tooltip
        this._hideTooltip();

        // Create tooltip element
        const tooltip = document.createElement('div');
        tooltip.className = 'tag_tooltip';
        tooltip.innerHTML = text; // Use innerHTML to support HTML content
        document.body.appendChild(tooltip);

        // Get target element position and size
        const rect = target.getBoundingClientRect();

        // Calculate tooltip position
        const tooltipRect = tooltip.getBoundingClientRect();
        const left = rect.left + (rect.width - tooltipRect.width) / 2;
        const top = rect.top - tooltipRect.height - 8; // 8px spacing

        // Set tooltip position
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        // Save current tooltip reference
        this.activeTooltip = tooltip;
    }

    /**
     * Hide tooltip
     */
    static _hideTooltip() {
        if (this.activeTooltip) {
            this.activeTooltip.remove();
            this.activeTooltip = null;
        }
    }

    /**
     * Optimized accordion toggle method - uses dynamic height calculation to fix frame skipping
     */
    static _toggleAccordion(header, content, headerIcon) {
        const isExpanding = !header.classList.contains('active');

        // Prevent duplicate animation
        if (content.dataset.animating === 'true') {
            return;
        }

        // Mark animation state
        content.dataset.animating = 'true';

        if (isExpanding) {
            // Expand accordion
            header.classList.add('active');
            content.classList.add('active');

            // Temporarily remove transition effect to measure height
            content.style.transition = 'none';
            content.style.maxHeight = 'none';
            content.style.overflow = 'visible';
            content.style.padding = '2px 0'; // Ensure padding is correct

            // Force reflow and get accurate height
            void content.offsetHeight;
            const contentHeight = content.scrollHeight;

            // Set animation start state
            content.style.maxHeight = '0px';
            content.style.padding = '0';
            content.style.overflow = 'hidden';

            // Force reflow again
            void content.offsetHeight;

            // Enable transition effect and start animation
            content.style.transition = 'max-height 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), padding 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

            // Use requestAnimationFrame to ensure smooth animation
            requestAnimationFrame(() => {
                content.style.maxHeight = contentHeight + 'px';
                content.style.padding = '2px 0';
            });

            // Listen for animation end event
            const handleTransitionEnd = (e) => {
                if (e.target === content && e.propertyName === 'max-height') {
                    content.removeEventListener('transitionend', handleTransitionEnd);

                    // Cleanup after animation completes
                    if (content.classList.contains('active')) {
                        content.style.maxHeight = 'none';
                        content.style.overflow = 'visible';
                        content.style.transition = '';
                    }

                    // Clear animation state marker
                    content.dataset.animating = 'false';
                }
            };

            content.addEventListener('transitionend', handleTransitionEnd);

            // Fallback cleanup mechanism (in case event doesn't fire)
            setTimeout(() => {
                if (content.dataset.animating === 'true') {
                    content.dataset.animating = 'false';
                    if (content.classList.contains('active')) {
                        content.style.maxHeight = 'none';
                        content.style.overflow = 'visible';
                        content.style.transition = '';
                    }
                }
            }, 250); // Adjusted to 0.2s + 50ms buffer

        } else {
            // Collapse accordion
            // Immediately remove header active class to update visual state
            header.classList.remove('active');

            // Get current height as animation start point
            const currentHeight = content.scrollHeight;

            // Set start state
            content.style.transition = 'none';
            content.style.maxHeight = currentHeight + 'px';
            content.style.overflow = 'hidden';

            // Force reflow
            void content.offsetHeight;

            // Enable transition effect
            content.style.transition = 'max-height 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), padding 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

            // Use requestAnimationFrame to ensure smooth animation
            requestAnimationFrame(() => {
                content.style.maxHeight = '0px';
                content.style.padding = '0';
            });

            // Listen for animation end event
            const handleTransitionEnd = (e) => {
                if (e.target === content && e.propertyName === 'max-height') {
                    content.removeEventListener('transitionend', handleTransitionEnd);

                    // Remove active class and clean up styles after animation
                    content.classList.remove('active');
                    content.style.transition = '';
                    content.style.maxHeight = '';
                    content.style.padding = '';
                    content.style.overflow = '';

                    // Clear animation state marker
                    content.dataset.animating = 'false';
                }
            };

            content.addEventListener('transitionend', handleTransitionEnd);

            // Fallback cleanup mechanism (in case event doesn't fire)
            setTimeout(() => {
                if (content.dataset.animating === 'true') {
                    content.dataset.animating = 'false';
                    content.classList.remove('active');
                    content.style.transition = '';
                    content.style.maxHeight = '';
                    content.style.padding = '';
                    content.style.overflow = '';
                }
            }, 250); // Adjusted to 0.2s + 50ms buffer
        }

        // Toggle icon rotation
        const arrowIcon = headerIcon.querySelector('.pi.pi-chevron-down, .accordion_arrow_icon');
        if (arrowIcon) {
            arrowIcon.classList.toggle('rotate-180');
        }
    }

    /**
     * Recursively create tag structure
     * @param {Object} data Data object
     * @param {string} level Level
     * @param {string} tabName Tab name (for state restoration)
     */
    static _createAccordionContent(data, level = '0', tabName = null, categoryName = null) {
        // If top level (first-level category), create tab structure
        if (level === '0') {
            // Create outer container
            const container = document.createElement('div');
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.height = '100%';
            container.style.overflow = 'hidden';

            // Create tab container
            const tabsContainer = document.createElement('div');
            tabsContainer.className = 'popup_tabs_container';

            // Create tab scroll area
            const tabsScroll = document.createElement('div');
            tabsScroll.className = 'popup_tabs_scroll';

            // Create tab bar
            const tabs = document.createElement('div');
            tabs.className = 'popup_tabs';

            // Create content area
            const tabContents = document.createElement('div');
            tabContents.className = 'tag_category_container';
            tabContents.style.overflow = 'hidden';
            tabContents.style.display = 'flex';
            tabContents.style.flexDirection = 'column';
            tabContents.style.flex = '1'; // Ensure content area fills remaining space
            tabContents.style.minHeight = '0'; // Allow flex shrink
            tabContents.style.flex = '1'; // Ensure content area fills remaining space
            tabContents.style.minHeight = '0'; // Allow flex shrink

            // Get all first-level categories and tags
            const categories = Object.keys(data);

            // Separate root-level tags (string values) from actual categories (object values)
            // Note: we only separate during rendering, don't modify original data object
            const rootTags = {};
            const actualCategories = [];
            categories.forEach(key => {
                if (typeof data[key] === 'string') {
                    rootTags[key] = data[key];
                } else {
                    actualCategories.push(key);
                }
            });

            // If no categories and no root tags, return empty container
            if (actualCategories.length === 0 && Object.keys(rootTags).length === 0) {
                const emptyContainer = document.createElement('div');
                emptyContainer.className = 'tag_category_container';
                return emptyContainer;
            }

            // Create left/right scroll indicators
            const leftIndicator = document.createElement('div');
            leftIndicator.className = 'tabs_scroll_indicator left';

            // Add icon
            const leftIconSpan = document.createElement('span');
            leftIconSpan.className = 'pi pi-angle-left scroll_indicator_icon';
            leftIndicator.appendChild(leftIconSpan);
            leftIndicator.style.display = 'none'; // Initially hidden

            const rightIndicator = document.createElement('div');
            rightIndicator.className = 'tabs_scroll_indicator right';

            // Add icon
            const rightIconSpan = document.createElement('span');
            rightIconSpan.className = 'pi pi-angle-right scroll_indicator_icon';
            rightIndicator.appendChild(rightIconSpan);
            rightIndicator.style.display = 'none'; // Initially hidden

            // Function to update indicator state
            const updateIndicators = () => {
                const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
                if (!canScroll) {
                    leftIndicator.style.display = 'none';
                    rightIndicator.style.display = 'none';
                    return;
                }
                // Use larger threshold (5px) to ensure correct hiding at boundaries
                const scrollLeft = tabsScroll.scrollLeft;
                const maxScroll = tabsScroll.scrollWidth - tabsScroll.clientWidth;

                // Remove high-frequency scroll debug logs

                leftIndicator.style.display = scrollLeft > 5 ? 'flex' : 'none';
                rightIndicator.style.display = scrollLeft < (maxScroll - 5) ? 'flex' : 'none';
            };

            // Add indicator click event - scroll one tab at a time
            const leftClickCleanup = EventManager.addDOMListener(leftIndicator, 'click', () => {
                // Get all tabs
                const allTabs = tabs.querySelectorAll('.popup_tab');
                if (allTabs.length === 0) return;

                // Find current first visible tab
                const scrollRect = tabsScroll.getBoundingClientRect();
                let firstVisibleTab = null;

                for (const tab of allTabs) {
                    const tabRect = tab.getBoundingClientRect();
                    // If tag's right edge is in viewport, it's at least partially visible
                    if (tabRect.right > scrollRect.left + 10) {
                        firstVisibleTab = tab;
                        break;
                    }
                }

                // Find previous tab
                if (firstVisibleTab) {
                    const currentIndex = Array.from(allTabs).indexOf(firstVisibleTab);
                    if (currentIndex > 0) {
                        const prevTab = allTabs[currentIndex - 1];
                        prevTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                        // Update indicator state after scroll (use longer delay to ensure animation completes)
                        setTimeout(updateIndicators, 600);
                    }
                }
            });

            const rightClickCleanup = EventManager.addDOMListener(rightIndicator, 'click', () => {
                // Get all tabs
                const allTabs = tabs.querySelectorAll('.popup_tab');
                if (allTabs.length === 0) return;

                // Find current last visible tab
                const scrollRect = tabsScroll.getBoundingClientRect();
                let lastVisibleTab = null;

                for (let i = allTabs.length - 1; i >= 0; i--) {
                    const tab = allTabs[i];
                    const tabRect = tab.getBoundingClientRect();
                    // If tag's left edge is in viewport, it's at least partially visible
                    if (tabRect.left < scrollRect.right - 10) {
                        lastVisibleTab = tab;
                        break;
                    }
                }

                // Find next tab
                if (lastVisibleTab) {
                    const currentIndex = Array.from(allTabs).indexOf(lastVisibleTab);
                    if (currentIndex < allTabs.length - 1) {
                        const nextTab = allTabs[currentIndex + 1];
                        nextTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
                        // Update indicator state after scroll (use longer delay to ensure animation completes)
                        setTimeout(updateIndicators, 600);
                    }
                }
            });

            // Listen for scroll events, show/hide scroll indicators
            const scrollCleanup = EventManager.addDOMListener(tabsScroll, 'scroll', updateIndicators);

            // Listen for window resize events
            const resizeObserver = new ResizeObserver(() => {
                updateIndicators();
            });
            resizeObserver.observe(popup);

            // Add cleanup function
            const resizeCleanup = () => {
                resizeObserver.disconnect();
            };

            this.eventCleanups.push(leftClickCleanup, rightClickCleanup, scrollCleanup, resizeCleanup);

            // Initial detection of whether scroll indicators are needed, auto-position to active tab
            setTimeout(() => {
                // Check if scrolling is needed
                const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;

                if (canScroll) {
                    // Find active tab
                    const activeTab = tabs.querySelector('.popup_tab.active');
                    if (activeTab) {
                        // Scroll active tab into visible area
                        activeTab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
                    }

                    // Wait for scroll to complete, then update indicator state
                    setTimeout(updateIndicators, 50);
                }
            }, 100);

            // If no actual categories but root tags exist, create a default Tab to display them
            const finalCategories = actualCategories.length > 0 ? actualCategories : (Object.keys(rootTags).length > 0 ? ["tags"] : []);

            // Create tab and content for each category
            finalCategories.forEach((category, index) => {
                // Create tab
                const tab = document.createElement('div');
                tab.className = 'popup_tab';
                tab.textContent = category;
                tab.setAttribute('data-category', category);

                // First tab active by default
                if (index === 0) {
                    tab.classList.add('active');
                }

                // Add tab click event
                const tabClickCleanup = EventManager.addDOMListener(tab, 'click', (e) => {
                    // Get currently active tab
                    const currentActiveTab = tabs.querySelector('.popup_tab.active');

                    // If clicking already active tab, do nothing
                    if (currentActiveTab === tab) return;

                    // Add exit animation to currently active tab
                    if (currentActiveTab) {
                        currentActiveTab.classList.add('exiting');
                        // Listen for animation end
                        const animationEndHandler = () => {
                            currentActiveTab.classList.remove('active', 'exiting');
                            currentActiveTab.removeEventListener('transitionend', animationEndHandler);
                        };
                        currentActiveTab.addEventListener('transitionend', animationEndHandler);
                    }

                    // Remove active class from all content
                    tabContents.querySelectorAll('.popup_tab_content').forEach(c => {
                        c.classList.remove('active');
                        c.style.display = 'none';
                    });

                    // Add active class to current tab
                    tab.classList.add('active');

                    // Add active class to corresponding content
                    const contentId = tab.getAttribute('data-category');
                    const content = tabContents.querySelector(`.popup_tab_content[data-category="${contentId}"]`);
                    if (content) {
                        content.classList.add('active');
                        content.style.display = 'flex';
                        content.style.flexDirection = 'column';
                    }

                    // Improved scroll logic: ensure selected tab is fully visible
                    const tabRect = tab.getBoundingClientRect();
                    const scrollRect = tabsScroll.getBoundingClientRect();

                    // Check if tab is fully within viewport
                    const isFullyVisible =
                        tabRect.left >= scrollRect.left &&
                        tabRect.right <= scrollRect.right;

                    if (!isFullyVisible) {
                        // If tab is not fully visible on the left
                        if (tabRect.left < scrollRect.left) {
                            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                        }
                        // If tab is not fully visible on the right
                        else if (tabRect.right > scrollRect.right) {
                            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
                        }
                    }
                });

                this.eventCleanups.push(tabClickCleanup);
                tabs.appendChild(tab);

                // Create corresponding content area
                const content = document.createElement('div');
                content.className = 'popup_tab_content';
                content.setAttribute('data-category', category);
                content.style.flex = '1';
                content.style.display = 'none';
                content.style.minHeight = '0'; // Allow flex shrink
                content.style.overflow = 'auto'; // Ensure scroll items are shown when content overflows

                // First item content shows by default
                if (index === 0) {
                    content.classList.add('active');
                    content.style.display = 'flex';
                    content.style.flexDirection = 'column';
                }

                // Get data for this category
                // If it's a virtual category "tags" (only used when there are no actual categories), use root tags as data
                const categoryData = category === "tags" ? rootTags : data[category];

                if (typeof categoryData === 'object' && categoryData !== null) {
                    // Use _createInnerAccordion, which already supports mixed content (tags + subcategories)
                    const innerContent = this._createInnerAccordion(categoryData, '1', category, category);
                    content.appendChild(innerContent);
                }

                tabContents.appendChild(content);
            });

            // ---Add "New Category" button at end of tab bar---
            const addTabButton = document.createElement('div');
            addTabButton.className = 'popup_tab add_category_tab';
            addTabButton.title = 'New Category';

            const addTabIcon = document.createElement('span');
            addTabIcon.className = 'pi pi-plus';
            addTabButton.appendChild(addTabIcon);

            const addTabClickCleanup = EventManager.addDOMListener(addTabButton, 'click', (e) => {
                e.stopPropagation();
                this._handleAddCategory(addTabButton, null, tabs, tabContents, data);
            });
            this.eventCleanups.push(addTabClickCleanup);
            tabs.appendChild(addTabButton);

            // Assemble tab structure
            tabsScroll.appendChild(tabs);
            tabsContainer.appendChild(leftIndicator);
            tabsContainer.appendChild(tabsScroll);
            tabsContainer.appendChild(rightIndicator);

            // Assemble container
            container.appendChild(tabsContainer);
            container.appendChild(tabContents);

            return container;
        } else {
            // Non-top-level categories use regular container
            const container = document.createElement('div');
            container.className = 'tag_category_container';
            container.style.overflow = 'visible'; // Remove scrollbar, let parent handle

            // Track first accordion in current level
            let isFirstAccordionInLevel = true;

            for (const [key, value] of Object.entries(data)) {
                // If value is string, it's a tag
                if (typeof value === 'string') {
                    const tagItem = this._createTagElement(key, value, categoryName);
                    container.appendChild(tagItem);
                }
                // Recursively process next level
                else if (typeof value === 'object' && value !== null) {
                    const accordion = document.createElement('div');
                    accordion.className = 'tag_accordion';
                    accordion.setAttribute('data-category', key);
                    accordion.setAttribute('data-level', level);

                    const header = document.createElement('div');
                    header.className = 'tag_accordion_header';

                    const headerTitle = document.createElement('div');
                    headerTitle.className = 'tag_accordion_title';
                    headerTitle.textContent = key;

                    const headerIcon = document.createElement('div');
                    headerIcon.className = 'tag_accordion_icon';

                    // Add plus icon (create new tag)
                    const addIconSpan = document.createElement('span');
                    addIconSpan.className = 'pi pi-plus accordion_add_icon';
                    addIconSpan.title = 'Create new tag in this category';
                    headerIcon.appendChild(addIconSpan);

                    // Add arrow icon
                    const arrowIconSpan = document.createElement('span');
                    arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
                    headerIcon.appendChild(arrowIconSpan);

                    // Add plus icon click event
                    const addIconCleanup = EventManager.addDOMListener(addIconSpan, 'click', (e) => {
                        e.stopPropagation(); // Stop event propagation to prevent accordion toggle
                        this._handleAddTag(key, categoryName || key);
                    });
                    this.eventCleanups.push(addIconCleanup);

                    header.appendChild(headerTitle);
                    header.appendChild(headerIcon);

                    // Add auto-expand on drag hover
                    let hoverTimer = null;
                    const dragOverCleanup = EventManager.addDOMListener(header, 'dragover', (e) => {
                        e.preventDefault(); // Must prevent default to respond to drop/dragover
                        // Check if there is a tag being dragged
                        const draggingTag = document.querySelector('.tag_item.tag-dragging');
                        if (draggingTag && !header.classList.contains('active')) {
                            if (!hoverTimer) {
                                hoverTimer = setTimeout(() => {
                                    logger.debug(`[AutoExpand] drag hover auto expand: ${key}`);
                                    header.click();
                                    hoverTimer = null;
                                }, 500); // 500ms delay
                            }
                        }
                    });

                    const dragLeaveCleanup = EventManager.addDOMListener(header, 'dragleave', () => {
                        if (hoverTimer) {
                            clearTimeout(hoverTimer);
                            hoverTimer = null;
                        }
                    });
                    // Also handle drop event to prevent timer leaks
                    const dropCleanup = EventManager.addDOMListener(header, 'drop', () => {
                        if (hoverTimer) {
                            clearTimeout(hoverTimer);
                            hoverTimer = null;
                        }
                    });

                    this.eventCleanups.push(dragOverCleanup, dragLeaveCleanup, dropCleanup);

                    const content = document.createElement('div');
                    content.className = 'tag_accordion_content';

                    // Recursively create child content, passing tabName
                    const childContent = this._createAccordionContent(value, (parseInt(level) + 1).toString(), tabName, key);
                    content.appendChild(childContent);

                    // Determine whether to expand based on saved state or default behavior
                    const accordionState = this.getAccordionState();
                    const shouldExpand = tabName && accordionState[tabName]?.[key] !== undefined
                        ? accordionState[tabName][key]  // Use saved state
                        : isFirstAccordionInLevel;       // Default expand first

                    if (shouldExpand) {
                        header.classList.add('active');
                        content.classList.add('active');
                        const arrowIconSpan = headerIcon.querySelector('.accordion_arrow_icon');
                        if (arrowIconSpan) {
                            arrowIconSpan.classList.add('rotate-180');
                        }
                        if (!tabName || !accordionState[tabName]?.[key]) {
                            // Only update flag when using default behavior
                            isFirstAccordionInLevel = false;
                        }
                    }

                    // Add accordion toggle event
                    const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
                        e.stopPropagation();

                        // Get current accordion level
                        const currentLevel = accordion.getAttribute('data-level');
                        // Get all sibling accordions under current tab
                        const parentTab = header.closest('.popup_tab_content');
                        if (parentTab) {
                            // Only close other accordions at same level
                            const siblingAccordions = parentTab.querySelectorAll(`.tag_accordion[data-level="${currentLevel}"] .tag_accordion_header.active`);
                            if (!header.classList.contains('active')) {
                                siblingAccordions.forEach(otherHeader => {
                                    if (otherHeader !== header) {
                                        // Get parent accordion
                                        const parentAccordion = otherHeader.closest('.tag_accordion');
                                        // Ensure it's a sibling accordion
                                        if (parentAccordion && parentAccordion.getAttribute('data-level') === currentLevel) {
                                            const otherContent = otherHeader.nextElementSibling;
                                            const otherHeaderIcon = otherHeader.querySelector('.tag_accordion_icon');
                                            // Use optimized toggle method to close other accordions
                                            if (otherHeader.classList.contains('active')) {
                                                this._toggleAccordion(otherHeader, otherContent, otherHeaderIcon);
                                                // Save close state
                                                const otherAccordionCategory = parentAccordion.getAttribute('data-category');
                                                const otherTabName = parentTab.getAttribute('data-category');
                                                if (otherTabName && otherAccordionCategory) {
                                                    this.setAccordionState(otherTabName, otherAccordionCategory, false);
                                                }
                                            }
                                        }
                                    }
                                });
                            }
                        }

                        // Use optimized toggle method to toggle current accordion
                        this._toggleAccordion(header, content, headerIcon);

                        // Save current accordion state
                        const accordionCategory = accordion.getAttribute('data-category');
                        const tabName = parentTab?.getAttribute('data-category');
                        if (tabName && accordionCategory) {
                            const isExpanded = header.classList.contains('active');
                            this.setAccordionState(tabName, accordionCategory, isExpanded);
                        }
                    });

                    this.eventCleanups.push(accordionCleanup);

                    accordion.appendChild(header);
                    accordion.appendChild(content);
                    container.appendChild(accordion);
                }
            }

            // Initialize drag sort (if Sortable available)
            // Handle accordion sorting and tag sorting separately
            if (this.Sortable) {
                // Detect container content type
                const hasAccordions = container.querySelector(':scope > .tag_accordion') !== null;
                const hasTags = container.querySelector(':scope > .tag_item') !== null;

                // Accordion sorting
                if (hasAccordions) {
                    const accordionSortable = new this.Sortable(container, {
                        group: { name: 'accordions', pull: false, put: false },
                        animation: 150,
                        ghostClass: 'tag-ghost',
                        handle: '.tag_accordion_header',
                        draggable: '.tag_accordion',
                        delay: 50,
                        onEnd: async (evt) => {
                            const { oldIndex, newIndex } = evt;
                            if (oldIndex === newIndex) return;

                            const newOrderKeys = [];
                            Array.from(container.children).forEach(el => {
                                if (el.classList.contains('tag_accordion')) {
                                    const cat = el.getAttribute('data-category');
                                    if (cat) newOrderKeys.push(cat);
                                }
                            });

                            const tempObj = { ...data };
                            for (const key in data) delete data[key];

                            newOrderKeys.forEach(key => {
                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                    data[key] = tempObj[key];
                                }
                            });

                            for (const key in tempObj) {
                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                    data[key] = tempObj[key];
                                }
                            }

                            await this._saveTagOrder(data, tabName, categoryName);
                        }
                    });
                    this.sortables.push(accordionSortable);
                }

                // Tag sorting (supports cross-category dragging)
                // Always initialize tag Sortable to ensure empty or subcategory-only containers can receive tags
                if (true) {
                    // Add category identifier to container for cross-category drag recognition
                    container.setAttribute('data-sortable-category', categoryName || tabName);
                    // Ensure container has minimum height so empty containers are visible as drop zones
                    container.style.minHeight = '10px';

                    const tagSortable = new this.Sortable(container, {
                        group: {
                            name: 'tags',
                            pull: true,
                            put: function (to) {
                                // If target container has accordions, don't allow dropping tags
                                return to.el.querySelector(':scope > .tag_accordion') === null;
                            }
                        }, // Allow cross-category dragging
                        animation: 150,
                        ghostClass: 'tag-ghost',
                        draggable: '.tag_item',
                        delay: 50,
                        onStart: function (evt) {
                            evt.item.classList.add('tag-dragging');
                            // Highlight all droppable category containers (bottom-level only)
                            document.querySelectorAll('[data-sortable-category]').forEach(el => {
                                if (el !== evt.from && !el.querySelector(':scope > .tag_accordion')) {
                                    el.classList.add('tag-drop-zone');
                                }
                            });
                        },
                        onEnd: async (evt) => {
                            evt.item.classList.remove('tag-dragging');
                            // Remove highlights
                            document.querySelectorAll('.tag-drop-zone').forEach(el => {
                                el.classList.remove('tag-drop-zone');
                            });

                            // If cross-category move, handled by onAdd
                            if (evt.from !== evt.to) return;

                            const { oldIndex, newIndex } = evt;
                            if (oldIndex === newIndex) return;

                            const newOrderKeys = [];
                            Array.from(container.children).forEach(el => {
                                if (el.classList.contains('tag_item')) {
                                    const name = el.getAttribute('data-name');
                                    if (name) newOrderKeys.push(name);
                                }
                            });

                            const tempObj = { ...data };
                            for (const key in data) delete data[key];

                            newOrderKeys.forEach(key => {
                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                    data[key] = tempObj[key];
                                }
                            });

                            for (const key in tempObj) {
                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                    data[key] = tempObj[key];
                                }
                            }

                            await this._saveTagOrder(data, tabName, categoryName);
                        },
                        onAdd: async (evt) => {
                            // Cross-category tag move
                            const tagItem = evt.item;
                            const tagName = tagItem.getAttribute('data-name');
                            const tagValue = tagItem.getAttribute('data-value');
                            const fromCategory = evt.from.getAttribute('data-sortable-category');
                            const toCategory = evt.to.getAttribute('data-sortable-category');

                            logger.debug(`[onAdd(root)] Begin moving tag: ${tagName}, from: ${fromCategory}, to: ${toCategory}`);

                            // Update tag element's category attribute
                            tagItem.setAttribute('data-category', toCategory);

                            // Call move function (don't save yet, wait for sort)
                            const success = await this._moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, false);

                            logger.debug(`[onAdd(root)] Move result: ${success}`);

                            if (!success) {
                                // If move fails, move tag back to original position
                                logger.warn(`[onAdd(root)] Move failed, rolling back DOM`);
                                evt.from.appendChild(tagItem);
                            } else {
                                // Move succeeded, now reorder based on DOM order and save

                                // Get new DOM order
                                const newOrderKeys = [];
                                Array.from(evt.to.children).forEach(el => {
                                    if (el.classList.contains('tag_item')) {
                                        const name = el.getAttribute('data-name');
                                        if (name) newOrderKeys.push(name);
                                    }
                                });

                                // Restructure data object
                                const tempObj = { ...data };
                                for (const key in data) delete data[key];

                                newOrderKeys.forEach(key => {
                                    if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                        data[key] = tempObj[key];
                                    }
                                });

                                // Ensure nothing is missed
                                for (const key in tempObj) {
                                    if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                        data[key] = tempObj[key];
                                    }
                                }

                                // Save sorted data
                                await this._saveTagOrder(data, tabName, toCategory);

                                // Show success notification
                                logger.debug(`[tagsmove(root)] successful and sort | tag: ${tagName} | to: ${toCategory}`);
                                app.extensionManager.toast.add({
                                    severity: "success",
                                    summary: "Move successful",
                                    detail: `Tag "${tagName}" has been moved to "${toCategory}"`,
                                    life: 2000
                                });
                            }
                        }
                    });
                    this.sortables.push(tagSortable);
                }
            }

            return container;
        }
    }

    /**
     * Create accordion element for second-level category
     */
    static _createAccordionElement(key, value, level) {
        const accordion = document.createElement('div');
        accordion.className = 'tag_accordion';
        accordion.setAttribute('data-category', key);

        const header = document.createElement('div');
        header.className = 'tag_accordion_header';

        const headerTitle = document.createElement('div');
        headerTitle.className = 'tag_accordion_title';
        headerTitle.textContent = key;

        const headerIcon = document.createElement('div');
        headerIcon.className = 'tag_accordion_icon';

        // Create icon element
        const arrowIconSpan = document.createElement('span');
        arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
        headerIcon.appendChild(arrowIconSpan);

        header.appendChild(headerTitle);
        header.appendChild(headerIcon);

        const content = document.createElement('div');
        content.className = 'tag_accordion_content';

        // Recursively create child content
        const childContent = this._createInnerAccordion(data, (parseInt(level) + 1).toString(), tabName, categoryName);
        accordion.appendChild(childContent);

        // Add accordion toggle event, including logic to close other accordions
        const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
            e.stopPropagation();
            // Get all accordions under current tab
            const parentTab = header.closest('.popup_tab_content');
            if (parentTab) {
                if (!header.classList.contains('active')) {
                    const otherAccordions = parentTab.querySelectorAll('.tag_accordion_header.active');
                    otherAccordions.forEach(otherHeader => {
                        if (otherHeader !== header) {
                            otherHeader.classList.remove('active');
                            const otherContent = otherHeader.nextElementSibling;
                            if (otherContent && otherContent.classList.contains('active')) {
                                otherContent.classList.remove('active');
                            }
                            const otherIcon = otherHeader.querySelector('.accordion_arrow_icon');
                            if (otherIcon) {
                                otherIcon.classList.add('rotate-180');
                            }
                        }
                    });
                }
            }
            // Toggle current accordion state
            header.classList.toggle('active');
            content.classList.toggle('active');
            // Icon rotation
            const toggleArrowIcon = headerIcon.querySelector('.accordion_arrow_icon');
            if (toggleArrowIcon) {
                if (header.classList.contains('active')) {
                    toggleArrowIcon.classList.add('rotate-180');
                } else {
                    toggleArrowIcon.classList.remove('rotate-180');
                }
            }
        });
        this.eventCleanups.push(accordionCleanup);

        accordion.appendChild(header);
        accordion.appendChild(content);

        // Default expand first accordion (based on parent element position)
        if (accordion.parentElement && accordion.parentElement.firstChild === accordion) {
            header.classList.add('active');
            content.classList.add('active');
        }

        return accordion;
    }

    /**
     * Create content for second-level category
     * @param {Object} data Data object
     * @param {string} level Level
     * @param {string} tabName Tab name (for state restoration)
     */
    static _createInnerAccordion(data, level, tabName = null, categoryName = null) {
        const container = document.createElement('div');
        container.className = 'tag_category_container';
        container.style.flex = '1';
        container.style.overflow = 'visible'; // Remove scrollbar, let parent handle
        container.style.minHeight = '0'; // Allow flex shrink

        // Track if it's the first accordion
        let isFirstAccordion = true;

        for (const [key, value] of Object.entries(data)) {
            // If value is an object, create new accordion
            if (typeof value === 'object' && value !== null) {
                const accordion = document.createElement('div');
                accordion.className = 'tag_accordion';
                accordion.setAttribute('data-category', key);
                const header = document.createElement('div');
                header.className = 'tag_accordion_header';

                const headerTitle = document.createElement('div');
                headerTitle.className = 'tag_accordion_title';
                headerTitle.textContent = key;

                const headerIcon = document.createElement('div');
                headerIcon.className = 'tag_accordion_icon';

                // Add plus icon (create new tag) - not shown on favorites page
                if (tabName !== 'favorites') {
                    const addIconSpan = document.createElement('span');
                    addIconSpan.className = 'pi pi-plus accordion_add_icon';
                    addIconSpan.title = 'Create new tag in this category';
                    headerIcon.appendChild(addIconSpan);

                    // Add plus icon click event
                    const addIconCleanup = EventManager.addDOMListener(addIconSpan, 'click', (e) => {
                        e.stopPropagation(); // Stop event propagation to prevent accordion toggle
                        this._handleAddTag(key, categoryName || key, addIconSpan);
                    });
                    this.eventCleanups.push(addIconCleanup);
                }

                // Add arrow icon
                const arrowIconSpan = document.createElement('span');
                arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
                headerIcon.appendChild(arrowIconSpan);

                header.appendChild(headerTitle);
                header.appendChild(headerIcon);

                // Add context menu event (not shown on favorites page)
                if (tabName !== 'favorites') {
                    const headerContextMenuCleanup = EventManager.addDOMListener(header, 'contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._showCategoryContextMenu(e, key, false, tabName);
                    });
                    this.eventCleanups.push(headerContextMenuCleanup);
                }

                // Add auto-expand on drag hover
                let hoverTimer = null;
                const dragOverCleanup = EventManager.addDOMListener(header, 'dragover', (e) => {
                    e.preventDefault(); // Must prevent default to respond to drop/dragover
                    // Check if there is a tag being dragged
                    const draggingTag = document.querySelector('.tag_item.tag-dragging');
                    if (draggingTag && !header.classList.contains('active')) {
                        if (!hoverTimer) {
                            hoverTimer = setTimeout(() => {
                                logger.debug(`[AutoExpand] drag hover auto expand: ${key}`);
                                header.click();
                                hoverTimer = null;
                            }, 500); // 500ms delay
                        }
                    }
                });

                const dragLeaveCleanup = EventManager.addDOMListener(header, 'dragleave', () => {
                    if (hoverTimer) {
                        clearTimeout(hoverTimer);
                        hoverTimer = null;
                    }
                });
                // Also handle drop event to prevent timer leaks
                const dropCleanup = EventManager.addDOMListener(header, 'drop', () => {
                    if (hoverTimer) {
                        clearTimeout(hoverTimer);
                        hoverTimer = null;
                    }
                });

                this.eventCleanups.push(dragOverCleanup, dragLeaveCleanup, dropCleanup);

                const content = document.createElement('div');
                content.className = 'tag_accordion_content';

                // Recursively create child content
                // Pass current accordion's category name (key) as categoryName, not parent category name
                // So that each container's data-sortable-category can correctly identify its category
                const childContent = this._createInnerAccordion(value, (parseInt(level) + 1).toString(), tabName, key);
                childContent.style.flex = '1'; // Let child content fill available space
                childContent.style.minHeight = '0'; // Allow flex shrink
                content.appendChild(childContent);

                // Determine whether to expand based on saved state or default behavior
                let shouldExpand;
                const accordionState = this.getAccordionState();

                if (tabName === 'favorites') {
                    // Special handling for favorites page: default expand the category corresponding to the current CSV
                    // Get current CSV file name (without extension)
                    let currentCsvName = this.currentCsvFile || "";
                    currentCsvName = currentCsvName.replace(/\.(csv|json|yaml|yml)$/i, '');

                    // Check if current key matches current CSV (key is the category name)
                    const isCurrentCsv = key === currentCsvName;

                    // Check if matching category exists
                    const hasCurrentCsv = Object.keys(data).includes(currentCsvName);

                    // If currentKey matches current CSV, expand
                    // Or if there is no corresponding CSV category, and this is the first item, expand
                    shouldExpand = isCurrentCsv || (!hasCurrentCsv && isFirstAccordion);

                    // console.log(`[AutoExpand] Key: ${key}, Current: ${currentCsvName}, Match: ${isCurrentCsv}, HasCurrent: ${hasCurrentCsv}, Should: ${shouldExpand}`);
                } else {
                    // Normal page logic: prioritize saved state, otherwise default expand first
                    shouldExpand = tabName && accordionState[tabName]?.[key] !== undefined
                        ? accordionState[tabName][key]
                        : isFirstAccordion;
                }

                if (shouldExpand) {
                    header.classList.add('active');
                    content.classList.add('active');
                    const firstArrowIcon = headerIcon.querySelector('.pi.pi-chevron-down');
                    if (firstArrowIcon) {
                        firstArrowIcon.classList.add('rotate-180');
                    }
                    if (!tabName || !accordionState[tabName]?.[key]) {
                        // Only update flag when using default behavior
                        isFirstAccordion = false;
                    }
                }

                // Add accordion toggle event, including logic to close sibling other accordions
                const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
                    e.stopPropagation();

                    // Get parent container of current accordion (not the entire tab)
                    const parentContainer = accordion.parentElement;
                    const parentTab = header.closest('.popup_tab_content');

                    if (parentContainer) {
                        if (!header.classList.contains('active')) {
                            // Only look for direct child accordions within the same parent container (sibling accordions), not all levels
                            const siblingAccordions = parentContainer.querySelectorAll(':scope > .tag_accordion > .tag_accordion_header.active');
                            siblingAccordions.forEach(otherHeader => {
                                if (otherHeader !== header) {
                                    const otherContent = otherHeader.nextElementSibling;
                                    const otherHeaderIcon = otherHeader.querySelector('.tag_accordion_icon');
                                    // Use optimized toggle method to close sibling other accordions
                                    if (otherHeader.classList.contains('active')) {
                                        this._toggleAccordion(otherHeader, otherContent, otherHeaderIcon);
                                        // Save close state
                                        const otherAccordion = otherHeader.closest('.tag_accordion');
                                        const otherAccordionCategory = otherAccordion?.getAttribute('data-category');
                                        const tabName = parentTab?.getAttribute('data-category');
                                        if (tabName && otherAccordionCategory) {
                                            this.setAccordionState(tabName, otherAccordionCategory, false);
                                        }
                                    }
                                }
                            });
                        }
                    }
                    // Use optimized toggle method to toggle current accordion
                    this._toggleAccordion(header, content, headerIcon);

                    // Save current accordion state
                    const accordionCategory = accordion.getAttribute('data-category');
                    const tabName = parentTab?.getAttribute('data-category');
                    if (tabName && accordionCategory) {
                        const isExpanded = header.classList.contains('active');
                        this.setAccordionState(tabName, accordionCategory, isExpanded);
                    }
                });

                this.eventCleanups.push(accordionCleanup);

                accordion.appendChild(header);
                accordion.appendChild(content);
                container.appendChild(accordion);
            } else if (typeof value === 'string') {
                // If value is a string, create a tag item
                const tagItem = this._createTagElement(key, value, categoryName);
                container.appendChild(tagItem);
            }
        }

        // ---Add "New Subcategory" button at the end of the accordion column table (only for level='1', i.e., first-level accordion)---
        if (level === '1' && tabName !== 'favorites') {
            const addSubCategoryBtn = document.createElement('div');
            addSubCategoryBtn.className = 'add_subcategory_button';
            addSubCategoryBtn.title = 'New subcategory';

            const addSubCategoryIcon = document.createElement('span');
            addSubCategoryIcon.className = 'pi pi-plus';
            addSubCategoryBtn.appendChild(addSubCategoryIcon);

            const addSubCategoryClickCleanup = EventManager.addDOMListener(addSubCategoryBtn, 'click', (e) => {
                e.stopPropagation();
                this._handleAddCategory(addSubCategoryBtn, tabName, null, null, data, categoryName);
            });
            this.eventCleanups.push(addSubCategoryClickCleanup);
            container.appendChild(addSubCategoryBtn);
        }

        // Initialize drag sort (if Sortable available)
        // Handle accordion sorting and tag sorting separately to avoid accidentally triggering accordion sorting when dragging tags
        if (this.Sortable) {
            // Detect container content type (only detect direct child elements)
            const hasAccordions = container.querySelector(':scope > .tag_accordion') !== null;
            const hasTags = container.querySelector(':scope > .tag_item') !== null;

            // Accordion sorting: Only accordion headers can trigger, only sort accordion elements
            if (hasAccordions) {
                const accordionSortable = new this.Sortable(container, {
                    group: { name: 'accordions', pull: false, put: false }, // Independent group, not mixed with tags
                    animation: 150,
                    ghostClass: 'tag-ghost',
                    handle: '.tag_accordion_header', // Only accordion header can be dragged
                    draggable: '.tag_accordion', // Only sort accordion elements
                    delay: 50,
                    onEnd: async (evt) => {
                        const { oldIndex, newIndex } = evt;
                        if (oldIndex === newIndex) return;

                        // Get new order (only accordions)
                        const newOrderKeys = [];
                        Array.from(container.children).forEach(el => {
                            if (el.classList.contains('tag_accordion')) {
                                const cat = el.getAttribute('data-category');
                                if (cat) newOrderKeys.push(cat);
                            }
                        });

                        // Restructure data object
                        const tempObj = { ...data };
                        for (const key in data) delete data[key];

                        newOrderKeys.forEach(key => {
                            if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                data[key] = tempObj[key];
                            }
                        });

                        // Preserve data not in DOM
                        for (const key in tempObj) {
                            if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                data[key] = tempObj[key];
                            }
                        }

                        // Save order
                        await this._saveTagOrder(data, tabName, categoryName);
                    }
                });
                this.sortables.push(accordionSortable);
            }


            // Tag sorting (supports cross-category dragging)
            // Always initialize tag Sortable to ensure empty or subcategory-only containers can receive tags
            if (true) {
                // Add category identifier to container for cross-category drag recognition
                container.setAttribute('data-sortable-category', categoryName || tabName);
                // Ensure container has minimum height so empty containers are visible as drop zones
                container.style.minHeight = '10px';

                const tagSortable = new this.Sortable(container, {
                    group: {
                        name: 'tags',
                        pull: true,
                        put: function (to) {
                            // If target container contains accordion (determined by .tag_accordion child element), do not allow dropping tags
                            // Tags can only be dropped into the lowest-level category containers (accordion content areas)
                            return to.el.querySelector(':scope > .tag_accordion') === null;
                        }
                    }, // Allow cross-category dragging
                    animation: 150,
                    ghostClass: 'tag-ghost',
                    draggable: '.tag_item',
                    delay: 50,
                    onStart: function (evt) {
                        evt.item.classList.add('tag-dragging');
                        // Highlight all droppable category containers (bottom-level only)
                        document.querySelectorAll('[data-sortable-category]').forEach(el => {
                            if (el !== evt.from && !el.querySelector(':scope > .tag_accordion')) {
                                el.classList.add('tag-drop-zone');
                            }
                        });
                    },
                    onEnd: async (evt) => {
                        evt.item.classList.remove('tag-dragging');
                        // Remove highlights
                        document.querySelectorAll('.tag-drop-zone').forEach(el => {
                            el.classList.remove('tag-drop-zone');
                        });

                        // If cross-category move, handled by onAdd
                        if (evt.from !== evt.to) return;

                        const { oldIndex, newIndex } = evt;
                        if (oldIndex === newIndex) return;

                        const newOrderKeys = [];
                        Array.from(container.children).forEach(el => {
                            if (el.classList.contains('tag_item')) {
                                const name = el.getAttribute('data-name');
                                if (name) newOrderKeys.push(name);
                            }
                        });

                        const tempObj = { ...data };
                        for (const key in data) delete data[key];

                        // Add sorted tags first
                        newOrderKeys.forEach(key => {
                            if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                data[key] = tempObj[key];
                            }
                        });

                        // Add back other keys (subcategories at this level)
                        for (const key in tempObj) {
                            if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                data[key] = tempObj[key];
                            }
                        }

                        await this._saveTagOrder(data, tabName, categoryName);
                    },
                    onAdd: async (evt) => {
                        // Cross-category tag move
                        const tagItem = evt.item;
                        const tagName = tagItem.getAttribute('data-name');
                        const tagValue = tagItem.getAttribute('data-value');
                        const fromCategory = evt.from.getAttribute('data-sortable-category');
                        const toCategory = evt.to.getAttribute('data-sortable-category');

                        logger.debug(`[onAdd] Begin moving tag: ${tagName}, from: ${fromCategory}, to: ${toCategory}`);

                        // Update tag element's category attribute
                        tagItem.setAttribute('data-category', toCategory);

                        // Call move function (don't save yet, wait for sort)
                        const success = await this._moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, false);

                        logger.debug(`[onAdd] Move result: ${success}`);

                        if (!success) {
                            // If move fails, move tag back to original position
                            logger.warn(`[onAdd] Move failed, rolling back DOM`);
                            evt.from.appendChild(tagItem);
                        } else {
                            // Move succeeded, now reorder based on DOM order and save

                            // Get new DOM order
                            const newOrderKeys = [];
                            Array.from(evt.to.children).forEach(el => {
                                if (el.classList.contains('tag_item')) {
                                    const name = el.getAttribute('data-name');
                                    if (name) newOrderKeys.push(name);
                                }
                            });

                            // Restructure data object
                            const tempObj = { ...data };
                            for (const key in data) delete data[key];

                            // Add sorted tags first
                            newOrderKeys.forEach(key => {
                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                    data[key] = tempObj[key];
                                }
                            });

                            // Add back other keys (subcategories already at this level)
                            for (const key in tempObj) {
                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                    data[key] = tempObj[key];
                                }
                            }


                            // Save sorted data
                            await this._saveTagOrder(data, tabName, toCategory);

                            // Show success notification
                            logger.debug(`[tagsmove] successful and sort | tag: ${tagName} | to: ${toCategory}`);
                            app.extensionManager.toast.add({
                                severity: "success",
                                summary: "Move successful",
                                detail: `Tag "${tagName}" has been moved to "${toCategory}"`,
                                life: 2000
                            });
                        }
                    }
                });
                this.sortables.push(tagSortable);
            }
        }

        return container;
    }

    /**
     * Save tag order
     * @param {Object} data Data object
     * @param {string} tabName Tab name
     * @param {string} categoryName Category name
     */
    static async _saveTagOrder(data, tabName, categoryName) {
        try {
            let success = false;
            const isFavorites = tabName === 'favorites' || categoryName === 'favorites';

            if (isFavorites) {
                // Save to tags_user.json
                const userTagData = await ResourceManager.getUserTagData();
                if (!userTagData.favorites) {
                    userTagData.favorites = {};
                }
                userTagData.favorites = TagManager.favorites;

                success = await ResourceManager.saveUserTags(userTagData);
                if (success) {
                    logger.debug(`[tagsort] Favorite order saved`);
                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: "Order saved successfully",
                        detail: "Favorite tag order updated",
                        life: 2000
                    });
                }
            } else {
                // Save to CSV
                if (TagManager.currentCsvFile && TagManager.tagData) {
                    success = await ResourceManager.saveTagsCsv(TagManager.currentCsvFile, TagManager.tagData);
                    if (success) {
                        logger.debug(`[tagsort] CSV order saved | file: ${TagManager.currentCsvFile}`);
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: "Order saved successfully",
                            detail: "Tag file order updated",
                            life: 2000
                        });
                    }
                }
            }

            if (!success) {
                app.extensionManager.toast.add({
                    severity: "error",
                    summary: "Save failed",
                    detail: "Failed to save order to server",
                    life: 3000
                });
            }
        } catch (err) {
            logger.error(`[tagsort] Save error: ${err.message}`);
        }
    }

    /**
     * Move tag to new category
     * @param {string} tagName Tag Name
     * @param {string} tagValue Tag value
     * @param {string} fromCategory Source category name
     * @param {string} toCategory Target category name
     * @param {string} tabName Tab name
     */
    static async _moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, shouldSave = true) {
        try {
            // Favorites page doesn't support cross-category moves
            if (tabName === 'favorites' || fromCategory === 'favorites' || toCategory === 'favorites') {
                logger.debug('[tagsmove] Favorite tags don\'t support cross-category movement');
                return false;
            }

            // If source and target categories are the same, skip
            if (fromCategory === toCategory) {
                return false;
            }

            const filename = this.currentCsvFile;
            if (!filename || !TagManager.tagData) {
                logger.error('[tagsmove] Cannot get current CSV file or tag data');
                return false;
            }

            // Get source and target categories
            const sourceCategory = TagManager._findCategoryRecursively(TagManager.tagData, fromCategory);
            const targetCategory = TagManager._findCategoryRecursively(TagManager.tagData, toCategory);

            if (!sourceCategory) {
                logger.error(`[tagsmove] Cannot find source category: ${fromCategory}`);
                return false;
            }

            if (!targetCategory) {
                logger.error(`[tagsmove] Cannot find target category: ${toCategory}`);
                return false;
            }

            // Check if target category already has tag with same name
            if (targetCategory.hasOwnProperty(tagName)) {
                app.extensionManager.toast.add({
                    severity: "warn",
                    summary: "Move failed",
                    detail: `Target category already has a tag with the same name "${tagName}"`,
                    life: 3000
                });
                return false;
            }

            // Delete tag from source category
            delete sourceCategory[tagName];

            // Add to target category
            targetCategory[tagName] = tagValue;

            if (!shouldSave) {
                return true;
            }

            // Save to CSV
            const success = await ResourceManager.saveTagsCsv(filename, TagManager.tagData);

            if (success) {
                logger.debug(`[tagsmove] successful | tag: ${tagName} | from: ${fromCategory} | to: ${toCategory}`);
                app.extensionManager.toast.add({
                    severity: "success",
                    summary: "Move successful",
                    detail: `Tag "${tagName}" has been moved to "${toCategory}"`,
                    life: 2000
                });
                return true;
            } else {
                // Rollback operation
                targetCategory[tagName] && delete targetCategory[tagName];
                sourceCategory[tagName] = tagValue;

                app.extensionManager.toast.add({
                    severity: "error",
                    summary: "Move failed",
                    detail: "Failed to save to server",
                    life: 3000
                });
                return false;
            }
        } catch (err) {
            logger.error(`[tagsmove] Error: ${err.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Move failed",
                detail: err.message,
                life: 3000
            });
            return false;
        }
    }

    /**
     * Check if tag is favorited
     */
    static _isTagFavorited(tagValue, category = null) {
        if (!this.favorites) return false;

        // If category is provided, check that category first
        if (category) {
            // Normalize category name (remove extension)
            const normalize = (name) => name.replace(/\.(csv|json|yaml|yml)$/i, '');
            const targetCat = normalize(category);

            // Check for direct match
            if (this.favorites[targetCat]) {
                return Object.values(this.favorites[targetCat]).includes(tagValue);
            }

            // If no direct key match found, may need to fuzzy match through keys?
            // Currently assumes keys are normalized.
            // But if favorites is old structure (flat), check values directly
            const isOldStructure = Object.values(this.favorites).some(v => typeof v !== 'object');
            if (isOldStructure) {
                // Old structure ignores category
                return Object.values(this.favorites).includes(tagValue);
            }

            return false;
        }

        // If no category provided (e.g., global search), check recursively
        // Recursively find value
        const checkRecursive = (obj) => {
            if (typeof obj !== 'object' || obj === null) return false;

            for (const value of Object.values(obj)) {
                if (typeof value === 'object' && value !== null) {
                    if (checkRecursive(value)) return true;
                } else if (value === tagValue) {
                    return true;
                }
            }
            return false;
        };

        return checkRecursive(this.favorites);
    }

    /**
     * Create tag element