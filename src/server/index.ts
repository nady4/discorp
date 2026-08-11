import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { prisma } from "../database/prisma.js";
import { env } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * Web dashboard + orchestration API (v0.5/v1.0).
 * Zero-dependency HTTP server built on node:http.
 *
 *   GET /healthz              — liveness probe
 *   GET /api/status           — org status overview
 *   GET /api/goals?guildId=   — goals with task counts
 *   GET /api/tasks?guildId=   — recent tasks
 *   GET /api/reports?guildId= — recent reports
 *   GET /api/balance?guildId= — day/month/all-time usage
 *   GET /                     — dashboard (HTML)
 *
 * Bind to 127.0.0.1 by default; expose via a reverse proxy or SSH tunnel.
 */
export async function startServer(): Promise<void> {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      logger.error({ err }, "api request failed");
      sendJson(res, 500, { error: "internal error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.SERVER_PORT, env.SERVER_BIND, () => resolve());
  });
  logger.info({ port: env.SERVER_PORT, bind: env.SERVER_BIND }, "dashboard + orchestration API listening");
}

/** Request router, exported for tests. */
export async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const guildId = url.searchParams.get("guildId") ?? "";

  if (req.method === "GET" && url.pathname === "/healthz") {
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    const guilds = await prisma.guild.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    const rows = await Promise.all(
      guilds.map(async (g) => {
        const [goals, openTasks, agents, month] = await Promise.all([
          prisma.goal.count({ where: { guildId: g.id } }),
          prisma.task.count({ where: { guildId: g.id, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS", "IN_REVIEW"] } } }),
          prisma.guildAgent.count({ where: { guildId: g.id } }),
          prisma.usageSummary.findUnique({
            where: { guildId_period_granularity: { guildId: g.id, period: new Date().toISOString().slice(0, 7), granularity: "MONTH" } },
          }),
        ]);
        return {
          id: g.id,
          mode: g.mode,
          sleepMode: g.sleepMode,
          agents,
          goals,
          openTasks,
          budgetUsd: g.maxMonthlyBudgetCents / 100,
          spentUsd: (month?.costCents ?? 0) / 100,
        };
      }),
    );
    return sendJson(res, 200, { guilds: rows });
  }
  if (req.method === "GET" && url.pathname === "/api/goals") {
    if (!guildId) return sendJson(res, 400, { error: "guildId query param required" });
    const goals = await prisma.goal.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { _count: { select: { tasks: true } } },
    });
    return sendJson(res, 200, {
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        tasks: g._count.tasks,
        createdAt: g.createdAt,
      })),
    });
  }
  if (req.method === "GET" && url.pathname === "/api/tasks") {
    if (!guildId) return sendJson(res, 400, { error: "guildId query param required" });
    const tasks = await prisma.task.findMany({
      where: { guildId },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });
    return sendJson(res, 200, {
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        agentId: t.assignedAgentId,
        goalId: t.goalId,
        updatedAt: t.updatedAt,
      })),
    });
  }
  if (req.method === "GET" && url.pathname === "/api/reports") {
    if (!guildId) return sendJson(res, 400, { error: "guildId query param required" });
    const reports = await prisma.report.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return sendJson(res, 200, {
      reports: reports.map((r) => ({
        id: r.id,
        title: r.title,
        authorAgentId: r.authorAgentId,
        createdAt: r.createdAt,
        preview: r.content.slice(0, 300),
      })),
    });
  }
  if (req.method === "GET" && url.pathname === "/api/balance") {
    if (!guildId) return sendJson(res, 400, { error: "guildId query param required" });
    const now = new Date();
    const [day, month, allTime] = await Promise.all([
      prisma.usageSummary.findUnique({
        where: { guildId_period_granularity: { guildId, period: now.toISOString().slice(0, 10), granularity: "DAY" } },
      }),
      prisma.usageSummary.findUnique({
        where: { guildId_period_granularity: { guildId, period: now.toISOString().slice(0, 7), granularity: "MONTH" } },
      }),
      prisma.agentExecution.aggregate({ where: { guildId }, _sum: { costCents: true }, _count: true }),
    ]);
    return sendJson(res, 200, {
      day: day ?? null,
      month: month ?? null,
      allTimeCostUsd: (allTime._sum.costCents ?? 0) / 100,
      allTimeExecutions: allTime._count,
    });
  }

  return sendJson(res, 404, { error: "not found" });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DisCorp dashboard</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
