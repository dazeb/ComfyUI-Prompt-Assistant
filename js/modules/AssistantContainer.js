import { app } from "../../../scripts/app.js";
import { EventManager } from "../utils/eventManager.js";
import "../lib/Sortable.min.js";

/**
 * Debug toggle: disable auto-collapse
 * Enter window.PA_DEBUG_NO_COLLAPSE = true in the console to disable auto-collapse
 * Enter window.PA_DEBUG_NO_COLLAPSE = false to restore auto-collapse
 */
window.PA_DEBUG_NO_COLLAPSE = window.PA_DEBUG_NO_COLLAPSE || false;

// Anchor position enum
export const ANCHOR_POSITION = {
    TOP_LEFT_H: 'top-left-h',
    TOP_LEFT_V: 'top-left-v',
    TOP_CENTER_H: 'top-center-h',
    TOP_RIGHT_H: 'top-right-h',
    TOP_RIGHT_V: 'top-right-v',
    RIGHT_CENTER_V: 'right-center-v',
    BOTTOM_RIGHT_H: 'bottom-right-h',
    BOTTOM_RIGHT_V: 'bottom-right-v',
    BOTTOM_CENTER_H: 'bottom-center-h',
    BOTTOM_LEFT_H: 'bottom-left-h',
    BOTTOM_LEFT_V: 'bottom-left-v',
    LEFT_CENTER_V: 'left-center-v'
};

export class AssistantContainer {
    constructor(options = {}) {
        this.nodeId = options.nodeId;
        this.type = options.type || 'prompt'; // 'prompt' or 'image'
        this.anchorPosition = options.anchorPosition || ANCHOR_POSITION.BOTTOM_RIGHT_H;
        this.offset = options.offset || { x: 0, y: 0 };
        this.enableDragSort = options.enableDragSort !== false;

        // Callbacks
        this.onButtonOrderChange = options.onButtonOrderChange;
        this.shouldCollapse = options.shouldCollapse;

        // State
        this.isCollapsed = true;
        this.isTransitioning = false;
        this.isDestroyed = false;
        this.buttons = [];
        this.element = null;
        this.container = null;
        this.hoverArea = null;
        this.indicator = null;
        this.content = null;

        // Timers
        this._collapseTimer = null;
        this._expandTimer = null;

        // Event cleanup functions
        this._cleanupFunctions = [];

        // Sortable instance
        this._sortable = null;
    }

    render() {
        // Check if already destroyed
        if (this.isDestroyed) return null;

        // Main container
        this.element = document.createElement('div');
        this.element.className = `assistant-container-common ${this.type}-assistant-container`;

        // Hover area (invisible, used to detect mouse enter/leave)
        this.hoverArea = document.createElement('div');
        this.hoverArea.className = 'assistant-hover-area';
        this.element.appendChild(this.hoverArea);

        // Indicator (icon)
        this.indicator = document.createElement('div');
        this.indicator.className = `assistant-indicator ${this.type}-assistant-indicator`;

        // Add entrance animation class
        this.indicator.classList.add('indicator-init');

        // Remove initialization class after animation ends
        this.indicator.addEventListener('animationend', () => {
            this.indicator.classList.remove('indicator-init');
        }, { once: true });

        this.element.appendChild(this.indicator);

        // Button content container
        this.content = document.createElement('div');
        this.content.className = 'assistant-content';
        this.element.appendChild(this.content);

        // Initial style based on anchor point
        this.updatePosition();

        // Bind events
        this._bindEvents();

        // Setup Sortable
        if (this.enableDragSort) {
            this._setupSortable();
        }

        return this.element;
    }

    mount(parentElement) {
        if (parentElement) {
            parentElement.appendChild(this.element);
            // Force reflow/update dimensions after mounting
            requestAnimationFrame(() => this.updateDimensions());
        }
    }

    setIconContent(svgContent) {
        if (this.indicator) {
            this.indicator.innerHTML = svgContent;
        }
    }

    addButton(buttonElement, id) {
        if (!buttonElement) return;
        buttonElement.dataset.id = id; // For Sortable

        // Set button index for progressive animation delay
        const buttonIndex = this.buttons.length;
        buttonElement.style.setProperty('--button-index', buttonIndex);

        this.content.appendChild(buttonElement);
        this.buttons.push({ id, element: buttonElement });

        // If it's a divider, set class name based on current layout direction
        if (buttonElement.classList.contains('prompt-assistant-divider') ||
            buttonElement.classList.contains('image-assistant-divider')) {
            const isVertical = this.anchorPosition.endsWith('-v');
            if (isVertical) {
                buttonElement.classList.add('divider-horizontal');
            }
        }

        this.updateDimensions();
    }

