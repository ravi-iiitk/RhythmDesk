/**
 * PostureGuard Logger
 * Lightweight logging utility for development and production
 * 
 * In development: logs to console
 * In production: logs to ~/.postureguard/logs/app.log
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: any;
}

class Logger {
  private logPath: string = '';
  private debugEnabled: boolean = false;
  private initialized: boolean = false;
  private writeStream: fs.WriteStream | null = null;
  private buffer: string[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  private isDev(): boolean {
    return process.env.NODE_ENV === 'development' || !app.isPackaged;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    
    try {
      const userDataPath = app.getPath('userData');
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
    } catch (error) {
      console.error('Failed to initialize logger:', error);
    }
  }

  private rotateLogIfNeeded(): void {
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
    } catch (error) {
      console.error('Failed to rotate log:', error);
    }
  }

  private formatEntry(entry: LogEntry): string {
    let line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`;
    if (entry.data !== undefined) {
      try {
        line += ` ${JSON.stringify(entry.data)}`;
      } catch {
        line += ` [data not serializable]`;
      }
    }
    return line;
  }

  private write(level: LogLevel, category: string, message: string, data?: any): void {
    // Skip debug logs unless debug mode is enabled
    if (level === 'debug' && !this.debugEnabled) {
      return;
    }

    const entry: LogEntry = {
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

  private flush(): void {
    if (this.buffer.length === 0 || !this.writeStream) return;
    
    const content = this.buffer.join('\n') + '\n';
    this.buffer = [];
    
    try {
      this.writeStream.write(content);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * Enable or disable debug logging
   */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
    this.info('Logger', `Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugEnabled(): boolean {
    return this.debugEnabled;
  }

  /**
   * Log debug message (only shown when debug mode is enabled)
   */
  debug(category: string, message: string, data?: any): void {
    this.write('debug', category, message, data);
  }

  /**
   * Log info message
   */
  info(category: string, message: string, data?: any): void {
    this.write('info', category, message, data);
  }

  /**
   * Log warning message
   */
  warn(category: string, message: string, data?: any): void {
    this.write('warn', category, message, data);
  }

  /**
   * Log error message
   */
  error(category: string, message: string, data?: any): void {
    this.write('error', category, message, data);
  }

  /**
   * Clean up resources
   */
  shutdown(): void {
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
export const logger = new Logger();
export default logger;
