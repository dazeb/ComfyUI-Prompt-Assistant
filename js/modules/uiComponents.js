/**
 * Generic UI Component Library
 * Provides reusable UI components in the project
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { tUI, localizeElement, observeLocalizedMutations } from "../utils/uiI18n.js";

// ---Dynamic Z-Index Calculation---
/**
 * Get the z-index value of ComfyUI settings dialog
 * Only search for ComfyUI's p-dialog element to avoid performance issues from traversing all DOM elements
 * @returns {number} The z-index value of ComfyUI dialog, or the base value if it does not exist
 */
function getComfyUIDialogZIndex() {
    // ComfyUI uses PrimeVue, the settings dialog class name is .p-dialog
    const comfyDialog = document.querySelector('.p-dialog');
    if (comfyDialog) {
        const zIndex = parseInt(window.getComputedStyle(comfyDialog).zIndex, 10);
        if (!isNaN(zIndex)) {
            return zIndex;
        }
    }
    // If no ComfyUI dialog is found, return the base value defined in CSS variable
    return 10200;
}

/**
 * Create a generic settings dialog
 * @param {Object} options Dialog configuration options
 * @param {string} options.title Dialog title
 * @param {Function} options.renderContent Function to render the dialog content
 * @param {Function} options.renderNotice Function to render the notice area (optional, displayed between title and content)
 * @param {Function} options.onSave Save button click callback
 * @param {Function} options.onCancel Cancel button click callback (optional)
 * @param {boolean} options.isConfirmDialog Whether it is a confirmation dialog (optional)
 * @param {string} options.saveButtonText Save button text (optional)
 * @param {string} options.cancelButtonText Cancel button text (optional)
 * @param {string} options.saveButtonIcon Save button icon (optional)
 * @param {boolean} options.isDangerButton Whether the save button is a danger button style (optional, red background)
 * @param {boolean} options.disableBackdropAndCloseOnClickOutside Disable backdrop and click outside to close (optional)
 */
export function createSettingsDialog(options) {
    try {
        const {
            title,
            renderContent,
            renderNotice = null,
            onSave,
            onCancel = null,
            onClose = null,  // Close callback (called regardless of save or cancel)
            isConfirmDialog = false,
            saveButtonText = tUI('Save'),
            cancelButtonText = tUI('Cancel'),
            saveButtonIcon = 'pi-check',
            isDangerButton = false,  // Whether it is a danger button
            dialogClassName = null,
            disableBackdropAndCloseOnClickOutside = false,
            hideFooter = false,  // Whether to hide the footer buttons
        } = options;

        let overlay = null;
        if (!disableBackdropAndCloseOnClickOutside) {
            // Create backdrop
            overlay = document.createElement('div');
            overlay.className = 'settings-modal-overlay';
            document.body.appendChild(overlay);
        }


        // Create dialog
        const modal = document.createElement('div');
        modal.className = 'settings-modal pa-settings-root';

        // If additional dialog class name is provided, add it to modal
        if (dialogClassName) {
            modal.classList.add(dialogClassName);
        }

        // If it is a confirmation dialog, set special styles
        if (isConfirmDialog) {
            // Only set default width when no custom class name is provided
            if (!dialogClassName) {
                modal.style.width = 'min(90vw, 400px)';
            }
            modal.style.minHeight = 'auto';
            // z-index is managed uniformly by CSS .settings-modal and .settings-modal-overlay, no need to set in JS
        }

        // Form modification state
        let isFormModified = false;

        // Internal close function: close the dialog and call onClose callback
        let stopContentLocalization = null;
        const closeDialog = () => {
            if (stopContentLocalization) {
                stopContentLocalization();
                stopContentLocalization = null;
            }
            closeModalWithAnimation(modal, overlay);
            // Call onClose after animation completes
            if (onClose) {
                setTimeout(() => {
                    onClose();
                }, 300); // Match animation time
            }
        };

        // Handle the logic of closing the dialog
        const handleCloseModal = async (saveAction) => {
            // If it is a save action, save directly and close, without showing confirmation dialog
            if (saveAction) {
                try {
                    await onSave(content);
                    closeDialog();
                } catch (error) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: tUI("Save Failed"),
                        detail: error.message,
                        life: 3000
                    });
                }
                return;
            }

            // Only show confirmation dialog when form is modified, it is not a confirmation dialog, and onCancel is not provided
            // If onCancel is provided, it means the caller chooses to skip the second confirmation
            if (isFormModified && !isConfirmDialog && !onCancel) {
                // Create confirmation dialog
                createSettingsDialog({
                    title: tUI('Confirm Action'),
                    isConfirmDialog: true,
                    saveButtonText: tUI('Return'),
                    saveButtonIcon: 'pi-undo',
                    cancelButtonText: tUI('Close'),
                    renderContent: (content) => {
                        content.style.textAlign = 'center';
                        content.style.padding = '1rem';

                        const confirmMessage = document.createElement('p');
                        confirmMessage.textContent = tUI('Configuration has been modified, do you want to save?');
                        confirmMessage.style.margin = '0';
                        confirmMessage.style.fontSize = '1rem';

                        content.appendChild(confirmMessage);
                    },
                    onSave: () => {
                        // Return button only closes the confirmation dialog, does not perform save
                        // No operation needed here, default dialog close logic will execute after button click
                    },
                    onCancel: () => {
                        // Close the main dialog
                        closeDialog();
                    }
                });
            } else {
                // No modification or is confirmation dialog or has onCancel, close directly
                if (onCancel && !isConfirmDialog) {
                    onCancel();
                }
                closeDialog();
            }
        };

        if (!disableBackdropAndCloseOnClickOutside) {
            // Click backdrop to close dialog
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    handleCloseModal(false);
                }
            });
        }

        // Create dialog header
        const header = document.createElement('div');
        header.className = 'p-dialog-header';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'p-dialog-title';
        titleSpan.innerHTML = title;

        const closeButton = document.createElement('button');
        closeButton.className = 'p-dialog-header-icon p-dialog-header-close p-link';
        closeButton.setAttribute('aria-label', tUI('Close'));
        closeButton.innerHTML = '<span class="pi pi-times"></span>';
        closeButton.onclick = () => {
            handleCloseModal(false);
        };

        const headerIcons = document.createElement('div');
        headerIcons.className = 'p-dialog-header-icons';
        headerIcons.appendChild(closeButton);

        header.appendChild(titleSpan);
        header.appendChild(headerIcons);

        // Create notice area (between title and content)
        let noticeArea = null;
        if (renderNotice) {
            noticeArea = document.createElement('div');
            noticeArea.className = 'p-dialog-notice';
            renderNotice(noticeArea);
        }

        // Create dialog content
        const content = document.createElement('div');
        content.className = 'p-dialog-content';

        // Listen for form changes
        const trackFormChanges = (formElement) => {
            // Add change listeners for all input elements
            const inputs = formElement.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                const originalValue = input.type === 'checkbox' ? input.checked : input.value;

                input.addEventListener('change', () => {
                    const currentValue = input.type === 'checkbox' ? input.checked : input.value;
                    // Only mark as modified when the value actually changes
                    if (currentValue !== originalValue) {
                        isFormModified = true;
                    }
                });

                if (input.tagName.toLowerCase() === 'textarea' || input.type === 'text') {
                    input.addEventListener('input', () => {
                        const currentValue = input.value;
                        // Only mark as modified when the value actually changes
                        if (currentValue !== originalValue) {
                            isFormModified = true;
                        }
                    });
                }
            });

            // Listen for custom dropdown changes
            const dropdowns = formElement.querySelectorAll('.p-dropdown');
            dropdowns.forEach(dropdown => {
                // Store original selected value
                const hiddenSelect = dropdown.querySelector('select');
                const originalValue = hiddenSelect ? hiddenSelect.value : '';

                const observer = new MutationObserver(() => {
                    const currentValue = hiddenSelect ? hiddenSelect.value : '';
                    // Only mark as modified when the value actually changes
                    if (currentValue !== originalValue) {
                        isFormModified = true;
                    }
                });
                observer.observe(dropdown, { attributes: true, childList: true, subtree: true });
            });
        };

        // Render content and track changes
        renderContent(content, header);
        localizeElement(header);
        if (noticeArea) {
            localizeElement(noticeArea);
        }
        localizeElement(content);
        stopContentLocalization = observeLocalizedMutations(modal);

        // If not a confirmation dialog and content has forms, add change tracking
        if (!isConfirmDialog) {
            const forms = content.querySelectorAll('form');
            forms.forEach(trackFormChanges);

            // If no form is found, watch the entire content area
            if (forms.length === 0) {
                trackFormChanges(content);
            }
        }

        // Create dialog footer
        const footer = document.createElement('div');
        footer.className = 'p-dialog-footer';

        const cancelButton = document.createElement('button');
        cancelButton.className = 'p-button p-component p-button-secondary';
        cancelButton.innerHTML = `<span class="p-button-icon-left pi pi-times"></span><span class="p-button-label">${cancelButtonText}</span>`;

        // Set different close behaviors for different dialog types
        if (isConfirmDialog) {
            cancelButton.onclick = () => {
                // For confirmation dialog, the "Close" button should execute onCancel callback (which closes the main window), then close itself
                if (onCancel) {
                    onCancel();
                }
                closeDialog();
            };
        } else {
            cancelButton.onclick = () => {
                // For normal dialog, use standard close handling logic
                handleCloseModal(false);
            };
        }

        const saveButton = document.createElement('button');
        // Set button style based on isDangerButton parameter
        saveButton.className = isDangerButton
            ? 'p-button p-component p-button-danger'
            : 'p-button p-component';
        saveButton.innerHTML = `<span class="p-button-icon-left pi ${saveButtonIcon}"></span><span class="p-button-label">${saveButtonText}</span>`;
        saveButton.onclick = () => {
            // If it is the Return button in the confirmation dialog, close the confirmation dialog directly
            if (isConfirmDialog) {
                try {
                    // For confirmation dialog, execute onSave callback first, then close the dialog
                    const result = onSave && onSave(content);
                    // If onSave returns Promise, wait for it to complete
                    if (result instanceof Promise) {
                        result.then(() => {
                            closeDialog();
                        }).catch(error => {
                            logger.error(`Confirmation dialog processing failed: ${error.message}`);
                            closeDialog();
                        });
                    } else {
                        // Normal return value, close directly
                        closeDialog();
                    }
                } catch (error) {
                    logger.error(`Confirmation dialog processing failed: ${error.message}`);
                    closeDialog();
                }
            } else {
                handleCloseModal(true);
            }
        };

        footer.appendChild(cancelButton);
        footer.appendChild(saveButton);

        // Add drag functionality
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;

        const startDragging = (e) => {
            if (e.target === closeButton || closeButton.contains(e.target)) return;

            e.preventDefault();
            isDragging = true;

            // Get offset of mouse relative to the modal
            const rect = modal.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            // Remove center positioning
            modal.style.transform = 'none';
            modal.style.left = rect.left + 'px';
            modal.style.top = rect.top + 'px';

            // Add dragging state
            modal.classList.add('dragging');

            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDragging);
        };

        const onDrag = (e) => {
            if (!isDragging) return;
            e.preventDefault();

            // Calculate new position (considering mouse offset inside the modal)
            let newLeft = e.clientX - offsetX;
            let newTop = e.clientY - offsetY;

            // Get viewport and modal dimensions
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const modalRect = modal.getBoundingClientRect();
            const modalWidth = modalRect.width;
            const modalHeight = modalRect.height;

            // Boundary check (keep 10px margin)
            const margin = 10;
            newLeft = Math.max(margin, Math.min(newLeft, viewportWidth - modalWidth - margin));
            newTop = Math.max(margin, Math.min(newTop, viewportHeight - modalHeight - margin));

            // Update position
            modal.style.left = `${newLeft}px`;
            modal.style.top = `${newTop}px`;
        };

        const stopDragging = () => {
            isDragging = false;
            modal.classList.remove('dragging');
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDragging);
        };

        header.addEventListener('mousedown', startDragging);

        // Assemble dialog
        modal.appendChild(header);
        if (noticeArea) {
            modal.appendChild(noticeArea);
        }
        modal.appendChild(content);

        // Only add footer buttons when hideFooter is false
        if (!hideFooter) {
            modal.appendChild(footer);
        }

        // Dynamically calculate z-index to ensure it is always above ComfyUI dialog
        // Must be set before appendChild, otherwise the animation start frame will use CSS static value
        const baseZIndex = getComfyUIDialogZIndex() + 10;
        modal.style.zIndex = baseZIndex;
        if (overlay) {
            overlay.style.zIndex = baseZIndex - 1;
        }

        // Show dialog and backdrop
        document.body.appendChild(modal);

        // Add display animation
        requestAnimationFrame(() => {
            modal.classList.add('modal-show');
            if (overlay) {
                overlay.classList.add('overlay-show');
            }
        });

        return modal;
    } catch (error) {
        logger.error(`Failed to create settings dialog: ${error.message}`);
        app.extensionManager.toast.add({
            severity: "error",
            summary: tUI("Failed to create dialog"),
            detail: error.message || tUI("An error occurred while creating the settings dialog"),
            life: 3000
        });
    }
}

