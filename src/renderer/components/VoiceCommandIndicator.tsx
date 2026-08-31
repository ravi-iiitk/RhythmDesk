/**
 * VoiceCommandIndicator
 * 
 * Floating UI overlay that shows voice command state:
 * - Listening animation (pulsing mic)
 * - Live transcript as user speaks
 * - Feedback message after command executes
 */

import { VoiceCommandState, VoiceCommandStatus } from '../hooks/useVoiceCommand';

interface Props {
  state: VoiceCommandState;
  available: boolean;
}

const statusColors: Record<VoiceCommandStatus, string> = {
  idle: 'transparent',
  listening: '#22c55e',
  processing: '#eab308',
  success: '#3b82f6',
  error: '#ef4444',
};

const statusLabels: Record<VoiceCommandStatus, string> = {
  idle: '',
  listening: '🎙️ Listening...',
  processing: '⏳ Processing...',
  success: '✓',
  error: '✗',
};

export function VoiceCommandIndicator({ state, available }: Props) {
  if (!available) return null;
  if (state.status === 'idle') return null;

  const color = statusColors[state.status];

  return (
    <div style={{
      position: 'fixed',
      bottom: '1.5rem',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.5rem',
      pointerEvents: 'none',
    }}>
      {/* Main pill */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.6rem 1.25rem',
        borderRadius: '2rem',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: `1px solid ${color}`,
        boxShadow: `0 0 20px ${color}40, 0 4px 12px rgba(0,0,0,0.5)`,
        backdropFilter: 'blur(8px)',
        transition: 'all 0.3s ease',
      }}>
        {/* Mic icon with pulse */}
        {state.status === 'listening' && (
          <span style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: color,
            animation: 'voicePulse 1.2s ease-in-out infinite',
          }} />
        )}

        {/* Status / transcript */}
        <span style={{
          color: '#e2e8f0',
          fontSize: '0.9rem',
          fontWeight: 500,
          maxWidth: '400px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {state.transcript
            ? `"${state.transcript}"`
            : statusLabels[state.status]
          }
        </span>
      </div>

      {/* Feedback message */}
      {state.feedback && (
        <div style={{
          padding: '0.4rem 1rem',
          borderRadius: '1rem',
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          border: `1px solid ${color}50`,
          color: color,
          fontSize: '0.85rem',
          fontWeight: 500,
          maxWidth: '500px',
          textAlign: 'center',
        }}>
          {state.feedback}
        </div>
      )}

      {/* CSS animation */}
      <style>{`
        @keyframes voicePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.5); }
        }
      `}</style>
    </div>
  );
}
