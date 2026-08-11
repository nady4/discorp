import { env } from "../../config/index.js";
import { sendMail } from "../../utils/smtp.js";
import type { AgentTool, ToolContext } from "./registry.js";

function requireEnv(name: string): string {
  const value = env[name as keyof typeof env];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} is not set. Ask the organization owner to add it to the environment.`);
  }
  return value;
}

async function jsonOrThrow(resp: Response, label: string): Promise<Record<string, unknown>> {
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${label} API ${resp.status}: ${body.slice(0, 200)}`);
  }
  return (await resp.json().catch(() => ({}))) as Record<string, unknown>;
}

export const integrationTools: AgentTool[] = [
  {
    name: "linear_issue_create",
    description:
      "Create an issue in Linear (requires LINEAR_API_KEY). Provide a team key, title, and description.",
    parameters: {
      type: "object",
      properties: {
        teamKey: { type: "string", description: "Linear team key, e.g. ENG" },
        title: { type: "string", description: "Issue title" },
        description: { type: "string", description: "Issue description" },
      },
      required: ["teamKey", "title"],
    },
    async execute(args) {
      const apiKey = requireEnv("LINEAR_API_KEY");
      const teamKey = String(args.teamKey).toUpperCase();
      const title = String(args.title);
      const description = String(args.description ?? "");
      const teamsResp = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: linearAuth(apiKey) },
        body: JSON.stringify({
          query: `query { teams(filter: { key: { eq: "${teamKey}" } }) { nodes { id } } }`,
        }),
      });
      const teams = (await jsonOrThrow(teamsResp, "Linear")) as { data?: { teams?: { nodes?: Array<{ id: string }> } } };
      const teamId = teams.data?.teams?.nodes?.[0]?.id;
      if (!teamId) throw new Error(`Linear team '${teamKey}' not found.`);
      const resp = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: linearAuth(apiKey) },
        body: JSON.stringify({
          query: `mutation ($t: String!, $title: String!, $desc: String!) {
            issueCreate(input: { teamId: $t, title: $title, description: $desc }) { issue { id identifier url } } }`,
          variables: { t: teamId, title, desc: description },
        }),
      });
      const data = (await jsonOrThrow(resp, "Linear")) as {
        data?: { issueCreate?: { issue?: { identifier: string; url: string } } };
      };
      const issue = data.data?.issueCreate?.issue;
      if (!issue) throw new Error(`Linear issueCreate failed: ${JSON.stringify(data).slice(0, 200)}`);
      return `Created Linear issue ${issue.identifier}: ${issue.url}`;
    },
  },
  {
    name: "jira_issue_create",
    description:
      "Create an issue in Jira (requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN). Provide project key, summary, and optional description.",
    parameters: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Jira project key, e.g. PROJ" },
        summary: { type: "string", description: "Issue summary/title" },
        description: { type: "string", description: "Issue description" },
      },
      required: ["projectKey", "summary"],
    },
    async execute(args) {
      const baseUrl = requireEnv("JIRA_BASE_URL").replace(/\/$/, "");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      const auth = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
      const resp = await fetch(`${baseUrl}/rest/api/2/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          fields: {
            project: { key: String(args.projectKey) },
            summary: String(args.summary),
            description: String(args.description ?? ""),
            issuetype: { name: "Task" },
          },
        }),
      });
      const data = (await jsonOrThrow(resp, "Jira")) as { key?: string; self?: string };
      if (!data.key) throw new Error(`Jira issueCreate failed: ${JSON.stringify(data).slice(0, 200)}`);
      return `Created Jira issue ${data.key}: ${data.self}`;
    },
  },
  {
    name: "notion_page_create",
    description:
      "Create a page in Notion under a database (requires NOTION_API_KEY, NOTION_DATABASE_ID). Provide a title and content.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Page title" },
        content: { type: "string", description: "Page content (plain text, stored as a paragraph block)" },
      },
      required: ["title"],
    },
    async execute(args) {
      const apiKey = requireEnv("NOTION_API_KEY");
      const databaseId = requireEnv("NOTION_DATABASE_ID");
      const title = String(args.title);
      const content = String(args.content ?? "");
      const resp = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: { title: { title: [{ text: { content: title } }] } },
          children: content
            ? [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content } }] } }]
            : [],
        }),
      });
      const data = (await jsonOrThrow(resp, "Notion")) as { url?: string };
      if (!data.url) throw new Error(`Notion page create failed: ${JSON.stringify(data).slice(0, 200)}`);
      return `Created Notion page: ${data.url}`;
    },
  },
  {
    name: "slack_message",
    description:
      "Send a message to a Slack channel (requires SLACK_BOT_TOKEN and SLACK_CHANNEL). The channel is fixed by the organization config.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message text to post" },
      },
      required: ["text"],
    },
    async execute(args) {
      const token = requireEnv("SLACK_BOT_TOKEN");
      const channel = requireEnv("SLACK_CHANNEL");
      const resp = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel, text: String(args.text ?? "").slice(0, 3900) }),
      });
      const data = (await resp.json()) as { ok?: boolean; error?: string };
      if (!data.ok) throw new Error(`Slack API error: ${data.error ?? "unknown"}`);
      return "Message posted to Slack.";
    },
  },
  {
    name: "email_send",
    description:
      "Send an email via SMTP (requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM). Provide a recipient, subject, and body.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain-text email body" },
      },
      required: ["to", "subject", "body"],
    },
    async execute(args) {
      const to = String(args.to);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error(`Invalid recipient email: ${to}`);
      await sendMail(
        {
          host: requireEnv("SMTP_HOST"),
          port: Number(env.SMTP_PORT ?? 587),
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
          from: requireEnv("SMTP_FROM"),
        },
        to,
        String(args.subject).slice(0, 200),
        String(args.body),
      );
      return `Email sent to ${to}.`;
    },
  },
];

function linearAuth(apiKey: string): string {
  // Linear accepts the raw API key directly as a bearer token.
  return `Bearer ${apiKey}`;
}
