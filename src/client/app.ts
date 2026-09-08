import {
  type Config,
  type Source,
  type Report,
  type AnalysisInput,
} from "../shared/contracts";
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const input = (id: string) => $<HTMLInputElement>("#" + id),
  value = (id: string) => input(id).value;
const split = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let csrf = "",
  config: Config,
  report: Report | undefined;
let recommendedTool: string | null = null;
function notice(text: string, error = false) {
  $("#notice").textContent = text;
  $("#notice").classList.toggle("ap-error", error);
  flash($("#notice"));
}
// Restarts the highlight animation so repeated clicks are visible.
function flash(el: HTMLElement) {
  el.classList.remove("ap-flash");
  void el.offsetWidth;
  el.classList.add("ap-flash");
}
function fillList(id: string, values: Iterable<string>) {
  $("#" + id).innerHTML = Array.from(values)
    .map((v) => `<option value="${esc(v)}"></option>`)
    .join("");
}
async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch("/api/v1" + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message ?? "Request failed");
  return data;
}
function safe(fn: () => Promise<void>) {
  return () => void fn().catch((e) => notice(e.message, true));
}
function go(page: string) {
  ["analysis", "reports", "connections", "settings"].forEach(
    (p) => ($("#" + p).hidden = p !== page),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-page]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.page === page)),
    );
  $("#evidence").hidden = true;
}
async function refresh() {
  config = await api("/config");
  $("#sources").innerHTML = config.sources
    .map(
      (s) =>
        `<option value="${esc(s.id)}" selected>${esc(s.name)} (${s.kind})</option>`,
    )
    .join("");
  $("#adoption").innerHTML = config.reporting.adoptionEvents
    .map((e) => `<option>${esc(e.name)}</option>`)
    .join("");
  input("settings-json").value = JSON.stringify(config.reporting, null, 2);
  $("#connection-list").innerHTML = config.sources
    .map(
      (s) =>
        `<div class="ap-panel"><button data-edit="${esc(s.id)}">${esc(s.name)}</button> <span class="ap-small">${s.kind} · ${s.transport}</span></div>`,
    )
    .join("");
  document
    .querySelectorAll<HTMLButtonElement>("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          edit(config.sources.find((s) => s.id === b.dataset.edit)!)),
    );
  const data = await api("/data");
  $("#data-label").textContent = data.synthetic
    ? "SYNTHETIC DATA · Local example"
    : "Local · " + data.count + " imported records";
  $("#demo").hidden = data.count > 0;
  await jobs();
  await reports();
}
function edit(s?: Source) {
  input("source-id").value = s?.id ?? "";
  input("source-name").value = s?.name ?? "";
  input("source-kind").value = s?.kind ?? "jira";
  input("source-url").value = s?.baseUrl ?? "";
  input("transport").value = s?.transport ?? "http";
  input("credential").value = s?.credentialRef ?? "";
  input("mcp-url").value = s?.mcpUrl ?? "";
  input("command").value = s?.command ?? "";
  input("args").value = JSON.stringify(s?.args ?? []);
  input("source-projects").value = s?.projects.join(", ") ?? "";
  input("source-repos").value = s?.repositories.join(", ") ?? "";
  input("ca").value = s?.caBundleRef ?? "";
  input("ai-reviewers").value = s?.aiReviewers.join(", ") ?? "";
  input("epic-field").value = s?.epicField ?? "customfield_10014";
  input("source-version").value = s?.version ?? "";
  input("fallback").checked = s?.restFallback ?? false;
  input("mappings").value = JSON.stringify(s?.mappings ?? {}, null, 2);
}
async function saveSource() {
  const s = {
    ...config.sources.find((s) => s.id === value("source-id")),
    id: value("source-id"),
    name: value("source-name"),
    kind: value("source-kind"),
    baseUrl: value("source-url"),
    transport: value("transport"),
    credentialRef: value("credential") || undefined,
    caBundleRef: value("ca") || undefined,
    mcpUrl: value("mcp-url") || undefined,
    command: value("command") || undefined,
    args: JSON.parse(value("args")),
    projects: split(value("source-projects")),
    repositories: split(value("source-repos")),
    version: value("source-version"),
    epicField: value("epic-field"),
    aiReviewers: split(value("ai-reviewers")),
    restFallback: input("fallback").checked,
    mappings: JSON.parse(value("mappings")),
  };
  config = await api(
    "/config",
    { ...config, sources: [...config.sources.filter((x) => x.id !== s.id), s] },
    "PUT",
  );
  await refresh();
  notice("Connection saved locally. No credentials are exported or committed.");
}
function num(v: number | null | undefined) {
  return v == null
    ? "Unavailable"
    : new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(v);
}
function table(head: string[], rows: unknown[][]) {
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function show(r: Report) {
  report = r;
  const c = r.current;
  $("#results").innerHTML =
    `<div class="ap-heading"><div><h3>${esc(c.period.label)}</h3><p class="ap-small">${r.baseline ? "Compared with " + esc(r.baseline.period.label) : "Single period"} · ${esc(r.config.reporting.timezone)}</p></div><div class="ap-row"><a href="/api/v1/comparisons/${r.id}/export?format=csv">CSV</a><a href="/api/v1/comparisons/${r.id}/export?format=html">Printable report</a></div></div><div class="ap-callout">${r.synthetic ? "SYNTHETIC DATA. " : ""}${esc([...r.warnings, ...c.warnings].join(" "))}</div><div class="ap-kpis">${c.metrics
      .filter((m) => ["cycle", "throughput", "reopen"].includes(m.id))
      .sort(
        (a, b) =>
          ["cycle", "throughput", "reopen"].indexOf(a.id) -
          ["cycle", "throughput", "reopen"].indexOf(b.id),
      )
      .map((m) => {
        const b = r.baseline?.metrics.find((x) => x.id === m.id);
        const diff =
          m.value != null && b?.value != null ? m.value - b.value : null;
        return `<button class="ap-kpi" data-metric="${m.id}"><span>${esc(m.label)}</span><span class="ap-value">${num(m.value)} <small>${esc(m.unit)}</small></span><span class="ap-delta">${diff == null ? "" : (diff > 0 ? "+" : "") + num(diff) + (m.unit === "%" ? " percentage points" : " from baseline")}</span><span class="ap-value ap-note" style="font-size:12px;font-weight:400">${m.n} eligible · ${m.excluded} excluded${m.immature ? " · " + m.immature + " immature" : ""}</span><span class="ap-small">${esc(m.reason ?? "View evidence →")}</span></button>`;
      })
      .join(
        "",
      )}</div><div class="ap-split"><div class="ap-panel"><h3>Where time is spent</h3>${c.stages.map((s) => `<div class="ap-bars"><span>${esc(s.name)}</span><div class="ap-track"><div class="ap-fill" style="width:${Math.min(100, (s.days / Math.max(1, ...c.stages.map((x) => x.days))) * 100)}%"></div></div><span>${num(s.days)} d</span></div>`).join("") || "No eligible stage history"}</div><div class="ap-panel"><h3>Data behind the result</h3>${table(
      ["Coverage", "Records"],
      [
        [
          "Complete issue history",
          c.coverage.completeIssues + " / " + c.coverage.issues,
        ],
        [
          "Complete PR history",
          c.coverage.completePRs + " / " + c.coverage.prs,
        ],
        ["Issues linked to PRs", c.coverage.linked],
        ["Unverified AI usage", c.unknownAI + " reviewed PRs"],
      ],
    )}</div></div><div class="ap-panel"><h3>Additional delivery measures</h3>${table(
      ["Metric", "Current", "Sample", "Availability"],
      c.metrics
        .filter((m) => !["cycle", "throughput", "reopen"].includes(m.id))
        .map((m) => [
          m.label,
          num(m.value) + " " + m.unit,
          m.n,
          m.reason ?? "Available",
        ]),
    )}</div><div class="ap-split"><div class="ap-panel"><h3>Work mix</h3>${table(
      ["Type", "Completions"],
      c.workMix.map((m) => [m.type, m.count]),
    )}</div><div class="ap-panel"><h3>Unfinished work at period end</h3>${table(
      ["Issue", "Age (days)"],
      c.aging.slice(0, 10).map((i) => [i.id, num(i.days)]),
    )}</div></div><div class="ap-rankings"><div class="ap-panel"><h3>Top 10 Epics</h3><p class="ap-small">Ranked by child issues completed in the analysis period.</p>${
      table(
        ["Epic", "Completed", "Status at period end"],
        c.epics.map((e) => [e.key + " · " + e.title, e.done, e.status]),
      ) || ""
    }${!c.epics.length ? "<p>No eligible linked epics.</p>" : ""}</div><div class="ap-panel"><h3>Top 10 Pull Requests</h3><p class="ap-small">Ranked by verified AI review runs in the analysis period.</p>${table(
      ["PR", "AI runs", "Run IDs"],
      c.prs.map((p) => ["#" + p.id + " · " + p.title, p.runs, "Verified"]),
    )}${!c.prs.length ? "<p>No verified AI review runs. Private AI assistance cannot be inferred.</p>" : ""}</div></div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach(
    (b) =>
      (b.onclick = safe(async () => {
        const data = await api(
          `/comparisons/${r.id}/evidence?metric=${b.dataset.metric}&limit=100`,
        );
        $("#evidence").hidden = false;
        $("#evidence-title").textContent =
          b.textContent?.split("Unavailable")[0]?.slice(0, 70) ?? "Evidence";
        $("#evidence-content").innerHTML = table(
          ["Issue/PR", "Title", "Value", "Status"],
          data.items.map((e: any) => [
            e.id,
            e.title,
            num(e.value),
            e.reason ?? "Included",
          ]),
        );
        if (data.nextCursor !== null)
          $("#evidence-content").insertAdjacentHTML(
            "beforeend",
            "<p>Showing first 100 records.</p>",
          );
      })),
  );
}
async function reports() {
  const d = await api("/comparisons");
  $("#report-list").innerHTML =
    d.items
      .map(
        (r: any) =>
          `<div class="ap-panel"><button data-report="${r.id}">${esc(r.label)}</button><span class="ap-small"> ${esc(r.created)}${r.synthetic ? " · Synthetic" : ""}</span></div>`,
      )
      .join("") || "No saved reports yet.";
  document.querySelectorAll<HTMLButtonElement>("[data-report]").forEach(
    (b) =>
      (b.onclick = safe(async () => {
        show(await api("/comparisons/" + b.dataset.report));
        go("analysis");
      })),
  );
}
async function jobs() {
  const d = await api("/data");
  $("#jobs").innerHTML =
    d.jobs
      .map(
        (j: any) =>
          `<div class="ap-panel"><span>${esc(j.status)} · ${j.entities} records · ${j.pages} pages</span><p class="ap-small">${esc(j.errors.join("; "))}</p>${["running", "queued"].includes(j.status) ? `<button data-cancel="${j.id}">Cancel</button>` : ["partial", "interrupted", "canceled"].includes(j.status) ? `<button data-resume="${j.id}">Resume</button>` : ""}</div>`,
      )
      .join("") || "No import jobs yet.";
  document.querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach(
    (b) =>
      (b.onclick = safe(async () => {
        await api("/imports/" + b.dataset.cancel + "/cancel", {});
        await jobs();
      })),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-resume]").forEach(
    (b) =>
      (b.onclick = safe(async () => {
        await api("/imports/" + b.dataset.resume + "/resume", {});
        await jobs();
      })),
  );
}
function readAnalysis(): AnalysisInput {
  return {
    configRevision: config.revision,
    preset: value("preset") as AnalysisInput["preset"],
    anchor: value("anchor"),
    start: value("start") || undefined,
    end: value("end") || undefined,
    comparison: value("comparison") as AnalysisInput["comparison"],
    baselineStart: value("baseline-start") || undefined,
    baselineEnd: value("baseline-end") || undefined,
    sourceIds: Array.from($<HTMLSelectElement>("#sources").selectedOptions).map(
      (o) => o.value,
    ),
    projects: split(value("projects")),
    repositories: split(value("repos")),
    linkedOnly: input("linked").checked,
    excludeMixed: input("mixed").checked,
    adoptionName: value("adoption") || undefined,
  };
}
async function preview() {
  const custom = ["custom", "yoy"].includes(value("preset"));
  input("start").disabled = !custom;
  input("end").disabled = !custom;
  input("baseline-start").disabled = value("comparison") !== "custom";
  input("baseline-end").disabled = value("comparison") !== "custom";
  try {
    const p = await api("/periods", readAnalysis());
    $("#period-preview").textContent =
      p.current.label +
      (p.baseline ? " vs " + p.baseline.label : " · Single period") +
      " · " +
      config.reporting.timezone;
  } catch {
    $("#period-preview").textContent =
      "Select sources and valid dates to preview the window.";
  }
}
async function init() {
  csrf = (await api("/session")).csrf;
  input("anchor").value = new Date().toISOString().slice(0, 10);
  document
    .querySelectorAll<HTMLButtonElement>("[data-page]")
    .forEach((b) => (b.onclick = () => go(b.dataset.page!)));
  $("#analysis-form").onsubmit = (e) => {
    e.preventDefault();
    void (async () => {
      show(await api("/comparisons", readAnalysis()));
      await reports();
      $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
      flash($("#results"));
      notice("Report calculated and saved with frozen evidence.");
    })().catch((e) => notice(e.message, true));
  };
  $("#source-form").onsubmit = (e) => {
    e.preventDefault();
    void saveSource().catch((e) => notice(e.message, true));
  };
  $("#test-source").onclick = safe(async () => {
    await saveSource();
    $("#connection-result").textContent = "Testing…";
    try {
      const result = await api(
        "/connections/" + encodeURIComponent(value("source-id")) + "/test",
        {},
      );
      const guide =
        Array.isArray(result.guidance) && result.guidance.length
          ? "Import guidance ([+] recommended, [-] do not import):\n" +
            result.guidance.join("\n") +
            "\n\n"
          : "";
      $("#connection-result").textContent =
        guide + JSON.stringify(result, null, 2);
      recommendedTool = result.recommendedTool ?? null;
      $("#apply-recommendation").hidden = !recommendedTool;
    } catch (e) {
      $("#connection-result").textContent = (e as Error).message;
      recommendedTool = null;
      $("#apply-recommendation").hidden = true;
    }
  });
  $("#apply-recommendation").onclick = () => {
    if (!recommendedTool) return;
    const op = value("source-kind") === "jira" ? "issues" : "pullRequests";
    let mappings: Record<string, unknown> = {};
    try {
      mappings = JSON.parse(value("mappings") || "{}");
    } catch {
      mappings = {};
    }
    mappings[op] = {
      tool: recommendedTool,
      arguments: {},
      verifiedReadOnly: true,
    };
    input("mappings").value = JSON.stringify(mappings, null, 2);
    input("mappings").focus();
    flash(input("mappings"));
    notice(
      `Applied recommended tool "${recommendedTool}" to ${op}. Review, then Save & test.`,
    );
  };
  $("#import-source").onclick = safe(async () => {
    await saveSource();
    await api("/imports", {
      sourceIds: [value("source-id")],
      mode: "backfill",
    });
    await jobs();
    $("#jobs").scrollIntoView({ behavior: "smooth", block: "nearest" });
    flash($("#jobs"));
    notice("Import started. See the Import jobs list below.");
  });
  $("#load-catalog").onclick = safe(async () => {
    const ids = Array.from(
      $<HTMLSelectElement>("#sources").selectedOptions,
    ).map((o) => o.value);
    if (!ids.length) {
      notice("Select one or more sources first.", true);
      return;
    }
    notice("Loading projects and repositories…");
    const projects = new Set<string>();
    const repos = new Set<string>();
    const projectQuery = encodeURIComponent(value("projects"));
    for (const id of ids) {
      const path = "/connections/" + encodeURIComponent(id) + "/catalog";
      (await api(path + "?type=projects")).items.forEach((x: string) =>
        projects.add(x),
      );
      (
        await api(path + "?type=repositories&projects=" + projectQuery)
      ).items.forEach((x: string) => repos.add(x));
    }
    fillList("projects-list", projects);
    fillList("repos-list", repos);
    flash(input("projects"));
    flash(input("repos"));
    notice(
      `Loaded ${projects.size} projects, ${repos.size} repositories. Repositories come from the project keys in the field above.`,
    );
  });
  $("#new-source").onclick = () => edit();
  input("mcp-file").onchange = () => {
    void (async () => {
      const file = input("mcp-file").files?.[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.sources))
        throw new Error("Template must contain a sources array");
      const ids = new Set(data.sources.map((s: Source) => s.id));
      await api(
        "/config",
        {
          ...config,
          sources: [
            ...config.sources.filter((s) => !ids.has(s.id)),
            ...data.sources,
          ],
        },
        "PUT",
      );
      await refresh();
      notice(
        "Profiles imported into local storage. The file was not copied into the project.",
      );
    })().catch((e) => notice(e.message, true));
  };
  $("#demo").onclick = safe(async () => {
    await api("/demo", {});
    await refresh();
    notice("Synthetic example loaded. No live source was contacted.");
  });
  $("#settings-form").onsubmit = (e) => {
    e.preventDefault();
    void (async () => {
      await api(
        "/config",
        { ...config, reporting: JSON.parse(value("settings-json")) },
        "PUT",
      );
      await refresh();
      notice("Reporting settings saved locally.");
    })().catch((e) => notice(e.message, true));
  };
  $("#close-evidence").onclick = () => ($("#evidence").hidden = true);
  await refresh();
  await preview();
  $("#analysis-form").addEventListener("change", () => {
    void preview();
  });
  setInterval(() => {
    if (!$("#connections").hidden) void jobs().catch(() => {});
  }, 3000);
}
void init().catch((e) => notice(e.message, true));
