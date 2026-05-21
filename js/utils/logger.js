/**
 * Log Management Module
 * Provides unified log recording and management functions
 */

// ====================== Log Level Constants ======================

/**
 * Log Level Constants
 * Used to control the verbosity of log output
 */
export const LOG_LEVELS = {
    ERROR: 0,   // Errors only (production environment)
    BASIC: 1,   // Basic logs (monitoring environment)
    DEBUG: 2    // Detailed logs (development environment)
};

// ====================== Log Manager ======================

/**
 * Unified Log Manager
 * Centralized management of logs at different levels
 */
class Logger {
    constructor() {
        this.level = LOG_LEVELS.DEBUG; // Default to detailed log level
    }

    log(message) {
        if (this.level >= LOG_LEVELS.BASIC) {
            const msg = typeof message === 'function' ? message() : message;
            console.log(`[PromptAssistant-System] ${msg}`);
        }
    }

    debug(message) {
        if (this.level >= LOG_LEVELS.DEBUG) {
            // Supports passing a function for lazy evaluation to avoid performance overhead in non-debug mode
            const msg = typeof message === 'function' ? message() : message;
            console.debug(`[PromptAssistant-Debug] ${msg}`);
        }
    }

    /**
     * Lightweight debugging (sampling)
     * Only outputs when random probability is hit, used for high-frequency paths
     * @param {string|Function} message
     * @param {number} rate 0~1, default 0.1 means 10% sampling
     */
    debugSample(message, rate = 0.1) {
        if (this.level >= LOG_LEVELS.DEBUG && Math.random() < rate) {
            const msg = typeof message === 'function' ? message() : message;
            console.debug(`[PromptAssistant-Debug] ${msg}`);
        }
    }

    error(message) {
        const msg = typeof message === 'function' ? message() : message;
        console.error(`[PromptAssistant-Error] ${msg}`);
    }

    warn(message) {
        const msg = typeof message === 'function' ? message() : message;
        console.warn(`[PromptAssistant-Warning] ${msg}`);
    }

    /**
     * Set log level
     * @param {number} level - Log level (0: ERROR, 1: BASIC, 2: DEBUG)
     */
    setLevel(level) {
        if (typeof level !== 'number' || level < 0 || level > 2) {
            console.error("[PromptAssistant-Error] Invalid log level:", level);
            return;
        }
        this.level = level;
    }
}

// Create singleton instance
const logger = new Logger();

// Export logger instance and log level constants
export { logger };