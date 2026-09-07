import { Store, newJob, type Job } from "./store.js";
import { pages, SourceError } from "./connectors.js";
export class Imports {
  controllers = new Map<string, AbortController>();
  constructor(private store: Store) {}
  start(sourceIds: string[], mode: string) {
    if (this.controllers.size) throw new Error("JOB_CONFLICT");
    const config = this.store.config();
    if (sourceIds.some((id) => !config.sources.some((s) => s.id === id)))
      throw new Error("Unknown source");
    const job = newJob(config, sourceIds, mode);
    this.store.saveJob(job);
    this.launch(job);
    return job;
  }
  resume(id: string) {
    const j = this.store.job(id);
    if (!j) throw new Error("NOT_FOUND");
    if (this.controllers.size || ["running", "complete"].includes(j.status))
      throw new Error("JOB_CONFLICT");
    j.status = "queued";
    this.store.saveJob(j);
    this.launch(j);
    return j;
  }
  cancel(id: string) {
    const c = this.controllers.get(id);
    if (!c) throw new Error("NOT_FOUND");
    c.abort();
    return { status: "cancel_requested" };
  }
  private launch(job: Job) {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    setImmediate(() => void this.run(job, controller));
  }
  private async run(job: Job, controller: AbortController) {
    job.status = "running";
    this.store.saveJob(job);
    try {
      for (const id of job.sourceIds) {
        const source = job.config.sources.find((s) => s.id === id)!;
        const previous = this.store
          .jobs()
          .find(
            (j) =>
              j.id !== job.id &&
              j.status === "complete" &&
              j.sourceIds.includes(id) &&
              j.finished,
          );
        const since =
          job.mode === "incremental" && previous?.finished
            ? new Date(
                Date.parse(previous.finished) - 7 * 86400000,
              ).toISOString()
            : undefined;
        for await (const page of pages(
          source,
          job.cursor[id] ?? 0,
          controller.signal,
          since,
        )) {
          if (controller.signal.aborted)
            throw new SourceError("CANCELED", "Canceled");
          job.pages++;
          job.entities += page.records.length;
          job.cursor[id] = page.next;
          this.store.upsert(page.records, job);
          await new Promise((r) => setImmediate(r));
        }
      }
      job.status = "complete";
    } catch (e) {
      job.status = controller.signal.aborted ? "canceled" : "partial";
      job.errors.push(
        e instanceof SourceError
          ? e.message
          : "Import failed: response schema or configuration is incompatible",
      );
    } finally {
      job.finished = new Date().toISOString();
      this.store.saveJob(job);
      this.controllers.delete(job.id);
    }
  }
}
