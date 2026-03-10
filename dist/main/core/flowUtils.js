"use strict";
/**
 * Flow-Based Schedule Utilities
 * Helper functions for flow-based schedule mode
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFlowBasedSchedule = isFlowBasedSchedule;
exports.getFlowStepDisplayName = getFlowStepDisplayName;
exports.getNextFlowStepIndex = getNextFlowStepIndex;
exports.getFlowStepAtOffset = getFlowStepAtOffset;
exports.getNextFlowPhase = getNextFlowPhase;
exports.getFlowStepDurationMs = getFlowStepDurationMs;
exports.isFlowStepWorkPhase = isFlowStepWorkPhase;
exports.createFlowStep = createFlowStep;
exports.getDefaultFlowSteps = getDefaultFlowSteps;
exports.validateFlowSteps = validateFlowSteps;
exports.moveFlowStepUp = moveFlowStepUp;
exports.moveFlowStepDown = moveFlowStepDown;
exports.removeFlowStep = removeFlowStep;
exports.addFlowStep = addFlowStep;
exports.formatFlowStepDuration = formatFlowStepDuration;
const uuid_1 = require("uuid");
/**
 * Check if a schedule is in flow-based mode
 */
function isFlowBasedSchedule(schedule) {
    return schedule?.mode === 'flow-based' && Array.isArray(schedule.flowSteps) && schedule.flowSteps.length > 0;
}
/**
 * Get display name for a flow step type
 */
function getFlowStepDisplayName(type) {
    switch (type) {
        case 'sit':
            return 'Sit';
        case 'stand':
            return 'Stand';
        case 'sit-to-stand-transition':
            return 'Sit → Stand Transition';
        case 'stand-to-sit-transition':
            return 'Stand → Sit Transition';
        case 'short-break':
            return 'Short Break';
        default:
            return type;
    }
}
/**
 * Get the next step index in a flow (wraps around)
 */
function getNextFlowStepIndex(currentIndex, flowSteps) {
    if (flowSteps.length === 0)
        return 0;
    return (currentIndex + 1) % flowSteps.length;
}
/**
 * Get the step N positions ahead in the flow (wraps around)
 */
function getFlowStepAtOffset(currentIndex, offset, flowSteps) {
    if (flowSteps.length === 0)
        return null;
    const targetIndex = (currentIndex + offset) % flowSteps.length;
    return flowSteps[targetIndex] ?? null;
}
/**
 * Get the phase type for the next step in flow
 */
function getNextFlowPhase(currentIndex, flowSteps) {
    const nextStep = getFlowStepAtOffset(currentIndex, 1, flowSteps);
    return nextStep?.type ?? 'idle';
}
/**
 * Get duration for a flow step in milliseconds
 */
function getFlowStepDurationMs(step) {
    return step.durationSeconds * 1000;
}
/**
 * Check if a flow step type counts as work time
 * Only sit and stand phases count toward cumulative work time
 */
function isFlowStepWorkPhase(type) {
    return type === 'sit' || type === 'stand';
}
/**
 * Create a new flow step with default duration
 */
function createFlowStep(type, durationSeconds) {
    const defaultDurations = {
        'sit': 12 * 60, // 12 minutes
        'stand': 12 * 60, // 12 minutes
        'sit-to-stand-transition': 30, // 30 seconds
        'stand-to-sit-transition': 30, // 30 seconds
        'short-break': 5 * 60, // 5 minutes
    };
    return {
        id: (0, uuid_1.v4)(),
        type,
        durationSeconds: durationSeconds ?? defaultDurations[type],
    };
}
/**
 * Default flow steps for a new flow-based schedule
 */
function getDefaultFlowSteps() {
    return [
        createFlowStep('sit', 12 * 60),
        createFlowStep('sit-to-stand-transition', 30),
        createFlowStep('stand', 12 * 60),
        createFlowStep('stand-to-sit-transition', 30),
        createFlowStep('short-break', 5 * 60),
    ];
}
/**
 * Validate flow steps
 * Returns array of validation errors (empty if valid)
 */
function validateFlowSteps(flowSteps) {
    const errors = [];
    if (!flowSteps || flowSteps.length === 0) {
        errors.push('Flow must have at least one step');
        return errors;
    }
    const hasWorkStep = flowSteps.some(step => isFlowStepWorkPhase(step.type));
    if (!hasWorkStep) {
        errors.push('Flow should include at least one work step (Sit or Stand)');
    }
    for (let i = 0; i < flowSteps.length; i++) {
        const step = flowSteps[i];
        if (step.durationSeconds <= 0) {
            errors.push(`Step ${i + 1} (${getFlowStepDisplayName(step.type)}) must have duration > 0`);
        }
    }
    return errors;
}
/**
 * Move a step up in the flow (swap with previous)
 */
function moveFlowStepUp(flowSteps, index) {
    if (index <= 0 || index >= flowSteps.length)
        return flowSteps;
    const newSteps = [...flowSteps];
    [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
    return newSteps;
}
/**
 * Move a step down in the flow (swap with next)
 */
function moveFlowStepDown(flowSteps, index) {
    if (index < 0 || index >= flowSteps.length - 1)
        return flowSteps;
    const newSteps = [...flowSteps];
    [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
    return newSteps;
}
/**
 * Remove a step from the flow
 */
function removeFlowStep(flowSteps, index) {
    if (index < 0 || index >= flowSteps.length)
        return flowSteps;
    return flowSteps.filter((_, i) => i !== index);
}
/**
 * Add a step to the end of the flow
 */
function addFlowStep(flowSteps, step) {
    return [...flowSteps, step];
}
/**
 * Format duration in seconds to human-readable string
 */
function formatFlowStepDuration(durationSeconds) {
    if (durationSeconds < 60) {
        return `${durationSeconds}s`;
    }
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    if (seconds === 0) {
        return `${minutes}m`;
    }
    return `${minutes}m ${seconds}s`;
}
//# sourceMappingURL=flowUtils.js.map