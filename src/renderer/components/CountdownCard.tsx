/**
 * PostureGuard Countdown Card Component
 * Displays the main countdown timer with progress bar
 */

import React from 'react';
import { formatDuration } from '../../shared/timeUtils';

interface CountdownCardProps {
  phase: string;
  phaseName: string;
  remaining: number;
  total: number;
  nextPhase: string;
  color: string;
}

function CountdownCard({ phaseName, remaining, total, nextPhase, color }: CountdownCardProps) {
  const progress = total > 0 ? ((total - remaining) / total) * 100 : 0;

  return (
    <div className="card countdown-card">
      <div className="countdown-phase" style={{ color }}>
        {phaseName}
      </div>
      <div className="countdown-timer" style={{ color }}>
        {formatDuration(remaining)}
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{
            width: `${progress}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <div className="countdown-next">
        Next: {nextPhase}
      </div>
    </div>
  );
}

export default CountdownCard;
