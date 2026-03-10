"use strict";
/**
 * RhythmDesk Logger
 * Lightweight logging utility for development and production
 *
 * In development: logs to console
 * In production: logs to ~/.rhythmdesk/logs/app.log
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class Logger {
    constructor() {
        this.logPath = '';
        this.debugEnabled = false;
        this.initialized = false;
        this.writeStream = null;
        this.buffer = [];
        this.flushInterval = null;
    }
    isDev() {
        return process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    }
    ensureInitialized() {
        if (this.initialized)
            return;
        try {
            const userDataPath = electron_1.app.getPath('userData');
            const logsDir = path.join(userDataPath, 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            this.logPath = path.join(logsDir, 'app.log');
            // Rotate log if too large (> 5MB)
            this.rotateLogIfNeeded();
            // Open write stream for production
            if (!this.isDev()) {
                this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a' });
            }
            // Flush buffer periodically
            this.flushInterval = setInterval(() => this.flush(), 5000);
            this.initialized = true;
        }
        catch (error) {
            console.error('Failed to initialize logger:', error);
        }
    }
    rotateLogIfNeeded() {
        try {
            if (fs.existsSync(this.logPath)) {
                const stats = fs.statSync(this.logPath);
                if (stats.size > 5 * 1024 * 1024) { // 5MB
                    const rotatedPath = this.logPath + '.old';
                    if (fs.existsSync(rotatedPath)) {
                        fs.unlinkSync(rotatedPath);
                    }
                    fs.renameSync(this.logPath, rotatedPath);
                }
            }
        }
        catch (error) {
            console.error('Failed to rotate log:', error);
        }
    }
    formatEntry(entry) {
        let line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`;
        if (entry.data !== undefined) {
            try {
                line += ` ${JSON.stringify(entry.data)}`;
            }
            catch {
                line += ` [data not serializable]`;
            }
        }
        return line;
    }
    write(level, category, message, data) {
        // Skip debug logs unless debug mode is enabled
        if (level === 'debug' && !this.debugEnabled) {
            return;
        }
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            category,
            message,
            data,
        };
        const formatted = this.formatEntry(entry);
        // Always log to console in development
        if (this.isDev()) {
            const consoleMethod = level === 'error' ? console.error
                : level === 'warn' ? console.warn
                    : console.log;
            consoleMethod(formatted);
        }
        // Write to file in production
        if (!this.isDev()) {
            this.ensureInitialized();
            this.buffer.push(formatted);
        }
    }
    flush() {
        if (this.buffer.length === 0 || !this.writeStream)
            return;
        const content = this.buffer.join('\n') + '\n';
        this.buffer = [];
        try {
            this.writeStream.write(content);
        }
        catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }
    /**
     * Enable or disable debug logging
     */
    setDebugEnabled(enabled) {
        this.debugEnabled = enabled;
        this.info('Logger', `Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    }
    /**
     * Check if debug mode is enabled
     */
    isDebugEnabled() {
        return this.debugEnabled;
    }
    /**
     * Log debug message (only shown when debug mode is enabled)
     */
    debug(category, message, data) {
        this.write('debug', category, message, data);
    }
    /**
     * Log info message
     */
    info(category, message, data) {
        this.write('info', category, message, data);
    }
    /**
     * Log warning message
     */
    warn(category, message, data) {
        this.write('warn', category, message, data);
    }
    /**
     * Log error message
     */
    error(category, message, data) {
        this.write('error', category, message, data);
    }
    /**
     * Clean up resources
     */
    shutdown() {
        this.flush();
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = null;
        }
    }
}
// Singleton instance
exports.logger = new Logger();
exports.default = exports.logger;
//# sourceMappingURL=logger.js.map