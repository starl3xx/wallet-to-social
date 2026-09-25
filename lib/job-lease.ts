/**
 * A write after a job's claim matched no row: another invocation holds the
 * job now, or it finished. The holder that sees this stops and writes nothing
 * more, including no 'failed' over a job someone else completed.
 *
 * In its own module because two files raise it: the worker's fenced writes
 * (`lib/job-processor.ts`) and the fenced history save (`lib/history.ts`),
 * which the worker imports. Either importing the other would be a cycle.
 */
export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lost the lease on job ${jobId}; another invocation holds it`);
    this.name = 'LeaseLostError';
  }
}
