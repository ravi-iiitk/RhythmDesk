/**
 * RhythmDesk Schedule Form Component
 * Create and edit schedules
 */

import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Schedule, DayOfWeek, DEFAULT_SCHEDULE, ScheduleMode, FlowStep, FlowStepType } from '../../shared/types';
import { DAY_SHORT_LABELS } from '../../shared/constants';
import {
  getDefaultFlowSteps,
  createFlowStep,
  getFlowStepDisplayName,
  moveFlowStepUp,
  moveFlowStepDown,
  removeFlowStep,
  validateFlowSteps,
} from '../../core/flowUtils';

const FLOW_STEP_TYPES: FlowStepType[] = [
  'sit',
  'stand',
  'sit-to-stand-transition',
  'stand-to-sit-transition',
  'short-break',
];

interface ScheduleFormProps {
  schedule: Schedule | null;
  onSave: (schedule: Schedule) => void;
  onCancel: () => void;
}

const ALL_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function ScheduleForm({ schedule, onSave, onCancel }: ScheduleFormProps) {
  const [formData, setFormData] = useState<Omit<Schedule, 'id' | 'createdAt'>>({
    ...DEFAULT_SCHEDULE,
    name: '',
  });
  
  // Flow-based mode state
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('rule-based');
  const [flowSteps, setFlowSteps] = useState<FlowStep[]>(getDefaultFlowSteps());
  const [flowValidationErrors, setFlowValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (schedule) {
      const { id, createdAt, ...rest } = schedule;
      // Ensure ALL legacy fields have safe defaults when loading existing schedule
      // This prevents crashes when editing schedules from before migration
      setFormData({
        ...rest,
        // Transition durations
        sitToStandTransitionSeconds: rest.sitToStandTransitionSeconds ?? 60,
        standToSitTransitionSeconds: rest.standToSitTransitionSeconds ?? 60,
        // Short break fields
        shortBreakEnabled: rest.shortBreakEnabled ?? true,
        shortBreakEveryMinutes: rest.shortBreakEveryMinutes ?? 60,
        shortBreakDurationMinutes: rest.shortBreakDurationMinutes ?? 5,
        // Long break fields
        longBreakEnabled: rest.longBreakEnabled ?? true,
        longBreakEveryMinutes: rest.longBreakEveryMinutes ?? 150,
        longBreakDurationMinutes: rest.longBreakDurationMinutes ?? 15,
        // Strict mode
        strictModeEnabled: rest.strictModeEnabled ?? true,
        // Postpone fields
        allowPostpone: rest.allowPostpone ?? true,
        postponeOptionsMinutes: rest.postponeOptionsMinutes ?? [2, 5, 10],
        maxPostponesPerDay: rest.maxPostponesPerDay ?? 3,
        // Cumulative work time settings
        transitionsCountAsCumulativeWork: rest.transitionsCountAsCumulativeWork ?? true,
        shortBreaksCountAsCumulativeWork: rest.shortBreaksCountAsCumulativeWork ?? true,
      });
      
      // Load schedule mode and flow steps
      setScheduleMode(rest.mode ?? 'rule-based');
      if (rest.flowSteps && rest.flowSteps.length > 0) {
        setFlowSteps(rest.flowSteps);
      } else {
        setFlowSteps(getDefaultFlowSteps());
      }
    }
  }, [schedule]);

  const handleChange = (field: keyof typeof formData, value: any) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };
      
      // When enabling features, ensure their related fields have safe defaults
      if (field === 'shortBreakEnabled' && value === true) {
        if (!updated.shortBreakEveryMinutes) updated.shortBreakEveryMinutes = 60;
        if (!updated.shortBreakDurationMinutes) updated.shortBreakDurationMinutes = 5;
      }
      
      if (field === 'longBreakEnabled' && value === true) {
        if (!updated.longBreakEveryMinutes) updated.longBreakEveryMinutes = 150;
        if (!updated.longBreakDurationMinutes) updated.longBreakDurationMinutes = 15;
      }
      
      if (field === 'allowPostpone' && value === true) {
        if (!updated.postponeOptionsMinutes || updated.postponeOptionsMinutes.length === 0) {
          updated.postponeOptionsMinutes = [2, 5, 10];
        }
        if (updated.maxPostponesPerDay === undefined || updated.maxPostponesPerDay === null) {
          updated.maxPostponesPerDay = 3;
        }
      }
      
      return updated;
    });
  };

  const handleDayToggle = (day: DayOfWeek) => {
    const newDays = formData.activeDays.includes(day)
      ? formData.activeDays.filter((d) => d !== day)
      : [...formData.activeDays, day];
    handleChange('activeDays', newDays);
  };

  const handlePostponeOptionsChange = (value: string) => {
    const options = value
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    handleChange('postponeOptionsMinutes', options);
  };

  // Flow builder handlers
  const handleAddFlowStep = (type: FlowStepType) => {
    const newStep = createFlowStep(type);
    setFlowSteps([...flowSteps, newStep]);
  };

  const handleRemoveFlowStep = (index: number) => {
    setFlowSteps(removeFlowStep(flowSteps, index));
  };

  const handleMoveFlowStepUp = (index: number) => {
    setFlowSteps(moveFlowStepUp(flowSteps, index));
  };

  const handleMoveFlowStepDown = (index: number) => {
    setFlowSteps(moveFlowStepDown(flowSteps, index));
  };

  const handleFlowStepDurationChange = (index: number, durationSeconds: number) => {
    const newSteps = [...flowSteps];
    newSteps[index] = { ...newSteps[index], durationSeconds: Math.max(1, durationSeconds) };
    setFlowSteps(newSteps);
  };

  // Convert seconds to h:m:s components
  const secondsToHMS = (totalSeconds: number): { h: number; m: number; s: number } => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return { h, m, s };
  };

  // Handle individual h/m/s field changes
  const handleHMSChange = (index: number, field: 'h' | 'm' | 's', value: number) => {
    const current = secondsToHMS(flowSteps[index].durationSeconds);
    current[field] = Math.max(0, value || 0);
    const totalSeconds = current.h * 3600 + current.m * 60 + current.s;
    handleFlowStepDurationChange(index, totalSeconds || 1);
  };

  const handleModeChange = (mode: ScheduleMode) => {
    setScheduleMode(mode);
    // Clear validation errors when switching modes
    setFlowValidationErrors([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate flow steps if in flow-based mode
    if (scheduleMode === 'flow-based') {
      const errors = validateFlowSteps(flowSteps);
      if (errors.length > 0) {
        setFlowValidationErrors(errors);
        return;
      }
    }
    
    // Sync legacy fields to nested config structures
    // This ensures timer engine picks up the updated values
    const savedSchedule: Schedule = {
      id: schedule?.id || uuidv4(),
      createdAt: schedule?.createdAt || Date.now(),
      ...formData,
      // Schedule mode
      mode: scheduleMode,
      // Flow steps (only used in flow-based mode)
      flowSteps: scheduleMode === 'flow-based' ? flowSteps : undefined,
      // Sync to nested transition configs
      transitions: {
        sitToStand: {
          durationSeconds: formData.sitToStandTransitionSeconds ?? 60,
          strictModeEnabled: formData.strictModeEnabled ?? true,
          allowPostpone: formData.allowPostpone ?? true,
          postponeOptionsMinutes: formData.postponeOptionsMinutes ?? [2, 5, 10],
          maxPostponesPerDay: formData.maxPostponesPerDay ?? 3,
        },
        standToSit: {
          durationSeconds: formData.standToSitTransitionSeconds ?? 60,
          strictModeEnabled: formData.strictModeEnabled ?? true,
          allowPostpone: formData.allowPostpone ?? true,
          postponeOptionsMinutes: formData.postponeOptionsMinutes ?? [2, 5, 10],
          maxPostponesPerDay: formData.maxPostponesPerDay ?? 3,
        },
      },
      // Sync to nested break configs
      shortBreak: {
        enabled: formData.shortBreakEnabled ?? true,
        everyMinutes: formData.shortBreakEveryMinutes ?? 60,
        durationMinutes: formData.shortBreakDurationMinutes ?? 5,
        strictModeEnabled: formData.strictModeEnabled ?? true,
        allowPostpone: formData.allowPostpone ?? true,
        postponeOptionsMinutes: formData.postponeOptionsMinutes ?? [2, 5, 10],
        maxPostponesPerDay: formData.maxPostponesPerDay ?? 3,
      },
      longBreak: {
        enabled: formData.longBreakEnabled ?? true,
        everyMinutes: formData.longBreakEveryMinutes ?? 150,
        durationMinutes: formData.longBreakDurationMinutes ?? 15,
        strictModeEnabled: formData.strictModeEnabled ?? true,
        allowPostpone: formData.allowPostpone ?? true,
        postponeOptionsMinutes: formData.postponeOptionsMinutes ?? [2, 5, 10],
        maxPostponesPerDay: formData.maxPostponesPerDay ?? 3,
      },
    };
    
    onSave(savedSchedule);
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <div className="card-header">
        <span className="card-title">
          {schedule ? 'Edit Schedule' : 'Create Schedule'}
        </span>
      </div>

      {/* Basic Info */}
      <div className="form-group">
        <label className="form-label">Schedule Name</label>
        <input
          type="text"
          className="form-input"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="e.g., EPAM Day"
          required
        />
      </div>

      {/* Active Days */}
      <div className="form-group">
        <label className="form-label">Active Days</label>
        <div className="days-selector">
          {ALL_DAYS.map((day) => (
            <button
              key={day}
              type="button"
              className={`day-toggle ${formData.activeDays.includes(day) ? 'selected' : ''}`}
              onClick={() => handleDayToggle(day)}
            >
              {DAY_SHORT_LABELS[day]}
            </button>
          ))}
        </div>
      </div>

      {/* Time Range */}
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Start Time</label>
          <input
            type="time"
            className="form-input"
            value={formData.startTime}
            onChange={(e) => handleChange('startTime', e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">End Time</label>
          <input
            type="time"
            className="form-input"
            value={formData.endTime}
            onChange={(e) => handleChange('endTime', e.target.value)}
            required
          />
        </div>
      </div>

      {/* Schedule Mode Selector */}
      <div className="form-group">
        <label className="form-label">Schedule Mode</label>
        <div className="mode-selector" style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className={`btn ${scheduleMode === 'rule-based' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => handleModeChange('rule-based')}
            style={{ flex: 1 }}
          >
            Rule-Based
          </button>
          <button
            type="button"
            className={`btn ${scheduleMode === 'flow-based' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => handleModeChange('flow-based')}
            style={{ flex: 1 }}
          >
            Flow-Based
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
          {scheduleMode === 'rule-based' 
            ? 'Breaks trigger based on cumulative work time rules'
            : 'Activities follow a configured sequence that repeats'}
        </p>
      </div>

      {/* Flow Builder (only shown in flow-based mode) */}
      {scheduleMode === 'flow-based' && (
        <div className="form-group">
          <label className="form-label">Flow Steps</label>
          {flowValidationErrors.length > 0 && (
            <div style={{ color: '#ef4444', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
              {flowValidationErrors.map((err, i) => (
                <div key={i}>⚠ {err}</div>
              ))}
            </div>
          )}
          <div className="flow-steps" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {flowSteps.map((step, index) => (
              <div 
                key={step.id} 
                className="flow-step"
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  padding: '0.5rem',
                  background: 'var(--bg-secondary)',
                  borderRadius: '0.375rem',
                }}
              >
                <span style={{ width: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  {index + 1}.
                </span>
                <span style={{ flex: 1, fontWeight: 500 }}>
                  {getFlowStepDisplayName(step.type)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={secondsToHMS(step.durationSeconds).h}
                    onChange={(e) => handleHMSChange(index, 'h', parseInt(e.target.value, 10) || 0)}
                    style={{ width: '3.5rem', textAlign: 'center', padding: '0.5rem' }}
                    className="form-input"
                    placeholder="0"
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>h</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={secondsToHMS(step.durationSeconds).m}
                    onChange={(e) => handleHMSChange(index, 'm', Math.min(59, parseInt(e.target.value, 10) || 0))}
                    style={{ width: '3.5rem', textAlign: 'center', padding: '0.5rem' }}
                    className="form-input"
                    placeholder="0"
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>m</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={secondsToHMS(step.durationSeconds).s}
                    onChange={(e) => handleHMSChange(index, 's', Math.min(59, parseInt(e.target.value, 10) || 0))}
                    style={{ width: '3.5rem', textAlign: 'center', padding: '0.5rem' }}
                    className="form-input"
                    placeholder="0"
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>s</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleMoveFlowStepUp(index)}
                  disabled={index === 0}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveFlowStepDown(index)}
                  disabled={index === flowSteps.length - 1}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveFlowStep(index)}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#ef4444' }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <label className="form-label" style={{ fontSize: '0.75rem' }}>Add Step:</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
              {FLOW_STEP_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleAddFlowStep(type)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                >
                  + {getFlowStepDisplayName(type)}
                </button>
              ))}
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
            Long breaks still trigger based on cumulative work time if enabled below.
          </p>
        </div>
      )}

      {/* Sit/Stand Durations (only shown in rule-based mode) */}
      {scheduleMode === 'rule-based' && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Sit Duration (minutes)</label>
              <input
                type="number"
                className="form-input"
                value={formData.sitMinutes}
                onChange={(e) => handleChange('sitMinutes', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                onBlur={(e) => !e.target.value && handleChange('sitMinutes', 1)}
                min="1"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Stand Duration (minutes)</label>
              <input
                type="number"
                className="form-input"
                value={formData.standMinutes}
                onChange={(e) => handleChange('standMinutes', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                onBlur={(e) => !e.target.value && handleChange('standMinutes', 1)}
                min="1"
                required
              />
            </div>
          </div>

          {/* Transition Durations */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Sit→Stand Transition (seconds)</label>
              <input
                type="number"
                className="form-input"
                value={formData.sitToStandTransitionSeconds ?? 60}
                onChange={(e) => handleChange('sitToStandTransitionSeconds', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                onBlur={(e) => !e.target.value && handleChange('sitToStandTransitionSeconds', 60)}
                min="10"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Stand→Sit Transition (seconds)</label>
              <input
                type="number"
                className="form-input"
                value={formData.standToSitTransitionSeconds ?? 60}
                onChange={(e) => handleChange('standToSitTransitionSeconds', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                onBlur={(e) => !e.target.value && handleChange('standToSitTransitionSeconds', 60)}
                min="10"
                required
              />
            </div>
          </div>

          {/* Short Break */}
          <div className="form-group">
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={formData.shortBreakEnabled ?? true}
                onChange={(e) => handleChange('shortBreakEnabled', e.target.checked)}
              />
              Enable Short Breaks
            </label>
          </div>
          {formData.shortBreakEnabled && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Short Break Every (minutes)</label>
                <input
                  type="number"
                  className="form-input"
                  value={formData.shortBreakEveryMinutes ?? 60}
                  onChange={(e) => handleChange('shortBreakEveryMinutes', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  onBlur={(e) => !e.target.value && handleChange('shortBreakEveryMinutes', 60)}
                  min="1"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Short Break Duration (minutes)</label>
                <input
                  type="number"
                  className="form-input"
                  value={formData.shortBreakDurationMinutes ?? 5}
                  onChange={(e) => handleChange('shortBreakDurationMinutes', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  onBlur={(e) => !e.target.value && handleChange('shortBreakDurationMinutes', 5)}
                  min="1"
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Long Break */}
      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={formData.longBreakEnabled ?? true}
            onChange={(e) => handleChange('longBreakEnabled', e.target.checked)}
          />
          Enable Long Breaks
        </label>
      </div>
      {formData.longBreakEnabled && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Long Break Every (minutes)</label>
              <input
                type="number"
                className="form-input"
                value={formData.longBreakEveryMinutes ?? 150}
                onChange={(e) => handleChange('longBreakEveryMinutes', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                onBlur={(e) => !e.target.value && handleChange('longBreakEveryMinutes', 150)}
                min="1"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Long Break Duration (minutes)</label>
              <input
                type="number"
                className="form-input"
                value={formData.longBreakDurationMinutes ?? 15}
                onChange={(e) => handleChange('longBreakDurationMinutes', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                onBlur={(e) => !e.target.value && handleChange('longBreakDurationMinutes', 15)}
                min="1"
              />
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '0.375rem' }}>
            <p className="form-label" style={{ marginBottom: '0.5rem' }}>Count toward cumulative work time:</p>
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={formData.transitionsCountAsCumulativeWork ?? true}
                  onChange={(e) => handleChange('transitionsCountAsCumulativeWork', e.target.checked)}
                />
                Transitions
              </label>
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={formData.shortBreaksCountAsCumulativeWork ?? true}
                  onChange={(e) => handleChange('shortBreaksCountAsCumulativeWork', e.target.checked)}
                />
                Short Breaks
              </label>
            </div>
            <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.25rem' }}>
              Checked items count toward long break trigger threshold
            </p>
          </div>
        </>
      )}

      {/* Strict Mode */}
      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={formData.strictModeEnabled ?? true}
            onChange={(e) => handleChange('strictModeEnabled', e.target.checked)}
          />
          Enable Strict Mode
        </label>
        <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
          In strict mode, overlays cannot be easily dismissed
        </p>
      </div>

      {/* Postpone Settings */}
      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={formData.allowPostpone ?? true}
            onChange={(e) => handleChange('allowPostpone', e.target.checked)}
          />
          Allow Postpone
        </label>
      </div>
      {formData.allowPostpone && (
        <>
          <div className="form-group">
            <label className="form-label">Postpone Options (minutes, comma-separated)</label>
            <input
              type="text"
              className="form-input"
              value={(formData.postponeOptionsMinutes ?? [2, 5, 10]).join(', ')}
              onChange={(e) => handlePostponeOptionsChange(e.target.value)}
              placeholder="2, 5, 10"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max Postpones Per Day</label>
            <input
              type="number"
              className="form-input"
              value={formData.maxPostponesPerDay ?? 3}
              onChange={(e) => handleChange('maxPostponesPerDay', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              onBlur={(e) => !e.target.value && handleChange('maxPostponesPerDay', 0)}
              min="0"
            />
          </div>
        </>
      )}

      {/* Form Actions */}
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          {schedule ? 'Save Changes' : 'Create Schedule'}
        </button>
      </div>
    </form>
  );
}

export default ScheduleForm;
