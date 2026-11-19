import { describe, expect, it } from 'vitest';
import { loginDestination } from '../src/lib/login-entry';

const entry = { next: '/tasks/t1?a=b', signedIn: false, oidc: true, authError: null, manualAdmin: false };
describe('login entry', () => {
  it('starts OIDC without a click and carries the local return path', () => {
    expect(loginDestination(entry)).toBe('/auth/login?next=%2Ftasks%2Ft1%3Fa%3Db');
    expect(loginDestination({ ...entry, next: '//elsewhere.test' })).toBe('/auth/login?next=%2Fdashboard');
  });
  it('resumes an existing login without a new OIDC transaction', () => {
    expect(loginDestination({ ...entry, signedIn: true })).toBe(entry.next);
  });
  it('stays on the form for provider errors, manual recovery and missing OIDC', () => {
    for (const override of [{ authError: 'LOGIN_START_FAILED' }, { manualAdmin: true }, { oidc: false }]) {
      expect(loginDestination({ ...entry, ...override })).toBeNull();
    }
  });
});
