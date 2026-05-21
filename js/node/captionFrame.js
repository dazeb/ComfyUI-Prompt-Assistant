/**
 * Video frame extraction tool node extension
 * Provides manual video frame extraction, preview, and frame index generation
 */

import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { createSettingsDialog, createInputGroup, createTooltip, createConfirmPopup } from "../modules/uiComponents.js";
import { APIService } from "../services/api.js";

// Import dedicated stylesheet (retained for video player specific layout styles)
const link = document.createElement("link");
link.rel = "stylesheet";
link.type = "text/css";
link.href = new URL("../css/captionFrame.css", import.meta.url).href;
document.head.appendChild(link);

// Popup state tracking (prevent duplicate opening)
let isDialogOpen = false;

app.registerExtension({
    name: "ComfyUI.PromptAssistant.CaptionFrame",

    /**
     * Hook before node definition registration
     * @param {Object} nodeType Node type definition
     * @param {Object} nodeData Node data
     */
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "VideoCaptionNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;

            // --- Override node creation logic ---
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) {
                    onNodeCreated.apply(this, arguments);
                }

                const node = this;

                // Add "Select Reverse Inferred Frames" button
                // Initially button may be hidden, depending on "frame extraction strategy"
                const btnWidget = this.addWidget("button", "🎬Select Reverse Inferred Frames", null, () => {
                    showFrameExtractionModal(node);
                });

                // Save original computeSize function for dynamic hide/show size calculation
                const origComputeSize = btnWidget.computeSize?.bind(btnWidget);

                // Ensure button is always visible
                btnWidget.type = "button";
                btnWidget.computeSize = origComputeSize || (() => [0, 26]);
                btnWidget.hidden = false;

                // Only redraw canvas, do not change node size
                app.graph.setDirtyCanvas(true, false);
            };
        }
    }
});

/**
 * Show video frame extraction tool popup
 * @param {Object} node Current node instance
 */
async function showFrameExtractionModal(node) {
    // Prevent duplicate opening
    if (isDialogOpen) {
        return;
    }
    isDialogOpen = true;

    // 1. Get connected video information
    const videoInfo = await findConnectedVideo(node);

    if (!videoInfo) {
        isDialogOpen = false;
        alert("No valid video input connection detected. Please ensure the node is connected to a Load Video node.");
        return;
    }

    if (videoInfo.error) {
        isDialogOpen = false;
        alert(videoInfo.error);
        return;
    }

    // 2. Get video metadata (FPS, duration, total frames)
    let initialFps = 30;
    let originalDuration = 0;
    let originalTotalFrames = 0;
    try {
        const response = await api.fetchApi(APIService.getDynamicApiBase() + '/video/info', {
            method: "POST",
            body: JSON.stringify({
                filename: videoInfo.filename,
                type: videoInfo.type
            })
        });
        const data = await response.json();
        if (data.success) {
            initialFps = data.fps || 30;
            originalDuration = data.duration || 0;
            originalTotalFrames = data.total_frames || 0;

            // If total_frames is 0 (some video formats cannot directly read frame count), calculate using fps * duration
            if (originalTotalFrames === 0 && originalDuration > 0 && initialFps > 0) {
                originalTotalFrames = Math.floor(initialFps * originalDuration);
            }
        }
    } catch (e) {
        console.warn("[PromptAssistant] Failed to get video info, will use default values:", e);
    }

    // 3. Calculate actual FPS used (consider force_rate parameter)
    // When force_rate > 0, use forced FPS, otherwise use original FPS
    const actualFps = (videoInfo.forceRate && videoInfo.forceRate > 0) ? videoInfo.forceRate : initialFps;

    // 4. Calculate actual total frames and duration after frame extraction
    // If force_rate is used, actual frames = original total frames * (force_rate / original_fps)
    let actualTotalFrames = originalTotalFrames;
    let actualDuration = originalDuration;

    // Validity check: ensure frame count is a valid positive integer
    if (!Number.isFinite(originalTotalFrames) || originalTotalFrames <= 0 || originalTotalFrames > 1e9) {
        // If frame count is invalid, try using duration * fps to calculate
        if (originalDuration > 0 && initialFps > 0) {
            originalTotalFrames = Math.floor(originalDuration * initialFps);
            actualTotalFrames = originalTotalFrames;
        } else {
            // Final fallback value
            originalTotalFrames = 100;
            actualTotalFrames = 100;
        }
        console.warn('[PromptAssistant-CaptionFrame] Invalid frame count, using calculated value:', originalTotalFrames);
    }

    if (videoInfo.forceRate && videoInfo.forceRate > 0 && initialFps > 0) {
        actualTotalFrames = Math.floor(originalTotalFrames * (videoInfo.forceRate / initialFps));
        actualDuration = actualTotalFrames / actualFps;
    }

    // Ensure at least 1 frame
    if (actualTotalFrames <= 0) {
        actualTotalFrames = 1;
    }

    /*
    console.log('[PromptAssistant-CaptionFrame] Video metadata:', {
        originalFps: initialFps,
        originalDuration,
        originalTotalFrames,
        forceRate: videoInfo.forceRate,
        actualFps,
        actualTotalFrames,
        actualDuration
    });
    */

    // State container, used to share data between renderContent and onSave
    const state = {
        fps: actualFps,
        originalFps: initialFps,  // Save original FPS for calculation
        forceRate: videoInfo.forceRate || 0,  // Save force_rate for frame extraction
        totalFrames: actualTotalFrames,  // Actual total frames
        duration: actualDuration,  // Actual duration
        selectedFrames: new Set(),
        rangeStart: null,
        // Frame index driven related state
        currentFrameIndex: 0,  // Current frame index
        isLoading: false,  // Frame loading flag
        frameCache: new Map(),  // Frame cache (frameIndex -> base64)
        filename: videoInfo.filename,  // Video filename
        widgets: {
            // Use English widget names defined in backend
            manualIndex: node.widgets.find(w => w.name === "manual_indices"),
            strategy: node.widgets.find(w => w.name === "sampling_mode")
        }
    };

    // Initialize selected frame state
    if (state.widgets.manualIndex?.value) {
        state.widgets.manualIndex.value.split(',').forEach(p => {
            p = p.trim();
            if (!p) return;
            if (p.includes('-')) state.selectedFrames.add(p);
            else {
                const n = parseInt(p);
                if (!isNaN(n)) state.selectedFrames.add(n);
            }
        });
    }

    // 3. Create generic settings dialog
    createSettingsDialog({
        title: '🎬 Video Manual Frame Extraction Tool',
        saveButtonText: 'Confirm and Apply',
        cancelButtonText: 'Cancel',
        saveButtonIcon: 'pi-check',
        disableBackdropAndCloseOnClickOutside: true, // No modal overlay needed, allow interaction
        dialogClassName: 'caption-frame-dialog', // Custom class name

        // Cancel callback (skip second confirmation, close directly)
        onCancel: () => { },

        // Render dialog content
        renderContent: (contentContainer, header) => {
            // Note: Specific flex layout and height control are now mainly handled by CSS (.caption-frame-dialog .p-dialog-content)

            // Build interface
            renderVideoInterface(contentContainer, state, videoInfo, header);
        },

        // Save callback
        onSave: () => {
            const sorted = Array.from(state.selectedFrames).sort((a, b) => {
                const getStart = v => typeof v === 'string' ? parseInt(v.split('-')[0]) : v;
                return getStart(a) - getStart(b);
            });

            if (state.widgets.manualIndex) {
                const newValue = sorted.join(",");
                state.widgets.manualIndex.value = newValue;

                // Trigger widget callback to ensure value synced to node
                if (state.widgets.manualIndex.callback) {
                    state.widgets.manualIndex.callback(newValue, app.graph, node, state.widgets.manualIndex);
                }

                // [Debug] Output saved value
                // console.log('[PromptAssistant-CaptionFrame] Saved frame indices:', newValue);

                // Automatically switch strategy to manual
                if (state.widgets.strategy) {
                    state.widgets.strategy.value = "Manual (Indices)";

                    // Also trigger strategy widget callback
                    if (state.widgets.strategy.callback) {
                        state.widgets.strategy.callback("Manual (Indices)", app.graph, node, state.widgets.strategy);
                    }
                }

                // Mark node for re-execution
                node.setDirtyCanvas(true, true);
                app.graph.setDirtyCanvas(true, true);
            }
        },

        // Close callback: clean up resources
        onClose: () => {
            isDialogOpen = false;
            if (state.frameCache) {
                state.frameCache.clear();
            }
        }
    });
}

