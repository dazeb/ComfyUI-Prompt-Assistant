/**
 * Button Menu Service
 * Handles the logic for button right-click popup menu
 */

import { EventManager } from "../utils/eventManager.js";
import { logger } from "../utils/logger.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";

/**
 * Button Menu Management Class
 * Responsible for creating, displaying and hiding button context menus
 */
export class ButtonMenu {
    /**
     * Singleton instance
     */
    static _instance = null;

    /**
     * Get singleton instance
     */
    static getInstance() {
        if (!ButtonMenu._instance) {
            ButtonMenu._instance = new ButtonMenu();
        }
        return ButtonMenu._instance;
    }

    /**
     * Constructor
     * Initializes menu state and event handling
     */
    constructor() {
        // Current menu DOM element
        this.menuElement = null;

        // Current button that triggered the menu
        this.targetButton = null;

        // Menu item configuration
        this.menuItems = [];

        // Whether the menu is visible
        this.isMenuVisible = false;

        // Menu context data
        this.menuContext = {};

        // Initialize global click event to close the menu
        this._setupGlobalEvents();

        // Log
        logger.log("Button menu service initialized");
    }

    /**
     * Set up global event handling
     * Mainly handles clicking other areas to close the menu
     */
    _setupGlobalEvents() {
        // Use event manager to add document click event
        EventManager.addDOMListener(document, 'click', async (event) => {
            // If menu is visible and click is not inside the menu, hide the menu
            if (this.isMenuVisible && this.menuElement) {
                if (!this.menuElement.contains(event.target)) {
                    await this.hideMenu();
                }
            }
        });

        // Close menu on ESC key press
        EventManager.addDOMListener(document, 'keydown', async (event) => {
            if (event.key === 'Escape' && this.isMenuVisible) {
                await this.hideMenu();
            }
        });
    }

    /**
     * Create menu DOM element
     * @param {Array} items Menu item configuration array
     * @param {Object} context Menu context data
     * @returns {HTMLElement} Menu DOM element
     */
    _createMenuElement(items, context) {
        // Create menu container
        const menuContainer = document.createElement('div');
        menuContainer.className = 'button-context-menu';

        // Create menu item list
        const menuList = document.createElement('ul');
        menuList.className = 'button-menu-list';

        // Add menu items
        items.forEach(item => {
            // If it is a separator
            if (item.type === 'separator') {
                const separator = document.createElement('li');
                separator.className = 'button-menu-separator';
                menuList.appendChild(separator);
                return;
            }

            // Normal menu item
            const menuItem = document.createElement('li');
            menuItem.className = 'button-menu-item';

            // If there are children, mark style
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;
            if (hasChildren) {
                menuItem.classList.add('button-menu-item-has-children');
            }

            // If menu item is disabled
            if (item.disabled) {
                menuItem.classList.add('button-menu-item-disabled');
            } else {
                // Add click event (submenu items can also execute their own onClick)
                menuItem.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // If clicking on the right arrow or submenu itself, do not trigger this item's click
                    const isOnRightIcon = e.target && (e.target.classList?.contains('button-menu-right-icon') || e.target.classList?.contains('pi-chevron-right'));
                    const isInsideSubmenu = e.target && menuItem.querySelector('.button-submenu')?.contains(e.target);
                    if (isOnRightIcon || isInsideSubmenu) return;

                    // Hide menu
                    await this.hideMenu();

                    // Execute callback
                    if (typeof item.onClick === 'function') {
                        item.onClick(context);
                    }
                });

                // Show submenu on hover (show immediately on enter, hide logic handled after submenu construction to avoid "passing through gap")
                if (hasChildren) {
                    menuItem.addEventListener('mouseenter', () => {
                        menuItem.classList.add('submenu-open');
                    });
                    // mouseleave hide logic will be added after submenu construction with delay
                }
            }

            // Handle selected state
            if (item.selected) {
                menuItem.classList.add('selected');
            }

            // Add icon (if any)
            if (item.icon) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'button-menu-icon';

                // Support SVG icons
                if (typeof item.icon === 'string' && item.icon.startsWith('<svg')) {
                    iconSpan.innerHTML = item.icon;
                } else {
                    // Support character icons or custom HTML
                    iconSpan.innerHTML = item.icon;
                }

                menuItem.appendChild(iconSpan);
            }

