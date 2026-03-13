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

import * as fs from 'fs';
import * as path from 'path';
import logger from './logger';

// ============================================================
// ATOMIC WRITE CONFIGURATION
// ============================================================

export interface AtomicWriteConfig {
  // Keep N backup files
  backupCount: number;
  
  // Sync to disk (fsync) after write
  fsyncEnabled: boolean;
  
  // Temp file suffix
  tempSuffix: string;
  
  // Backup file suffix
  backupSuffix: string;
}

const DEFAULT_CONFIG: AtomicWriteConfig = {
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
export function atomicWriteSync(
  filePath: string,
  data: string | object,
  config: Partial<AtomicWriteConfig> = {}
): { success: boolean; error?: string } {
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
      } finally {
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
      } catch (backupError) {
        // Log but don't fail - backup is optional
        logger.warn('AtomicWrite', 'Failed to create backup', { 
          filePath, 
          error: backupError instanceof Error ? backupError.message : String(backupError),
        });
      }
    }
    
    // Step 4: Rename temp to target (atomic)
    fs.renameSync(tempPath, filePath);
    
    logger.debug('AtomicWrite', 'Atomic write successful', { filePath });
    
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('AtomicWrite', 'Atomic write failed', { filePath, error: errorMsg });
    
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    
    return { success: false, error: errorMsg };
  }
}

/**
 * Async version of atomic write
 */
export async function atomicWrite(
  filePath: string,
  data: string | object,
  config: Partial<AtomicWriteConfig> = {}
): Promise<{ success: boolean; error?: string }> {
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
export function readWithFallback(
  filePath: string,
  config: Partial<AtomicWriteConfig> = {}
): { data: string | null; source: 'primary' | 'backup' | 'none'; error?: string } {
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
  } catch (error) {
    logger.warn('AtomicWrite', 'Primary file read/parse failed, trying backup', {
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
      logger.info('AtomicWrite', 'Recovered from backup file', { backupPath });
      return { data, source: 'backup' };
    }
  } catch (error) {
    logger.error('AtomicWrite', 'Backup file read/parse also failed', {
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
export function readJsonWithFallback<T>(
  filePath: string,
  defaultValue: T,
  config: Partial<AtomicWriteConfig> = {}
): { data: T; source: 'primary' | 'backup' | 'default'; recovered: boolean } {
  const result = readWithFallback(filePath, config);
  
  if (result.data) {
    try {
      const parsed = JSON.parse(result.data) as T;
      return { 
        data: parsed, 
        source: result.source as 'primary' | 'backup', 
        recovered: result.source === 'backup',
      };
    } catch {
      // Parse failed, return default
    }
  }
  
  return { data: defaultValue, source: 'default', recovered: false };
}

// ============================================================
// SNAPSHOT INTEGRITY
// ============================================================

export interface SnapshotIntegrity {
  valid: boolean;
  checksumMatch: boolean;
  version: string | null;
  timestamp: number | null;
  error?: string;
}

/**
 * Simple checksum for snapshot integrity
 */
export function computeChecksum(data: string): string {
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
export function wrapWithIntegrity<T extends object>(
  data: T,
  version: string = '1.0'
): { data: T; _meta: { checksum: string; version: string; timestamp: number } } {
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
export function verifyAndUnwrap<T extends object>(
  wrapped: { data: T; _meta?: { checksum: string; version: string; timestamp: number } }
): { data: T; integrity: SnapshotIntegrity } {
  if (!wrapped._meta) {
    // No integrity metadata - assume legacy format
    return {
      data: wrapped.data || (wrapped as unknown as T),
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
export function writeSnapshotSafe<T extends object>(
  filePath: string,
  data: T,
  version: string = '1.0'
): { success: boolean; error?: string } {
  const wrapped = wrapWithIntegrity(data, version);
  return atomicWriteSync(filePath, wrapped);
}

/**
 * Read snapshot with integrity verification
 */
export function readSnapshotSafe<T extends object>(
  filePath: string,
  defaultValue: T
): { 
  data: T; 
  source: 'primary' | 'backup' | 'default';
  integrity: SnapshotIntegrity;
  recovered: boolean;
} {
  const result = readJsonWithFallback<{ data: T; _meta?: { checksum: string; version: string; timestamp: number } }>(
    filePath,
    { data: defaultValue },
  );
  
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
