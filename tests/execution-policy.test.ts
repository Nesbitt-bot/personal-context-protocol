import { describe, it, expect } from 'vitest';
import { executionPolicySchema, executionRule } from '../src/lib/execution-policy';

describe('AstrBot execution policy', () => {
  const policy = executionPolicySchema.parse({ owner: { agent: 'astrbot-exec', tools: ['exec'] }, groups: [
    { platform: 'qq', group_id: '123', senders: ['456'], agent: 'astrbot-exec-group', tools: ['exec'] },
  ] });
  it('owner DMs execute; unlinked DMs and unlisted groups do not', () => {
    expect(executionRule({ platform: 'qq', chat: 'private', sender_id: '1' }, true, policy)?.agent).toBe('astrbot-exec');
    expect(executionRule({ platform: 'qq', chat: 'private', sender_id: '1' }, false, policy)).toBeNull();
    expect(executionRule({ platform: 'qq', chat: 'group', group_id: 'other', sender_id: '1' }, true, policy)).toBeNull();
  });
  it('group membership requires exact platform, group and sender matches', () => {
    expect(executionRule({ platform: 'qq', chat: 'group', group_id: '123', sender_id: '456' }, false, policy)?.agent).toBe('astrbot-exec-group');
    expect(executionRule({ platform: 'qq', chat: 'group', group_id: '123', sender_id: '999' }, true, policy)).toBeNull();
    expect(executionRule({ platform: 'discord', chat: 'group', group_id: '123', sender_id: '456' }, false, policy)).toBeNull();
  });
  it('rejects shared private/group agents and arbitrary tool permissions', () => {
    expect(executionPolicySchema.safeParse({ ...policy, groups: [{ ...policy.groups[0], agent: 'astrbot-exec' }] }).success).toBe(false);
    expect(executionPolicySchema.safeParse({ owner: { agent: 'main', tools: ['gateway'] } }).success).toBe(false);
  });
});
