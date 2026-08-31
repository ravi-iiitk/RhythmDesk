/**
 * Voice Command Intent Parser for RhythmDesk
 * 
 * Parses natural language voice commands into structured intents
 * that map to existing RhythmDesk actions.
 * 
 * Supported commands:
 *   BREAKS:
 *     "take a break" / "break" / "I need a break"
 *     "break for 7 minutes" / "5 minute break" / "take 10"
 *     "bio break" / "bathroom break" (2 min default)
 *     "lunch break" / "dinner break" / "start rest"
 *     "stop break" / "end break" / "cancel break"
 *     "take the pending break" / "take break now"
 *   TIMER:
 *     "pause" / "pause the timer" / "hold"
 *     "pause for 10 minutes" / "pause for half an hour"
 *     "resume" / "continue" / "start" / "unpause"
 *     "skip" / "skip this" / "next phase"
 *     "done" / "complete" / "mark complete" / "finished"
 *     "start next" / "next activity" / "begin next"
 *   TIME ADJUSTMENT:
 *     "extend by 5" / "add 5 minutes" / "extend"
 *     "reduce by 2" / "shorten by 3" / "prepone"
 *     "reset duration" / "reset time" / "undo extend"
 *   SESSION:
 *     "reset" / "reset session" / "start over"
 *     "restart" / "restart this" / "redo"
 *     "reset counters" / "clear counters" / "reset stats"
 *   FLOW:
 *     "shuffle" / "shuffle the flow" / "randomize"
 *     "reverse" / "reverse the flow"
 *   FOCUS MODE:
 *     "start focus" / "focus mode" / "deep work"
 *     "stop focus" / "end focus" / "exit focus"
 *   QUERY:
 *     "how much time" / "time left" / "remaining"
 *     "status" / "what's happening" / "what phase"
 *   OTHER:
 *     "postpone" / "postpone by 5" / "delay break"
 *     "open settings" / "go to settings"
 *     "minimize" / "hide" / "go to tray"
 */

export type VoiceIntentAction =
  | 'startAdHocBreak'
  | 'pause'
  | 'pauseForDuration'
  | 'resume'
  | 'skip'
  | 'extend'
  | 'reduce'
  | 'reset'
  | 'shuffle'
  | 'reverse'
  | 'queryTimeLeft'
  | 'queryStatus'
  | 'startRestBlock'
  | 'stopBreak'
  | 'restart'
  | 'resetCounters'
  | 'resetPhaseDuration'
  | 'completePhase'
  | 'startNextActivity'
  | 'triggerPendingBreak'
  | 'postpone'
  | 'startFocusMode'
  | 'stopFocusMode'
  | 'openSettings'
  | 'minimize'
  | 'unknown';

export interface VoiceIntent {
  action: VoiceIntentAction;
  duration?: number; // in minutes
  restBlockName?: string;
  focusLabel?: string;
  rawText: string;
  confidence: number; // 0-1
}

// Number word mapping
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  twenty5: 25, thirty: 30, forty5: 45, sixty: 60,
  'twenty-five': 25, 'twenty five': 25,
  'thirty-five': 35, 'thirty five': 35,
  half: 30, // "half an hour"
};

/**
 * Extract a number (minutes) from text.
 * Handles: "5", "five", "15 minutes", "half an hour", etc.
 */
function extractMinutes(text: string): number | undefined {
  // Try numeric digits first
  const digitMatch = text.match(/(\d+)\s*(min|minute|minutes|m\b)?/i);
  if (digitMatch) {
    const num = parseInt(digitMatch[1], 10);
    if (num > 0 && num <= 120) return num;
  }

  // Try number words
  const lowerText = text.toLowerCase();
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (lowerText.includes(word)) {
      return value;
    }
  }

  // "half an hour" / "half hour"
  if (lowerText.includes('half') && lowerText.includes('hour')) {
    return 30;
  }

  // "an hour" / "one hour"
  if (lowerText.match(/\b(an?\s+hour|one\s+hour)\b/)) {
    return 60;
  }

  return undefined;
}