/**
 * Close the dialog with animation effect
 * @param {HTMLElement} modal Dialog element
 * @param {HTMLElement} overlay Backdrop element
 */
export function closeModalWithAnimation(modal, overlay) {
    // Add close animation class
    modal.classList.remove('modal-show');
    modal.classList.add('modal-hide');
    if (overlay) {
        overlay.classList.remove('overlay-show');
        overlay.classList.add('overlay-hide');
    }

    // Wait for animation to complete before removing dialog and backdrop
    setTimeout(() => {
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }, 300); // Match CSS transition duration
}

/**
 * Create a form group
 * @param {string} title Form group title
 * @param {Array<{text: string, url: string}>} links Array of links to the right of the title
 * @param {Object} [options] Additional options
 * @param {string} [options.prefixText] Prefix plain text before links (not a link, not wrapped in a tag)
 * @returns {HTMLElement} Form group container
 */
export function createFormGroup(title, links = [], options = {}) {
    const { prefixText = null } = options;

    const group = document.createElement('div');
    group.className = 'settings-form-section';

    const titleContainer = document.createElement('div');
    titleContainer.className = 'settings-form-section-header';
    titleContainer.style.display = 'flex';
    titleContainer.style.alignItems = 'center';
    titleContainer.style.justifyContent = 'space-between';
    titleContainer.style.marginBottom = '10px';

    const titleElem = document.createElement('h3');
    titleElem.className = 'settings-form-section-title';
    titleElem.textContent = tUI(title, title);
    titleElem.style.margin = '0';

    const linksContainer = document.createElement('div');
    linksContainer.style.display = 'flex';
    linksContainer.style.gap = '8px';
    linksContainer.style.alignItems = 'center';

    if (links.length > 0) {
        const serviceLinksContainer = document.createElement('div');
        serviceLinksContainer.className = 'settings-service-links';

        // Optional prefix text, keep same font size as links (not wrapped in <a> tag)
        if (prefixText) {
            const prefix = document.createElement('span');
            prefix.className = 'settings-service-prefix';
            prefix.textContent = tUI(prefixText, prefixText);
            serviceLinksContainer.appendChild(prefix);
        }

        links.forEach((linkInfo, index) => {
            if (index > 0) {
                // Add separator
                const separator = document.createElement('span');
                separator.textContent = '｜';
                separator.className = 'settings-service-separator';
                serviceLinksContainer.appendChild(separator);
            }

            const link = document.createElement('a');
            link.href = linkInfo.url;
            link.target = '_blank';
            link.textContent = tUI(linkInfo.text, linkInfo.text);
            link.className = 'settings-service-link';

            serviceLinksContainer.appendChild(link);
        });

        linksContainer.appendChild(serviceLinksContainer);
    }

    titleContainer.appendChild(titleElem);
    titleContainer.appendChild(linksContainer);
    group.appendChild(titleContainer);

    return group;
}

/**
 * Create a floating label input group (PrimeVue FloatLabel variant="on" style)
 * @param {string} label Label text
 * @param {string} placeholder Placeholder text
 * @param {string} type Input type
 * @returns {Object} Object containing group and input
 */