    // Batch add buttons. If Sortable already exists, it will follow Sortable's logic (usually append)
    // If specific order is needed, sort before adding.
    addButtons(buttonElementsWithIds) {
        buttonElementsWithIds.forEach(({ element, id }) => {
            this.addButton(element, id);
        });
    }

    // Clear buttons
    clearButtons() {
        this.content.innerHTML = '';
        this.buttons = [];
    }

    setAnchorPosition(position) {
        if (Object.values(ANCHOR_POSITION).includes(position)) {
            this.anchorPosition = position;
            this.updatePosition();
        }
    }

    updatePosition() {
        if (!this.element) return;

        // Save current expanded/collapsed state
        const wasExpanded = !this.isCollapsed;

        // Reset class names, keep current state
        const stateClass = wasExpanded ? 'expanded' : 'collapsed';
        this.element.className = `assistant-container-common ${this.type}-assistant-container ${stateClass}`;

        // Add layout class name
        this.element.classList.add(`layout-${this.anchorPosition}`);

        // Ensure content container's Flex direction is correct
        const isVertical = this.anchorPosition.endsWith('-v');
        if (isVertical) {
            this.content.classList.add('flex-col');
            this.content.classList.remove('flex-row');
        } else {
            this.content.classList.add('flex-row');
            this.content.classList.remove('flex-col');
        }

        // Update divider class names: add divider-horizontal class for vertical layout
        this._updateDividerOrientation(isVertical);

        // Trigger dimension recalculation
        this.updateDimensions();
    }

    // Update divider orientation class names
    _updateDividerOrientation(isVertical) {
        if (!this.content) return;
        const dividers = this.content.querySelectorAll('.prompt-assistant-divider, .image-assistant-divider');
        dividers.forEach(divider => {
            if (isVertical) {
                divider.classList.add('divider-horizontal');
            } else {
                divider.classList.remove('divider-horizontal');
            }
        });
    }

    /**
     * Update container dimensions (optimized version: constant layout mode)
     * Directly calculate dimensions based on currently enabled button combination, avoiding overhead of DOM clone measurement
     */
    updateDimensions() {
        if (!this.element || !this.content) return;

        // --- 1. Get current state statistics ---
        const buttons = Array.from(this.content.children).filter(el =>
            el.style.display !== 'none' &&
            !el.classList.contains('assistant-indicator')
        );

        const totalCount = buttons.length;
        if (totalCount === 0) return;

        // Count feature groups
        const hasHistoryGroup = buttons.some(el => el.dataset.id === 'history' || el.dataset.id === 'undo' || el.dataset.id === 'redo');
        const hasDivider = buttons.some(el => el.classList.contains('prompt-assistant-divider') || el.classList.contains('image-assistant-divider'));

        // Count valid feature buttons excluding history and dividers
        const otherFeaturesCount = buttons.filter(el =>
            !['history', 'undo', 'redo'].includes(el.dataset.id) &&
            !el.classList.contains('prompt-assistant-divider') &&
            !el.classList.contains('image-assistant-divider')
        ).length;

        // --- 2. Dimension mapping based on preset constants ---
        let finalDimension = 28; // Default single button width (or collapsed size)

        // Logical rule matching (based on precise measurements provided by user)
        if (hasHistoryGroup && otherFeaturesCount === 3) {
            finalDimension = 143; // All features enabled (history 3 + divider 1 + other 3)
        } else if (hasHistoryGroup && otherFeaturesCount === 2) {
            finalDimension = 121; // History + two others
        } else if (hasHistoryGroup && otherFeaturesCount === 1) {
            finalDimension = 99;  // History + one other
        } else if (hasHistoryGroup && otherFeaturesCount === 0) {
            finalDimension = 77;  // Only history features
        } else if (!hasHistoryGroup && otherFeaturesCount === 3) {
            finalDimension = 72;  // Three features without history
        } else if (!hasHistoryGroup && otherFeaturesCount === 2) {
            finalDimension = 50;  // Only two buttons
        } else if (!hasHistoryGroup && otherFeaturesCount === 1) {
            finalDimension = 28;  // Only one button
        } else {
            // Fallback dynamic calculation: base 28 + (extra buttons * 22) + (has divider ? 5 : 0)
            const extraCount = totalCount - 1;
            finalDimension = 28 + (extraCount * 22);
            if (hasDivider) finalDimension += 5;
        }

        // --- 3. Apply dimensions ---
        const isVertical = this.anchorPosition.endsWith('-v');
        if (isVertical) {
            // Vertical layout: fixed width, dynamic height
            this.element.style.setProperty('--expanded-width', `28px`);
            this.element.style.setProperty('--expanded-height', `${finalDimension}px`);
        } else {
            // Horizontal layout: fixed height, dynamic width
            this.element.style.setProperty('--expanded-width', `${finalDimension}px`);
            this.element.style.setProperty('--expanded-height', `28px`);
        }

        /* 
        // --- Original automatic measurement code (commented out, backup) ---
        const clone = this.content.cloneNode(true);
        clone.style.cssText = `
            position: absolute; 
            visibility: hidden; 
            height: auto; 
            width: auto; 
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 0;
        `;

        const isVerticalMeasure = this.anchorPosition.endsWith('-v');
        clone.style.flexDirection = isVerticalMeasure ? 'column' : 'row';

        document.body.appendChild(clone);
        const contentWidth = clone.scrollWidth;
        const contentHeight = clone.scrollHeight;
        document.body.removeChild(clone);

        const containerPadding = 4;
        const lastButtonMargin = 2;
        const collapsedSize = 28;

        let expandedWidth, expandedHeight;
        if (isVerticalMeasure) {
            expandedWidth = collapsedSize;
            expandedHeight = Math.max(contentHeight + containerPadding + lastButtonMargin, collapsedSize);
        } else {
            expandedWidth = Math.max(contentWidth + containerPadding + lastButtonMargin, collapsedSize);
            expandedHeight = collapsedSize;
        }

        this.element.style.setProperty('--expanded-width', `${expandedWidth}px`);
        this.element.style.setProperty('--expanded-height', `${expandedHeight}px`);
        */
    }

