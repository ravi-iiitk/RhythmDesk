/**
 * RhythmDesk Schedules Page
 * List and manage schedules
 */

import React, { useEffect, useState } from 'react';
import { Schedule } from '../../shared/types';
import { DAY_SHORT_LABELS } from '../../shared/constants';
import ScheduleForm from '../components/ScheduleForm';

function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadSchedules();
  }, []);

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
    await window.rhythmDesk.saveSchedule(schedule);
    setShowForm(false);
    setEditingSchedule(null);
    loadSchedules();
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
                  <div className="schedule-actions">
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={schedule.enabled}
                        onChange={() => handleToggleEnabled(schedule)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
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