export function createInputGroup(label, placeholder, type = 'text') {
    const group = document.createElement('div');
    group.className = 'settings-form-group';

    // Create floating label container
    const floatContainer = document.createElement('div');
    floatContainer.className = 'float-label-container';

    // Create input
    const input = document.createElement('input');
    input.className = 'p-inputtext p-component';
    input.type = type;
    // Use space as placeholder to trigger :not(:placeholder-shown) selector
    input.placeholder = ' ';

    // Create floating label
    const floatLabel = document.createElement('label');
    floatLabel.textContent = tUI(label, label);

    // Assemble structure: input first, label after (uses ~ selector)
    floatContainer.appendChild(input);
    floatContainer.appendChild(floatLabel);

    // If it is a number input, add custom up/down adjustment buttons
    if (type === 'number') {
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'number-input-buttons';

        // Increase button
        const increaseBtn = document.createElement('button');
        increaseBtn.className = 'number-input-button';
        increaseBtn.type = 'button';
        increaseBtn.innerHTML = '<i class="pi pi-chevron-up"></i>';
        increaseBtn.addEventListener('click', () => {
            const step = parseFloat(input.step) || 1;
            const max = input.max ? parseFloat(input.max) : Infinity;
            const currentValue = parseFloat(input.value) || 0;
            const newValue = Math.min(currentValue + step, max);
            input.value = newValue;
            // Trigger change event to save data
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Decrease button
        const decreaseBtn = document.createElement('button');
        decreaseBtn.className = 'number-input-button';
        decreaseBtn.type = 'button';
        decreaseBtn.innerHTML = '<i class="pi pi-chevron-down"></i>';
        decreaseBtn.addEventListener('click', () => {
            const step = parseFloat(input.step) || 1;
            const min = input.min ? parseFloat(input.min) : -Infinity;
            const currentValue = parseFloat(input.value) || 0;
            const newValue = Math.max(currentValue - step, min);
            input.value = newValue;
            // Trigger change event to save data
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });

        buttonsContainer.appendChild(increaseBtn);
        buttonsContainer.appendChild(decreaseBtn);
        floatContainer.appendChild(buttonsContainer);
    }

    group.appendChild(floatContainer);

    return { group, input };
}

/**
 * Create a dropdown select group (PrimeVue FloatLabel variant="on" style)
 * @param {string} label Label text
 * @param {Array<{value: string, text: string}>} options List of options
 * @param {string} [initialValue=null] Initial selected value
 * @param {Object} [config={}] Configuration options
 * @param {boolean} [config.showLabel=true] Whether to show floating label
 * @returns {Object} Object containing group and select
 */
export function createSelectGroup(label, options, initialValue = null, config = {}) {
    const { showLabel = true } = config;

    const group = document.createElement('div');
    group.className = 'settings-form-group';

    // Create floating label container
    const floatContainer = document.createElement('div');
    floatContainer.className = 'float-label-container';

    // Main Container
    const dropdownContainer = document.createElement('div');
    // Add custom style class pa-dropdown, keep p-dropdown for compatibility with existing logic (like dirty checking and layout selectors)
    dropdownContainer.className = 'pa-dropdown p-dropdown p-component w-full';
    dropdownContainer.style.position = 'relative'; // Needed for panel positioning

    // Hidden select for form data and accessibility
    const select = document.createElement('select');
    const hiddenContainer = document.createElement('div');
    hiddenContainer.className = 'p-hidden-accessible';
    hiddenContainer.appendChild(select);

    // Visible Part: Label and Trigger
    const dropdownLabel = document.createElement('span');
    dropdownLabel.className = 'pa-dropdown-label p-dropdown-label p-inputtext';

    const dropdownTrigger = document.createElement('div');
    dropdownTrigger.className = 'pa-dropdown-trigger p-dropdown-trigger';
    dropdownTrigger.innerHTML = '<span class="p-dropdown-trigger-icon pi pi-chevron-down"></span>';

    // Dropdown Panel (the menu)
    const dropdownPanel = document.createElement('div');
    dropdownPanel.className = 'pa-dropdown-panel p-dropdown-panel p-component settings-modal-dropdown-panel';
    dropdownPanel.style.display = 'none'; // Initially hidden
    // z-index is managed by CSS variable --settings-dropdown-z-index

    const dropdownItemsWrapper = document.createElement('div');
    dropdownItemsWrapper.className = 'p-dropdown-items-wrapper';

    const dropdownList = document.createElement('ul');
    dropdownList.className = 'p-dropdown-items';
    dropdownList.setAttribute('role', 'listbox');

    /**
     * Update dropdown options
     * @param {Array<{value: string, text: string}>} newOptions - New options list
     * @param {string} [newValue=null] - New selected value
     */
    const updateOptions = (newOptions, newValue = null) => {
        // Clear existing options
        select.innerHTML = '';
        dropdownList.innerHTML = '';

        if (!newOptions || newOptions.length === 0) {
            dropdownLabel.textContent = tUI('No options');
            return;
        }

        // Fill new options
        newOptions.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt.value;
            optionEl.textContent = tUI(opt.text, opt.text);
            select.appendChild(optionEl);

            const itemEl = document.createElement('li');
            itemEl.className = 'p-dropdown-item';
            itemEl.textContent = tUI(opt.text, opt.text);
            itemEl.dataset.value = opt.value;
            itemEl.setAttribute('role', 'option');

            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                // Update highlight
                dropdownList.querySelectorAll('.p-dropdown-item').forEach(el => el.classList.remove('p-highlight'));
                itemEl.classList.add('p-highlight');

                select.value = opt.value;
                dropdownLabel.textContent = tUI(opt.text, opt.text);
                closePanel();
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });

            dropdownList.appendChild(itemEl);
        });

        // Set selected value
        // If newValue is provided and exists in options, use it; otherwise try to keep current value; finally default to first item
        const currentVal = select.value;
        const valToSet = (newValue !== null && newOptions.some(o => o.value === newValue))
            ? newValue
            : (newOptions.some(o => o.value === currentVal) ? currentVal : newOptions[0].value);

        if (valToSet !== null) {
            const selectedOption = newOptions.find(o => o.value === valToSet);
            if (selectedOption) {
                dropdownLabel.textContent = tUI(selectedOption.text, selectedOption.text);
                select.value = selectedOption.value;
                // Set highlight
                const initialItem = dropdownList.querySelector(`.p-dropdown-item[data-value="${valToSet}"]`);
                if (initialItem) {
                    initialItem.classList.add('p-highlight');
                }
            }
        }
    };

    // Initialize and render options
    updateOptions(options, initialValue);

    // Assemble dropdown
    dropdownItemsWrapper.appendChild(dropdownList);
    dropdownPanel.appendChild(dropdownItemsWrapper);

    dropdownContainer.appendChild(hiddenContainer);
    dropdownContainer.appendChild(dropdownLabel);
    dropdownContainer.appendChild(dropdownTrigger);

    // Decide whether to create floating label based on showLabel
    if (showLabel) {
        // Create floating label
        const floatLabel = document.createElement('label');
        floatLabel.textContent = tUI(label, label);

        // Assemble floating label structure: dropdown first, label after
        floatContainer.appendChild(dropdownContainer);
        floatContainer.appendChild(floatLabel);
    } else {
        // Do not show floating label, add dropdown directly
        floatContainer.appendChild(dropdownContainer);
    }

    group.appendChild(floatContainer);

    // --- Event Handling ---
    let isOpen = false;

    // Function to update panel position
    const updatePanelPosition = () => {
        if (!isOpen) return;

        const rect = dropdownContainer.getBoundingClientRect();
        dropdownPanel.style.top = rect.bottom + 'px';
        dropdownPanel.style.left = rect.left + 'px';
        dropdownPanel.style.width = rect.width + 'px';
    };

    const closePanel = () => {
        if (!isOpen) return;
        isOpen = false;

        dropdownPanel.classList.add('p-hidden');
        dropdownPanel.classList.remove('p-enter-active');
        dropdownContainer.classList.remove('p-dropdown-open', 'p-focus');

        // Remove event listeners
        window.removeEventListener('resize', updatePanelPosition);
        window.removeEventListener('scroll', updatePanelPosition, true);

        // Wait for animation to complete before removing panel and event listeners
        setTimeout(() => {
            if (dropdownPanel.parentNode === document.body) {
                document.body.removeChild(dropdownPanel);
            }
            document.removeEventListener('click', handleOutsideClick, true);
        }, 120); // Match CSS transition duration
    };

    const openPanel = () => {
        isOpen = true;

        // Temporarily attach panel to body to avoid clipping
        document.body.appendChild(dropdownPanel);

        // Calculate position relative to viewport
        const rect = dropdownContainer.getBoundingClientRect();

        // Set panel styles
        dropdownPanel.style.position = 'fixed';
        dropdownPanel.style.display = 'block';
        dropdownPanel.style.top = rect.bottom + 'px';
        dropdownPanel.style.left = rect.left + 'px';
        dropdownPanel.style.width = rect.width + 'px';
        // Dynamically calculate z-index to ensure above ComfyUI dialog
        dropdownPanel.style.zIndex = getComfyUIDialogZIndex() + 15;

        dropdownPanel.classList.remove('p-hidden');
        // Force reflow to ensure animation takes effect
        dropdownPanel.offsetHeight;
        dropdownPanel.classList.add('p-enter-active');
        dropdownContainer.classList.add('p-dropdown-open', 'p-focus');

        document.addEventListener('click', handleOutsideClick, true);

        // Add window resize and scroll event listeners to reposition panel
        window.addEventListener('resize', updatePanelPosition);
        window.addEventListener('scroll', updatePanelPosition, true);
    };

    const handleOutsideClick = (e) => {
        // If the dropdown itself is clicked, toggle state
        if (dropdownContainer.contains(e.target)) {
            e.stopPropagation();
            if (isOpen) {
                closePanel();
            } else {
                openPanel();
            }
            return;
        }
        // If other area is clicked, close panel
        closePanel();
    };

    // Initialize panel state
    dropdownPanel.classList.add('p-hidden');
    dropdownContainer.addEventListener('click', handleOutsideClick);

    select.addEventListener('change', () => {
        const selectedOption = options.find(o => o.value === select.value);
        if (selectedOption) {
            dropdownLabel.textContent = tUI(selectedOption.text, selectedOption.text);
            // Update highlight
            dropdownList.querySelectorAll('.p-dropdown-item').forEach(el => {
                if (el.dataset.value === select.value) {
                    el.classList.add('p-highlight');
                } else {
                    el.classList.remove('p-highlight');
                }
            });
        }
    });

    return { group, select, updateOptions };
}

/**
 * Create an editable dropdown group (Combo Box)
 * Supports selecting from dropdown list or custom input
 * @param {string} label Label text
 * @param {Array<{value: string, text: string}>} options List of options (dynamic)
 * @param {string} [initialValue=''] Initial value
 * @param {Object} [config={}] Configuration options
 * @param {string} [config.placeholder=''] Input placeholder
 * @param {string} [config.emptyText='No options'] Empty text when no options
 * @param {boolean} [config.showLabel=true] Whether to show floating label
 * @returns {Object} Object containing group, input, setValue, getValue, updateOptions
 */