            // Add label
            const labelSpan = document.createElement('span');
            labelSpan.className = 'button-menu-label';
            labelSpan.textContent = item.label || '';
            menuItem.appendChild(labelSpan);

            // If there is a shortcut hint
            if (item.shortcut) {
                const shortcutSpan = document.createElement('span');
                shortcutSpan.className = 'button-menu-shortcut';
                shortcutSpan.textContent = item.shortcut;
                menuItem.appendChild(shortcutSpan);
            }

            // If there are children, add right arrow icon
            if (hasChildren) {
                const rightIcon = document.createElement('span');
                rightIcon.className = 'button-menu-right-icon pi pi-chevron-right';
                menuItem.appendChild(rightIcon);

                // Build submenu
                const submenu = document.createElement('div');
                submenu.className = 'button-submenu';
                const submenuList = document.createElement('ul');
                submenuList.className = 'button-menu-list';

                // —— Debounced submenu show/hide to avoid closing when mouse passes through ——
                let hideTimer = null;
                // Get submenu alignment, default center
                const submenuAlign = item.submenuAlign || 'center';
                const openSubmenu = () => {
                    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
                    menuItem.classList.add('submenu-open');
                    // Use requestAnimationFrame to ensure submenu is rendered before adjusting position
                    requestAnimationFrame(() => {
                        this._adjustSubmenuPosition(submenu, menuItem, submenuAlign);
                    });
                };
                const scheduleCloseSubmenu = () => {
                    if (hideTimer) clearTimeout(hideTimer);
                    hideTimer = setTimeout(() => {
                        menuItem.classList.remove('submenu-open');
                        hideTimer = null;
                    }, 200);
                };

                // Mouse events for parent item and submenu to allow diagonal movement
                menuItem.addEventListener('mouseleave', scheduleCloseSubmenu);
                menuItem.addEventListener('mouseenter', openSubmenu);
                submenu.addEventListener('mouseenter', openSubmenu);
                submenu.addEventListener('mouseleave', scheduleCloseSubmenu);

                item.children.forEach(subItem => {
                    if (subItem.type === 'separator') {
                        const sep = document.createElement('li');
                        sep.className = 'button-menu-separator';
                        submenuList.appendChild(sep);
                        return;
                    }

                    const subMenuItem = document.createElement('li');
                    subMenuItem.className = 'button-menu-item';

                    // Check if submenu item has children (supports third-level and deeper menus)
                    const hasSubChildren = Array.isArray(subItem.children) && subItem.children.length > 0;
                    if (hasSubChildren) {
                        subMenuItem.classList.add('button-menu-item-has-children');
                    }

                    if (subItem.disabled) {
                        subMenuItem.classList.add('button-menu-item-disabled');
                    } else {
                        subMenuItem.addEventListener('click', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();

                            // If clicking on the right arrow or sub-submenu, do not trigger click
                            const isOnRightIcon = e.target && (e.target.classList?.contains('button-menu-right-icon') || e.target.classList?.contains('pi-chevron-right'));
                            const isInsideSubSubmenu = e.target && subMenuItem.querySelector('.button-submenu')?.contains(e.target);
                            if (isOnRightIcon || isInsideSubSubmenu) return;

                            // Hide menu
                            await this.hideMenu();

                            if (typeof subItem.onClick === 'function') {
                                subItem.onClick(context);
                            }
                        });

                        // If there are sub-submenus, add hover logic
                        if (hasSubChildren) {
                            subMenuItem.addEventListener('mouseenter', () => {
                                subMenuItem.classList.add('submenu-open');
                            });
                        }
                    }

                    if (subItem.icon) {
                        const subIcon = document.createElement('span');
                        subIcon.className = 'button-menu-icon';
                        if (typeof subItem.icon === 'string' && subItem.icon.startsWith('<svg')) {
                            subIcon.innerHTML = subItem.icon;
                        } else {
                            subIcon.innerHTML = subItem.icon;
                        }
                        subMenuItem.appendChild(subIcon);
                    }

                    const subLabel = document.createElement('span');
                    subLabel.className = 'button-menu-label';
                    subLabel.textContent = subItem.label || '';
                    subMenuItem.appendChild(subLabel);

                    if (subItem.shortcut) {
                        const subShortcut = document.createElement('span');
                        subShortcut.className = 'button-menu-shortcut';
                        subShortcut.textContent = subItem.shortcut;
                        subMenuItem.appendChild(subShortcut);
                    }

                    // If there are sub-submenus, create recursively
                    if (hasSubChildren) {
                        const subRightIcon = document.createElement('span');
                        subRightIcon.className = 'button-menu-right-icon pi pi-chevron-right';
                        subMenuItem.appendChild(subRightIcon);

                        // Build sub-submenu
                        const subSubmenu = document.createElement('div');
                        subSubmenu.className = 'button-submenu';
                        const subSubmenuList = document.createElement('ul');
                        subSubmenuList.className = 'button-menu-list';

                        // Debounce handling
                        let subHideTimer = null;
                        // Get sub-menu alignment, default center
                        const subSubmenuAlign = subItem.submenuAlign || 'center';
                        const openSubSubmenu = () => {
                            if (subHideTimer) { clearTimeout(subHideTimer); subHideTimer = null; }
                            subMenuItem.classList.add('submenu-open');
                            // Use requestAnimationFrame to ensure submenu is rendered before adjusting position
                            requestAnimationFrame(() => {
                                this._adjustSubmenuPosition(subSubmenu, subMenuItem, subSubmenuAlign);
                            });
                        };
                        const scheduleCloseSubSubmenu = () => {
                            if (subHideTimer) clearTimeout(subHideTimer);
                            subHideTimer = setTimeout(() => {
                                subMenuItem.classList.remove('submenu-open');
                                subHideTimer = null;
                            }, 200);
                        };

                        subMenuItem.addEventListener('mouseleave', scheduleCloseSubSubmenu);
                        subMenuItem.addEventListener('mouseenter', openSubSubmenu);
                        subSubmenu.addEventListener('mouseenter', openSubSubmenu);
                        subSubmenu.addEventListener('mouseleave', scheduleCloseSubSubmenu);

                        // Render third-level menu items
                        subItem.children.forEach(subSubItem => {
                            if (subSubItem.type === 'separator') {
                                const sep = document.createElement('li');
                                sep.className = 'button-menu-separator';
                                subSubmenuList.appendChild(sep);
                                return;
                            }

                            const subSubMenuItem = document.createElement('li');
                            subSubMenuItem.className = 'button-menu-item';

                            if (subSubItem.disabled) {
                                subSubMenuItem.classList.add('button-menu-item-disabled');
                            } else {
                                subSubMenuItem.addEventListener('click', async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    await this.hideMenu();
                                    if (typeof subSubItem.onClick === 'function') {
                                        subSubItem.onClick(context);
                                    }
                                });
                            }

                            if (subSubItem.icon) {
                                const subSubIcon = document.createElement('span');
                                subSubIcon.className = 'button-menu-icon';
                                subSubIcon.innerHTML = subSubItem.icon;
                                subSubMenuItem.appendChild(subSubIcon);
                            }

                            const subSubLabel = document.createElement('span');
                            subSubLabel.className = 'button-menu-label';
                            subSubLabel.textContent = subSubItem.label || '';
                            subSubMenuItem.appendChild(subSubLabel);

                            subSubmenuList.appendChild(subSubMenuItem);
                        });

                        subSubmenu.appendChild(subSubmenuList);
                        subMenuItem.appendChild(subSubmenu);
                    }

                    submenuList.appendChild(subMenuItem);
                });

                submenu.appendChild(submenuList);
                menuItem.appendChild(submenu);
            }

            // Add to menu list
            menuList.appendChild(menuItem);
        });

        // Add the menu list to the container
        menuContainer.appendChild(menuList);

        return menuContainer;
    }

    /**
     * Show menu
     * @param {HTMLElement} targetButton Button that triggered the menu
     * @param {Array} items Menu item configuration
     * @param {Object} context Menu context data
     * @param {Event} event Trigger event (for positioning)
     */
    async showMenu(targetButton, items, context = {}, event) {
        // Close any open popups first
        const { PopupManager } = await import('../utils/popupManager.js');

        // 【Critical】 Mark transitioning to prevent container collapse
        PopupManager._isTransitioning = true;

        await PopupManager.closeAllPopups();

        // Hide any existing menu first
        await this.hideMenu();

        // After all other windows are closed, set the active button state
        if (context.widget && targetButton.dataset.id) {
            UIToolkit.setActiveButton({
                widget: context.widget,
                buttonId: targetButton.dataset.id
            });
            logger.debug(`Context menu | Set active button | Button ID: ${targetButton.dataset.id}`);
        }

        // Save parameters
        this.targetButton = targetButton;
        this.menuItems = items;
        this.menuContext = context;

        // Create menu element
        this.menuElement = this._createMenuElement(items, context);

        // Add to document
        document.body.appendChild(this.menuElement);

        // Set menu position
        this._positionMenu(event);

        // Mark menu as visible
        this.isMenuVisible = true;

        // 【Critical】 Clear transition mark since menu is now displayed
        PopupManager._isTransitioning = false;

        // Prevent default context menu
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        // Add focus management
        this._setupKeyboardNavigation();
    }

    /**
     * Set up keyboard navigation
     */
    _setupKeyboardNavigation() {
        if (!this.menuElement) return;

        // Add keyboard event handling
        const keyHandler = (e) => {
            if (!this.isMenuVisible) return;

            switch (e.key) {
                case 'ArrowDown':
                    this._navigateMenu(1);
                    e.preventDefault();
                    break;
                case 'ArrowUp':
                    this._navigateMenu(-1);
                    e.preventDefault();
                    break;
                case 'Enter':
                    this._activateSelectedItem();
                    e.preventDefault();
                    break;
            }
        };

        // Add keyboard event listener
        document.addEventListener('keydown', keyHandler);

        // Save cleanup function
        this._keyboardCleanup = () => {
            document.removeEventListener('keydown', keyHandler);
        };
    }

    /**
     * Menu navigation
     * @param {number} direction Navigation direction (1: down, -1: up)
     */
    _navigateMenu(direction) {
        if (!this.menuElement) return;

        const items = this.menuElement.querySelectorAll('.button-menu-item:not(.button-menu-item-disabled)');
        if (items.length === 0) return;

        // Find currently selected item
        let currentIndex = -1;
        for (let i = 0; i < items.length; i++) {
            if (items[i].classList.contains('button-menu-item-focus')) {
                currentIndex = i;
                break;
            }
        }

        // Calculate next index
        let nextIndex;
        if (currentIndex === -1) {
            nextIndex = direction > 0 ? 0 : items.length - 1;
        } else {
            nextIndex = (currentIndex + direction + items.length) % items.length;
        }

        // Remove all focus
        items.forEach(item => item.classList.remove('button-menu-item-focus'));

        // Set new focus
        items[nextIndex].classList.add('button-menu-item-focus');
    }

    /**
     * Activate currently selected item
     */
    _activateSelectedItem() {
        if (!this.menuElement) return;

        const focusedItem = this.menuElement.querySelector('.button-menu-item-focus');
        if (focusedItem) {
            focusedItem.click();
        }
    }

    /**
     * Hide menu
     */
    async hideMenu() {
        const widget = this.menuContext?.widget;

        if (this.menuElement) {
            const menuToHide = this.menuElement; // Capture the menu element to hide

            // Remove menu element
            menuToHide.classList.remove('button-menu-visible');

            // Clean up keyboard navigation
            if (this._keyboardCleanup) {
                this._keyboardCleanup();
                this._keyboardCleanup = null;
            }

            // Use transitionend event listener
            const handleTransitionEnd = () => {
                if (menuToHide && menuToHide.parentNode) {
                    menuToHide.removeEventListener('transitionend', handleTransitionEnd);
                    menuToHide.parentNode.removeChild(menuToHide);

                    // Only set to null if the instance property still points to the menu we removed
                    if (this.menuElement === menuToHide) {
                        this.menuElement = null;
                    }
                }
            };

            // Listen for transition end event
            menuToHide.addEventListener('transitionend', handleTransitionEnd);

            // If animation does not start, set a timeout
            setTimeout(() => {
                if (menuToHide && menuToHide.parentNode) {
                    handleTransitionEnd();
                }
            }, 300); // Force remove after 300ms in case animation does not trigger
        }

        // Reset center button state
        UIToolkit.setActiveButton(null);
        // logger.debug('Context menu | Reset active button');

        // Trigger assistant visibility update to allow auto-collapse
        if (widget) {
            try {
                // Handle prompt assistant case
                if (widget.type === 'prompt_assistant') {
                    const { promptAssistant } = await import('../modules/PromptAssistant.js');
                    // First update visibility
                    promptAssistant.updateAssistantVisibility(widget);

                    // Directly trigger auto-collapse (if assistant is expanded)
                    if (!widget.isCollapsed) {
                        setTimeout(() => {
                            // Trigger auto-collapse in the next event loop
                            promptAssistant.triggerAutoCollapse(widget);
                        }, 100);
                    }
                }
                // Handle image caption assistant case - use more lenient detection condition
                else if (widget.type === 'image_caption_assistant' || widget.nodeId) {
                    const { imageCaption } = await import('../modules/imageCaption.js');
                    // First update visibility
                    imageCaption.updateAssistantVisibility(widget);

                    // Directly trigger auto-collapse (if assistant is expanded)
                    if (!widget.isCollapsed) {
                        setTimeout(() => {
                            // Trigger auto-collapse in the next event loop
                            imageCaption.triggerAutoCollapse(widget);
                        }, 100);
                    }
                }
                logger.debug(`Context menu closed | Triggered assistant visibility update | Type: ${widget.type || 'image caption assistant'}`);
            } catch (error) {
                logger.error(`Failed to trigger assistant visibility update: ${error.message}`);
            }
        }

        // Reset state
        this.isMenuVisible = false;
        this.targetButton = null;
        this.menuItems = [];
        this.menuContext = {};
    }

    /**
     * Position the menu
     * @param {Event} event Trigger event
     */
    _positionMenu(event) {
        if (!this.menuElement || !this.targetButton) return;

        const buttonRect = this.targetButton.getBoundingClientRect();
        const menuRect = this.menuElement.getBoundingClientRect();

        // Calculate menu position to center above the button
        let x = buttonRect.left + (buttonRect.width / 2) - (menuRect.width / 2);
        let y = buttonRect.top - menuRect.height - 4; // 4px margin

        // Set initial menu position
        this.menuElement.style.left = `${x}px`;
        this.menuElement.style.top = `${y}px`;

        // Ensure menu is within viewport
        setTimeout(() => this._adjustMenuPosition(), 0);
    }

    /**
     * Adjust menu position to ensure it is within the viewport
     */
    _adjustMenuPosition() {
        if (!this.menuElement) return;

        const menuRect = this.menuElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const margin = 12; // margin

        // Check and adjust horizontal position
        if (menuRect.right > viewportWidth - margin) {
            const newLeft = viewportWidth - menuRect.width - margin;
            this.menuElement.style.left = `${Math.max(margin, newLeft)}px`;
        } else if (menuRect.left < margin) {
            this.menuElement.style.left = `${margin}px`;
        }

        // Check and adjust vertical position
        if (menuRect.top < margin && this.targetButton) {
            const buttonRect = this.targetButton.getBoundingClientRect();
            let newTop = buttonRect.bottom + 4; // 4px margin

            // Check if placing it below makes it go off-screen at the bottom
            if (newTop + menuRect.height > viewportHeight - margin) {
                newTop = viewportHeight - menuRect.height - margin;
            }
            this.menuElement.style.top = `${Math.max(margin, newTop)}px`;

        } else if (menuRect.bottom > viewportHeight - margin) {
            const newTop = viewportHeight - menuRect.height - margin;
            this.menuElement.style.top = `${Math.max(margin, newTop)}px`;
        }

        // Add display animation
        requestAnimationFrame(() => {
            this.menuElement.classList.add('button-menu-visible');
        });
    }

    /**
     * Adjust submenu position
     * @param {HTMLElement} submenu Submenu element
     * @param {HTMLElement} parentItem Parent menu item element
     * @param {string} align Alignment: 'top' (top align), 'center' (center), 'bottom' (bottom align), default 'center'
     */
    _adjustSubmenuPosition(submenu, parentItem, align = 'center') {
        if (!submenu || !parentItem) return;

        const parentRect = parentItem.getBoundingClientRect();
        const submenuRect = submenu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const margin = 12;

        // Calculate initial vertical offset based on alignment
        let topOffset;
        switch (align) {
            case 'top':
                // Top align: submenu top aligns with parent top
                topOffset = 0;
                break;
            case 'bottom':
                // Bottom align: submenu bottom aligns with parent bottom
                topOffset = parentRect.height - submenuRect.height;
                break;
            case 'center':
            default:
                // Center: submenu center aligns with parent center
                topOffset = (parentRect.height - submenuRect.height) / 2;
                break;
        }

        // Calculate actual top position of the submenu (relative to viewport)
        let actualTop = parentRect.top + topOffset;

        // Clamp within viewport (dynamic adjustment)
        if (actualTop < margin) {
            // Exceeds top, adjust to top edge
            topOffset = margin - parentRect.top;
        } else if (actualTop + submenuRect.height > viewportHeight - margin) {
            // Exceeds bottom, adjust to bottom edge
            topOffset = viewportHeight - margin - submenuRect.height - parentRect.top;
        }

        // Set vertical position
        submenu.style.top = `${topOffset}px`;
        submenu.style.bottom = 'auto';

        // Check horizontal position: if right edge exceeds viewport, try to display on left
        const rightEdge = parentRect.right + submenuRect.width + 4;
        if (rightEdge > viewportWidth - margin) {
            // Display on the left of the parent menu
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
            submenu.style.marginLeft = '0';
            submenu.style.marginRight = '2px';
        } else {
            // Default: display on the right of the parent menu
            submenu.style.left = '100%';
            submenu.style.right = 'auto';
            submenu.style.marginLeft = '2px';
            submenu.style.marginRight = '0';
        }
    }

    /**
     * Public method: Set up button context menu
     * @param {HTMLElement} button Button element
     * @param {Function} getMenuItems Function to get menu items, receives context parameter, returns menu items array or Promise
     * @param {Object} context Context data
     */
    setupButtonMenu(button, getMenuItems, context = {}) {
        if (!button || typeof getMenuItems !== 'function') return;

        // Clean up any existing event listeners
        if (button._menuEventCleanup) {
            button._menuEventCleanup();
        }

        // Add context menu event
        const removeContextMenu = EventManager.addDOMListener(button, 'contextmenu', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            // Get current menu items - supports async function
            try {
                const menuItems = await Promise.resolve(getMenuItems(context));
                if (!menuItems || menuItems.length === 0) return;

                // Show menu
                await this.showMenu(button, menuItems, context, event);
            } catch (error) {
                logger.error(`Failed to get menu items: ${error.message}`);
            }
        });

        // Save cleanup function
        button._menuEventCleanup = () => {
            removeContextMenu();
        };

        // Return cleanup function for external use
        return button._menuEventCleanup;
    }
}

// Create and export styles
export function addButtonMenuStyles() {
    // Ensure resource manager is initialized
    if (!ResourceManager.isInitialized()) {
        ResourceManager.init();
    }

    // Styles are already defined in popup.css, no need to add extra
    logger.debug("Button menu styles loaded from popup.css");
}

/**
 * Export default instance
 */
export const buttonMenu = ButtonMenu.getInstance();

// Automatically add styles
addButtonMenuStyles();