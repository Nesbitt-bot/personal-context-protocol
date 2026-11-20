import { describe, it, expect } from 'vitest';
import { sortTasks, progressLabel, type TaskItem } from '../src/lib/task-types';

function task(partial: Partial<TaskItem> & { id: string }): TaskItem {
  return {
    parent_id: null,
    topic_id: null,
    topic_title: null,
    title: partial.id,
    description: null,
    completed: false,
    completed_at: null,
    priority: 0,
    expected_turns: null,
    due_at: null,
    position: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    last_activity_at: null,
    project: null,
    project_ids: [],
    subtask_count: 0,
    session_count: 0,
    current_turns: 0,
    progress: null,
    ...partial,
  };
}

describe('sortTasks', () => {
  it('sorts by name ascending by default', () => {
    const list = [task({ id: 'b' }), task({ id: 'a' }), task({ id: 'c' })];
    expect(sortTasks(list, 'name').map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts times newest first by default', () => {
    const list = [
      task({ id: 'old', updated_at: '2026-01-01T00:00:00Z' }),
      task({ id: 'new', updated_at: '2026-02-01T00:00:00Z' }),
    ];
    expect(sortTasks(list, 'updated').map((t) => t.id)).toEqual(['new', 'old']);
  });

  it('sinks unassigned categories and null progress to the end ascending', () => {
    const byCategory = [
      task({ id: 'unassigned', topic_title: null }),
      task({ id: 'assigned', topic_title: 'alpha' }),
    ];
    expect(sortTasks(byCategory, 'category').map((t) => t.id)).toEqual(['assigned', 'unassigned']);

    const byProgress = [
      task({ id: 'progress-null', expected_turns: 5, progress: null }),
      task({ id: 'progress-1', expected_turns: 2, progress: 0.5 }),
    ];
    expect(sortTasks(byProgress, 'progress').map((t) => t.id)).toEqual(['progress-1', 'progress-null']);
  });

  it('honors an explicit reverse direction', () => {
    const list = [task({ id: 'a' }), task({ id: 'b' })];
    expect(sortTasks(list, 'name', 'desc').map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('sinks unset priority (null) to the end ascending', () => {
    const list = [
      task({ id: 'unset', priority: null }),
      task({ id: 'p0', priority: 0 }),
      task({ id: 'p3', priority: 3 }),
    ];
    expect(sortTasks(list, 'priority').map((t) => t.id)).toEqual(['p0', 'p3', 'unset']);
  });
});

describe('progressLabel', () => {
  it('returns an empty string without a target', () => {
    expect(progressLabel({ expected_turns: null, progress: null })).toBe('');
  });
  it('returns a rounded percentage', () => {
    expect(progressLabel({ expected_turns: 4, progress: 0.75 })).toBe('75%');
  });
});