export function createComboBoxGroup(label, options = [], initialValue = '', config = {}) {
    const {
        placeholder = '',
        emptyText = tUI('No options'),
        showLabel = true
    } = config;

    const group = document.createElement('div');
    group.className = 'settings-form-group';

    // Create floating label container
    const floatContainer = document.createElement('div');
    floatContainer.className = 'float-label-container';

    // ---Main container---
    const comboContainer = document.createElement('div');
    comboContainer.className = 'pa-combobox pa-dropdown p-dropdown p-component w-full';
    comboContainer.style.position = 'relative';

    // ---Input (visible and editable)---
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pa-combobox-input pa-dropdown-label p-dropdown-label p-inputtext';
    input.placeholder = placeholder || ' ';
    input.value = initialValue;

    // ---Dropdown trigger (arrow icon)---
    const dropdownTrigger = document.createElement('div');
    dropdownTrigger.className = 'pa-dropdown-trigger p-dropdown-trigger';
    dropdownTrigger.innerHTML = '<span class="p-dropdown-trigger-icon pi pi-chevron-down"></span>';

    // ---Dropdown panel---
    const dropdownPanel = document.createElement('div');
    dropdownPanel.className = 'pa-dropdown-panel pa-combobox-panel p-dropdown-panel p-component settings-modal-dropdown-panel';
    dropdownPanel.style.display = 'none';

    const dropdownItemsWrapper = document.createElement('div');
    dropdownItemsWrapper.className = 'p-dropdown-items-wrapper';

    const dropdownList = document.createElement('ul');
    dropdownList.className = 'p-dropdown-items';
    dropdownList.setAttribute('role', 'listbox');

    // ---State variables---
    let isOpen = false;
    let currentOptions = [...options];

    // ---Render options list---
    const renderOptions = (optionsList) => {
        dropdownList.innerHTML = '';

        if (optionsList.length === 0) {
            // Show empty state hint
            const emptyItem = document.createElement('li');
            emptyItem.className = 'p-dropdown-item pa-combobox-empty';
            emptyItem.textContent = tUI(emptyText, emptyText);
            emptyItem.style.color = 'var(--p-text-muted-color)';
            emptyItem.style.fontStyle = 'italic';
            emptyItem.style.pointerEvents = 'none';
            dropdownList.appendChild(emptyItem);
            return;
        }

        optionsList.forEach(opt => {
            const itemEl = document.createElement('li');
            itemEl.className = 'p-dropdown-item';
            itemEl.textContent = tUI(opt.text, opt.text);
            itemEl.dataset.value = opt.value;
            itemEl.setAttribute('role', 'option');

            // Highlight current selected item
            if (input.value === opt.value) {
                itemEl.classList.add('p-highlight');
            }

            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                // Update input value
                input.value = opt.value;
                // Update highlight
                dropdownList.querySelectorAll('.p-dropdown-item').forEach(el => el.classList.remove('p-highlight'));
                itemEl.classList.add('p-highlight');
                // Close panel
                closePanel();
                // Trigger change event
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });

            dropdownList.appendChild(itemEl);
        });
    };

    // Initial render
    renderOptions(currentOptions);

    // ---Assemble dropdown panel---
    dropdownItemsWrapper.appendChild(dropdownList);
    dropdownPanel.appendChild(dropdownItemsWrapper);

    // ---Assemble main container---
    comboContainer.appendChild(input);
    comboContainer.appendChild(dropdownTrigger);

    // ---Decide whether to create floating label based on showLabel---
    if (showLabel) {
        const floatLabel = document.createElement('label');
        floatLabel.textContent = tUI(label, label);
        floatContainer.appendChild(comboContainer);
        floatContainer.appendChild(floatLabel);
    } else {
        floatContainer.appendChild(comboContainer);
    }

    group.appendChild(floatContainer);

    // ---Update panel position---
    const updatePanelPosition = () => {
        if (!isOpen) return;
        const rect = comboContainer.getBoundingClientRect();
        dropdownPanel.style.top = rect.bottom + 'px';
        dropdownPanel.style.left = rect.left + 'px';
        dropdownPanel.style.width = rect.width + 'px';
    };

    // ---Close panel---
    const closePanel = () => {
        if (!isOpen) return;
        isOpen = false;

        dropdownPanel.classList.add('p-hidden');
        dropdownPanel.classList.remove('p-enter-active');
        comboContainer.classList.remove('p-dropdown-open', 'p-focus');

        window.removeEventListener('resize', updatePanelPosition);
        window.removeEventListener('scroll', updatePanelPosition, true);

        setTimeout(() => {
            if (dropdownPanel.parentNode === document.body) {
                document.body.removeChild(dropdownPanel);
            }
            document.removeEventListener('click', handleOutsideClick, true);
        }, 120);
    };

    // ---Open panel---
    const openPanel = () => {
        if (isOpen) return;
        isOpen = true;

        document.body.appendChild(dropdownPanel);

        const rect = comboContainer.getBoundingClientRect();
        dropdownPanel.style.position = 'fixed';
        dropdownPanel.style.display = 'block';
        dropdownPanel.style.top = rect.bottom + 'px';
        dropdownPanel.style.left = rect.left + 'px';
        dropdownPanel.style.width = rect.width + 'px';
        // Dynamically calculate z-index to ensure above ComfyUI dialog
        dropdownPanel.style.zIndex = getComfyUIDialogZIndex() + 15;

        dropdownPanel.classList.remove('p-hidden');
        dropdownPanel.offsetHeight; // Force reflow
        dropdownPanel.classList.add('p-enter-active');
        comboContainer.classList.add('p-dropdown-open', 'p-focus');

        document.addEventListener('click', handleOutsideClick, true);
        window.addEventListener('resize', updatePanelPosition);
        window.addEventListener('scroll', updatePanelPosition, true);

        // Update highlight state
        dropdownList.querySelectorAll('.p-dropdown-item').forEach(el => {
            if (el.dataset.value === input.value) {
                el.classList.add('p-highlight');
            } else {
                el.classList.remove('p-highlight');
            }
        });
    };

    // ---Handle outside click---
    const handleOutsideClick = (e) => {
        // Do not close if clicking inside panel
        if (dropdownPanel.contains(e.target)) {
            return;
        }
        // Toggle state when clicking input or trigger
        if (comboContainer.contains(e.target)) {
            return; // Handled by input or trigger events
        }
        closePanel();
    };

    // ---Input events---
    input.addEventListener('focus', () => {
        openPanel();
        comboContainer.classList.add('p-focus');
    });

    input.addEventListener('blur', () => {
        // Delay close to allow option click
        setTimeout(() => {
            if (!dropdownPanel.contains(document.activeElement)) {
                comboContainer.classList.remove('p-focus');
            }
        }, 150);
    });

    // ---Trigger click event---
    dropdownTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen) {
            closePanel();
        } else {
            openPanel();
            input.focus();
        }
    });

    // ---Initialize panel state---
    dropdownPanel.classList.add('p-hidden');

    // ---Public methods---
    const setValue = (value) => {
        input.value = value;
        // Update highlight
        dropdownList.querySelectorAll('.p-dropdown-item').forEach(el => {
            if (el.dataset.value === value) {
                el.classList.add('p-highlight');
            } else {
                el.classList.remove('p-highlight');
            }
        });
    };

    const getValue = () => {
        return input.value;
    };

    const updateOptions = (newOptions) => {
        currentOptions = [...newOptions];
        renderOptions(currentOptions);
    };

    return { group, input, setValue, getValue, updateOptions };
}

/**
 * Create a horizontal layout form group
 * @param {Array<{label: string, element: HTMLElement}>} items Array of form items
 * @returns {HTMLElement} Horizontal layout form group
 */
export function createHorizontalFormGroup(items) {
    const group = document.createElement('div');
    group.className = 'settings-form-group horizontal';

    items.forEach(item => {
        const container = document.createElement('div');

        const label = document.createElement('label');
        label.className = 'settings-form-label';
        label.textContent = tUI(item.label, item.label);

        container.appendChild(label);
        container.appendChild(item.element);

        group.appendChild(container);
    });

    return group;
}

/**
 * Create a multi-line text input group (PrimeVue FloatLabel variant="on" style)
 * @param {string} label Label text
 * @param {string} placeholder Placeholder text (unused, kept for compatibility)
 * @param {number} rows Default number of rows
 * @returns {Object} Object containing group and textarea
 */
export function createTextareaGroup(label, placeholder, rows = 8) {
    const group = document.createElement('div');
    group.className = 'settings-form-group';

    // Create floating label container
    const floatContainer = document.createElement('div');
    floatContainer.className = 'float-label-container';

    // Create textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'p-inputtext p-component settings-form-textarea';
    // Use space as placeholder to trigger :not(:placeholder-shown) selector
    textarea.placeholder = ' ';
    textarea.rows = rows;
    textarea.style.resize = 'vertical';
    textarea.style.minHeight = '150px';

    // Create floating label
    const floatLabel = document.createElement('label');
    floatLabel.textContent = tUI(label, label);

    // Assemble structure: textarea first, label after (uses ~ selector)
    floatContainer.appendChild(textarea);
    floatContainer.appendChild(floatLabel);

    group.appendChild(floatContainer);

    return { group, textarea };
}

/**
 * Create a switch control component
 * @param {string} label Label text
 * @param {string} description Description text
 * @param {boolean} defaultChecked Default checked state
 * @param {Function} onChange Change callback
 * @returns {HTMLElement} Switch container element
 */
export function createSwitchControl(label, description, defaultChecked, onChange) {
    const container = document.createElement('div');
    container.className = 'switch-control-container';

    const textContainer = document.createElement('div');
    textContainer.className = 'switch-control-text';

    const labelEl = document.createElement('div');
    labelEl.className = 'switch-control-label';
    labelEl.textContent = tUI(label, label);
    textContainer.appendChild(labelEl);

    if (description) {
        const descEl = document.createElement('div');
        descEl.className = 'switch-control-desc';
        descEl.textContent = tUI(description, description);
        textContainer.appendChild(descEl);
    }

    container.appendChild(textContainer);

    // Create switch
    const switchWrapper = document.createElement('label');
    switchWrapper.className = 'switch-wrapper';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = defaultChecked;

    const slider = document.createElement('span');
    slider.className = `switch-slider${defaultChecked ? ' checked' : ''}`;

    const sliderButton = document.createElement('span');
    sliderButton.className = `switch-button${defaultChecked ? ' checked' : ''}`;
    slider.appendChild(sliderButton);

    input.addEventListener('change', async (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
            slider.classList.add('checked');
            sliderButton.classList.add('checked');
        } else {
            slider.classList.remove('checked');
            sliderButton.classList.remove('checked');
        }
        if (onChange) {
            await onChange(isChecked);
        }
    });

    switchWrapper.appendChild(input);
    switchWrapper.appendChild(slider);
    container.appendChild(switchWrapper);

    return container;
}

/**
 * Create a loading button
 * @param {string} text Button text
 * @param {Function} onClick Click callback
 * @param {boolean} showSuccessToast Whether to show success toast
 * @returns {HTMLElement} Button element
 */
export function createLoadingButton(text, onClick, showSuccessToast = true) {
    const button = document.createElement('button');
    button.className = 'p-button p-component p-button-primary';
    button.style.width = '208px'; // equivalent to w-52
    button.innerHTML = `<span class="p-button-label">${tUI(text, text)}</span>`;

    button.addEventListener('click', async () => {
        if (button.disabled) return;

        // Start loading state
        button.disabled = true;
        button.classList.add('p-disabled');

        try {
            await onClick();

            // Only show success toast when showSuccessToast is true
            if (showSuccessToast) {
                app.extensionManager.toast.add({
                    severity: "success",
                    summary: tUI("Cleanup completed"),
                    life: 3000
                });
            }

        } catch (error) {
            // Show error toast
            app.extensionManager.toast.add({
                severity: "error",
                summary: tUI("Operation failed"),
                detail: error.message || tUI("An error occurred during the operation"),
                life: 3000
            });
            logger.error(`Button operation failed: ${error.message}`);
        } finally {
            // Restore button state
            button.disabled = false;
            button.classList.remove('p-disabled');
        }
    });

    return button;
}