header { display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-bottom: 1px solid #21262d; }
header h1 { font-size: 18px; margin: 0; }
main { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
nav button { background: #21262d; color: #e6edf3; border: 0; border-radius: 6px; padding: 8px 14px; margin-right: 8px; cursor: pointer; }
nav button.active { background: #1f6feb; }
section { display: none; margin-top: 16px; }
section.active { display: block; }
table { width: 100%; border-collapse: collapse; background: #161b22; border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #21262d; font-size: 13px; }
th { color: #8b949e; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.tag.done { background: #23863633; color: #3fb950; }
.tag.open { background: #1f6feb33; color: #58a6ff; }
.tag.fail { background: #f8514933; color: #f85149; }
.tag.warn { background: #d2992233; color: #d29922; }
.empty { color: #8b949e; padding: 24px; text-align: center; }
select, input { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 8px; margin-bottom: 12px; }
</style>
</head>
<body>
<header><h1>DisCorp</h1><select id="guild"></select></header>
<main>
<nav>
  <button data-tab="status" class="active">Status</button>
  <button data-tab="goals">Goals</button>
  <button data-tab="tasks">Tasks</button>
  <button data-tab="reports">Reports</button>
  <button data-tab="balance">Costs</button>
</nav>
<section id="tab-status" class="active"></section>
<section id="tab-goals"></section>
<section id="tab-tasks"></section>
<section id="tab-reports"></section>
<section id="tab-balance"></section>
</main>
<script>
const $ = (id) => document.getElementById(id);
let guilds = [];
const guildId = () => $("guild").value;

function tag(status) {
  const cls = /DONE|COMPLETED/.test(status) ? "done" : /FAILED/.test(status) ? "fail" : /IN_PROGRESS|ASSIGNED|PENDING|ANALYZING|REVIEWING/.test(status) ? "open" : "warn";
  return '<span class="tag ' + cls + '">' + status + '</span>';
}

async function load() {
  const res = await fetch("/api/status");
  const data = await res.json();
  guilds = data.guilds;
  $("guild").innerHTML = guilds.map((g) => '<option value="' + g.id + '">' + g.id + " (" + g.mode + ")</option>").join("");
  renderStatus();
  if (guilds.length) refreshAll();
}
$("guild").onchange = refreshAll;

async function refreshAll() {
  if (!guildId()) return;
  await Promise.all([renderGoals(), renderTasks(), renderReports(), renderBalance()]);
}

function renderStatus() {
  const rows = guilds.map((g) => "<tr><td>" + g.id + "</td><td>" + tag(g.mode) + "</td><td>" + g.agents + "</td><td>" + g.goals + "</td><td>" + g.openTasks + "</td><td>$" + g.spentUsd.toFixed(2) + " / $" + g.budgetUsd.toFixed(2) + "</td><td>" + (g.sleepMode ? tag("SLEEP") : "—") + "</td></tr>").join("");
  $("tab-status").innerHTML = guilds.length
    ? "<table><tr><th>Guild</th><th>Mode</th><th>Agents</th><th>Goals</th><th>Open tasks</th><th>Spend</th><th>Sleep</th></tr>" + rows + "</table>"
    : '<div class="empty">No organizations registered yet.</div>';
}

async function renderGoals() {
  const res = await fetch("/api/goals?guildId=" + encodeURIComponent(guildId()));
  const data = await res.json();
  const rows = (data.goals || []).map((g) => "<tr><td>" + g.title + "</td><td>" + tag(g.status) + "</td><td>" + g.tasks + "</td><td><code>" + g.id + "</code></td></tr>").join("");
  $("tab-goals").innerHTML = rows
    ? "<table><tr><th>Goal</th><th>Status</th><th>Tasks</th><th>Id</th></tr>" + rows + "</table>"
    : '<div class="empty">No goals yet.</div>';
}

async function renderTasks() {
  const res = await fetch("/api/tasks?guildId=" + encodeURIComponent(guildId()));
  const data = await res.json();
  const rows = (data.tasks || []).map((t) => "<tr><td>" + t.title + "</td><td>" + tag(t.status) + "</td><td>" + t.priority + "</td><td>" + (t.agentId || "—") + "</td><td>" + new Date(t.updatedAt).toISOString().slice(0, 10) + "</td></tr>").join("");
  $("tab-tasks").innerHTML = rows
    ? "<table><tr><th>Task</th><th>Status</th><th>Priority</th><th>Agent</th><th>Updated</th></tr>" + rows + "</table>"
    : '<div class="empty">No tasks yet.</div>';
}

async function renderReports() {
  const res = await fetch("/api/reports?guildId=" + encodeURIComponent(guildId()));
  const data = await res.json();
  const rows = (data.reports || []).map((r) => "<tr><td>" + r.title + "</td><td>" + (r.authorAgentId || "—") + "</td><td>" + new Date(r.createdAt).toISOString().slice(0, 10) + "</td><td>" + (r.preview || "").replace(/</g, "&lt;") + "</td></tr>").join("");
  $("tab-reports").innerHTML = rows
    ? "<table><tr><th>Report</th><th>Author</th><th>Date</th><th>Preview</th></tr>" + rows + "</table>"
    : '<div class="empty">No reports yet.</div>';
}

async function renderBalance() {
  const res = await fetch("/api/balance?guildId=" + encodeURIComponent(guildId()));
  const data = await res.json();
  const usd = (c) => "$" + (c / 100).toFixed(2);
  const day = data.day ? "<tr><td>Today</td><td>" + (data.day.executions || 0) + "</td><td>" + (data.day.tokensIn || 0) + "</td><td>" + (data.day.tokensOut || 0) + "</td><td>" + usd(data.day.costCents || 0) + "</td></tr>" : "";
  const month = data.month ? "<tr><td>This month</td><td>" + (data.month.executions || 0) + "</td><td>" + (data.month.tokensIn || 0) + "</td><td>" + (data.month.tokensOut || 0) + "</td><td>" + usd(data.month.costCents || 0) + "</td></tr>" : "";
  $("tab-balance").innerHTML =
    "<table><tr><th>Period</th><th>Executions</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr>" + day + month +
    '<tr><td>All time</td><td>' + data.allTimeExecutions + '</td><td colspan="2"></td><td>' + usd(data.allTimeCostUsd * 100) + "</td></tr></table>";
}

document.querySelectorAll("nav button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
  };
});

load();
</script>
</body>
</html>`;

export const server = { startServer };