/**
 * Known rest block preset names (fuzzy matched)
 */
const REST_BLOCK_KEYWORDS: Record<string, { name: string; defaultMinutes?: number }> = {
  lunch: { name: 'Lunch Break' },
  dinner: { name: 'Dinner' },
  'big break': { name: 'Big Break' },
  'quick rest': { name: 'Quick Rest' },
  'bio break': { name: 'Bio Break', defaultMinutes: 2 },
  bathroom: { name: 'Bio Break', defaultMinutes: 2 },
};

/**
 * Parse a voice command text into a structured intent.
 */
export function parseVoiceIntent(text: string): VoiceIntent {
  const raw = text.trim();
  const lower = raw.toLowerCase();

  // --- OPEN SETTINGS ---
  if (lower.match(/\b(open settings|go to settings|show settings|settings page)\b/)) {
    return { action: 'openSettings', rawText: raw, confidence: 0.9 };
  }

  // --- MINIMIZE ---
  if (lower.match(/\b(minimize|hide|go to tray|hide window|minimize to tray)\b/)) {
    return { action: 'minimize', rawText: raw, confidence: 0.9 };
  }

  // --- STOP FOCUS MODE (before stop break, to avoid conflict) ---
  if (lower.match(/\b(stop|end|exit|cancel|quit)\s*(the\s+)?(focus|focus mode|deep work|focus lock)\b/)) {
    return { action: 'stopFocusMode', rawText: raw, confidence: 0.9 };
  }

  // --- STOP/END BREAK ---
  if (lower.match(/\b(stop|end|cancel|finish)\s*(the\s+)?(break|rest|lunch|dinner)\b/)) {
    return { action: 'stopBreak', rawText: raw, confidence: 0.85 };
  }

  // --- START FOCUS MODE ---
  if (lower.match(/\b(start|begin|enable)\s*(the\s+)?(focus|focus mode|focus lock|deep work|office focus)\b/) ||
      lower.match(/\b(focus mode|deep work|focus lock)\b/)) {
    const duration = extractMinutes(lower) || undefined;
    return { action: 'startFocusMode', duration, rawText: raw, confidence: 0.85 };
  }

  // --- PAUSE FOR DURATION ---
  if (lower.match(/\bpause\s+(for|the next)\s+/)) {
    const duration = extractMinutes(lower);
    if (duration) {
      return { action: 'pauseForDuration', duration, rawText: raw, confidence: 0.9 };
    }
  }

  // --- PAUSE ---
  if (lower.match(/\b(pause|hold|freeze|stop timer|pause timer|pause the timer)\b/)) {
    // Make sure it's not "stop break"
    if (!lower.match(/\b(stop|end|cancel)\s*(break|rest)/)) {
      return { action: 'pause', rawText: raw, confidence: 0.9 };
    }
  }

  // --- RESUME ---
  if (lower.match(/\b(resume|continue|unpause|start timer|go|carry on)\b/)) {
    // Avoid matching "start rest" / "start break" / "start focus"
    if (!lower.match(/\b(start)\s*(rest|break|lunch|dinner|focus|next)/)) {
      return { action: 'resume', rawText: raw, confidence: 0.9 };
    }
  }

  // --- COMPLETE / DONE ---
  if (lower.match(/\b(done|complete|mark complete|finished|i'm done|mark done|complete phase)\b/)) {
    return { action: 'completePhase', rawText: raw, confidence: 0.85 };
  }

  // --- START NEXT ACTIVITY ---
  if (lower.match(/\b(start next|next activity|begin next|start the next)\b/)) {
    return { action: 'startNextActivity', rawText: raw, confidence: 0.85 };
  }

  // --- TRIGGER PENDING BREAK ---
  if (lower.match(/\b(take the pending|pending break|take break now|take it now|break now)\b/)) {
    return { action: 'triggerPendingBreak', rawText: raw, confidence: 0.85 };
  }

  // --- POSTPONE ---
  if (lower.match(/\b(postpone|delay|defer|later|not now|push back)\b/)) {
    const duration = extractMinutes(lower) || undefined;
    return { action: 'postpone', duration, rawText: raw, confidence: 0.85 };
  }

  // --- REST BLOCK (named) ---
  for (const [keyword, config] of Object.entries(REST_BLOCK_KEYWORDS)) {
    if (lower.includes(keyword)) {
      // Check if it's a "start" intent
      if (lower.match(/\b(start|take|begin|go for|need)\b/) || lower.match(new RegExp(`\\b${keyword}\\b`))) {
        const duration = extractMinutes(lower) || config.defaultMinutes || undefined;
        return { action: 'startRestBlock', restBlockName: config.name, duration, rawText: raw, confidence: 0.85 };
      }
    }
  }

  // --- AD-HOC BREAK ---
  if (lower.match(/\b(break|rest|breather|nap)\b/)) {
    const duration = extractMinutes(lower);
    return { action: 'startAdHocBreak', duration, rawText: raw, confidence: 0.85 };
  }

  // "take 5" / "take 10" / "take fifteen"
  if (lower.match(/\btake\s+/)) {
    const duration = extractMinutes(lower);
    if (duration) {
      return { action: 'startAdHocBreak', duration, rawText: raw, confidence: 0.8 };
    }
  }

  // --- SKIP ---
  if (lower.match(/\b(skip|skip this|next phase|move on)\b/)) {
    return { action: 'skip', rawText: raw, confidence: 0.85 };
  }

  // --- EXTEND ---
  if (lower.match(/\b(extend|add|more time|longer|increase)\b/)) {
    const duration = extractMinutes(lower) || undefined;
    return { action: 'extend', duration, rawText: raw, confidence: 0.85 };
  }

  // --- REDUCE / PREPONE ---
  if (lower.match(/\b(reduce|shorten|less time|shorter|prepone|decrease|cut)\b/)) {
    const duration = extractMinutes(lower) || undefined;
    return { action: 'reduce', duration, rawText: raw, confidence: 0.85 };
  }

  // --- RESET PHASE DURATION (undo extend/reduce) ---
  if (lower.match(/\b(reset duration|reset time|reset timer|undo extend|undo reduce|original duration|original time)\b/)) {
    return { action: 'resetPhaseDuration', rawText: raw, confidence: 0.85 };
  }

  // --- RESET COUNTERS ---
  if (lower.match(/\b(reset counter|clear counter|reset stat|reset today|clear stat|clear today)\b/)) {
    return { action: 'resetCounters', rawText: raw, confidence: 0.85 };
  }

  // --- RESET SESSION ---
  if (lower.match(/\b(reset session|reset|start over|fresh start)\b/)) {
    return { action: 'reset', rawText: raw, confidence: 0.85 };
  }

  // --- RESTART current ---
  if (lower.match(/\b(restart|restart this|redo|redo this|restart current)\b/)) {
    return { action: 'restart', rawText: raw, confidence: 0.8 };
  }

  // --- SHUFFLE ---
  if (lower.match(/\b(shuffle|randomize|mix|random)\b/)) {
    return { action: 'shuffle', rawText: raw, confidence: 0.85 };
  }

  // --- REVERSE ---
  if (lower.match(/\b(reverse|flip|backwards|reverse flow)\b/)) {
    return { action: 'reverse', rawText: raw, confidence: 0.85 };
  }

  // --- QUERY TIME ---
  if (lower.match(/\b(time left|how much time|remaining|how long|what's left|time remaining)\b/)) {
    return { action: 'queryTimeLeft', rawText: raw, confidence: 0.9 };
  }

  // --- QUERY STATUS ---
  if (lower.match(/\b(status|what's happening|what phase|current phase|what am i doing|what's going on)\b/)) {
    return { action: 'queryStatus', rawText: raw, confidence: 0.85 };
  }

  // --- UNKNOWN ---
  return { action: 'unknown', rawText: raw, confidence: 0 };
}
