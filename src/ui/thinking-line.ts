import kleur from 'kleur';

/**
 * Returns:  thinking… 12s · 1240 chars   (running)
 *           thought 18s · 2480 chars      (stopped)
 * Color: violet stand-in via magenta.
 */
export function formatThinkingLine(opts: { running: boolean; durationMs: number; chars: number }): string {
  const sec = Math.max(0, Math.round(opts.durationMs / 1000));
  const head = opts.running ? 'thinking…' : 'thought';
  const body = `${sec}s · ${opts.chars} chars`;
  return kleur.magenta(`${head} ${body}`);
}
