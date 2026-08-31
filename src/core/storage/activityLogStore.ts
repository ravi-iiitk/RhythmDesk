/**
 * ActivityLogStore - Persistent storage for user-facing activity log entries
 * 
 * Uses electron-store for durable persistence.
 * Entries are automatically pruned based on retention settings.
 */

import Store from 'electron-store';
import { ActivityLogEntry } from '../../shared/types';
import logger from '../logger';

interface ActivityLogStoreSchema {
  entries: ActivityLogEntry[];
}

class ActivityLogStore {
  private store: Store<ActivityLogStoreSchema>;
  private static instance: ActivityLogStore | null = null;

  private constructor() {
    this.store = new Store<ActivityLogStoreSchema>({
      name: 'activity-log',
      defaults: {
        entries: [],
      },
    });

    logger.info('ActivityLogStore', 'Initialized', {
      path: this.store.path,
      entryCount: this.store.get('entries').length,
    });
  }

  static getInstance(): ActivityLogStore {
    if (!ActivityLogStore.instance) {
      ActivityLogStore.instance = new ActivityLogStore();
    }
    return ActivityLogStore.instance;
  }

  // For testing
  static resetInstance(): void {
    ActivityLogStore.instance = null;
  }

  getStorePath(): string {
    return this.store.path;
  }

  /**
   * Add a new log entry
   */
  addEntry(entry: ActivityLogEntry): void {
    const entries = this.store.get('entries');
    entries.push(entry);
    this.store.set('entries', entries);
  }

  /**
   * Get all log entries, optionally filtered by date range
   */
  getEntries(fromTimestamp?: number, toTimestamp?: number): ActivityLogEntry[] {
    let entries = this.store.get('entries');
    
    if (fromTimestamp) {
      entries = entries.filter(e => e.timestamp >= fromTimestamp);
    }
    if (toTimestamp) {
      entries = entries.filter(e => e.timestamp <= toTimestamp);
    }
    
    // Return newest first
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Prune entries older than the specified number of days
   */
  pruneOldEntries(retentionDays: number): number {
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const entries = this.store.get('entries');
    const before = entries.length;
    const filtered = entries.filter(e => e.timestamp >= cutoff);
    this.store.set('entries', filtered);
    const pruned = before - filtered.length;
    if (pruned > 0) {
      logger.info('ActivityLogStore', 'Pruned old entries', { pruned, remaining: filtered.length });
    }
    return pruned;
  }

  /**
   * Clear all log entries
   */
  clear(): void {
    this.store.set('entries', []);
    logger.info('ActivityLogStore', 'All entries cleared');
  }

  /**
   * Get total entry count
   */
  getEntryCount(): number {
    return this.store.get('entries').length;
  }
}

export const activityLogStore = ActivityLogStore.getInstance();
export default activityLogStore;
