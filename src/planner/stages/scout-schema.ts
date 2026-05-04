import { z } from 'zod';

export const ScoutOutputSchema = z.object({
  selectedFiles: z.array(z.string()).min(1).max(25),
  reasoning: z.string().min(1),
  suggestedReadStrategy: z.enum(['read_full', 'read_ranges', 'mixed']),
  readRanges: z
    .array(
      z.object({
        path: z.string(),
        offset: z.number().int().min(1),
        limit: z.number().int().min(1).max(400),
      }),
    )
    .optional(),
});

export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
