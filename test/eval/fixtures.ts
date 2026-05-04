/**
 * Eval fixtures — paths are optional outside the squad-kit dev workspace.
 * `realPlanPath` is used when present for before/after plan comparison in `run-eval.ts`.
 */
export interface EvalFixture {
  id: string;
  intakeMarkdown: string;
  knownGroundTruth: {
    expectedFiles: string[];
    expectedSymbols: string[];
    rubric: string;
  };
  category: 'bug' | 'feature' | 'refactor' | 'migration';
  realPlanPath?: string;
}

export const evalFixtures: EvalFixture[] = [
  {
    id: 'bug-jira-search-410',
    intakeMarkdown: '# Jira search 410\n\nTracker search should use modern Jira API.\n',
    knownGroundTruth: {
      expectedFiles: ['project/src/console/api/tracker-jira.ts', 'project/console-ui/src/pages/TrackerPage.tsx'],
      expectedSymbols: ['search', 'jql'],
      rubric: 'Plan should cite Jira client/search paths and mention HTTP 410 or /search/jql migration.',
    },
    category: 'bug',
    realPlanPath: '.squad/plans/bugs/03-story-jira-search-410-4.md',
  },
  {
    id: 'enhancement-rate-limit',
    intakeMarkdown: '# Rate limit\n\nAdd resilient handling for planner rate limits.\n',
    knownGroundTruth: {
      expectedFiles: ['project/src/planner/loop.ts'],
      expectedSymbols: ['rate_limit', 'runPlanner'],
      rubric: 'Plan should reference planner loop and rate-limit behaviour.',
    },
    category: 'feature',
    realPlanPath: '.squad/plans/enhancements/02-story-rate-limit-handler-5.md',
  },
  {
    id: 'console-settings-refactor',
    intakeMarkdown: '# Console settings\n\nImprove settings / tracker configuration UX.\n',
    knownGroundTruth: {
      expectedFiles: ['project/console-ui/src/pages'],
      expectedSymbols: ['config'],
      rubric: 'Plan should touch console UI or API for settings.',
    },
    category: 'refactor',
    realPlanPath: '.squad/plans/console-settings/01-story-tracker-intake.md',
  },
];
