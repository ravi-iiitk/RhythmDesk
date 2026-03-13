"use strict";
/**
 * RhythmDesk Log Rotation - Phase 5 Stability Lockdown
 *
 * Implements log rotation to prevent logs from growing indefinitely.
 *
 * FEATURES:
 * - Maximum log file size (5-10 MB)
 * - Archive old logs
 * - Keep limited history (3 files)
 * - Logs stored in ~/.config/rhythmdesk/logs/
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
exports.LogRotationManager = void 0;
exports.getLogRotation = getLogRotation;
exports.formatLogMessage = formatLogMessage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const DEFAULT_CONFIG = {
    maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
    maxFiles: 3,
    logDir: '', // Set at runtime
    logFileName: 'rhythmdesk.log',
};
// ============================================================
// LOG ROTATION MANAGER
// ============================================================
class LogRotationManager {
    constructor(config = {}) {
        this.writeStream = null;
        this.currentSize = 0;
        // Get log directory
        const userDataPath = electron_1.app?.getPath?.('userData') ||
            path.join(process.env.HOME || '', '.config', 'rhythmdesk');
        const logDir = config.logDir || path.join(userDataPath, 'logs');
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
            logDir,
        };
        this.currentLogPath = path.join(this.config.logDir, this.config.logFileName);
        // Ensure log directory exists
        this.ensureLogDir();
        // Check current file size
        this.currentSize = this.getFileSize(this.currentLogPath);
    }
    /**
     * Ensure log directory exists
     */
    ensureLogDir() {
        try {
            if (!fs.existsSync(this.config.logDir)) {
                fs.mkdirSync(this.config.logDir, { recursive: true });
            }
        }
        catch (error) {
            console.error('Failed to create log directory:', error);
        }
    }
    /**
     * Get file size or 0 if doesn't exist
     */
    getFileSize(filePath) {
        try {
            const stats = fs.statSync(filePath);
            return stats.size;
        }
        catch {
            return 0;
        }
    }
    /**
     * Write a log entry
     */
    write(message) {
        const line = message + '\n';
        const lineSize = Buffer.byteLength(line, 'utf8');
        // Check if rotation needed
        if (this.currentSize + lineSize > this.config.maxFileSizeBytes) {
            this.rotate();
        }
        // Write to file
        try {
            fs.appendFileSync(this.currentLogPath, line, 'utf8');
            this.currentSize += lineSize;
        }
        catch (error) {
            console.error('Failed to write log:', error);
        }
    }
    /**
     * Rotate logs
     */
    rotate() {
        try {
            // Close current stream if open
            if (this.writeStream) {
                this.writeStream.end();
                this.writeStream = null;
            }
            // Remove oldest file if at limit
            const oldestPath = this.getRotatedPath(this.config.maxFiles);
            if (fs.existsSync(oldestPath)) {
                fs.unlinkSync(oldestPath);
            }
            // Rotate existing files
            for (let i = this.config.maxFiles - 1; i >= 1; i--) {
                const fromPath = this.getRotatedPath(i);
                const toPath = this.getRotatedPath(i + 1);
                if (fs.existsSync(fromPath)) {
                    fs.renameSync(fromPath, toPath);
                }
            }
            // Rotate current log
            if (fs.existsSync(this.currentLogPath)) {
                fs.renameSync(this.currentLogPath, this.getRotatedPath(1));
            }
            // Reset size counter
            this.currentSize = 0;
            console.log('Log rotated successfully');
        }
        catch (error) {
            console.error('Failed to rotate logs:', error);
        }
    }
    /**
     * Get rotated log path
     */
    getRotatedPath(index) {
        const ext = path.extname(this.config.logFileName);
        const base = path.basename(this.config.logFileName, ext);
        return path.join(this.config.logDir, `${base}.${index}${ext}`);
    }
    /**
     * Get all log files
     */
    getLogFiles() {
        const files = [];
        if (fs.existsSync(this.currentLogPath)) {
            files.push(this.currentLogPath);
        }
        for (let i = 1; i <= this.config.maxFiles; i++) {
            const rotatedPath = this.getRotatedPath(i);
            if (fs.existsSync(rotatedPath)) {
                files.push(rotatedPath);
            }
        }
        return files;
    }
    /**
     * Get total log size
     */
    getTotalSize() {
        return this.getLogFiles().reduce((total, file) => {
            return total + this.getFileSize(file);
        }, 0);
    }
    /**
     * Clear all logs
     */
    clearAll() {
        for (const file of this.getLogFiles()) {
            try {
                fs.unlinkSync(file);
            }
            catch {
                // Ignore
            }
        }
        this.currentSize = 0;
    }
    /**
     * Get current log path
     */
    getCurrentLogPath() {
        return this.currentLogPath;
    }
    /**
     * Get log directory
     */
    getLogDir() {
        return this.config.logDir;
    }
}
exports.LogRotationManager = LogRotationManager;
// ============================================================
// SINGLETON
// ============================================================
let logRotationInstance = null;
function getLogRotation() {
    if (!logRotationInstance) {
        logRotationInstance = new LogRotationManager();
    }
    return logRotationInstance;
}
/**
 * Format log message with category
 */
function formatLogMessage(category, level, component, message, data) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] [${category}] [${component}] ${message}${dataStr}`;
}
//# sourceMappingURL=logRotation.js.map