/**
 * Create a confirmation popup (reference PrimeVue ConfirmPopup)
 * @param {Object} options Configuration options
 * @param {HTMLElement} options.target Trigger element, the popup arrow points to it
 * @param {string} options.message Confirmation message text
 * @param {string} [options.icon] Message icon class name (optional, default 'pi-info-circle')
 * @param {Function} options.renderFormContent Function to render form content (optional)
 * @param {Function} options.onConfirm Confirm callback
 * @param {Function} [options.onCancel] Cancel callback (optional)
 * @param {string} [options.confirmLabel='Confirm'] Confirm button text
 * @param {string} [options.cancelLabel='Cancel'] Cancel button text
 * @param {string} [options.position='bottom'] Position relative to trigger element ('top', 'bottom', 'left', 'right')
 * @param {boolean} [options.autoPosition=true] Whether to automatically calculate best popup position (based on element position in window)
 * @param {boolean} [options.singleButton=false] Whether to show only a single confirm button (for info prompt scenarios)
 * @returns {Object} Object containing popup element and close method
 */
export function createConfirmPopup(options) {
    const {
        target,
        message,
        icon = 'pi-info-circle',
        iconColor = null,
        renderFormContent = null,
        onConfirm,
        onCancel = null,
        confirmLabel = tUI('Confirm'),
        cancelLabel = tUI('Cancel'),
        position = 'bottom',
        autoPosition = true,
        singleButton = false,
        confirmDanger = false
    } = options;

    // Create popup container
    const popup = document.createElement('div');
    popup.className = 'pa-confirm-popup';

    // Create popup content
    const content = document.createElement('div');
    content.className = 'pa-confirm-popup-content';

    // Create message area
    const messageContainer = document.createElement('div');
    messageContainer.className = 'pa-confirm-popup-message';

    const iconElement = document.createElement('i');
    iconElement.className = `pi ${icon} pa-confirm-popup-icon`;
    if (iconColor) {
        iconElement.style.color = iconColor;
    }
    messageContainer.appendChild(iconElement);

    const messageText = document.createElement('span');
    messageText.textContent = tUI(message, message);
    messageContainer.appendChild(messageText);

    content.appendChild(messageContainer);

    // If form rendering function is provided, create form area
    let formContainer = null;
    if (renderFormContent) {
        // Adjust message area bottom margin
        messageContainer.style.marginBottom = '12px';

        // Add divider
        const divider = document.createElement('div');
        divider.className = 'pa-confirm-popup-divider';
        content.appendChild(divider);

        formContainer = document.createElement('div');
        formContainer.className = 'pa-confirm-popup-form';
        renderFormContent(formContainer);
        content.appendChild(formContainer);
    }

    // Create button group
    const footer = document.createElement('div');
    footer.className = 'pa-confirm-popup-footer';

    // Single button mode: only show confirm button
    if (singleButton) {
        const confirmButton = document.createElement('button');
        confirmButton.className = confirmDanger
            ? 'p-button p-component p-button-sm p-button-danger'
            : 'p-button p-component p-button-sm';
        confirmButton.innerHTML = `<span class="p-button-icon-left pi pi-check"></span><span class="p-button-label">${tUI(confirmLabel, confirmLabel)}</span>`;
        confirmButton.onclick = async () => {
            try {
                if (onConfirm) {
                    await onConfirm(formContainer);
                }
                closePopup();
            } catch (error) {
                logger.error('Confirmation operation failed', error);
                // If confirmation operation fails, do not close popup
            }
        };
        footer.appendChild(confirmButton);
    } else {
        // Dual button mode: show cancel and confirm buttons
        const cancelButton = document.createElement('button');
        cancelButton.className = 'p-button p-component p-button-secondary p-button-sm';
        cancelButton.innerHTML = `<span class="p-button-icon-left pi pi-times"></span><span class="p-button-label">${tUI(cancelLabel, cancelLabel)}</span>`;
        cancelButton.onclick = () => {
            if (onCancel) {
                onCancel();
            }
            closePopup();
        };

        const confirmButton = document.createElement('button');
        confirmButton.className = confirmDanger
            ? 'p-button p-component p-button-sm p-button-danger'
            : 'p-button p-component p-button-sm';
        confirmButton.innerHTML = `<span class="p-button-icon-left pi pi-check"></span><span class="p-button-label">${tUI(confirmLabel, confirmLabel)}</span>`;
        confirmButton.onclick = async () => {
            try {
                // Pass form container to onConfirm callback
                await onConfirm(formContainer);
                closePopup();
            } catch (error) {
                logger.error('Confirmation operation failed', error);
                // If confirmation operation fails, do not close popup
            }
        };

        footer.appendChild(cancelButton);
        footer.appendChild(confirmButton);
    }
    content.appendChild(footer);

    // Create arrow
    const arrow = document.createElement('div');
    arrow.className = 'pa-confirm-popup-arrow';

    popup.appendChild(arrow);
    popup.appendChild(content);

    const stopPopupLocalization = observeLocalizedMutations(popup);

    // Function to close popup
    const closePopup = () => {
        stopPopupLocalization();
        popup.classList.add('pa-confirm-popup-hide');
        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
            // Remove click outside close event listener
            document.removeEventListener('click', handleOutsideClick, true);
        }, 200);
    };

    // Click outside to close
    const handleOutsideClick = (e) => {
        if (!popup.contains(e.target) && !target.contains(e.target)) {
            if (onCancel) {
                onCancel();
            }
            closePopup();
        }
    };

    // ---Position popup---
    const positionPopup = () => {
        const targetRect = target.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const margin = 10;
        const gap = 12; // Gap between popup and target
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let top, left;
        let arrowPosition = '';
        let finalPosition = position;

        // If auto-positioning is enabled, calculate best direction based on target element position
        if (autoPosition) {
            // Calculate available space in each direction
            const spaceTop = targetRect.top - margin;
            const spaceBottom = viewportHeight - targetRect.bottom - margin;
            const spaceLeft = targetRect.left - margin;
            const spaceRight = viewportWidth - targetRect.right - margin;

            // Check if each direction can fit the popup
            const canFitTop = spaceTop >= popupRect.height + gap;
            const canFitBottom = spaceBottom >= popupRect.height + gap;
            const canFitLeft = spaceLeft >= popupRect.width + gap;
            const canFitRight = spaceRight >= popupRect.width + gap;

            // Choose best direction based on target element position
            // Priority: user-specified direction > opposite direction > vertical/horizontal alternative
            const preferHorizontal = (position === 'left' || position === 'right');

            if (preferHorizontal) {
                // User prefers horizontal direction
                if (position === 'left' && canFitLeft) {
                    finalPosition = 'left';
                } else if (position === 'right' && canFitRight) {
                    finalPosition = 'right';
                } else if (canFitRight) {
                    finalPosition = 'right';
                } else if (canFitLeft) {
                    finalPosition = 'left';
                } else if (canFitBottom) {
                    finalPosition = 'bottom';
                } else if (canFitTop) {
                    finalPosition = 'top';
                } else {
                    // No direction has enough space, choose direction with largest vertical space
                    finalPosition = spaceBottom >= spaceTop ? 'bottom' : 'top';
                }
            } else {
                // User prefers vertical direction (default)
                if (position === 'bottom' && canFitBottom) {
                    finalPosition = 'bottom';
                } else if (position === 'top' && canFitTop) {
                    finalPosition = 'top';
                } else if (canFitBottom) {
                    finalPosition = 'bottom';
                } else if (canFitTop) {
                    finalPosition = 'top';
                } else if (canFitRight) {
                    finalPosition = 'right';
                } else if (canFitLeft) {
                    finalPosition = 'left';
                } else {
                    // No direction has enough space, choose direction with largest vertical space
                    finalPosition = spaceBottom >= spaceTop ? 'bottom' : 'top';
                }
            }
        }

        // Calculate position based on final direction
        switch (finalPosition) {
            case 'top':
                top = targetRect.top - popupRect.height - gap;
                left = targetRect.left + (targetRect.width / 2) - (popupRect.width / 2);
                arrowPosition = 'bottom';
                break;
            case 'left':
                top = targetRect.top + (targetRect.height / 2) - (popupRect.height / 2);
                left = targetRect.left - popupRect.width - gap;
                arrowPosition = 'right';
                break;
            case 'right':
                top = targetRect.top + (targetRect.height / 2) - (popupRect.height / 2);
                left = targetRect.right + gap;
                arrowPosition = 'left';
                break;
            case 'bottom':
            default:
                top = targetRect.bottom + gap;
                left = targetRect.left + (targetRect.width / 2) - (popupRect.width / 2);
                arrowPosition = 'top';
                break;
        }

        // Horizontal boundary check (ensure popup does not go out of viewport)
        if (left < margin) {
            left = margin;
        } else if (left + popupRect.width > viewportWidth - margin) {
            left = viewportWidth - popupRect.width - margin;
        }

        // Vertical boundary check
        if (top < margin) {
            top = margin;
        } else if (top + popupRect.height > viewportHeight - margin) {
            top = viewportHeight - popupRect.height - margin;
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;

        // Set arrow position
        arrow.className = `pa-confirm-popup-arrow ${arrowPosition}`;

        // Calculate arrow offset to point to the center of the trigger element
        if (arrowPosition === 'top' || arrowPosition === 'bottom') {
            let arrowLeft = targetRect.left + (targetRect.width / 2) - left;
            // Ensure arrow does not go beyond popup boundary
            arrowLeft = Math.max(16, Math.min(arrowLeft, popupRect.width - 16));
            arrow.style.left = `${arrowLeft}px`;
            arrow.style.top = '';
        } else if (arrowPosition === 'left' || arrowPosition === 'right') {
            let arrowTop = targetRect.top + (targetRect.height / 2) - top;
            // Ensure arrow does not go beyond popup boundary
            arrowTop = Math.max(16, Math.min(arrowTop, popupRect.height - 16));
            arrow.style.top = `${arrowTop}px`;
            arrow.style.left = '';
        }
    };

    // Add popup to body
    document.body.appendChild(popup);
    localizeElement(popup);

    // Position popup
    requestAnimationFrame(() => {
        positionPopup();
        popup.classList.add('pa-confirm-popup-show');

        // Delay adding outside click listener to prevent immediate trigger
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick, true);
        }, 100);
    });

    return {
        popup,
        close: closePopup
    };
}