/**
 * Render video operation interface
 * @param {HTMLElement} container Container element
 * @param {Object} state State object
 * @param {Object} videoInfo Video information object
 */
/**
 * Render video operation interface
 * @param {HTMLElement} container Container element
 * @param {Object} state State object
 * @param {Object} videoInfo Video information object
 * @param {HTMLElement} [headerElement] Dialog header element (optional)
 */
function renderVideoInterface(container, state, videoInfo, headerElement) {
    // --- Display area (hybrid mode: img for precise positioning, video for smooth playback) ---
    const frameContainer = document.createElement("div");
    frameContainer.className = "video-container frame-display-container";

    // Create frame image element (for precise positioning mode)
    const frameImg = document.createElement("img");
    frameImg.id = "caption-frame-display";
    frameImg.className = "frame-display-img";
    frameImg.alt = "Video frame preview";

    // Create video element (for smooth playback mode, hidden by default)
    const videoElement = document.createElement("video");
    videoElement.className = "frame-video-player";
    // Optimize buffer settings
    videoElement.preload = "auto";  // Preload as much video as possible

    // Set video source
    if (videoInfo.fromLoadNode && state.fps !== state.originalFps) {
        const params = {
            filename: videoInfo.filename,
            type: videoInfo.type || "input",
            force_rate: state.fps,
            skip_first_frames: 0,
            select_every_nth: 1,
            frame_load_cap: 0,
            timestamp: Date.now()
        };
        videoElement.src = api.apiURL('/vhs/viewvideo?' + new URLSearchParams(params));
    } else {
        videoElement.src = videoInfo.url;
    }

    // Create loading indicator
    const loadingIndicator = document.createElement("div");
    loadingIndicator.className = "frame-loading-indicator";
    loadingIndicator.innerHTML = '<span class="pi pi-spin pi-spinner"></span>';
    loadingIndicator.style.display = "none";

    // Buffer status event listener - show loading indicator when dragging to unbuffered position
    videoElement.addEventListener("waiting", () => {
        loadingIndicator.style.display = "flex";
    });
    videoElement.addEventListener("canplay", () => {
        loadingIndicator.style.display = "none";
    });
    videoElement.addEventListener("canplaythrough", () => {
        loadingIndicator.style.display = "none";
    });

    frameContainer.appendChild(frameImg);
    frameContainer.appendChild(videoElement);
    frameContainer.appendChild(loadingIndicator);

    // Initial state: show video, hide image (video preview mode)
    frameImg.style.display = "none";
    videoElement.style.display = "block";

    // Switch to image mode
    const switchToImageMode = async (frameIndex) => {
        videoElement.style.display = "none";
        frameImg.style.display = "block";
        await loadFrame(frameIndex);
    };

    // Switch to video playback mode
    const switchToVideoMode = (startFromFrame) => {
        // Sync video progress to current frame position
        const targetTime = startFromFrame / state.fps;
        videoElement.currentTime = targetTime;
        frameImg.style.display = "none";
        videoElement.style.display = "block";
        videoElement.play();
    };

    // --- Frame loading function ---
    const loadFrame = async (frameIndex) => {
        if (state.isLoading) return;

        // Boundary check
        frameIndex = Math.max(0, Math.min(state.totalFrames - 1, frameIndex));
        state.currentFrameIndex = frameIndex;

        // Check cache
        if (state.frameCache.has(frameIndex)) {
            frameImg.src = `data:image/jpeg;base64,${state.frameCache.get(frameIndex)}`;
            updateDisplay();
            return;
        }

        // Show loading indicator
        state.isLoading = true;
        loadingIndicator.style.display = "flex";

        try {
            const response = await api.fetchApi(APIService.getDynamicApiBase() + '/video/frame', {
                method: "POST",
                body: JSON.stringify({
                    filename: state.filename,
                    frame_index: frameIndex,
                    force_rate: state.forceRate
                })
            });
            const data = await response.json();

            if (data.success && data.data) {
                // Cache frame data
                state.frameCache.set(frameIndex, data.data);
                frameImg.src = `data:image/jpeg;base64,${data.data}`;

                // Preload adjacent frames (improve experience)
                preloadAdjacentFrames(frameIndex);
            } else {
                console.error("[PromptAssistant-CaptionFrame] Frame load failed:", data.error);
            }
        } catch (e) {
            console.error("[PromptAssistant-CaptionFrame] Frame load exception:", e);
        } finally {
            state.isLoading = false;
            loadingIndicator.style.display = "none";
            updateDisplay();
        }
    };

    // --- Preload adjacent frames (improve experience) ---
    const preloadAdjacentFrames = async (centerIndex) => {
        const preloadRange = 2; // Preload 2 frames before and after
        for (let offset = 1; offset <= preloadRange; offset++) {
            const indices = [centerIndex - offset, centerIndex + offset];
            for (const idx of indices) {
                if (idx >= 0 && idx < state.totalFrames && !state.frameCache.has(idx)) {
                    // Asynchronous preload, non-blocking
                    api.fetchApi(APIService.getDynamicApiBase() + '/video/frame', {
                        method: "POST",
                        body: JSON.stringify({
                            filename: state.filename,
                            frame_index: idx,
                            force_rate: state.forceRate
                        })
                    }).then(res => res.json()).then(data => {
                        if (data.success && data.data) {
                            state.frameCache.set(idx, data.data);
                        }
                    }).catch(() => { }); // Silently ignore preload failure
                }
            }
        }
    };

    // --- Move info to header bar ---
    let headerTimeSpan = null;
    let headerFrameSpan = null;

    if (headerElement) {
        // Create header info container (style defined in captionFrame.css)
        const infoContainer = document.createElement("div");
        infoContainer.className = "video-header-info";

        // Build two-line info HTML
        infoContainer.innerHTML = `
            <div class="info-row"><span id="header-time">00:00.00/00:00.00</span></div>
            <div class="info-row"><span id="header-frame">0/${state.totalFrames}</span>&nbsp;${state.fps}fps</div>
        `;

        // Insert before close button
        const icons = headerElement.querySelector('.p-dialog-header-icons');
        if (icons) {
            headerElement.insertBefore(infoContainer, icons);
        } else {
            headerElement.appendChild(infoContainer);
        }

        headerTimeSpan = infoContainer.querySelector("#header-time");
        headerFrameSpan = infoContainer.querySelector("#header-frame");
    }

    container.appendChild(frameContainer);

    // --- Unified timeline component (combine progress bar slider and marker track) ---
    const timelineContainer = document.createElement("div");
    timelineContainer.className = "unified-timeline-container";

    // Marker track layer (bottom layer, for displaying frame markers)
    const markerTrack = document.createElement("div");
    markerTrack.className = "frame-marker-track";
    timelineContainer.appendChild(markerTrack);

    // Custom slider layer (top layer)
    const sliderThumb = document.createElement("div");
    sliderThumb.className = "timeline-slider-thumb";
    timelineContainer.appendChild(sliderThumb);

    container.appendChild(timelineContainer);

    // Switch to video preview mode when dragging (smooth), precise frame load on release
    let isDraggingSlider = false;

    // Unified frame index to percentage conversion function (ensure slider and markers use same calculation)
    const frameToPercent = (frameIndex) => {
        const maxFrame = state.totalFrames - 1;
        if (maxFrame <= 0) return 0;
        return (frameIndex / maxFrame) * 100;
    };

    // Helper function to update slider position
    const updateSliderPosition = (frameIndex) => {
        sliderThumb.style.left = `${frameToPercent(frameIndex)}%`;
    };

    // Calculate frame index from mouse position
    const getFrameFromMousePosition = (clientX) => {
        const rect = timelineContainer.getBoundingClientRect();
        const offsetX = clientX - rect.left;
        const percent = Math.max(0, Math.min(1, offsetX / rect.width));
        return Math.round(percent * (state.totalFrames - 1));
    };

    // Slider drag event
    sliderThumb.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isDraggingSlider = true;
        sliderThumb.classList.add("dragging");
        // Switch to video preview mode
        frameImg.style.display = "none";
        videoElement.style.display = "block";
        loadingIndicator.style.display = "none";

        const onMouseMove = (moveEvent) => {
            if (!isDraggingSlider) return;
            const targetFrame = getFrameFromMousePosition(moveEvent.clientX);
            state.currentFrameIndex = targetFrame;
            videoElement.currentTime = targetFrame / state.fps;
            updateSliderPosition(targetFrame);
            updateDisplay();
        };

        const onMouseUp = () => {
            isDraggingSlider = false;
            sliderThumb.classList.remove("dragging");
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });

    // Timeline click jump
    timelineContainer.addEventListener("click", (e) => {
        // If clicked on slider itself or marker elements, do nothing
        if (e.target === sliderThumb || e.target.closest('.frame-marker, .frame-marker-range, .frame-marker-temp')) {
            return;
        }
        const targetFrame = getFrameFromMousePosition(e.clientX);
        state.currentFrameIndex = targetFrame;
        videoElement.currentTime = targetFrame / state.fps;
        updateSliderPosition(targetFrame);
        updateDisplay();
    });

    // --- Controls area ---
    const controlsContainer = document.createElement("div");
    controlsContainer.className = "controls-container";
    container.appendChild(controlsContainer);

    // Helper function: create button
    // Returns { btn: HTMLElement, iconSpan: HTMLElement }
    const createBtn = (text, iconClass, onClick, type = 'secondary', iconPos = 'left') => {
        const btn = document.createElement("button");
        // Reuse PrimeVue button styles
        btn.className = `p-button p-component p-button-${type} p-button-sm`;

        // Icon-only button handling
        const isIconOnly = !text && iconClass;
        if (isIconOnly) {
            btn.classList.add("p-button-icon-only");
        }

        let iconSpan = null;
        if (iconClass) {
            iconSpan = document.createElement("span");
            // Icon-only does not need left/right positioning class
            iconSpan.className = isIconOnly
                ? `p-button-icon pi ${iconClass}`
                : `p-button-icon-${iconPos} pi ${iconClass}`;
            btn.appendChild(iconSpan);
        }

        // Add label only when there is text
        if (text) {
            const labelSpan = document.createElement("span");
            labelSpan.className = "p-button-label";
            labelSpan.textContent = text;

            if (iconPos === 'right' && iconSpan) {
                // When icon is on the right, need to remove and reorder
                btn.removeChild(iconSpan);
                btn.appendChild(labelSpan);
                btn.appendChild(iconSpan);
            } else {
                btn.appendChild(labelSpan);
            }
        }

        btn.onclick = onClick;
        btn.style.marginRight = "5px";
        return { btn, iconSpan };
    };

    // 2. Playback control buttons (left side)
    const playbackControls = document.createElement("div");
    playbackControls.className = "playback-controls";
    playbackControls.style.marginTop = "0";

    // Long press continuous frame skip helper function
    // @param {HTMLElement} btn Button element
    // @param {Function} action Frame skip operation function
    const setupLongPressFrame = (btn, action) => {
        let pressTimer = null; // Long press delay timer
        let intervalTimer = null; // Continuous trigger timer

        const startPress = () => {
            // Execute one frame skip immediately
            action();

            // Start continuous frame skip after delay
            pressTimer = setTimeout(() => {
                intervalTimer = setInterval(() => {
                    action();
                }, 50); // Jump one frame every 50ms
            }, 500); // Start continuous frame skip after 500ms
        };

        const endPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            if (intervalTimer) {
                clearInterval(intervalTimer);
                intervalTimer = null;
            }
        };

        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('mouseup', endPress);
        btn.addEventListener('mouseleave', endPress);
    };

    // Previous frame button (use video.currentTime for quick preview)
    const prevFrameBtn = createBtn("Previous Frame", "pi-caret-left", null).btn;
    setupLongPressFrame(prevFrameBtn, () => {
        stopPlayback(); // Stop playback
        if (state.currentFrameIndex > 0) {
            state.currentFrameIndex--;
            videoElement.currentTime = state.currentFrameIndex / state.fps;
            updateDisplay();
        }
    });
    playbackControls.appendChild(prevFrameBtn);

    // --- Play/Pause function (smooth playback using video element) ---
    let isPlaying = false;
    let animationFrameId = null;  // Used to cancel animation frame

    const playBtnObj = createBtn("Play", "pi-play", () => {
        if (isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    });
    playbackControls.appendChild(playBtnObj.btn);

    // Use requestAnimationFrame for smooth slider update
    const updatePlaybackProgress = () => {
        if (!isPlaying) return;

        // Use video.currentTime to calculate continuous progress (instead of discrete frame index)
        const currentTime = videoElement.currentTime;
        const duration = state.duration;

        // Directly use time ratio to calculate slider position for smooth movement
        if (duration > 0) {
            const percent = Math.min(100, (currentTime / duration) * 100);
            sliderThumb.style.left = `${percent}%`;
        }

        // Also update frame index for display
        const currentFrame = Math.floor(currentTime * state.fps);
        state.currentFrameIndex = Math.max(0, Math.min(state.totalFrames - 1, currentFrame));

        // Update header info display
        const formatTime = (s) => {
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            const ms = Math.floor((s % 1) * 100);
            return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
        };
        if (headerTimeSpan) headerTimeSpan.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        if (headerFrameSpan) headerFrameSpan.textContent = `${state.currentFrameIndex} / ${state.totalFrames}`;

        // Continue next frame animation
        animationFrameId = requestAnimationFrame(updatePlaybackProgress);
    };

    const startPlayback = () => {
        if (isPlaying) return;
        isPlaying = true;

        // Switch to video playback mode
        switchToVideoMode(state.currentFrameIndex);

        // Start smooth animation update
        animationFrameId = requestAnimationFrame(updatePlaybackProgress);

        // Update button icon
        if (playBtnObj.iconSpan) {
            playBtnObj.iconSpan.classList.remove("pi-play");
            playBtnObj.iconSpan.classList.add("pi-pause");
        }
    };

    const stopPlayback = () => {
        if (!isPlaying) return;
        isPlaying = false;

        // Cancel animation frame
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        // Pause video (do not automatically capture precise frame, continue showing video)
        videoElement.pause();

        // Sync frame index and update display
        const currentFrameFromVideo = Math.floor(videoElement.currentTime * state.fps);
        state.currentFrameIndex = Math.max(0, Math.min(state.totalFrames - 1, currentFrameFromVideo));
        updateDisplay();

        // Update button icon
        if (playBtnObj.iconSpan) {
            playBtnObj.iconSpan.classList.remove("pi-pause");
            playBtnObj.iconSpan.classList.add("pi-play");
        }
    };

    // Automatically stop when video playback ends (keep video display, don't switch to img)
    videoElement.addEventListener("ended", () => {
        isPlaying = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        state.currentFrameIndex = state.totalFrames - 1;
        updateDisplay();
        if (playBtnObj.iconSpan) {
            playBtnObj.iconSpan.classList.remove("pi-pause");
            playBtnObj.iconSpan.classList.add("pi-play");
        }
    });

    // Next frame button (use video.currentTime for quick preview)
    const nextFrameBtn = createBtn("Next Frame", "pi-caret-right", null).btn;
    setupLongPressFrame(nextFrameBtn, () => {
        stopPlayback(); // Stop playback
        if (state.currentFrameIndex < state.totalFrames - 1) {
            state.currentFrameIndex++;
            videoElement.currentTime = state.currentFrameIndex / state.fps;
            updateDisplay();
        }
    });
    playbackControls.appendChild(nextFrameBtn);

    // Mute toggle button
    const muteBtnObj = createBtn("", "pi-volume-up", () => {
        videoElement.muted = !videoElement.muted;
        // Toggle icon
        if (muteBtnObj.iconSpan) {
            if (videoElement.muted) {
                muteBtnObj.iconSpan.classList.remove("pi-volume-up");
                muteBtnObj.iconSpan.classList.add("pi-volume-off");
            } else {
                muteBtnObj.iconSpan.classList.remove("pi-volume-off");
                muteBtnObj.iconSpan.classList.add("pi-volume-up");
            }
        }
    });
    playbackControls.appendChild(muteBtnObj.btn);

    // 3. Marker control buttons (right side)
    const markerControls = document.createElement("div");
    markerControls.className = "playback-controls";
    markerControls.style.marginTop = "0";
    markerControls.style.display = "flex";
    markerControls.style.gap = "8px";

    markerControls.appendChild(createBtn("Mark Current Frame", "pi-thumbtack", () => {
        state.selectedFrames.add(state.currentFrameIndex);
        renderTags();
    }, "primary").btn);

    markerControls.appendChild(createBtn("Range Start", "pi-step-backward-alt", () => {
        state.rangeStart = state.currentFrameIndex;
        // Show temporary blinking marker on track
        renderRangeStartMarker();
    }, "success").btn);

    markerControls.appendChild(createBtn("Range End", "pi-step-forward-alt", (e) => {
        if (state.rangeStart === null) {
            // Use popup dialog to notify user
            const button = e.target.closest('button');
            createConfirmPopup({
                target: button,
                message: 'Please set the start point first',
                icon: 'pi-info-circle',
                singleButton: true,
                confirmLabel: 'OK',
                position: 'top',
                onConfirm: () => { }
            });
            return;
        }
        const rangeEnd = state.currentFrameIndex;
        if (rangeEnd < state.rangeStart) {
            // Use popup dialog to notify user
            const button = e.target.closest('button');
            createConfirmPopup({
                target: button,
                message: 'End point must be greater than start point',
                icon: 'pi-exclamation-triangle',
                singleButton: true,
                confirmLabel: 'OK',
                position: 'top',
                onConfirm: () => { }
            });
            return;
        }
        state.selectedFrames.add(`${state.rangeStart}-${rangeEnd}`);
        state.rangeStart = null;
        // Remove temporary marker and render range markers
        removeRangeStartMarker();
        renderTags();
    }, "success", "right").btn);

    controlsContainer.appendChild(playbackControls);
    controlsContainer.appendChild(markerControls);

    // --- Selected frames list area ---
    const listContainer = document.createElement("div");
    listContainer.className = "frame-list-container";
    listContainer.style.marginTop = "0";

    const listHeader = document.createElement("div");
    listHeader.className = "frame-list-header";

    // Tag list container (left side)
    const tagsList = document.createElement("div");
    tagsList.className = "frame-tags";
    listHeader.appendChild(tagsList);

    // Clear button (right side)
    const clearBtnObj = createBtn("", "pi-eraser", () => {
        if (confirm("Are you sure you want to clear all selected frames?")) {
            state.selectedFrames.clear();
            renderTags();
        }
    }, "danger");
    clearBtnObj.btn.style.padding = "6px 8px";
    listHeader.appendChild(clearBtnObj.btn);

    listContainer.appendChild(listHeader);
    container.appendChild(listContainer);

    // Add tooltip (needs to be after element is added to DOM)
    createTooltip({
        target: clearBtnObj.btn,
        content: "Clear selected frames",
        position: "top"
    });

    // --- Event binding and logic ---
    // Get references for updating (prefer references from header)

    // Update display function (based on frame index)
    const updateDisplay = () => {
        const currentFrame = state.currentFrameIndex;
        const totalFrames = state.totalFrames;
        // Calculate current time based on frame index
        const t = currentFrame / state.fps;
        const d = state.duration;

        // Format time MM:SS.ms
        const formatTime = (s) => {
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            const ms = Math.floor((s % 1) * 100);
            return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
        };

        if (headerTimeSpan) headerTimeSpan.textContent = `${formatTime(t)} / ${formatTime(d)}`;
        if (headerFrameSpan) headerFrameSpan.textContent = `${currentFrame} / ${totalFrames}`;

        // Sync custom slider position
        updateSliderPosition(currentFrame);
    };

    // --- Render range start temporary marker ---
    const renderRangeStartMarker = () => {
        // First remove existing temporary marker
        removeRangeStartMarker();

        const totalFrames = state.totalFrames;
        if (totalFrames <= 0 || state.rangeStart === null) return;

        // Use unified frame to percentage conversion function
        const leftPercent = frameToPercent(state.rangeStart);
        const tempMarker = document.createElement("div");
        tempMarker.className = "frame-marker-temp";
        tempMarker.style.left = `${leftPercent}%`;
        tempMarker.dataset.frame = state.rangeStart;
        markerTrack.appendChild(tempMarker);

        // Add tooltip
        createTooltip({
            target: tempMarker,
            content: `Range start: ${state.rangeStart}`,
            position: 'top'
        });
    };

    // --- Remove range start temporary marker ---
    const removeRangeStartMarker = () => {
        const tempMarker = markerTrack.querySelector(".frame-marker-temp");
        if (tempMarker) {
            tempMarker.remove();
        }
    };

    // --- Clear residual tooltips ---
    const clearTooltips = () => {
        document.querySelectorAll('.pa-tooltip').forEach(t => t.remove());
    };

    // --- Render frame marker track ---
    const renderMarkers = () => {
        // Clear possible residual tooltips (elements removed during drag but tooltips not destroyed)
        clearTooltips();
        markerTrack.innerHTML = "";
        const totalFrames = state.totalFrames;
        if (totalFrames <= 0) return;

        state.selectedFrames.forEach(item => {
            if (typeof item === 'string' && item.includes('-')) {
                // Range marker (use unified frame to percentage conversion)
                const [start, end] = item.split('-').map(Number);
                const leftPercent = frameToPercent(start);
                const rightPercent = frameToPercent(end);
                const widthPercent = rightPercent - leftPercent;

                const rangeEl = document.createElement("div");
                rangeEl.className = "frame-marker-range";
                rangeEl.style.left = `${leftPercent}%`;
                rangeEl.style.width = `${Math.max(widthPercent, 0.5)}%`;
                rangeEl.dataset.range = item;
                rangeEl.dataset.originalItem = item;

                // Create left edge handle
                const leftHandle = document.createElement("div");
                leftHandle.className = "range-handle range-handle-left";
                rangeEl.appendChild(leftHandle);

                // Create right edge handle
                const rightHandle = document.createElement("div");
                rightHandle.className = "range-handle range-handle-right";
                rangeEl.appendChild(rightHandle);

                // Left edge drag
                leftHandle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    clearTooltips(); // Immediately clear tooltip on drag

                    let isDragging = false;
                    let dragLabel = null;
                    const originalStart = start;
                    const originalEnd = end;

                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) {
                            isDragging = true;
                            // Create following label
                            dragLabel = document.createElement("div");
                            dragLabel.className = "drag-label";
                            markerTrack.appendChild(dragLabel);
                        }

                        const trackRect = markerTrack.getBoundingClientRect();
                        const offsetX = moveEvent.clientX - trackRect.left;
                        const newPercent = Math.max(0, Math.min(1, offsetX / trackRect.width));
                        const newStart = Math.round(newPercent * (totalFrames - 1));

                        // Clamp to not exceed end frame
                        const clampedStart = Math.max(0, Math.min(originalEnd - 1, newStart));

                        // Update position and width (using unified percentage conversion)
                        const newLeftPercent = frameToPercent(clampedStart);
                        const newRightPercent = frameToPercent(originalEnd);
                        rangeEl.style.left = `${newLeftPercent}%`;
                        rangeEl.style.width = `${newRightPercent - newLeftPercent}%`;
                        rangeEl.dataset.range = `${clampedStart}-${originalEnd}`;

                        // Update following label
                        if (dragLabel) {
                            dragLabel.textContent = `Frame ${clampedStart}-${originalEnd}`;
                            // Position label at left edge
                            dragLabel.style.left = `${newLeftPercent}%`;
                        }

                        // Sync video preview to new start frame
                        state.currentFrameIndex = clampedStart;
                        videoElement.currentTime = clampedStart / state.fps;
                        updateDisplay();
                    };

                    const onMouseUp = () => {
                        // Remove following label
                        if (dragLabel) {
                            dragLabel.remove();
                            dragLabel = null;
                        }

                        if (isDragging) {
                            const newRange = rangeEl.dataset.range;
                            state.selectedFrames.delete(item);
                            state.selectedFrames.add(newRange);
                            renderTags();
                        }
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                // Right edge drag
                rightHandle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    clearTooltips(); // Immediately clear tooltip on drag

                    let isDragging = false;
                    let dragLabel = null;
                    const originalStart = start;
                    const originalEnd = end;

                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) {
                            isDragging = true;
                            // Create following label
                            dragLabel = document.createElement("div");
                            dragLabel.className = "drag-label";
                            markerTrack.appendChild(dragLabel);
                        }

                        const trackRect = markerTrack.getBoundingClientRect();
                        const offsetX = moveEvent.clientX - trackRect.left;
                        const newPercent = Math.max(0, Math.min(1, offsetX / trackRect.width));
                        const newEnd = Math.round(newPercent * (totalFrames - 1));

                        // Clamp to not less than start frame
                        const clampedEnd = Math.max(originalStart + 1, Math.min(totalFrames - 1, newEnd));

                        // Update width (using unified percentage conversion)
                        const leftPercent = frameToPercent(originalStart);
                        const rightPercent = frameToPercent(clampedEnd);
                        rangeEl.style.width = `${rightPercent - leftPercent}%`;
                        rangeEl.dataset.range = `${originalStart}-${clampedEnd}`;

                        // Update following label
                        if (dragLabel) {
                            dragLabel.textContent = `Frame ${originalStart}-${clampedEnd}`;
                            // Position label at right edge
                            dragLabel.style.left = `${rightPercent}%`;
                        }

                        // Sync video preview to new end frame
                        state.currentFrameIndex = clampedEnd;
                        videoElement.currentTime = clampedEnd / state.fps;
                        updateDisplay();
                    };

                    const onMouseUp = () => {
                        // Remove following label
                        if (dragLabel) {
                            dragLabel.remove();
                            dragLabel = null;
                        }

                        if (isDragging) {
                            const newRange = rangeEl.dataset.range;
                            state.selectedFrames.delete(item);
                            state.selectedFrames.add(newRange);
                            renderTags();
                        }
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                // Middle area drag (overall pan)
                rangeEl.addEventListener('mousedown', (e) => {
                    // Check if clicked on handle, if so do nothing
                    if (e.target.classList.contains('range-handle')) {
                        return;
                    }

                    e.stopPropagation();
                    e.preventDefault();
                    clearTooltips(); // Immediately clear tooltip on drag

                    let isDragging = false;
                    let dragLabel = null;
                    const startX = e.clientX;
                    const originalStart = start;
                    const originalEnd = end;
                    const rangeWidth = originalEnd - originalStart;

                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) {
                            isDragging = true;
                            // Create following label
                            dragLabel = document.createElement("div");
                            dragLabel.className = "drag-label";
                            markerTrack.appendChild(dragLabel);
                        }

                        const deltaX = moveEvent.clientX - startX;
                        const trackRect = markerTrack.getBoundingClientRect();
                        const deltaPercent = deltaX / trackRect.width;
                        const deltaFrames = Math.round(deltaPercent * (totalFrames - 1));

                        let newStart = originalStart + deltaFrames;
                        let newEnd = originalEnd + deltaFrames;

                        // Clamp range to not exceed boundaries
                        if (newStart < 0) {
                            newStart = 0;
                            newEnd = rangeWidth;
                        } else if (newEnd >= totalFrames) {
                            newEnd = totalFrames - 1;
                            newStart = newEnd - rangeWidth;
                        }

                        // Update position (using unified percentage conversion)
                        const newLeftPercent = frameToPercent(newStart);
                        rangeEl.style.left = `${newLeftPercent}%`;
                        rangeEl.dataset.range = `${newStart}-${newEnd}`;

                        // Update following label
                        if (dragLabel) {
                            dragLabel.textContent = `Frame ${newStart}-${newEnd}`;
                            // Position label at center of range
                            const centerFrame = (newStart + newEnd) / 2;
                            dragLabel.style.left = `${frameToPercent(centerFrame)}%`;
                        }

                        // Sync video preview to new start frame
                        state.currentFrameIndex = newStart;
                        videoElement.currentTime = newStart / state.fps;
                        updateDisplay();
                    };

                    const onMouseUp = () => {
                        // Remove following label
                        if (dragLabel) {
                            dragLabel.remove();
                            dragLabel = null;
                        }

                        if (isDragging) {
                            const newRange = rangeEl.dataset.range;
                            state.selectedFrames.delete(item);
                            state.selectedFrames.add(newRange);
                            renderTags();
                        }
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                // Double-click range marker to jump to start frame
                rangeEl.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const range = rangeEl.dataset.range;
                    const startFrame = parseInt(range.split('-')[0]);
                    state.currentFrameIndex = startFrame;
                    videoElement.currentTime = startFrame / state.fps;
                    updateDisplay();
                });

                markerTrack.appendChild(rangeEl);

                // Use createTooltip to display frame range
                createTooltip({
                    target: rangeEl,
                    content: `Frame ${item}`,
                    position: 'top'
                });
            } else {
                // Single frame marker (using unified frame to percentage conversion)
                const frame = typeof item === 'number' ? item : parseInt(item);
                const leftPercent = frameToPercent(frame);

                const markerEl = document.createElement("div");
                markerEl.className = "frame-marker";
                markerEl.style.left = `${leftPercent}%`;
                markerEl.dataset.frame = frame;
                markerEl.dataset.originalItem = item;

                // Add drag functionality
                markerEl.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    clearTooltips(); // Immediately clear tooltip on drag

                    const originalFrame = parseInt(markerEl.dataset.frame);
                    const originalItem = markerEl.dataset.originalItem;
                    let isDragging = false;
                    let dragLabel = null;

                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) {
                            isDragging = true;
                            // Create following label
                            dragLabel = document.createElement("div");
                            dragLabel.className = "drag-label";
                            markerTrack.appendChild(dragLabel);
                        }

                        const trackRect = markerTrack.getBoundingClientRect();
                        const offsetX = moveEvent.clientX - trackRect.left;
                        const newPercent = Math.max(0, Math.min(1, offsetX / trackRect.width));
                        const newFrame = Math.round(newPercent * (totalFrames - 1));

                        // Clamp range
                        const clampedFrame = Math.max(0, Math.min(totalFrames - 1, newFrame));

                        // Real-time update position (using unified percentage conversion)
                        markerEl.style.left = `${frameToPercent(clampedFrame)}%`;
                        markerEl.dataset.frame = clampedFrame;

                        // Update following label
                        if (dragLabel) {
                            dragLabel.textContent = `Frame ${clampedFrame}`;
                            dragLabel.style.left = `${frameToPercent(clampedFrame)}%`;
                        }

                        // Sync video preview
                        state.currentFrameIndex = clampedFrame;
                        videoElement.currentTime = clampedFrame / state.fps;
                        updateDisplay();
                    };

                    const onMouseUp = () => {
                        // Remove following label
                        if (dragLabel) {
                            dragLabel.remove();
                            dragLabel = null;
                        }

                        if (isDragging) {
                            const newFrame = parseInt(markerEl.dataset.frame);

                            // Update selectedFrames
                            if (typeof originalItem === 'number') {
                                state.selectedFrames.delete(originalItem);
                            } else {
                                state.selectedFrames.delete(parseInt(originalItem));
                            }
                            state.selectedFrames.add(newFrame);

                            // Re-render
                            renderTags();
                        }

                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                // Double-click to jump to corresponding frame
                markerEl.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const targetFrame = parseInt(markerEl.dataset.frame);
                    state.currentFrameIndex = targetFrame;
                    videoElement.currentTime = targetFrame / state.fps;
                    updateDisplay();
                });

                markerTrack.appendChild(markerEl);

                // Use createTooltip to display frame number
                createTooltip({
                    target: markerEl,
                    content: `Frame ${frame}`,
                    position: 'top'
                });
            }
        });
    };

    // --- Render bottom frame tags ---
    const renderTags = () => {
        tagsList.innerHTML = "";
        const sorted = Array.from(state.selectedFrames).sort((a, b) => {
            const getStart = v => typeof v === 'string' ? parseInt(v.split('-')[0]) : v;
            return getStart(a) - getStart(b);
        });

        sorted.forEach(item => {
            const tag = document.createElement("div");
            // Add corresponding style class based on type
            const isRange = typeof item === 'string' && item.includes('-');
            tag.className = `frame-tag ${isRange ? 'frame-tag-range' : 'frame-tag-single'}`;
            tag.innerHTML = `<span>${item}</span>`;

            const removeIcon = document.createElement("span");
            removeIcon.className = "remove-frame";
            removeIcon.innerHTML = "×";
            removeIcon.onclick = () => {
                state.selectedFrames.delete(item);
                renderTags();
            };

            tag.appendChild(removeIcon);
            tagsList.appendChild(tag);
        });

        // Sync update marker track
        renderMarkers();
    };

    // --- Frame slider click support (click on marker track to jump to specified frame) ---
    markerTrack.addEventListener('click', (e) => {
        if (e.target === markerTrack) {
            const rect = markerTrack.getBoundingClientRect();
            const clickPercent = (e.clientX - rect.left) / rect.width;
            const targetFrame = Math.round(clickPercent * state.totalFrames);
            loadFrame(Math.max(0, Math.min(state.totalFrames - 1, targetFrame)));
        }
    });

    // --- Initialize: load first frame ---
    loadFrame(0);
    renderTags();
}

