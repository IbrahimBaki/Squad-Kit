/** Skip live HTTP probes in test/CI so `config set` stays offline-safe. */
export function skipExternalProbesInAutomation(): boolean {
  const c = process.env.CI;
  if (c === 'true' || c === '1') return true;
  if (process.env.GITHUB_ACTIONS) return true;
  return false;
}