/**
 * Create a context menu component (reference PrimeVue Menu)
 * @param {Object} options Configuration options
 * @param {HTMLElement} options.target Trigger element, the context menu will be triggered on this element
 * @param {Array<Object>} options.items List of menu items
 * @param {string} options.items[].label Menu item text
 * @param {string} [options.items[].icon] Menu item icon class name (optional)
 * @param {Function} options.items[].onClick Menu item click callback
 * @param {boolean} [options.items[].separator] Whether it is a separator (optional)
 * @param {boolean} [options.items[].disabled] Whether it is disabled (optional)
 * @returns {Object} Object containing destroy method
 */
/**
 * Show a context menu (dynamic display, no need to bind to specific element)
 * @param {Object} options Configuration options
 * @param {number} options.x Display position X coordinate
 * @param {number} options.y Display position Y coordinate
 * @param {Array<Object>} options.items List of menu items
 * @param {Function} [options.onClose] Menu close callback
 */
export function showContextMenu(options) {
    const {
        x,
        y,
        items = [],
        onClose
    } = options;

    // Remove existing context menu (but not Split Button menu or dropdown menu)
    const existingMenu = document.querySelector('.pa-context-menu:not(.pa-split-button-menu):not(.pa-dropdown-menu)');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'pa-context-menu pa-context-menu-show'; // Show directly

    // We need to manually set styles to ensure it is immediately visible but can be positioned
    menu.style.display = 'block';

    const menuList = document.createElement('ul');
    menuList.className = 'pa-context-menu-list';

    const closeMenu = () => {
        menu.classList.remove('pa-context-menu-show');
        menu.classList.add('pa-context-menu-hide');

        setTimeout(() => {
            if (menu && menu.parentNode) {
                menu.parentNode.removeChild(menu);
            }
        }, 150);

        document.removeEventListener('click', handleOutsideClick, true);
        document.removeEventListener('contextmenu', handleOutsideClick, true);

        if (onClose) {
            onClose();
        }
    };

    items.forEach(item => {
        if (item.separator) {
            const separator = document.createElement('li');
            separator.className = 'pa-context-menu-separator';
            menuList.appendChild(separator);
        } else {
            const menuItem = document.createElement('li');
            menuItem.className = 'pa-context-menu-item';

            if (item.disabled) {
                menuItem.classList.add('disabled');
            }

            if (item.danger) {
                menuItem.classList.add('danger');
            }

            const menuItemContent = document.createElement('div');
            menuItemContent.className = 'pa-context-menu-item-content';

            if (item.icon) {
                const icon = document.createElement('i');
                icon.className = `pi ${item.icon} pa-context-menu-item-icon`;
                menuItemContent.appendChild(icon);
            }

            const label = document.createElement('span');
            label.className = 'pa-context-menu-item-label';
            label.textContent = tUI(item.label, item.label);
            menuItemContent.appendChild(label);

            menuItem.appendChild(menuItemContent);

            if (!item.disabled && item.onClick) {
                menuItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    item.onClick(e);
                    closeMenu();
                });
            }

            menuList.appendChild(menuItem);
        }
    });

    menu.appendChild(menuList);
    document.body.appendChild(menu);

    // Position menu
    const menuRect = menu.getBoundingClientRect();
    let left = x;
    let top = y;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left + menuRect.width > viewportWidth) {
        left = viewportWidth - menuRect.width - 10;
    }

    if (top + menuRect.height > viewportHeight) {
        top = viewportHeight - menuRect.height - 10;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    // Click outside to close
    const handleOutsideClick = (e) => {
        if (menu && !menu.contains(e.target)) {
            closeMenu();
        }
    };

    // Delay adding outside click listener
    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick, true);
        document.addEventListener('contextmenu', handleOutsideClick, true);
    }, 100);

    return {
        close: closeMenu
    };
}

/**
 * Create a context menu component (reference PrimeVue Menu)
 * @param {Object} options Configuration options
 * @param {HTMLElement} options.target Trigger element, the context menu will be triggered on this element
 * @param {Array<Object>|Function} options.items List of menu items or a function that returns a list of menu items
 * @returns {Object} Object containing destroy method
 */
export function createContextMenu(options) {
    const {
        target,
        items = []
    } = options;

    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // If items is a function, call it to get the latest menu item list
        const menuItems = typeof items === 'function' ? items() : items;

        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: menuItems
        });
    };

    target.addEventListener('contextmenu', handleContextMenu);

    const destroy = () => {
        target.removeEventListener('contextmenu', handleContextMenu);
    };

    return {
        destroy
    };
}

/**
 * Create a Tooltip (reference PrimeVue Tooltip)
 * @param {Object} options Configuration options
 * @param {HTMLElement} options.target Trigger element
 * @param {string} options.content Tooltip content
 * @param {string} [options.position='top'] Tooltip position ('top', 'bottom', 'left', 'right')
 * @returns {Object} Object containing destroy method
 */
export function createTooltip(options) {
    const {
        target,
        content,
        position = 'top'
    } = options;

    let tooltip = null;
    let showTimeout = null;
    let hideTimeout = null;

    // Create tooltip element
    const createTooltipElement = () => {
        tooltip = document.createElement('div');
        tooltip.className = 'pa-tooltip';
        tooltip.textContent = tUI(content, content);

        // Create arrow
        const arrow = document.createElement('div');
        arrow.className = 'pa-tooltip-arrow';
        tooltip.appendChild(arrow);

        document.body.appendChild(tooltip);
    };

    // Position tooltip
    const positionTooltip = () => {
        if (!tooltip) return;

        const targetRect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let top, left;
        let arrowClass = '';

        switch (position) {
            case 'top':
                top = targetRect.top - tooltipRect.height - 8;
                left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
                arrowClass = 'bottom';
                break;
            case 'bottom':
                top = targetRect.bottom + 8;
                left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
                arrowClass = 'top';
                break;
            case 'left':
                top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
                left = targetRect.left - tooltipRect.width - 8;
                arrowClass = 'right';
                break;
            case 'right':
                top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
                left = targetRect.right + 8;
                arrowClass = 'left';
                break;
        }

        // Boundary check
        const margin = 10;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (left < margin) {
            left = margin;
        } else if (left + tooltipRect.width > viewportWidth - margin) {
            left = viewportWidth - tooltipRect.width - margin;
        }

        if (top < margin) {
            top = margin;
        } else if (top + tooltipRect.height > viewportHeight - margin) {
            top = viewportHeight - tooltipRect.height - margin;
        }

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;

        const arrow = tooltip.querySelector('.pa-tooltip-arrow');
        if (arrow) {
            arrow.className = `pa-tooltip-arrow ${arrowClass}`;
        }
    };

    // Show tooltip
    const showTooltip = () => {
        clearTimeout(hideTimeout);
        showTimeout = setTimeout(() => {
            if (!tooltip) {
                createTooltipElement();
            }
            positionTooltip();
            requestAnimationFrame(() => {
                tooltip.classList.add('pa-tooltip-show');
            });
        }, 200); // Show after 200ms delay
    };

    // Hide tooltip
    const hideTooltip = () => {
        clearTimeout(showTimeout);
        if (tooltip) {
            tooltip.classList.remove('pa-tooltip-show');
            hideTimeout = setTimeout(() => {
                if (tooltip && tooltip.parentNode) {
                    tooltip.parentNode.removeChild(tooltip);
                    tooltip = null;
                }
            }, 150);
        }
    };

    // Bind events
    target.addEventListener('mouseenter', showTooltip);
    target.addEventListener('mouseleave', hideTooltip);

    // Destroy method
    const destroy = () => {
        clearTimeout(showTimeout);
        clearTimeout(hideTimeout);
        target.removeEventListener('mouseenter', showTooltip);
        target.removeEventListener('mouseleave', hideTooltip);
        if (tooltip && tooltip.parentNode) {
            tooltip.parentNode.removeChild(tooltip);
        }
        tooltip = null;
    };

    return {
        destroy
    };
}

/**
 * Create a multi-select Listbox component
 * @param {Object} options Configuration options
 * @param {HTMLElement} options.triggerElement Trigger element (button) for positioning
 * @param {string} options.placeholder Search box placeholder
 * @param {Function} options.fetchItems Async function to fetch data, returns Promise<Array>
 * @param {Function} options.onConfirm Selection confirmation callback, parameters are array of selected items
 * @param {Function} options.onCancel Cancel callback (optional)
 * @returns {void}
 */
