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

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ============================================================
// CONFIGURATION
// ============================================================

export interface LogRotationConfig {
  maxFileSizeBytes: number;
  maxFiles: number;
  logDir: string;
  logFileName: string;
}

const DEFAULT_CONFIG: LogRotationConfig = {
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  maxFiles: 3,
  logDir: '', // Set at runtime
  logFileName: 'rhythmdesk.log',
};

// ============================================================
// LOG ROTATION MANAGER
// ============================================================

export class LogRotationManager {
  private config: LogRotationConfig;
  private currentLogPath: string;
  private writeStream: fs.WriteStream | null = null;
  private currentSize: number = 0;
  
  constructor(config: Partial<LogRotationConfig> = {}) {
    // Get log directory
    const userDataPath = app?.getPath?.('userData') || 
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
  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.config.logDir)) {
        fs.mkdirSync(this.config.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }
  
  /**
   * Get file size or 0 if doesn't exist
   */
  private getFileSize(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }
  
  /**
   * Write a log entry
   */
  write(message: string): void {
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
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }
  
  /**
   * Rotate logs
   */
  rotate(): void {
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
    } catch (error) {
      console.error('Failed to rotate logs:', error);
    }
  }
  
  /**
   * Get rotated log path
   */
  private getRotatedPath(index: number): string {
    const ext = path.extname(this.config.logFileName);
    const base = path.basename(this.config.logFileName, ext);
    return path.join(this.config.logDir, `${base}.${index}${ext}`);
  }
  
  /**
   * Get all log files
   */
  getLogFiles(): string[] {
    const files: string[] = [];
    
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
  getTotalSize(): number {
    return this.getLogFiles().reduce((total, file) => {
      return total + this.getFileSize(file);
    }, 0);
  }
  
  /**
   * Clear all logs
   */
  clearAll(): void {
    for (const file of this.getLogFiles()) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore
      }
    }
    this.currentSize = 0;
  }
  
  /**
   * Get current log path
   */
  getCurrentLogPath(): string {
    return this.currentLogPath;
  }
  
  /**
   * Get log directory
   */
  getLogDir(): string {
    return this.config.logDir;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let logRotationInstance: LogRotationManager | null = null;

export function getLogRotation(): LogRotationManager {
  if (!logRotationInstance) {
    logRotationInstance = new LogRotationManager();
  }
  return logRotationInstance;
}

// ============================================================
// LOG CATEGORIES
// ============================================================

export type LogCategory = 
  | 'BOOT'     // System initialization
  | 'TIMER'    // Phase transitions
  | 'SESSION'  // Runtime state updates
  | 'OVERLAY'  // Overlay lifecycle
  | 'TRAY'     // Tray events
  | 'STORAGE'  // Persistence events
  | 'ERROR'    // Critical issues
  | 'TRACE'    // Optional debug trace
  | 'IPC'      // IPC communication
  | 'CONFIG'   // Configuration changes
  | 'HEALTH';  // Health monitoring

/**
 * Format log message with category
 */
export function formatLogMessage(
  category: LogCategory,
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  component: string,
  message: string,
  data?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level}] [${category}] [${component}] ${message}${dataStr}`;
}
