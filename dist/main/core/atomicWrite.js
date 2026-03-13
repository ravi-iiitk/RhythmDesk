"use strict";
/**
 * RhythmDesk Atomic Write - Phase 4 Production Hardening
 *
 * Crash-safe atomic file writes for snapshot persistence.
 * Prevents data corruption from partial writes or crashes.
 *
 * Strategy: write temp → fsync → rename
 *
 * Also maintains a backup of the last known good snapshot.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.atomicWriteSync = atomicWriteSync;
exports.atomicWrite = atomicWrite;
exports.readWithFallback = readWithFallback;
exports.readJsonWithFallback = readJsonWithFallback;
exports.computeChecksum = computeChecksum;
exports.wrapWithIntegrity = wrapWithIntegrity;
exports.verifyAndUnwrap = verifyAndUnwrap;
exports.writeSnapshotSafe = writeSnapshotSafe;
exports.readSnapshotSafe = readSnapshotSafe;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("./logger"));
const DEFAULT_CONFIG = {
    backupCount: 1,
    fsyncEnabled: true,
    tempSuffix: '.tmp',
    backupSuffix: '.bak',
};
// ============================================================
// ATOMIC WRITE FUNCTIONS
// ============================================================
/**
 * Write data atomically to a file
 *
 * Strategy:
 * 1. Write to temp file
 * 2. Fsync temp file (ensure data on disk)
 * 3. Rename temp to target (atomic on most filesystems)
 * 4. Keep backup of previous file
 *
 * @param filePath - Target file path
 * @param data - Data to write (will be JSON stringified if object)
 * @param config - Optional configuration
 */
function atomicWriteSync(filePath, data, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const tempPath = filePath + cfg.tempSuffix;
    const backupPath = filePath + cfg.backupSuffix;
    try {
        // Convert data to string if needed
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Step 1: Write to temp file
        fs.writeFileSync(tempPath, content, 'utf8');
        // Step 2: Fsync temp file
        if (cfg.fsyncEnabled) {
            const fd = fs.openSync(tempPath, 'r');
            try {
                fs.fsyncSync(fd);
            }
            finally {
                fs.closeSync(fd);
            }
        }
        // Step 3: Create backup of existing file (if exists)
        if (fs.existsSync(filePath)) {
            try {
                // Remove old backup
                if (fs.existsSync(backupPath)) {
                    fs.unlinkSync(backupPath);
                }
                // Rename current to backup
                fs.renameSync(filePath, backupPath);
            }
            catch (backupError) {
                // Log but don't fail - backup is optional
                logger_1.default.warn('AtomicWrite', 'Failed to create backup', {
                    filePath,
                    error: backupError instanceof Error ? backupError.message : String(backupError),
                });
            }
        }
        // Step 4: Rename temp to target (atomic)
        fs.renameSync(tempPath, filePath);
        logger_1.default.debug('AtomicWrite', 'Atomic write successful', { filePath });
        return { success: true };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger_1.default.error('AtomicWrite', 'Atomic write failed', { filePath, error: errorMsg });
        // Clean up temp file if it exists
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        }
        catch {
            // Ignore cleanup errors
        }
        return { success: false, error: errorMsg };
    }
}
/**
 * Async version of atomic write
 */
async function atomicWrite(filePath, data, config = {}) {
    return new Promise((resolve) => {
        // Use sync version in a try-catch for simplicity
        // Could be made truly async with fs.promises if needed
        resolve(atomicWriteSync(filePath, data, config));
    });
}
/**
 * Read file with fallback to backup
 *
 * If primary file is corrupted or missing, tries backup.
 */
function readWithFallback(filePath, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const backupPath = filePath + cfg.backupSuffix;
    // Try primary file first
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            // Validate JSON if it looks like JSON
            if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
                JSON.parse(data); // Will throw if invalid
            }
            return { data, source: 'primary' };
        }
    }
    catch (error) {
        logger_1.default.warn('AtomicWrite', 'Primary file read/parse failed, trying backup', {
            filePath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    // Try backup file
    try {
        if (fs.existsSync(backupPath)) {
            const data = fs.readFileSync(backupPath, 'utf8');
            // Validate JSON if it looks like JSON
            if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
                JSON.parse(data); // Will throw if invalid
            }
            logger_1.default.info('AtomicWrite', 'Recovered from backup file', { backupPath });
            return { data, source: 'backup' };
        }
    }
    catch (error) {
        logger_1.default.error('AtomicWrite', 'Backup file read/parse also failed', {
            backupPath,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            data: null,
            source: 'none',
            error: `Both primary and backup files are corrupted or missing`,
        };
    }
    // Neither exists
    return { data: null, source: 'none' };
}
/**
 * Read JSON with fallback to backup
 */
function readJsonWithFallback(filePath, defaultValue, config = {}) {
    const result = readWithFallback(filePath, config);
    if (result.data) {
        try {
            const parsed = JSON.parse(result.data);
            return {
                data: parsed,
                source: result.source,
                recovered: result.source === 'backup',
            };
        }
        catch {
            // Parse failed, return default
        }
    }
    return { data: defaultValue, source: 'default', recovered: false };
}
/**
 * Simple checksum for snapshot integrity
 */
function computeChecksum(data) {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
}
/**
 * Wrap data with integrity metadata
 */
function wrapWithIntegrity(data, version = '1.0') {
    const dataString = JSON.stringify(data);
    return {
        data,
        _meta: {
            checksum: computeChecksum(dataString),
            version,
            timestamp: Date.now(),
        },
    };
}
/**
 * Verify and unwrap integrity-wrapped data
 */
function verifyAndUnwrap(wrapped) {
    if (!wrapped._meta) {
        // No integrity metadata - assume legacy format
        return {
            data: wrapped.data || wrapped,
            integrity: {
                valid: true,
                checksumMatch: true,
                version: null,
                timestamp: null,
            },
        };
    }
    const dataString = JSON.stringify(wrapped.data);
    const expectedChecksum = computeChecksum(dataString);
    const checksumMatch = expectedChecksum === wrapped._meta.checksum;
    return {
        data: wrapped.data,
        integrity: {
            valid: checksumMatch,
            checksumMatch,
            version: wrapped._meta.version,
            timestamp: wrapped._meta.timestamp,
            error: checksumMatch ? undefined : 'Checksum mismatch - data may be corrupted',
        },
    };
}
// ============================================================
// SAFE SNAPSHOT WRITE
// ============================================================
/**
 * Write snapshot with integrity wrapper
 */
function writeSnapshotSafe(filePath, data, version = '1.0') {
    const wrapped = wrapWithIntegrity(data, version);
    return atomicWriteSync(filePath, wrapped);
}
/**
 * Read snapshot with integrity verification
 */
function readSnapshotSafe(filePath, defaultValue) {
    const result = readJsonWithFallback(filePath, { data: defaultValue });
    if (result.source === 'default') {
        return {
            data: defaultValue,
            source: 'default',
            integrity: { valid: true, checksumMatch: true, version: null, timestamp: null },
            recovered: false,
        };
    }
    const { data, integrity } = verifyAndUnwrap(result.data);
    return {
        data,
        source: result.source,
        integrity,
        recovered: result.recovered || !integrity.valid,
    };
}
//# sourceMappingURL=atomicWrite.js.map