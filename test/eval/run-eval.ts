#!/usr/bin/env tsx
/**
 * Gated live eval: set SQUAD_INTEGRATION_TEST=1 and a provider API key.
 * Compares new planner output to fixtures / rubrics. Produces reports under test/eval/reports/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalFixtures } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  if (process.env.SQUAD_INTEGRATION_TEST !== '1') {
    console.error('Skip: set SQUAD_INTEGRATION_TEST=1 to run live planner eval (costs API credits).');
    return;
  }
  const workspaceRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), '..'));
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY || process.env.SQUAD_PLANNER_API_KEY);
  const hasOpenai = Boolean(process.env.OPENAI_API_KEY);
  const hasGoogle = Boolean(process.env.GOOGLE_API_KEY);
  if (!hasAnthropic && !hasOpenai && !hasGoogle) {
    console.error('Skip: no ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY set.');
    return;
  }

  console.log('Live eval is a stub in this release — fixtures loaded:', evalFixtures.map((f) => f.id).join(', '));
  console.log('Point-in-time: implement full runPlanner pipeline probe here; workspace:', workspaceRoot);

  const reportDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(reportDir, `${ts}-eval-skipped.json`),
    JSON.stringify({ note: 'stub', workspaceRoot, fixtureIds: evalFixtures.map((f) => f.id) }, null, 2) + '\n',
    'utf8',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
