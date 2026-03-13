"use strict";
/**
 * RhythmDesk Sound Service
 *
 * Plays different sounds for different events.
 * Supports custom sound files and system notification sounds.
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
exports.soundService = exports.SOUND_EVENT_NAMES = exports.DEFAULT_SOUND_CONFIG = void 0;
exports.playSound = playSound;
exports.getSoundService = getSoundService;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = __importDefault(require("./logger"));
const configService_1 = __importDefault(require("./configService"));
exports.DEFAULT_SOUND_CONFIG = {
    enabled: true,
    volume: 50,
    sounds: {
        break_start: { enabled: true, file: 'chime.wav' },
        break_end: { enabled: true, file: 'bell.wav' },
        transition_start: { enabled: true, file: 'ding.wav' },
        phase_warning: { enabled: true, file: 'tick.wav' },
        session_start: { enabled: true, file: 'start.wav' },
        session_reset: { enabled: true, file: 'reset.wav' },
        postpone: { enabled: true, file: 'swoosh.wav' },
        focus_lock_start: { enabled: true, file: 'lock.wav' },
        focus_lock_end: { enabled: true, file: 'unlock.wav' },
        rest_block_start: { enabled: true, file: 'rest.wav' },
        rest_block_end: { enabled: true, file: 'bell.wav' },
    },
};
// Human-readable names for UI
exports.SOUND_EVENT_NAMES = {
    break_start: 'Break Starting',
    break_end: 'Break Ending',
    transition_start: 'Transition Starting',
    phase_warning: 'Phase Warning (1 min)',
    session_start: 'Session Started',
    session_reset: 'Session Reset',
    postpone: 'Break Postponed',
    focus_lock_start: 'Focus Lock Started',
    focus_lock_end: 'Focus Lock Ended',
    rest_block_start: 'Rest Block Started',
    rest_block_end: 'Rest Block Ended',
};
// ============================================================
// SOUND SERVICE
// ============================================================
class SoundService {
    constructor() {
        this.isInitialized = false;
        // Determine sounds directory based on packaged vs dev
        if (electron_1.app.isPackaged) {
            this.soundsDir = path.join(process.resourcesPath, 'resources/sounds');
        }
        else {
            this.soundsDir = path.join(__dirname, '../../resources/sounds');
        }
    }
    static getInstance() {
        if (!SoundService.instance) {
            SoundService.instance = new SoundService();
        }
        return SoundService.instance;
    }
    /**
     * Initialize the sound service
     */
    initialize() {
        if (this.isInitialized)
            return;
        // Ensure sounds directory exists
        this.ensureSoundsDirectory();
        this.isInitialized = true;
        logger_1.default.info('SoundService', 'Initialized', { soundsDir: this.soundsDir });
    }
    /**
     * Ensure sounds directory exists and has default sounds
     */
    ensureSoundsDirectory() {
        try {
            if (!fs.existsSync(this.soundsDir)) {
                fs.mkdirSync(this.soundsDir, { recursive: true });
                logger_1.default.info('SoundService', 'Created sounds directory');
            }
        }
        catch (error) {
            logger_1.default.warn('SoundService', 'Could not create sounds directory', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /**
     * Get path to a sound file
     */
    getSoundPath(filename) {
        return path.join(this.soundsDir, filename);
    }
    /**
     * Check if a sound file exists
     */
    soundExists(filename) {
        if (filename === 'none' || filename === 'default')
            return true;
        return fs.existsSync(this.getSoundPath(filename));
    }
    /**
     * Get list of available sound files
     */
    getAvailableSounds() {
        try {
            if (!fs.existsSync(this.soundsDir)) {
                return ['none'];
            }
            const files = fs.readdirSync(this.soundsDir)
                .filter(f => f.endsWith('.wav') || f.endsWith('.mp3') || f.endsWith('.ogg'));
            return ['none', ...files];
        }
        catch {
            return ['none'];
        }
    }
    /**
     * Play a sound for a specific event
     */
    async playSound(event) {
        const settings = configService_1.default.getGeneralSettings();
        // Check if sounds are globally enabled
        if (!settings.soundEnabled) {
            return;
        }
        // Get sound config (use defaults if not configured)
        const soundConfig = settings.soundConfig;
        const eventConfig = soundConfig?.sounds?.[event] ?? exports.DEFAULT_SOUND_CONFIG.sounds[event];
        // Check if this specific sound is enabled
        if (!eventConfig.enabled || eventConfig.file === 'none') {
            return;
        }
        const volume = (soundConfig?.volume ?? settings.soundVolume ?? 50) / 100;
        try {
            await this.playSoundFile(eventConfig.file, volume);
            logger_1.default.debug('SoundService', `Played sound for ${event}`, { file: eventConfig.file });
        }
        catch (error) {
            logger_1.default.warn('SoundService', `Failed to play sound for ${event}`, {
                file: eventConfig.file,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /**
     * Play a specific sound file
     */
    async playSoundFile(filename, volume) {
        if (filename === 'none')
            return;
        const soundPath = this.getSoundPath(filename);
        // Check if file exists
        if (!fs.existsSync(soundPath)) {
            // Try to use system beep as fallback
            await this.playSystemBeep();
            return;
        }
        // Use shell command to play sound (cross-platform approach for Electron main process)
        const { exec } = require('child_process');
        // Linux: use paplay (PulseAudio) or aplay (ALSA)
        const command = `paplay "${soundPath}" --volume=${Math.floor(volume * 65536)} 2>/dev/null || aplay "${soundPath}" 2>/dev/null`;
        exec(command, (error) => {
            if (error) {
                logger_1.default.debug('SoundService', 'Sound playback command failed, trying fallback', {
                    error: error.message,
                });
                // Fallback to system beep
                this.playSystemBeep();
            }
        });
    }
    /**
     * Play system beep as fallback
     */
    async playSystemBeep() {
        const { shell } = require('electron');
        shell.beep();
    }
    /**
     * Play a test sound
     */
    async playTestSound(filename, volume = 50) {
        await this.playSoundFile(filename, volume / 100);
    }
}
// ============================================================
// EXPORTS
// ============================================================
exports.soundService = SoundService.getInstance();
/**
 * Convenience function to play a sound event
 */
function playSound(event) {
    exports.soundService.playSound(event).catch(() => {
        // Ignore errors - sound is non-critical
    });
}
/**
 * Get the sound service instance
 */
function getSoundService() {
    return exports.soundService;
}
//# sourceMappingURL=soundService.js.map