/**
 * useVoiceCommand Hook
 * 
 * Manages push-to-talk voice command recognition using:
 * - getUserMedia for mic recording (works in Electron)
 * - OpenAI Whisper API for transcription (via IPC to main process)
 * - Web Speech Synthesis for TTS feedback
 * 
 * Flow:
 *   1. User presses V → mic recording starts
 *   2. User releases V → recording stops, audio sent to Whisper
 *   3. Transcription returned → parsed into intent
 *   4. Intent executed → TTS feedback spoken
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { parseVoiceIntent, VoiceIntent } from '../utils/voiceIntentParser';

export type VoiceCommandStatus = 'idle' | 'listening' | 'processing' | 'success' | 'error';

export interface VoiceCommandState {
  status: VoiceCommandStatus;
  transcript: string;
  lastIntent: VoiceIntent | null;
  error: string | null;
  feedback: string | null;
}

interface UseVoiceCommandOptions {
  /** Called to execute a parsed intent. Return feedback string. */
  onIntent: (intent: VoiceIntent) => string | Promise<string>;
  /** Whether voice commands are enabled */
  enabled?: boolean;
  /** Voice mode: 'local' for whisper.cpp, 'cloud' for OpenAI API, 'off' to disable */
  voiceMode?: 'off' | 'local' | 'cloud';
}

/**
 * Speak feedback using TTS (Web Speech Synthesis — works in Electron)
 */
function speakFeedback(text: string): void {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  utterance.pitch = 1.0;
  utterance.volume = 0.8;
  window.speechSynthesis.speak(utterance);
}

/**
 * Encode recorded audio chunks into a WAV ArrayBuffer
 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit PCM
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function useVoiceCommand({ onIntent, enabled = true, voiceMode = 'off' }: UseVoiceCommandOptions) {
  const [state, setState] = useState<VoiceCommandState>({
    status: 'idle',
    transcript: '',
    lastIntent: null,
    error: null,
    feedback: null,
  });

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // getUserMedia is available in Electron; voice must be on
  const available = voiceMode !== 'off' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const clearFeedback = useCallback(() => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, status: 'idle', feedback: null, transcript: '' }));
    }, 4000);
  }, []);

  const processAudio = useCallback(async (audioBlob: Blob) => {
    setState(prev => ({ ...prev, status: 'processing', transcript: '...' }));

    try {
      // Convert blob to ArrayBuffer and then to WAV
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const samples = audioBuffer.getChannelData(0);
      const wavBuffer = encodeWav(samples, audioBuffer.sampleRate);
      audioContext.close();

      // Send to main process for transcription (local or cloud)
      const result = voiceMode === 'local'
        ? await window.rhythmDesk.voiceTranscribeLocal(wavBuffer)
        : await window.rhythmDesk.voiceTranscribe(wavBuffer);

      if (!result.success) {
        const errorMsg = result.error || 'Transcription failed';
        setState(prev => ({
          ...prev,
          status: 'error',
          feedback: errorMsg,
        }));
        // Only speak non-config errors (not API key missing)
        if (!errorMsg.toLowerCase().includes('api key')) {
          speakFeedback(errorMsg);
        }
        clearFeedback();
        return;
      }

      const transcript = result.text;
      if (!transcript) {
        setState(prev => ({ ...prev, status: 'idle', transcript: '', feedback: null }));
        return;
      }

      setState(prev => ({ ...prev, transcript }));

      // Parse intent
      const intent = parseVoiceIntent(transcript);

      if (intent.action === 'unknown') {
        setState(prev => ({
          ...prev,
          status: 'error',
          lastIntent: intent,
          feedback: `Didn't understand: "${transcript}"`,
        }));
        speakFeedback("Sorry, I didn't understand that command.");
        clearFeedback();
      } else {
        // Execute intent
        try {
          const feedback = await onIntent(intent);
          setState(prev => ({
            ...prev,
            status: 'success',
            lastIntent: intent,
            feedback,
          }));
          speakFeedback(feedback);
        } catch (err) {
          setState(prev => ({
            ...prev,
            status: 'error',
            lastIntent: intent,
            feedback: `Error: ${err}`,
          }));
        }
        clearFeedback();
      }
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        status: 'error',
        feedback: `Audio processing error: ${err.message}`,
      }));
      clearFeedback();
    }
  }, [onIntent, clearFeedback]);

  const startListening = useCallback(async () => {
    if (!available || !enabled || isRecordingRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 },
      });

      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      isRecordingRef.current = true;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        // Only process if we have meaningful audio (> 1KB)
        if (audioBlob.size > 1000) {
          processAudio(audioBlob);
        } else {
          setState(prev => ({ ...prev, status: 'idle', transcript: '' }));
        }
      };

      mediaRecorder.start();
      setState(prev => ({
        ...prev,
        status: 'listening',
        transcript: '',
        error: null,
        feedback: null,
      }));
    } catch (err: any) {
      isRecordingRef.current = false;
      let feedback = 'Could not access microphone.';
      if (err.name === 'NotAllowedError') {
        feedback = 'Microphone permission denied.';
      } else if (err.name === 'NotFoundError') {
        feedback = 'No microphone found.';
      }
      setState(prev => ({ ...prev, status: 'error', feedback }));
      clearFeedback();
    }
  }, [available, enabled, processAudio, clearFeedback]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      isRecordingRef.current = false;
    }
    // Stop mic stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && isRecordingRef.current) {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    state,
    available,
    startListening,
    stopListening,
    isListening: isRecordingRef.current || state.status === 'listening',
  };
}
