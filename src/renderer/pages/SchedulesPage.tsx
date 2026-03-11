/**
 * RhythmDesk Schedules Page
 * List and manage schedules
 */

import { useEffect, useState } from 'react';
import { Schedule } from '../../shared/types';
import { DAY_SHORT_LABELS } from '../../shared/constants';
import ScheduleForm from '../components/ScheduleForm';

function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSchedules();
  }, []);
  
  // Auto-hide save message after 3 seconds
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  const loadSchedules = async () => {
    const data = await window.rhythmDesk.getSchedules();
    setSchedules(data);
  };

  const handleCreate = () => {
    setEditingSchedule(null);
    setShowForm(true);
  };

  const handleEdit = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this schedule?')) {
      await window.rhythmDesk.deleteSchedule(id);
      loadSchedules();
    }
  };

  const handleSave = async (schedule: Schedule) => {
    try {
      await window.rhythmDesk.saveSchedule(schedule);
      
      // Validate: reload and verify the saved data
      const savedSchedules = await window.rhythmDesk.getSchedules();
      const savedSchedule = savedSchedules.find((s: Schedule) => s.id === schedule.id);
      
      if (savedSchedule) {
        // Verify key fields match
        const isValid = 
          savedSchedule.name === schedule.name &&
          savedSchedule.sitMinutes === schedule.sitMinutes &&
          savedSchedule.standMinutes === schedule.standMinutes &&
          savedSchedule.mode === schedule.mode;
        
        if (isValid) {
          setSaveMessage({ type: 'success', text: `✓ Schedule "${schedule.name}" saved successfully!` });
        } else {
          console.warn('Schedule validation mismatch:', { saved: savedSchedule, expected: schedule });
          setSaveMessage({ type: 'error', text: '⚠ Schedule saved but some values may not have been applied correctly' });
        }
      } else {
        setSaveMessage({ type: 'success', text: `✓ Schedule "${schedule.name}" saved!` });
      }
      
      setShowForm(false);
      setEditingSchedule(null);
      setSchedules(savedSchedules);
    } catch (error) {
      console.error('Failed to save schedule:', error);
      setSaveMessage({ type: 'error', text: '✗ Failed to save schedule. Please try again.' });
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingSchedule(null);
  };

  const handleToggleEnabled = async (schedule: Schedule) => {
    await window.rhythmDesk.saveSchedule({
      ...schedule,
      enabled: !schedule.enabled,
    });
    loadSchedules();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Schedules</h2>
        <p>Manage your work schedules</p>
      </div>

      {/* Save confirmation message */}
      {saveMessage && (
        <div style={{
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          borderRadius: '6px',
          backgroundColor: saveMessage.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          color: saveMessage.type === 'success' ? '#22c55e' : '#ef4444',
          border: `1px solid ${saveMessage.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          fontWeight: 500,
        }}>
          {saveMessage.text}
        </div>
      )}

      {!showForm && (
        <>
          <div className="mb-2">
            <button className="btn btn-primary" onClick={handleCreate}>
              + Create Schedule
            </button>
          </div>

          {schedules.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📅</div>
              <h3>No Schedules</h3>
              <p>Create your first schedule to get started.</p>
            </div>
          ) : (
            <div className="schedule-list">
              {schedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className={`schedule-item ${!schedule.enabled ? 'disabled' : ''}`}
                >
                  <div className="schedule-info">
                    <h3>{schedule.name}</h3>
                    <div className="schedule-meta">
                      <span>
                        {schedule.activeDays.map((d) => DAY_SHORT_LABELS[d]).join(', ')}
                      </span>
                      <span> • </span>
                      <span>{schedule.startTime} - {schedule.endTime}</span>
                      <span> • </span>
                      <span>Sit {schedule.sitMinutes}m / Stand {schedule.standMinutes}m</span>
                    </div>
                  </div>
                  <div className="schedule-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '100px' }}>
                      <label className="toggle-switch" title="Enable/Disable Schedule" style={{ marginRight: 0 }}>
                        <input
                          type="checkbox"
                          checked={schedule.enabled}
                          onChange={() => handleToggleEnabled(schedule)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                      <span style={{ fontSize: '0.8rem', color: schedule.enabled ? '#22c55e' : '#64748b', whiteSpace: 'nowrap' }}>
                        {schedule.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleEdit(schedule)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDelete(schedule.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showForm && (
        <ScheduleForm
          schedule={editingSchedule}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}

export default SchedulesPage;