    _bindEvents() {
        // Hover handling with interrupt logic
        const onMouseEnter = () => this.expand();
        const onMouseLeave = () => this.collapse();

        // Bind to hover area and element itself
        // Use EventManager to bind for easy cleanup
        this._cleanupFunctions.push(EventManager.addDOMListener(this.element, 'mouseenter', onMouseEnter));
        this._cleanupFunctions.push(EventManager.addDOMListener(this.element, 'mouseleave', onMouseLeave));
    }

    expand() {
        // Check if already destroyed
        if (this.isDestroyed) return;

        // Clear any pending collapse timer
        if (this._collapseTimer) {
            clearTimeout(this._collapseTimer);
            this._collapseTimer = null;
        }

        // First update dimensions to ensure CSS variables are set before expanding
        this.updateDimensions();

        // Adjust button progressive animation index based on anchor position
        this._updateButtonStaggerIndex();

        // Expand immediately
        this.isCollapsed = false;
        this.element.classList.remove('collapsed');
        this.element.classList.add('expanded');

        // Hide indicator
        if (this.indicator) {
            this.indicator.style.opacity = '0';
            this.indicator.style.pointerEvents = 'none';
        }

        // Show content
        if (this.content) {
            this.content.style.opacity = '1';
            this.content.style.pointerEvents = 'auto';
        }
    }

    // Adjust button progressive animation index based on anchor position
    _updateButtonStaggerIndex() {
        if (!this.content) return;

        const children = Array.from(this.content.children);
        const totalButtons = children.length;

        // Determine whether reverse index is needed
        // When right layout expands leftwards or bottom layout expands upwards, reverse is needed (last button shows first)
        const needReverse = this._isReverseStaggerDirection();

        children.forEach((child, index) => {
            const staggerIndex = needReverse ? (totalButtons - 1 - index) : index;
            child.style.setProperty('--button-index', staggerIndex);
        });
    }

    // Determine whether progressive animation needs reversal
    _isReverseStaggerDirection() {
        // Layouts that expand from right/bottom need reversal
        // Right layout: expands leftwards, the rightmost button shows first
        // Bottom-v layout: expands upwards, the bottommost button shows first
        const pos = this.anchorPosition;

        // Horizontal layout: right side needs reversal
        if (pos.includes('right') && pos.endsWith('-h')) {
            return true;
        }
        // Vertical layout: bottom needs reversal (column-reverse)
        if (pos.includes('bottom') && pos.endsWith('-v')) {
            return true;
        }

        return false;
    }