export function createMultiSelectListbox(options) {
    const {
        triggerElement,
        placeholder = tUI('Search...'),
        fetchItems,
        onConfirm,
        onCancel = null
    } = options;

    // Get trigger button position
    const btnRect = triggerElement.getBoundingClientRect();

    // Create listbox container
    const listbox = document.createElement('div');
    listbox.className = 'pa-multi-listbox';

    // Create search box container
    const searchContainer = document.createElement('div');
    searchContainer.className = 'pa-multi-listbox-search';

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'pa-multi-listbox-search-wrapper';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = tUI(placeholder, placeholder);
    searchInput.className = 'pa-multi-listbox-search-input';

    const searchIcon = document.createElement('i');
    searchIcon.className = 'pi pi-search pa-multi-listbox-search-icon';

    searchWrapper.appendChild(searchInput);
    searchWrapper.appendChild(searchIcon);
    searchContainer.appendChild(searchWrapper);
    listbox.appendChild(searchContainer);

    // Create list container
    const listContainer = document.createElement('div');
    listContainer.className = 'pa-multi-listbox-content';
    listbox.appendChild(listContainer);

    // Create footer action bar
    const footer = document.createElement('div');
    footer.className = 'pa-multi-listbox-footer';

    const countLabel = document.createElement('span');
    countLabel.className = 'pa-multi-listbox-count';
    countLabel.textContent = tUI('Selected 0 items');

    const actions = document.createElement('div');
    actions.className = 'pa-multi-listbox-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'p-button p-component p-button-secondary p-button-sm';
    cancelBtn.innerHTML = `<span class="p-button-icon-left pi pi-times"></span><span class="p-button-label">${tUI('Cancel')}</span>`;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'p-button p-component p-button-sm';
    confirmBtn.innerHTML = `<span class="p-button-icon-left pi pi-check"></span><span class="p-button-label">${tUI('Confirm')}</span>`;
    confirmBtn.disabled = true;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    footer.appendChild(countLabel);
    footer.appendChild(actions);
    listbox.appendChild(footer);

    // Data storage
    let allItems = [];
    let selectedItems = new Set();

    // Show loading state
    const showLoading = () => {
        listContainer.innerHTML = `
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text">${tUI('Loading...')}</div>
            </div>
        `;
    };

    // Show error message
    const showError = (message) => {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                <div style="font-size: 14px; color: var(--p-text-color); margin-bottom: 8px;">${tUI('Load Failed')}</div>
                <div style="font-size: 13px; color: var(--p-red-500);">${message}</div>
                <div style="font-size: 12px; color: var(--p-text-muted-color); margin-top: 12px;">${tUI('You can still manually type the model name in the search box')}</div>
            </div>
        `;
        // Do not disable the search box, allow users to manually type model names
    };

    // Update selected count
    const updateCount = () => {
        countLabel.textContent = `${tUI('Selected')} ${selectedItems.size} ${tUI('items')}`;
        // Enable confirm button if there are selected items or search box has content
        const hasInput = searchInput.value.trim().length > 0;
        confirmBtn.disabled = selectedItems.size === 0 && !hasInput;
    };

    // Render list
    const renderList = (searchTerm = '') => {
        listContainer.innerHTML = '';

        const filteredItems = searchTerm
            ? allItems.filter(item => item.toLowerCase().includes(searchTerm.toLowerCase()))
            : allItems;

        if (filteredItems.length === 0) {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'pa-multi-listbox-empty';
            emptyHint.textContent = searchTerm ? tUI('No matching items found') : tUI('No available items');
            listContainer.appendChild(emptyHint);
            return;
        }

        filteredItems.forEach(itemName => {
            const item = document.createElement('div');
            item.className = 'pa-multi-listbox-item';
            if (selectedItems.has(itemName)) {
                item.classList.add('selected');
            }

            const checkbox = document.createElement('div');
            checkbox.className = 'pa-multi-listbox-checkbox';

            const label = document.createElement('span');
            label.textContent = itemName;

            item.appendChild(checkbox);
            item.appendChild(label);

            // Click to toggle selection state
            item.addEventListener('click', () => {
                if (selectedItems.has(itemName)) {
                    selectedItems.delete(itemName);
                    item.classList.remove('selected');
                } else {
                    selectedItems.add(itemName);
                    item.classList.add('selected');
                }
                updateCount();
            });

            listContainer.appendChild(item);
        });
    };

    // Initialize data
    const initialize = async () => {
        showLoading();
        try {
            const items = await fetchItems();
            if (!items || !Array.isArray(items)) {
                throw new Error(tUI('Invalid data format'));
            }
            allItems = items;
            renderList();
        } catch (error) {
            showError(error.message || tUI('Unknown error'));
        }
    };

    // Search box event
    searchInput.addEventListener('input', (e) => {
        renderList(e.target.value);
        updateCount(); // Update button state on input
    });

    // Cancel button
    cancelBtn.addEventListener('click', () => {
        if (onCancel) {
            onCancel();
        }
        close();
    });

    // Confirm button
    confirmBtn.addEventListener('click', () => {
        const selected = Array.from(selectedItems);
        const searchValue = searchInput.value; // Get search box value
        onConfirm(selected, searchValue); // Pass search box value as second parameter
        close();
    });

    // Create transparent background layer
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: var(--settings-multi-listbox-z-index);
    `;

    overlay.appendChild(listbox);
    document.body.appendChild(overlay);
    localizeElement(listbox);
    const stopListboxLocalization = observeLocalizedMutations(listbox);

    // Calculate and set position (right-aligned with button, auto-adjust vertically)
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const listboxHeight = 400; // max-height
    const spaceBelow = viewportHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;

    if (spaceBelow >= listboxHeight || spaceBelow > spaceAbove) {
        // Display below the button
        listbox.style.top = `${btnRect.bottom + 4}px`;
    } else {
        // Display above the button
        listbox.style.bottom = `${viewportHeight - btnRect.top + 4}px`;
    }

    // Right-align with button
    listbox.style.right = `${viewportWidth - btnRect.right}px`;

    // Close function
    const close = () => {
        stopListboxLocalization();
        if (overlay.parentNode) {
            document.body.removeChild(overlay);
        }
    };

    // Click background to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            if (onCancel) {
                onCancel();
            }
            close();
        }
    });

    // Initialize data
    initialize();

    // Focus search box
    setTimeout(() => searchInput.focus(), 100);
}

/**
 * Create a SplitButton component (reference PrimeVue SplitButton)
 * @param {Object} options Configuration options
 * @param {string} options.label Button text
 * @param {string} options.icon Button icon
 * @param {string} options.className Custom class name
 * @param {Function} options.onClick Main button click callback
 * @param {Array} options.items Dropdown menu items [{label, icon, command, separator, checked, disabled}]
 * @returns {Object} { container, updateLabel, updateIcon, updateMenu, setMainButtonDisabled, setMenuButtonDisabled }
 */
