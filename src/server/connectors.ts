import { readFileSync } from "node:fs";
import { Agent, fetch as httpFetch } from "undici";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import {
  recordSchema,
  type Source,
  type RecordData,
  type Issue,
  type PR,
} from "../shared/contracts.js";
export class SourceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function certificate(source: Source) {
  if (!source.caBundleRef) return undefined;
  const path = process.env[source.caBundleRef];
  if (!path)
    throw new SourceError("CA", "Corporate CA environment variable is not set");
  try {
    return readFileSync(path);
  } catch {
    throw new SourceError("CA", "Corporate CA file cannot be read");
  }
}
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new SourceError("CANCELED", "Canceled"));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(t);
      reject(new SourceError("CANCELED", "Canceled"));
    }
    signal.addEventListener("abort", stop, { once: true });
  });
export async function request(
  source: Source,
  url: string,
  signal: AbortSignal,
): Promise<any> {
  const target = new URL(url),
    base = new URL(source.baseUrl);
  if (target.origin !== base.origin)
    throw new SourceError("ORIGIN", "Off-origin request blocked");
  const token = source.credentialRef
    ? process.env[source.credentialRef]
    : undefined;
  if (source.credentialRef && !token)
    throw new SourceError(
      "CREDENTIAL",
      "Credential environment variable is not set",
    );
  const ca = certificate(source);
  const agent = new Agent({
    connect: ca ? { ca } : undefined,
  });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await httpFetch(target, {
          dispatcher: agent,
          redirect: "manual",
          signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
      } catch {
        throw new SourceError(
          "NETWORK",
          "Connection failed; check URL, certificate trust, and network access",
        );
      }
      if ([401, 403].includes(res.status)) {
        await res.body?.cancel();
        throw new SourceError(
          "PERMISSION",
          "Source denied access; check credentials and permissions",
        );
      }
      if (res.status === 429 || res.status >= 500) {
        const retry = res.headers.get("retry-after");
        await res.body?.cancel();
        if (attempt === 2)
          throw new SourceError("RETRY", "Source retry budget exhausted");
        const seconds = retry
          ? /^\d+$/.test(retry)
            ? Number(retry)
            : Math.max(0, (Date.parse(retry) - Date.now()) / 1000)
          : NaN;
        await pause(
          Math.min(
            30000,
            Number.isFinite(seconds) ? seconds * 1000 : 1000 * 2 ** attempt,
          ),
          signal,
        );
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new SourceError(
          `HTTP_${res.status}`,
          `Source returned HTTP ${res.status}`,
        );
      }
      return await res.json();
    }
    throw new SourceError("RETRY", "Source unavailable");
  } finally {
    await agent.close();
  }
}
function endpoint(s: Source, path: string) {
  return s.baseUrl.replace(/\/$/, "") + path;
}
async function mcp(source: Source, signal?: AbortSignal) {
  const ca = certificate(source);
  const agent = new Agent({ connect: ca ? { ca } : undefined });
  const client = new Client({ name: "ai-productivity", version: "0.1.0" });
  const originalClose = client.close.bind(client);
  client.close = async () => {
    try {
      await originalClose();
    } finally {
      await agent.close();
    }
  };
  try {
    if (source.transport === "stdio") {
      await client.connect(
        new StdioClientTransport({
          command: source.command!,
          args: source.args,
          env: Object.fromEntries(
            ["PATH", "HOME", source.credentialRef, source.caBundleRef]
              .filter((k): k is string => !!k)
              .filter((k) => process.env[k])
              .map((k) => [k, process.env[k]!]),
          ),
          stderr: "pipe",
        }),
        { timeout: 20000, signal },
      );
    } else {
      const token = source.credentialRef
        ? process.env[source.credentialRef]
        : undefined;
      if (source.credentialRef && !token)
        throw new SourceError(
          "CREDENTIAL",
          "Credential environment variable is not set",
        );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(source.mcpUrl!), {
          fetch: async (input, init) => {
            const url = new URL(typeof input === "string" ? input : input.href);
            if (url.origin !== new URL(source.mcpUrl!).origin)
              throw new SourceError("ORIGIN", "Off-origin MCP request blocked");
            return (await httpFetch(url, {
              ...(init as Parameters<typeof httpFetch>[1]),
              dispatcher: agent,
              redirect: "error",
            })) as unknown as Response;
          },
          requestInit: {
            redirect: "error",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        }),
        { timeout: 20000, signal },
      );
    }
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}
// Splits snake_case and camelCase tool names into lowercase word tokens so
// classification works for both jira_get_issue and bitbucket_getPullRequests.
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}
// Verbs whose presence marks a tool as mutating. Matched by stem (startsWith)
// so plurals/inflections like "comments"/"created" are caught; this is
// intentionally safe-biased since a false positive only demotes to do-not-import.
const MUTATION_VERBS = [
  "create", "update", "delete", "remove", "add", "set", "edit", "assign",
  "transition", "link", "unlink", "move", "archive", "restore", "download",
  "post", "put", "patch", "merge", "decline", "approve", "submit", "vote",
  "comment", "worklog",
];
function isMutation(name: string): boolean {
  return words(name).some((w) => MUTATION_VERBS.some((v) => w.startsWith(v)));
}
function isEntity(name: string, kind: Source["kind"]): boolean {
  const jira = /^(issues?|jql|search|changelogs?)$/;
  const bb = /^(pull|pullrequests?|prs?|commits?|activit(y|ies)|diffs?)$/;
  return words(name).some((w) => (kind === "jira" ? jira : bb).test(w));
}
// Best-effort hint only: a tool is recommended when it is read-only and concerns
// the operation entity. Mutations and unrelated reads are marked do-not-import.
// The caller must still verify read-only behavior and normalized-page output.
function importGuidance(names: string[], kind: Source["kind"]): string[] {
  return names
    .map((name) => ({
      name,
      recommended: !isMutation(name) && isEntity(name, kind),
    }))
    .sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        a.name.localeCompare(b.name),
    )
    .map((t) => `${t.recommended ? "[+]" : "[-]"} ${t.name}`);
}
// Ranks read-only tools to pick a single default mapping target for the
// operation. Returns null when nothing looks like a suitable reader.
function recommendedTool(names: string[], kind: Source["kind"]): string | null {
  const score = (name: string): number => {
    if (isMutation(name)) return -1;
    const w = words(name);
    const has = (x: string) => w.includes(x);
    if (kind === "jira") {
      if (has("search") && !has("fields")) return 100;
      if (
        (has("project") || has("board") || has("sprint")) &&
        (has("issue") || has("issues"))
      )
        return 80;
      if (has("issue") || has("issues")) return 30;
      if (has("changelog") || has("changelogs")) return 20;
      return -1;
    }
    const pr =
      has("pull") || has("pullrequest") || has("pullrequests") || has("pr") || has("prs");
    if (has("search")) return 100;
    if (
      pr &&
      (has("requests") || has("pullrequests") || has("prs")) &&
      !has("dashboard") &&
      !has("inbox") &&
      !has("changes") &&
      !has("diff")
    )
      return 90;
    if (pr && (has("get") || has("list"))) return 80;
    if (pr) return 60;
    if (has("commit") || has("commits") || has("activity") || has("diff"))
      return 20;
    return -1;
  };
  let best: string | null = null;
  let bestScore = 0;
  for (const name of names) {
    const s = score(name);
    if (s > bestScore) {
      bestScore = s;
      best = name;
    }
  }
  return best;
}
// Fetches all pages of a Bitbucket list tool (start/limit + isLastPage paging).
async function bitbucketPages(
  call: (name: string, args: Record<string, unknown>) => Promise<any>,
  name: string,
  args: Record<string, unknown>,
): Promise<any[]> {
  const out: any[] = [];
  let start = 0;
  for (let i = 0; i < 100; i++) {
    const o = await call(name, { ...args, start, limit: 100 });
    const d = o?.data ?? o ?? {};
    const values = Array.isArray(d.values) ? d.values : [];
    out.push(...values);
    if (d.isLastPage !== false || !values.length) break;
    start = typeof d.nextPageStart === "number" ? d.nextPageStart : start + values.length;
  }
  return out;
}
// Lists project keys or repository slugs from a connection's MCP server so the
// UI can offer them as suggestions. Read-only; opens and closes its own client.
export async function browseCatalog(
  s: Source,
  type: "projects" | "repositories",
  signal: AbortSignal,
  projectKeys?: string[],
): Promise<string[]> {
  if (s.transport === "rest")
    throw new SourceError("MCP", "Catalog browsing requires an MCP transport");
  const client = await mcp(s, signal);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name, arguments: args }, undefined, {
      signal,
      timeout: 20000,
    });
    if (res.isError) {
      const msg = (res.content ?? []).map((c: any) => c.text).join(" ");
      throw new SourceError("MCP", `Tool ${name} failed: ${msg}`.slice(0, 300));
    }
    const text = (res.content ?? []).find(
      (c: any) => typeof c.text === "string",
    )?.text;
    return text ? JSON.parse(text) : res.structuredContent;
  };
  const uniq = (a: string[]) =>
    Array.from(new Set(a.filter(Boolean))).sort((x, y) => x.localeCompare(y));
  try {
    if (s.kind === "jira") {
      if (type === "repositories") return [];
      const arr = await call("jira_get_all_projects", {});
      return uniq((Array.isArray(arr) ? arr : []).map((p: any) => String(p.key ?? "")));
    }
    if (type === "projects") {
      const values = await bitbucketPages(call, "bitbucket_getProjects", {});
      return uniq(values.map((v: any) => String(v.key ?? "")));
    }
    const keys = (projectKeys?.length ? projectKeys : s.projects).filter(
      (k) => k && k !== "PROJECT",
    );
    const repos: string[] = [];
    for (const key of keys) {
      try {
        const values = await bitbucketPages(call, "bitbucket_getRepositories", {
          projectKey: key,
        });
        for (const v of values) if (v?.slug) repos.push(`${key}/${v.slug}`);
      } catch {
        // Skip project keys that don't exist or aren't accessible.
      }
    }
    return uniq(repos);
  } finally {
    await client.close();
  }
}
export async function testConnection(s: Source, signal: AbortSignal) {
  if (s.transport !== "rest") {
    let client: Client | undefined;
    try {
      client = await mcp(s, signal);
      const available = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(
          { cursor },
          { signal, timeout: 20000 },
        );
        available.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      const operation = s.kind === "jira" ? "issues" : "pullRequests";
      const mapping = s.mappings[operation];
      return {
        status:
          mapping && available.some((t) => t.name === mapping.tool)
            ? "ready"
            : "configuration_required",
        version: client.getServerVersion()?.version ?? "Unknown",
        tools: available.map((t) => ({
          name: t.name,
          inputSchema: t.inputSchema,
        })),
        guidance: importGuidance(
          available.map((t) => t.name),
          s.kind,
        ),
        recommendedTool: recommendedTool(
          available.map((t) => t.name),
          s.kind,
        ),
        gaps: !mapping
          ? [
              "Map the read-only " +
                operation +
                " operation to a tool returning normalized pages",
            ]
          : available.some((t) => t.name === mapping.tool)
            ? []
            : ["Mapped tool is unavailable"],
        note: "Tool discovery verifies connectivity. Run a bounded import to verify response schema and complete history.",
      };
    } catch (e) {
      throw e instanceof SourceError
        ? e
        : new SourceError(
            "MCP",
            "MCP connection failed; verify transport, command, environment and server configuration",
          );
    } finally {
      await client?.close();
    }
  }
  const version = await request(
    s,
    endpoint(
      s,
      s.kind === "jira"
        ? "/rest/api/2/serverInfo"
        : "/rest/api/1.0/application-properties",
    ),
    signal,
  );
  return {
    status: "connected",
    version: String(version.version ?? "Unknown"),
    tools: [],
    gaps: [],
    note: "REST connection verified. Historical compatibility is verified during import.",
  };
}
const normalizedPage = z.object({
  records: z.array(recordSchema),
  nextCursor: z.number().int().nonnegative().nullable(),
  complete: z.boolean(),
});
export async function* pages(
  s: Source,
  start: number,
  signal: AbortSignal,
  since?: string,
): AsyncGenerator<{ records: RecordData[]; next: number; complete: boolean }> {
  const op = s.kind === "jira" ? "issues" : "pullRequests";
  if (s.transport !== "rest" && s.mappings[op]) {
    const client = await mcp(s, signal);
    try {
      let cursor = start;
      const seen = new Set<number>();
      while (true) {
        if (signal.aborted) throw new SourceError("CANCELED", "Canceled");
        if (seen.has(cursor))
          throw new SourceError(
            "PAGINATION",
            "MCP pagination repeated a cursor",
          );
        seen.add(cursor);
        const mapping = s.mappings[op]!;
        const response = await client.callTool(
          {
            name: mapping.tool,
            arguments: {
              ...mapping.arguments,
              cursor,
              projects: s.projects,
              repositories: s.repositories,
              ...(since ? { updatedSince: since } : {}),
            },
          },
          undefined,
          { signal, timeout: 20000 },
        );
        if (response.isError)
          throw new SourceError("MCP_TOOL", "Mapped read tool failed");
        const data =
          response.structuredContent ??
          JSON.parse(
            (response.content as { type: string; text?: string }[])
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join(""),
          );
        const page = normalizedPage.parse(data);
        if (
          page.records.some(
            (r) =>
              r.sourceId !== s.id ||
              r.kind !== (s.kind === "jira" ? "issue" : "pr"),
          )
        )
          throw new SourceError(
            "SCHEMA",
            "MCP records must match configured source and kind",
          );
        yield {
          records: page.records,
          next: page.nextCursor ?? cursor,
          complete: page.complete,
        };
        if (page.nextCursor === null) {
          if (!page.complete)
            throw new SourceError(
              "PARTIAL",
              "MCP source returned incomplete history",
            );
          break;
        }
        cursor = page.nextCursor;
      }
    } finally {
      await client.close();
    }
    return;
  }
  if (s.transport !== "rest" && !s.restFallback)
    throw new SourceError(
      "MAPPING",
      "Configure a read mapping or enable REST fallback",
    );
  if (s.kind === "jira") {
    if (!s.projects.length)
      throw new SourceError("SCOPE", "Select Jira project keys");
    let cursor = start;
    while (true) {
      const jql =
        "project in (" +
        s.projects
          .map(
            (p) =>
              '"' + p.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"',
          )
          .join(",") +
        ")" +
        (since ? ' AND updated >= "' + since.slice(0, 10) + '"' : "") +
        " ORDER BY key";
      const page = await request(
        s,
        endpoint(
          s,
          "/rest/api/2/search?" +
            new URLSearchParams({
              jql,
              startAt: String(cursor),
              maxResults: "50",
              expand: "changelog",
              fields: `summary,status,created,issuetype,priority,project,parent,labels,issuelinks,${s.epicField}${s.deliveryField ? "," + s.deliveryField : ""}`,
            }),
        ),
        signal,
      );
      if (!Array.isArray(page.issues) || !Number.isInteger(page.total))
        throw new SourceError("SCHEMA", "Unexpected Jira search response");
      const items: RecordData[] = [];
      for (const item of page.issues) {
        const f = item.fields,
          h = item.changelog;
        let histories = h?.histories ?? [];
        let historyComplete = !!h && h.total === histories.length;
        if (h && h.total > histories.length) {
          try {
            const full: any[] = [];
            let at = 0;
            while (true) {
              const details = await request(
                s,
                endpoint(
                  s,
                  "/rest/api/2/issue/" +
                    encodeURIComponent(item.key) +
                    "/changelog?startAt=" +
                    at +
                    "&maxResults=100",
                ),
                signal,
              );
              const values = details.values ?? details.histories;
              if (!Array.isArray(values))
                throw new SourceError("SCHEMA", "Unexpected changelog page");
              full.push(...values);
              if (details.isLast === true || full.length >= details.total)
                break;
              if (!values.length)
                throw new SourceError(
                  "PAGINATION",
                  "Changelog pagination stalled",
                );
              at += values.length;
            }
            histories = full;
            historyComplete = full.length >= h.total;
          } catch (error) {
            if (
              !(error instanceof SourceError) ||
              !["HTTP_404", "HTTP_405"].includes(error.code)
            )
              throw error;
          }
        }
        const events = histories.flatMap((event: any) =>
          (event.items ?? [])
            .filter((v: any) => v.field === "status")
            .map((v: any, index: number) => ({
              id: String(event.id) + "-" + index,
              at: new Date(event.created).toISOString(),
              from: String(v.fromString ?? ""),
              to: String(v.toString ?? ""),
            })),
        );
        items.push(
          recordSchema.parse({
            kind: "issue",
            sourceId: s.id,
            id: String(item.id),
            key: item.key,
            title: f.summary,
            project: f.project.key,
            type: f.issuetype.name,
            priority: f.priority?.name ?? "Unknown",
            status: f.status.name,
            created: new Date(f.created).toISOString(),
            history: events,
            historyComplete,
            coverageThrough: new Date().toISOString(),
            url: endpoint(s, "/browse/" + encodeURIComponent(item.key)),
            epic:
              typeof f[s.epicField] === "string"
                ? f[s.epicField]
                : f.parent?.fields?.issuetype?.name === "Epic"
                  ? f.parent.key
                  : undefined,
            labels: f.labels ?? [],
            defectOf: (f.issuelinks ?? [])
              .filter((link: any) =>
                (s.defectLinkTypes ?? []).includes(link.type?.name),
              )
              .map(
                (link: any) =>
                  link[(s.defectLinkDirection ?? "outward") + "Issue"]?.key,
              )
              .filter(Boolean),
            delivered:
              s.deliveryField && f[s.deliveryField]
                ? new Date(f[s.deliveryField]).toISOString()
                : undefined,
            synthetic: false,
          }),
        );
      }
      const next = cursor + page.issues.length;
      yield { records: items, next, complete: next >= page.total };
      if (next >= page.total) break;
      if (next <= cursor)
        throw new SourceError("PAGINATION", "Jira pagination stalled");
      cursor = next;
    }
  } else {
    if (!s.repositories.length)
      throw new SourceError(
        "SCOPE",
        "Select Bitbucket PROJECT/repository entries",
      );
    let pageIndex = 0;
    for (const repository of s.repositories) {
      const [project, slug] = repository.split("/");
      if (!project || !slug)
        throw new SourceError("SCOPE", "Use PROJECT/repository format");
      let cursor = 0;
      const base = `/rest/api/1.0/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(slug)}`;
      while (true) {
        const page = await request(
          s,
          endpoint(
            s,
            base + `/pull-requests?state=ALL&limit=50&start=${cursor}`,
          ),
          signal,
        );
        if (!Array.isArray(page.values))
          throw new SourceError("SCHEMA", "Unexpected Bitbucket response");
        const items: RecordData[] = [];
        for (const pr of page.values) {
          let at = 0,
            activities: any[] = [];
          while (true) {
            const events = await request(
              s,
              endpoint(
                s,
                base +
                  `/pull-requests/${pr.id}/activities?limit=100&start=${at}`,
              ),
              signal,
            );
            activities.push(...events.values);
            if (events.isLastPage) break;
            if (
              !Number.isInteger(events.nextPageStart) ||
              events.nextPageStart <= at
            )
              throw new SourceError(
                "PAGINATION",
                "Activity pagination stalled",
              );
            at = events.nextPageStart;
          }
          const merged = activities.find((e) => e.action === "MERGED");
          const reviews = activities
            .filter((e) =>
              ["COMMENTED", "APPROVED", "REVIEWED", "UNAPPROVED"].includes(
                e.action,
              ),
            )
            .map((e) => ({
              id: String(e.id),
              at: new Date(e.createdDate).toISOString(),
              actor: String(e.user?.slug ?? e.user?.name ?? "unknown"),
              type: e.action === "APPROVED" ? "approval" : "comment",
              aiVerified: false,
            }));
          items.push(
            recordSchema.parse({
              kind: "pr",
              sourceId: s.id,
              id: String(pr.id),
              title: pr.title,
              repository,
              author: String(pr.author?.user?.slug ?? "unknown"),
              created: new Date(pr.createdDate).toISOString(),
              merged: merged
                ? new Date(merged.createdDate).toISOString()
                : undefined,
              state: pr.state,
              url: endpoint(
                s,
                `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(slug)}/pull-requests/${pr.id}`,
              ),
              issueKeys: [
                ...new Set(
                  (pr.title + " " + (pr.fromRef?.displayId ?? "")).match(
                    /\b[A-Z][A-Z0-9]+-\d+\b/g,
                  ) ?? [],
                ),
              ],
              reviews,
              historyComplete: pr.state !== "MERGED" || !!merged,
              coverageThrough: new Date().toISOString(),
              synthetic: false,
            }),
          );
        }
        pageIndex++;
        if (pageIndex > start)
          yield {
            records: items,
            next: pageIndex,
            complete: page.isLastPage && repository === s.repositories.at(-1),
          };
        if (page.isLastPage) break;
        if (
          !Number.isInteger(page.nextPageStart) ||
          page.nextPageStart <= cursor
        )
          throw new SourceError("PAGINATION", "PR pagination stalled");
        cursor = page.nextPageStart;
      }
    }
  }
}