/**
 * Recursively find connected video source
 * @param {Object} node Starting node
 * @returns {Promise<Object|null>} Video information object {url, filename, type}
 */
async function findConnectedVideo(node) {
    if (!node.inputs) return null;

    // Helper function: extract video file information from node
    const extractVideoFile = (node) => {
        let filename = null;
        let subfolder = "";
        let type = "input";
        let forceRate = 0;

        // Detect if it's a Load Video node from VideoHelperSuite
        const isLoadVideoNode = node.type?.includes("VHS_LoadVideo");

        // Strategy 1: Get from serialize.widgets_values
        if (node.serialize) {
            const serialized = node.serialize();
            if (serialized?.widgets_values?.length > 0) {
                filename = serialized.widgets_values[0];
            }
        }

        // Strategy 2: Get from widgets
        if (!filename && node.widgets?.length > 0) {
            for (const w of node.widgets) {
                if (w.value && typeof w.value === 'string' && w.value.length > 0) {
                    filename = w.value;
                    break;
                }
            }
        }

        // Strategy 3: Get from properties
        if (!filename && node.properties) {
            filename = node.properties.video || node.properties.filename || node.properties.upload;
        }

        // Extract force_rate parameter (from VideoHelperSuite Load Video node)
        if (node.widgets) {
            const forceRateWidget = node.widgets.find(w => w.name === "force_rate");
            if (forceRateWidget && forceRateWidget.value != null) {
                forceRate = parseFloat(forceRateWidget.value);
            }
        }

        if (filename) {
            return { filename, subfolder, type, forceRate, fromLoadNode: isLoadVideoNode };
        }
        return null;
    };

    // Helper function: recursively traverse graph
    const findVideoSource = (currentNode, visited = new Set()) => {
        if (!currentNode || visited.has(currentNode.id)) return null;
        visited.add(currentNode.id);

        // Check if current node has video file
        const videoFile = extractVideoFile(currentNode);
        if (videoFile) return videoFile;

        // Recursively find upstream nodes
        if (currentNode.inputs) {
            for (const input of currentNode.inputs) {
                if (input.link) {
                    const link = app.graph.links[input.link];
                    if (link) {
                        const sourceNode = app.graph.getNodeById(link.origin_id);
                        const result = findVideoSource(sourceNode, visited);
                        if (result) return result;
                    }
                }
            }
        }
        return null;
    };

    // 1. Prefer to find Video type input
    const videoInput = node.inputs.find(i => i.name === "Video" || i.type === "VIDEO");
    if (videoInput?.link) {
        const link = app.graph.links[videoInput.link];
        if (link) {
            const originNode = app.graph.getNodeById(link.origin_id);
            const videoFile = findVideoSource(originNode);
            if (videoFile) {
                const params = new URLSearchParams(videoFile);
                return {
                    url: api.apiURL("/view?" + params.toString()),
                    filename: videoFile.filename,
                    type: videoFile.type,
                    forceRate: videoFile.forceRate || 0,
                    fromLoadNode: videoFile.fromLoadNode || false
                };
            }
        }
    }

    // 2. Find Image type input (image sequence)
    const imageInput = node.inputs.find(i => i.name === "Image Sequence" || i.type === "IMAGE");
    if (imageInput?.link) {
        const link = app.graph.links[imageInput.link];
        if (link) {
            const originNode = app.graph.getNodeById(link.origin_id);
            const videoFile = findVideoSource(originNode);

            if (videoFile) {
                const params = new URLSearchParams(videoFile);
                return {
                    url: api.apiURL("/view?" + params.toString()),
                    filename: videoFile.filename,
                    type: videoFile.type,
                    forceRate: videoFile.forceRate || 0,
                    fromLoadNode: videoFile.fromLoadNode || false
                };
            } else {
                return {
                    type: "image_sequence",
                    error: "Detected image sequence input, but cannot trace back to original video file. Please ensure the image sequence comes from a video loading node (e.g., VHS Load Video)."
                };
            }
        }
    }

    return null;
}