export function createSplitButton(options) {
    const { label = '', icon = '', className = '', onClick = () => { }, items = [], align = 'left' } = options;

    const container = document.createElement('div');
    container.className = `p-splitbutton p-component${className ? ' ' + className : ''}`;
    container.style.display = 'inline-flex';
    container.style.position = 'relative';

    // 1. Main button
    const mainKey = document.createElement('button');
    mainKey.className = 'p-button p-component p-button-text p-button-sm';
    mainKey.type = 'button';
    mainKey.style.borderTopRightRadius = '0';
    mainKey.style.borderBottomRightRadius = '0';
    mainKey.style.borderRight = '0 none';

    // Content container
    const mainContent = document.createElement('span');
    mainContent.className = 'p-button-label p-c';
    mainContent.style.display = 'flex';
    mainContent.style.alignItems = 'center';
    mainContent.style.gap = '0.5rem';

    const renderMainButton = (text, iconClass, spinning = false) => {
        mainContent.innerHTML = '';
        if (iconClass) {
            const i = document.createElement('span');
            i.className = `p-button-icon p-button-icon-left ${iconClass} ${spinning ? 'spinning' : ''}`;
            mainContent.appendChild(i);
        }
        const span = document.createElement('span');
        span.className = 'p-button-label';
        span.textContent = tUI(text, text);
        mainContent.appendChild(span);

        // Update stored data for subsequent updates via updateIcon
        mainKey.dataset.label = text;
        mainKey.dataset.icon = iconClass || '';
    };

    renderMainButton(label, icon);
    mainKey.appendChild(mainContent);
    mainKey.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(e);
    });

    // 2. Dropdown trigger button
    const menuBtn = document.createElement('button');
    menuBtn.className = 'p-button p-component p-button-icon-only p-button-text p-button-sm p-splitbutton-menubutton';
    menuBtn.type = 'button';
    menuBtn.style.borderTopLeftRadius = '0';
    menuBtn.style.borderBottomLeftRadius = '0';
    menuBtn.innerHTML = '<span class="p-button-icon pi pi-chevron-down"></span>';

    container.appendChild(mainKey);
    container.appendChild(menuBtn);

    // 3. Dropdown menu
    const menuPanel = document.createElement('div');
    menuPanel.className = 'pa-context-menu pa-split-button-menu';
    menuPanel.style.display = 'none';
    menuPanel.style.position = 'fixed';
    menuPanel.style.minWidth = '12rem';
    // z-index is managed by CSS variable --settings-context-menu-z-index

    const menuList = document.createElement('ul');
    menuList.className = 'pa-context-menu-list';
    menuList.setAttribute('role', 'menu');
    menuPanel.appendChild(menuList);
    document.body.appendChild(menuPanel);

    let currentItems = items;
    let isOpen = false;
    let submenuPanels = []; // Store all submenu panels for cleanup on close

    // Create a single menu item (supports second-level submenu)
    const createMenuItem = (item, parentPanel) => {
        if (item.separator) {
            const sep = document.createElement('li');
            sep.className = 'pa-context-menu-separator';
            sep.setAttribute('role', 'separator');
            return sep;
        }

        const li = document.createElement('li');
        li.className = 'pa-context-menu-item';
        li.setAttribute('role', 'menuitem');
        if (item.disabled) li.classList.add('disabled');

        const itemContent = document.createElement('div');
        itemContent.className = 'pa-context-menu-item-content';

        // Icon logic
        let iconHtml = '';
        if (typeof item.checked === 'boolean') {
            const checkIcon = item.checked ? 'pi pi-check' : '';
            iconHtml = `<span class="pa-context-menu-item-icon ${checkIcon}"></span>`;
        } else if (item.icon) {
            iconHtml = `<span class="pa-context-menu-item-icon ${item.icon}"></span>`;
        } else {
            iconHtml = '<span class="pa-context-menu-item-icon"></span>';
        }

        // Check if there is a submenu
        const hasSubmenu = item.items && item.items.length > 0;

        itemContent.innerHTML = `
            ${iconHtml}
            <span class="pa-context-menu-item-label">${tUI(item.label, item.label)}</span>
            ${hasSubmenu ? '<span class="pa-context-menu-submenu-icon pi pi-chevron-right"></span>' : ''}
        `;

        li.appendChild(itemContent);

        // If there is a submenu
        if (hasSubmenu) {
            li.classList.add('pa-context-menu-item-has-submenu');

            // Create submenu panel
            const submenuPanel = document.createElement('div');
            submenuPanel.className = 'pa-context-menu pa-context-submenu';
            submenuPanel.style.display = 'none';
            submenuPanel.style.position = 'fixed';

            const submenuList = document.createElement('ul');
            submenuList.className = 'pa-context-menu-list';
            submenuList.setAttribute('role', 'menu');

            item.items.forEach(subItem => {
                const subLi = createMenuItem(subItem, submenuPanel);
                submenuList.appendChild(subLi);
            });

            submenuPanel.appendChild(submenuList);
            document.body.appendChild(submenuPanel);

            // Add submenu panel to list for cleanup on close
            submenuPanels.push(submenuPanel);

            let submenuTimeout = null;

            // Show submenu
            const showSubmenu = () => {
                clearTimeout(submenuTimeout);
                submenuPanel.style.display = 'block';
                submenuPanel.style.zIndex = parseInt(menuPanel.style.zIndex || getComfyUIDialogZIndex()) + 5;
                submenuPanel.classList.add('pa-context-menu-show');

                // Position submenu
                const liRect = li.getBoundingClientRect();
                const submenuRect = submenuPanel.getBoundingClientRect();
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                let left = liRect.right + 2;
                let top = liRect.top;

                // If there is not enough space on the right, display on the left
                if (left + submenuRect.width > viewportWidth - 10) {
                    left = liRect.left - submenuRect.width - 2;
                }

                // Vertical boundary check
                if (top + submenuRect.height > viewportHeight - 10) {
                    top = viewportHeight - submenuRect.height - 10;
                }
                if (top < 10) top = 10;

                submenuPanel.style.left = `${left}px`;
                submenuPanel.style.top = `${top}px`;
            };

            // Hide submenu
            const hideSubmenu = () => {
                submenuTimeout = setTimeout(() => {
                    submenuPanel.classList.remove('pa-context-menu-show');
                    submenuPanel.classList.add('pa-context-menu-hide');
                    setTimeout(() => {
                        submenuPanel.style.display = 'none';
                        submenuPanel.classList.remove('pa-context-menu-hide');
                    }, 150);
                }, 100);
            };

            // Mouse enter parent item to show submenu
            li.addEventListener('mouseenter', showSubmenu);
            li.addEventListener('mouseleave', hideSubmenu);

            // Keep submenu open (when mouse is over submenu)
            submenuPanel.addEventListener('mouseenter', () => {
                clearTimeout(submenuTimeout);
            });
            submenuPanel.addEventListener('mouseleave', hideSubmenu);

        } else if (!item.disabled) {
            // No submenu and not disabled, bind click event
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.command) {
                    item.command({ originalEvent: e, item });
                }
                closeMenu();
            });
        }

        return li;
    };

    const renderMenu = () => {
        // First clean up previous submenu panels
        submenuPanels.forEach(panel => {
            if (panel.parentNode) {
                panel.parentNode.removeChild(panel);
            }
        });
        submenuPanels = [];

        menuList.innerHTML = '';
        currentItems.forEach(item => {
            const li = createMenuItem(item, menuPanel);
            menuList.appendChild(li);
        });
    };

    const updatePosition = () => {
        if (!isOpen) return;
        const containerRect = container.getBoundingClientRect();

        // First ensure the panel is displayed to get width
        menuPanel.style.display = 'block';
        const panelRect = menuPanel.getBoundingClientRect();

        let left = containerRect.left;
        let top = containerRect.bottom + 2;

        if (align === 'right') {
            left = containerRect.right - panelRect.width;
        }

        // Boundary check: prevent overflow on right side of screen
        if (left + panelRect.width > window.innerWidth) {
            left = window.innerWidth - panelRect.width - 5;
        }
        // Boundary check: prevent overflow on left side of screen
        if (left < 0) left = 5;

        menuPanel.style.top = `${top}px`;
        menuPanel.style.left = `${left}px`;
    };

    const closeMenu = () => {
        if (!isOpen) return;
        isOpen = false;

        // Clean up all submenu panels
        submenuPanels.forEach(panel => {
            if (panel.parentNode) {
                panel.parentNode.removeChild(panel);
            }
        });
        submenuPanels = [];

        menuPanel.classList.remove('pa-context-menu-show');
        menuPanel.classList.add('pa-context-menu-hide');

        setTimeout(() => {
            menuPanel.style.display = 'none';
            menuPanel.classList.remove('pa-context-menu-hide');
        }, 150);

        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
        document.removeEventListener('click', outsideClickListener);
    };

    const openMenu = () => {
        if (isOpen) {
            closeMenu();
            return;
        }
        isOpen = true;

        // Support dynamic fetching of menu items (if items is a function)
        if (typeof options.items === 'function') {
            currentItems = options.items();
        }

        renderMenu(); // Render fresh on open to catch state changes
        menuPanel.style.display = 'block';
        // Dynamically calculate z-index to ensure above ComfyUI dialog
        menuPanel.style.zIndex = getComfyUIDialogZIndex() + 20;
        menuPanel.classList.add('pa-context-menu-show');
        updatePosition();

        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        setTimeout(() => document.addEventListener('click', outsideClickListener), 0);
    };

    const outsideClickListener = (e) => {
        if (!menuPanel.contains(e.target) && !menuBtn.contains(e.target) && !container.contains(e.target)) {
            closeMenu();
        }
    };

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenu();
    });

    return {
        container,
        updateLabel: (text) => renderMainButton(text, mainKey.dataset.icon),
        updateIcon: (newIcon, spinning) => renderMainButton(mainKey.dataset.label, newIcon, spinning),
        updateMainButton: (text, newIcon, spinning) => renderMainButton(text, newIcon, spinning),
        updateMenu: (newItems) => {
            currentItems = newItems;
            if (isOpen) renderMenu();
        },
        setMainButtonDisabled: (disabled) => { mainKey.disabled = disabled; },
        setMenuButtonDisabled: (disabled) => { menuBtn.disabled = disabled; },
        destroy: () => {
            // Cleanup if needed
            if (menuPanel && menuPanel.parentNode) menuPanel.parentNode.removeChild(menuPanel);
            // Remove listeners... (handled by closure mostly, but good practice if needed)
        }
    };
}

/**
 * Create a SelectButton component (reference PrimeVue SelectButton)
 * Supports single select, multi-select, and toggle modes
 * @param {string} label Label text
 * @param {Array<Object>} options Array of options, each option contains { value: string, label: string, icon?: string, disabled?: boolean }
 * @param {string|Array<string>} initialValue Initial value, string for single select, array for multi-select
 * @param {Object} config Configuration options
 * @param {string} config.mode Mode: 'single' (single select), 'multiple' (multi-select), 'toggle' (toggle, equivalent to switch)
 * @param {string} config.size Size: 'small', 'normal', 'large'
 * @param {boolean} config.allowEmpty Whether to allow none selected (only valid for multi-select mode)
 * @param {Function} config.onChange Value change callback
 * @returns {Object} { group: HTMLElement, getValue: Function, setValue: Function }
 */
export function createSelectButtonGroup(label, options, initialValue, config = {}) {
    const {
        mode = 'multiple',
        size = 'normal',
        allowEmpty = true,
        onChange = null
    } = config;

    // ---Create container---
    const group = document.createElement('div');
    group.className = 'pa-form-group pa-select-button-group';

    // Label
    if (label) {
        const labelEl = document.createElement('label');
        labelEl.className = 'pa-form-label';
        labelEl.textContent = tUI(label, label);
        group.appendChild(labelEl);
    }

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = `pa-select-button pa-select-button-${size}`;

    // Current selected value
    let currentValue = mode === 'multiple'
        ? (Array.isArray(initialValue) ? [...initialValue] : [])
        : initialValue;

    // Render option buttons
    const renderButtons = () => {
        buttonContainer.innerHTML = '';

        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pa-select-button-item';

            // Determine if selected
            const isSelected = mode === 'multiple'
                ? currentValue.includes(option.value)
                : currentValue === option.value;

            if (isSelected) {
                button.classList.add('pa-select-button-item-selected');
            }

            if (option.disabled) {
                button.classList.add('pa-select-button-item-disabled');
                button.disabled = true;
            }

            // Icon
            if (option.icon) {
                const icon = document.createElement('span');
                icon.className = `pa-select-button-icon pi ${option.icon}`;
                button.appendChild(icon);
            }

            // Label
            if (option.label) {
                const labelSpan = document.createElement('span');
                labelSpan.className = 'pa-select-button-label';
                labelSpan.textContent = tUI(option.label, option.label);
                button.appendChild(labelSpan);
            }

            // Click event
            if (!option.disabled) {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleClick(option.value);
                });
            }

            buttonContainer.appendChild(button);
        });
    };

    // Handle click event
    const handleClick = (value) => {
        const prevValue = mode === 'multiple' ? [...currentValue] : currentValue;

        if (mode === 'multiple') {
            // Multi-select mode: toggle selection state
            const index = currentValue.indexOf(value);
            if (index === -1) {
                currentValue.push(value);
            } else {
                // Check if deselect is allowed
                if (allowEmpty || currentValue.length > 1) {
                    currentValue.splice(index, 1);
                }
            }
        } else if (mode === 'toggle') {
            // Toggle mode: click to toggle switch state
            currentValue = currentValue === value ? null : value;
        } else {
            // Single select mode: directly select
            currentValue = value;
        }

        // Re-render buttons
        renderButtons();

        // Trigger callback
        if (onChange) {
            onChange(currentValue, prevValue);
        }
    };

    // Initial render
    renderButtons();
    group.appendChild(buttonContainer);

    // ---Return component API---
    return {
        group,
        getValue: () => mode === 'multiple' ? [...currentValue] : currentValue,
        setValue: (newValue) => {
            currentValue = mode === 'multiple'
                ? (Array.isArray(newValue) ? [...newValue] : [])
                : newValue;
            renderButtons();
        },
        setOptions: (newOptions) => {
            options = newOptions;
            renderButtons();
        }
    };
}