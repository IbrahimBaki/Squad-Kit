import type { z } from 'zod';

/**
 * Runtime-neutral tool definition shared by Vercel and Agent SDK runtimes.
 */
export interface PlannerToolDefinition<TParams extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>) => Promise<string | { content: string; isError: boolean }>;
}
