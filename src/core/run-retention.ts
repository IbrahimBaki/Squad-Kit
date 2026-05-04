/** Max planner run summaries (and paired event logs) retained under `.squad/runs/`. */
export const RUN_HISTORY_RING_SIZE = 20;

/** Within the retention ring, this many newest run event logs stay as raw `.events.jsonl`. */
export const RUN_EVENT_JSONL_UNCOMPRESSED_HEAD = 5;