    collapse() {
        // Check if already destroyed
        if (this.isDestroyed) return;

        // Debug mode: disable auto-collapse
        if (window.PA_DEBUG_NO_COLLAPSE) return;

        // Check if collapse should be prevented (e.g., active menu)
        if (this.shouldCollapse && !this.shouldCollapse()) {
            return;
        }

        // Set short delay before collapse to allow mouse to move between gaps/buttons
        // But if the user moves back, expand() will cancel this operation.
        this._collapseTimer = setTimeout(() => {
            // Check again because state may have changed during the delay
            if (this.shouldCollapse && !this.shouldCollapse()) {
                return;
            }

            this.isCollapsed = true;
            this.element.classList.remove('expanded');
            this.element.classList.add('collapsed');

            // Show indicator (clear inline styles to let CSS variable --assistant-icon-opacity take effect)
            if (this.indicator) {
                this.indicator.style.opacity = '';
                this.indicator.style.pointerEvents = '';
            }

            // Hide content
            if (this.content) {
                this.content.style.opacity = '0';
                this.content.style.pointerEvents = 'none';
            }

            // After collapse, detect if mouse is still in the hot zone
            // Fix issue where mouse is still in hot zone after auto-collapse but needs to move out and back in to expand
            this._checkMouseStillInHoverArea();
        }, 150); // Small delay set for ease of use
    }

    // --- Check if mouse is still in hot zone ---
    _checkMouseStillInHoverArea() {
        if (!this.element) return;

        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
            // Get elements under current mouse position
            const hoveredElements = document.querySelectorAll(':hover');

            // Check if assistant container or its children are hovered
            let isMouseInside = false;
            for (const el of hoveredElements) {
                if (this.element.contains(el) || el === this.element) {
                    isMouseInside = true;
                    break;
                }
            }

            // If mouse is still in hot zone and currently collapsed, trigger expand
            if (isMouseInside && this.isCollapsed) {
                this.expand();
            }
        });
    }

    _setupSortable() {
        if (!this.content) return;

        this._sortable = new Sortable(this.content, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                const newOrder = Array.from(this.content.children)
                    .map(el => el.dataset.id)
                    .filter(Boolean);

                // Save order
                if (this.onButtonOrderChange) {
                    this.onButtonOrderChange(newOrder);
                }

                // Persist to settings
                this._saveOrderToSettings(newOrder);
            }
        });
    }

    _saveOrderToSettings(order) {
        const settingKey = `PromptAssistant.ButtonOrder.${this.type}`;
        // Save using app.ui.settings
        // ComfyUI settings are usually set via app.ui.settings.setSettingValue(id, value)
        if (app.ui && app.ui.settings) {
            app.ui.settings.setSettingValue(settingKey, JSON.stringify(order));
        }
    }

    restoreOrder() {
        const settingKey = `PromptAssistant.ButtonOrder.${this.type}`;
        if (!app.ui || !app.ui.settings) return;

        const orderStr = app.ui.settings.getSettingValue(settingKey);
        if (!orderStr) return;

        try {
            const order = JSON.parse(orderStr);
            if (!Array.isArray(order) || order.length === 0) return;

            // Create mapping of existing buttons by ID
            const buttonMap = new Map();
            Array.from(this.content.children).forEach(el => {
                if (el.dataset.id) {
                    buttonMap.set(el.dataset.id, el);
                }
            });

            // Restore button positions in saved order, new buttons placed at end
            const existingButtons = Array.from(this.content.children);
            const orderedIds = new Set(order);

            // First append sorted items
            order.forEach(id => {
                const el = buttonMap.get(id);
                if (el) {
                    this.content.appendChild(el);
                }
            });

            // Then append any remaining items if they are not in the order list
            existingButtons.forEach(el => {
                if (el.dataset.id && !orderedIds.has(el.dataset.id)) {
                    this.content.appendChild(el);
                }
            });

            this.updateDimensions();
        } catch (e) {
            logger.warn("[PromptAssistant] Failed to restore button order:", e);
        }
    }

    destroy() {
        // Prevent duplicate destruction
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        // Clean up timers
        if (this._collapseTimer) {
            clearTimeout(this._collapseTimer);
            this._collapseTimer = null;
        }
        if (this._expandTimer) {
            clearTimeout(this._expandTimer);
            this._expandTimer = null;
        }

        // Clean up listeners
        this._cleanupFunctions.forEach(fn => fn && fn());
        this._cleanupFunctions = [];

        // Destroy Sortable
        if (this._sortable) {
            this._sortable.destroy();
            this._sortable = null;
        }

        // Remove element
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        // Clear all references
        this.element = null;
        this.container = null;
        this.content = null;
        this.indicator = null;
        this.hoverArea = null;
        this.buttons = [];
    }
}