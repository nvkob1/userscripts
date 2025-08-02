// ==UserScript==
// @name         YouTube PiP and Loop for Safari
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Picture-in-Picture, Loop, and Sleep Timer for YouTube on Safari
// @author       nvkob1
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://youtube.com/*
// @downloadURL   https://github.com/nvkob1/userscripts/raw/refs/heads/main/iPhoneTube/yt-pip-loop-timer.user.js
// @updateURL     https://github.com/nvkob1/userscripts/raw/refs/heads/main/iPhoneTube/yt-pip-loop-timer.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        BUTTON_SIZE: 50,
        CONTROL_GAP: 10,
        NOTIFICATION_DURATION: 3000,
        VIDEO_CHECK_INTERVAL: 500,
        DEBOUNCE_DELAY: 300,
        AUTO_PIP_DELAY: 100,
        TIMER_PRECISION: 100, // More precise timing (100ms intervals)
        COUNTDOWN_UPDATE_INTERVAL: 1000 // Update display every second
    };

    // State management
    const state = {
        currentVideo: null,
        isInitialized: false,
        observers: [],
        eventListeners: [],
        sleepTimer: null,
        sleepTimeRemaining: 0,
        sleepStartTime: null,
        sleepDuration: 0,
        lastCountdownUpdate: 0
    };

    // Utility functions
    const utils = {
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        isMobile() {
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        },

        createButton(icon, title, onClick) {
            const button = document.createElement('button');
            button.innerHTML = icon;
            button.title = title;
            button.style.cssText = `
                width: ${CONFIG.BUTTON_SIZE}px;
                height: ${CONFIG.BUTTON_SIZE}px;
                border-radius: 50%;
                border: none;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                font-size: 20px;
                cursor: pointer;
                backdrop-filter: blur(10px);
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
            `;
            
            button.addEventListener('mouseenter', () => {
                button.style.transform = 'scale(1.1)';
                button.style.background = 'rgba(0, 0, 0, 0.9)';
            });
            
            button.addEventListener('mouseleave', () => {
                button.style.transform = 'scale(1)';
                button.style.background = 'rgba(0, 0, 0, 0.8)';
            });

            button.addEventListener('click', onClick);
            return button;
        },

        showNotification(message, type = 'info') {
            const colors = {
                info: 'rgba(0, 123, 255, 0.9)',
                success: 'rgba(40, 167, 69, 0.9)',
                error: 'rgba(220, 53, 69, 0.9)',
                warning: 'rgba(255, 193, 7, 0.9)'
            };

            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: ${colors[type]};
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                z-index: 10000;
                max-width: 300px;
                backdrop-filter: blur(10px);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                animation: slideIn 0.3s ease-out;
            `;

            // Add animation styles
            const style = document.createElement('style');
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);

            notification.textContent = message;
            document.body.appendChild(notification);

            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, CONFIG.NOTIFICATION_DURATION);
        },

        findVideo() {
            return document.querySelector('video');
        },

        isVideoReady(video) {
            return video && video.readyState >= 1 && video.videoWidth > 0;
        },

        formatTime(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            
            if (hours > 0) {
                return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            } else {
                return `${minutes}:${secs.toString().padStart(2, '0')}`;
            }
        }
    };

    // Picture-in-Picture functionality
    const pip = {
        isSupported() {
            return document.pictureInPictureEnabled;
        },

        isActive() {
            return document.pictureInPictureElement;
        },

        async toggle(video) {
            try {
                if (this.isActive()) {
                    await document.exitPictureInPicture();
                    utils.showNotification('Exited Picture-in-Picture', 'info');
                } else {
                    if (video.disablePictureInPicture) {
                        throw new Error('PiP disabled for this video');
                    }
                    await video.requestPictureInPicture();
                    utils.showNotification('Entered Picture-in-Picture', 'success');
                }
            } catch (error) {
                console.error('PiP error:', error);
                utils.showNotification('Picture-in-Picture not available', 'error');
            }
        }
    };

    // Loop functionality
    const loop = {
        toggle(video) {
            video.loop = !video.loop;
            utils.showNotification(
                video.loop ? 'Loop enabled' : 'Loop disabled',
                video.loop ? 'success' : 'info'
            );
            return video.loop;
        }
    };

    // Enhanced Sleep timer functionality
    const sleepTimer = {
        durations: [
            { label: '15 min', minutes: 15 },
            { label: '30 min', minutes: 30 },
            { label: '45 min', minutes: 45 },
            { label: '1 hour', minutes: 60 },
            { label: '2 hours', minutes: 120 }
        ],

        start(minutes, video) {
            this.stop(); // Clear any existing timer
            
            state.sleepStartTime = Date.now();
            state.sleepDuration = minutes * 60 * 1000; // Convert to milliseconds
            state.sleepTimeRemaining = minutes * 60; // Keep in seconds for display
            
            this.startPreciseTimer(video);
            utils.showNotification(`Sleep timer set for ${minutes} minutes`, 'success');
            
            this.updateButtonDisplay();
            this.createCountdownDisplay();
        },

        startPreciseTimer(video) {
            let oneMinuteWarningShown = false;
            
            const checkTime = () => {
                const elapsed = Date.now() - state.sleepStartTime;
                const remaining = Math.max(0, state.sleepDuration - elapsed);
                state.sleepTimeRemaining = Math.ceil(remaining / 1000);
                
                // Update display every second
                const now = Date.now();
                if (now - state.lastCountdownUpdate >= CONFIG.COUNTDOWN_UPDATE_INTERVAL) {
                    this.updateButtonDisplay();
                    this.updateCountdownDisplay();
                    state.lastCountdownUpdate = now;
                }
                
                // Show warning at 1 minute remaining (only once)
                if (state.sleepTimeRemaining <= 60 && state.sleepTimeRemaining > 0 && !oneMinuteWarningShown) {
                    utils.showNotification('Sleep timer: 1 minute remaining', 'warning');
                    oneMinuteWarningShown = true;
                }
                
                // Time's up!
                if (remaining <= 0) {
                    this.executeAction(video, 'Timer ended');
                    return;
                }
                
                state.sleepTimer = setTimeout(checkTime, CONFIG.TIMER_PRECISION);
            };
            
            checkTime();
        },

        startEndOfVideoTimer(video) {
            // This function is no longer needed - removed
        },

        executeAction(video, reason) {
            video.pause();
            utils.showNotification(`Sleep timer: ${reason} - video paused`, 'info');
            this.reset();
        },

        stop() {
            if (state.sleepTimer) {
                clearTimeout(state.sleepTimer);
                state.sleepTimer = null;
            }
        },

        reset() {
            this.stop();
            state.sleepTimeRemaining = 0;
            state.sleepStartTime = null;
            state.sleepDuration = 0;
            this.updateButtonDisplay();
            this.removeCountdownDisplay();
        },

        isActive() {
            return state.sleepTimer !== null;
        },

        getRemainingTime() {
            if (!this.isActive() || state.sleepTimeRemaining <= 0) return '';
            return utils.formatTime(state.sleepTimeRemaining);
        },

        getShortRemainingTime() {
            if (!this.isActive() || state.sleepTimeRemaining <= 0) return '';
            
            const minutes = Math.ceil(state.sleepTimeRemaining / 60);
            return minutes > 0 ? `${minutes}m` : '<1m';
        },

        updateButtonDisplay() {
            const button = document.getElementById('sleep-button');
            if (button) {
                if (this.isActive()) {
                    const shortTime = this.getShortRemainingTime();
                    button.innerHTML = `⏰${shortTime}`;
                    button.style.background = 'rgba(255, 193, 7, 0.8)'; // Yellow for timer
                } else {
                    button.innerHTML = '😴';
                    button.style.background = 'rgba(0, 0, 0, 0.8)';
                }
            }
        },

        createCountdownDisplay() {
            this.removeCountdownDisplay();
            
            const countdown = document.createElement('div');
            countdown.id = 'sleep-countdown-display';
            countdown.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 16px;
                font-weight: bold;
                z-index: 9998;
                backdrop-filter: blur(10px);
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
                border: 2px solid rgba(255, 193, 7, 0.5);
                transition: all 0.3s ease;
                cursor: pointer;
                user-select: none;
            `;
            
            countdown.addEventListener('mouseenter', () => {
                countdown.style.transform = 'translateX(-50%) scale(1.05)';
                countdown.style.background = 'rgba(255, 193, 7, 0.2)';
            });
            
            countdown.addEventListener('mouseleave', () => {
                countdown.style.transform = 'translateX(-50%) scale(1)';
                countdown.style.background = 'rgba(0, 0, 0, 0.8)';
            });
            
            countdown.addEventListener('click', () => {
                const video = utils.findVideo();
                if (video) {
                    this.showTimerMenu(video);
                }
            });
            
            this.updateCountdownText(countdown);
            document.body.appendChild(countdown);
        },

        updateCountdownDisplay() {
            const countdown = document.getElementById('sleep-countdown-display');
            if (countdown && this.isActive()) {
                this.updateCountdownText(countdown);
                
                // Add pulsing effect when less than 1 minute remaining
                if (state.sleepTimeRemaining <= 60) {
                    countdown.style.animation = 'pulse 1s infinite';
                    countdown.style.borderColor = 'rgba(220, 53, 69, 0.8)';
                    
                    if (!document.getElementById('pulse-animation')) {
                        const style = document.createElement('style');
                        style.id = 'pulse-animation';
                        style.textContent = `
                            @keyframes pulse {
                                0% { transform: translateX(-50%) scale(1); }
                                50% { transform: translateX(-50%) scale(1.05); }
                                100% { transform: translateX(-50%) scale(1); }
                            }
                        `;
                        document.head.appendChild(style);
                    }
                }
            }
        },

        updateCountdownText(countdown) {
            const remainingTime = this.getRemainingTime();
            countdown.innerHTML = `⏰ Sleep Timer: ${remainingTime}`;
        },

        removeCountdownDisplay() {
            const countdown = document.getElementById('sleep-countdown-display');
            if (countdown) {
                countdown.remove();
            }
        },

        showTimerMenu(video) {
            const existingMenu = document.getElementById('sleep-timer-menu');
            if (existingMenu) {
                existingMenu.remove();
                return;
            }

            const menu = document.createElement('div');
            menu.id = 'sleep-timer-menu';
            menu.style.cssText = `
                position: fixed;
                top: 80px;
                right: 80px;
                background: rgba(0, 0, 0, 0.9);
                border-radius: 8px;
                padding: 10px;
                z-index: 10001;
                backdrop-filter: blur(10px);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                min-width: 200px;
            `;

            // Title
            const title = document.createElement('div');
            title.textContent = 'Sleep Timer';
            title.style.cssText = `
                color: white;
                font-weight: bold;
                padding: 5px 10px;
                text-align: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.2);
                margin-bottom: 5px;
            `;
            menu.appendChild(title);

            // Custom time section
            const customSection = document.createElement('div');
            customSection.style.cssText = `
                padding: 5px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.2);
                margin-bottom: 5px;
            `;

            const customLabel = document.createElement('div');
            customLabel.textContent = 'Custom Time:';
            customLabel.style.cssText = `
                color: white;
                font-size: 12px;
                margin-bottom: 5px;
                text-align: center;
            `;
            customSection.appendChild(customLabel);

            const inputContainer = document.createElement('div');
            inputContainer.style.cssText = `
                display: flex;
                align-items: center;
                gap: 5px;
                margin-bottom: 5px;
            `;

            const minutesInput = document.createElement('input');
            minutesInput.type = 'number';
            minutesInput.min = '1';
            minutesInput.max = '999';
            minutesInput.placeholder = '30';
            minutesInput.style.cssText = `
                width: 60px;
                padding: 4px 6px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 4px;
                color: white;
                font-size: 12px;
                text-align: center;
            `;

            const minutesLabel = document.createElement('span');
            minutesLabel.textContent = 'minutes';
            minutesLabel.style.cssText = `
                color: white;
                font-size: 12px;
                flex: 1;
            `;

            const setCustomButton = document.createElement('button');
            setCustomButton.textContent = 'Set';
            setCustomButton.style.cssText = `
                padding: 4px 8px;
                background: rgba(0, 123, 255, 0.8);
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                transition: background 0.2s;
            `;

            setCustomButton.addEventListener('mouseenter', () => {
                setCustomButton.style.background = 'rgba(0, 123, 255, 1)';
            });
            
            setCustomButton.addEventListener('mouseleave', () => {
                setCustomButton.style.background = 'rgba(0, 123, 255, 0.8)';
            });

            setCustomButton.addEventListener('click', () => {
                const minutes = parseInt(minutesInput.value);
                if (minutes && minutes > 0 && minutes <= 999) {
                    this.start(minutes, video);
                    menu.remove();
                } else {
                    utils.showNotification('Please enter a valid time (1-999 minutes)', 'error');
                }
            });

            minutesInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    setCustomButton.click();
                }
            });

            inputContainer.appendChild(minutesInput);
            inputContainer.appendChild(minutesLabel);
            inputContainer.appendChild(setCustomButton);
            customSection.appendChild(inputContainer);
            menu.appendChild(customSection);

            // Preset options
            const presetsLabel = document.createElement('div');
            presetsLabel.textContent = 'Quick Options:';
            presetsLabel.style.cssText = `
                color: white;
                font-size: 12px;
                margin-bottom: 5px;
                text-align: center;
            `;
            menu.appendChild(presetsLabel);

            this.durations.forEach(({ label, minutes }) => {
                const option = document.createElement('button');
                option.textContent = label;
                option.style.cssText = `
                    display: block;
                    width: 100%;
                    padding: 6px 12px;
                    margin: 2px 0;
                    background: rgba(255, 255, 255, 0.1);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background 0.2s;
                    font-size: 12px;
                `;
                
                option.addEventListener('mouseenter', () => {
                    option.style.background = 'rgba(255, 255, 255, 0.2)';
                });
                
                option.addEventListener('mouseleave', () => {
                    option.style.background = 'rgba(255, 255, 255, 0.1)';
                });

                option.addEventListener('click', () => {
                    this.start(minutes, video);
                    menu.remove();
                });

                menu.appendChild(option);
            });

            // Cancel option if timer is active
            if (this.isActive()) {
                const stopOption = document.createElement('button');
                stopOption.textContent = 'Cancel Timer';
                stopOption.style.cssText = `
                    display: block;
                    width: 100%;
                    padding: 6px 12px;
                    margin: 5px 0 2px 0;
                    background: rgba(220, 53, 69, 0.8);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    border-top: 1px solid rgba(255, 255, 255, 0.2);
                    font-size: 12px;
                `;

                stopOption.addEventListener('click', () => {
                    this.reset();
                    utils.showNotification('Sleep timer cancelled', 'info');
                    menu.remove();
                });

                menu.appendChild(stopOption);
            }

            document.body.appendChild(menu);
            setTimeout(() => minutesInput.focus(), 100);

            // Close menu when clicking outside
            const closeMenu = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 100);
        }
    };

    // Control interface
    const controls = {
        container: null,

        create(video) {
            this.remove();

            this.container = document.createElement('div');
            this.container.id = 'youtube-controls';
            this.container.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: ${CONFIG.CONTROL_GAP}px;
                transition: opacity 0.3s ease;
            `;

            const buttons = [
                {
                    icon: '📺',
                    title: 'Toggle Picture-in-Picture',
                    onClick: () => pip.toggle(video),
                    id: 'pip-button'
                },
                {
                    icon: video.loop ? '🔁' : '▶️',
                    title: 'Toggle Loop',
                    onClick: (e) => {
                        const isLooping = loop.toggle(video);
                        e.target.innerHTML = isLooping ? '🔁' : '▶️';
                        e.target.style.opacity = isLooping ? '1' : '0.7';
                    },
                    id: 'loop-button'
                },
                {
                    icon: '😴',
                    title: 'Sleep Timer',
                    onClick: () => sleepTimer.showTimerMenu(video),
                    id: 'sleep-button'
                }
            ];

            buttons.forEach(({ icon, title, onClick, id }) => {
                const button = utils.createButton(icon, title, onClick);
                button.id = id;
                this.container.appendChild(button);
            });

            document.body.appendChild(this.container);
            this.setupHideOnFullscreen();
        },

        remove() {
            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
                this.container = null;
            }
        },

        setupHideOnFullscreen() {
            const handleFullscreenChange = () => {
                if (this.container) {
                    this.container.style.display = document.fullscreenElement ? 'none' : 'flex';
                }
            };

            document.addEventListener('fullscreenchange', handleFullscreenChange);
            state.eventListeners.push({ 
                type: 'fullscreenchange', 
                target: document, 
                handler: handleFullscreenChange 
            });
        }
    };

    // Main initialization
    const app = {
        init() {
            if (state.isInitialized) {
                this.cleanup();
            }

            this.waitForVideo();
            this.setupSPANavigation();
        },

        waitForVideo() {
            const checkVideo = () => {
                const video = utils.findVideo();
                
                if (video && utils.isVideoReady(video)) {
                    this.setupVideo(video);
                } else {
                    setTimeout(checkVideo, CONFIG.VIDEO_CHECK_INTERVAL);
                }
            };

            checkVideo();
        },

        setupVideo(video) {
            if (state.currentVideo === video) return;

            state.currentVideo = video;
            state.isInitialized = true;

            controls.create(video);

            if (utils.isMobile()) {
                this.setupMobileDoubleTap(video);
            }

            console.log('YouTube Script: Initialized successfully');
        },

        setupMobileDoubleTap(video) {
            let tapCount = 0;
            const handleTap = utils.debounce(() => {
                if (tapCount === 2 && pip.isSupported()) {
                    pip.toggle(video);
                }
                tapCount = 0;
            }, CONFIG.DEBOUNCE_DELAY);

            video.addEventListener('click', (e) => {
                tapCount++;
                handleTap();
            });
        },

        setupSPANavigation() {
            let currentUrl = location.href;
            
            const observer = new MutationObserver(utils.debounce(() => {
                if (location.href !== currentUrl) {
                    currentUrl = location.href;
                    state.isInitialized = false;
                    setTimeout(() => this.init(), 1000);
                }
            }, 500));

            observer.observe(document.body, { 
                subtree: true, 
                childList: true 
            });

            state.observers.push(observer);
        },

        cleanup() {
            // Stop sleep timer
            sleepTimer.reset();
            
            // Remove event listeners
            state.eventListeners.forEach(({ type, target, handler }) => {
                (target || document).removeEventListener(type, handler);
            });
            state.eventListeners = [];

            // Disconnect observers
            state.observers.forEach(observer => observer.disconnect());
            state.observers = [];

            // Remove controls
            controls.remove();

            // Remove any open menus and countdown display
            const menu = document.getElementById('sleep-timer-menu');
            if (menu) menu.remove();
            
            const countdown = document.getElementById('sleep-countdown-display');
            if (countdown) countdown.remove();

            // Reset state
            state.currentVideo = null;
            state.isInitialized = false;
        }
    };

    // Start the application
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => app.init());
    } else {
        app.init();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => app.cleanup());

})();
