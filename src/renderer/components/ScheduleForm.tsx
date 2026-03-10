/**
 * RhythmDesk Schedule Form Component
 * Create and edit schedules
 */

import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Schedule, DayOfWeek, DEFAULT_SCHEDULE } from '../../shared/types';
import { DAY_SHORT_LABELS } from '../../shared/constants';

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
      });
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const savedSchedule: Schedule = {
      id: schedule?.id || uuidv4(),
      createdAt: schedule?.createdAt || Date.now(),
      ...formData,
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

      {/* Sit/Stand Durations */}
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Sit Duration (minutes)</label>
          <input
            type="number"
            className="form-input"
            value={formData.sitMinutes}
            onChange={(e) => handleChange('sitMinutes', parseInt(e.target.value, 10))}
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
            onChange={(e) => handleChange('standMinutes', parseInt(e.target.value, 10))}
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
            onChange={(e) => handleChange('sitToStandTransitionSeconds', parseInt(e.target.value, 10) || 60)}
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
            onChange={(e) => handleChange('standToSitTransitionSeconds', parseInt(e.target.value, 10) || 60)}
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
              onChange={(e) => handleChange('shortBreakEveryMinutes', parseInt(e.target.value, 10) || 60)}
              min="1"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Short Break Duration (minutes)</label>
            <input
              type="number"
              className="form-input"
              value={formData.shortBreakDurationMinutes ?? 5}
              onChange={(e) => handleChange('shortBreakDurationMinutes', parseInt(e.target.value, 10) || 5)}
              min="1"
            />
          </div>
        </div>
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
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Long Break Every (minutes)</label>
            <input
              type="number"
              className="form-input"
              value={formData.longBreakEveryMinutes ?? 150}
              onChange={(e) => handleChange('longBreakEveryMinutes', parseInt(e.target.value, 10) || 150)}
              min="1"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Long Break Duration (minutes)</label>
            <input
              type="number"
              className="form-input"
              value={formData.longBreakDurationMinutes ?? 15}
              onChange={(e) => handleChange('longBreakDurationMinutes', parseInt(e.target.value, 10) || 15)}
              min="1"
            />
          </div>
        </div>
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
              onChange={(e) => handleChange('maxPostponesPerDay', parseInt(e.target.value, 10))}
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
