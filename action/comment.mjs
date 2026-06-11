#!/usr/bin/env node
// Best-effort sticky PR comment for the doc2toon context-check Action.
//
// Implements the spike's degradation design (docs/action-fork-pr-permissions.md):
// the comment is progressive enhancement — a 403/404 (read-only GITHUB_TOKEN,
// e.g. fork PRs that slipped past the step-level skip, or repos with read-only
// default workflow permissions) downgrades to a notice pointing at the step
// summary and never fails the run. Sticky behavior: find-and-update an existing
// comment by hidden marker so re-pushes edit one comment instead of stacking.
//
// Plain node + REST against GITHUB_TOKEN — deliberately not actions/github-script,
// whose current majors run on the deprecated node20 action runtime.

import { readFileSync } from "node:fs";

const MARKER = "<!-- doc2toon-context-check -->";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const prNumber = event.pull_request?.number;
const body = readFileSync(process.env.COMMENT_PATH, "utf8");

if (!prNumber) {
  console.log("::notice::doc2toon comment step: not a pull_request event; nothing to do.");
  process.exit(0);
}

// Defense in depth — the action.yml step condition already skips detected forks.
if (event.pull_request.head?.repo?.full_name && event.pull_request.head.repo.full_name !== repository) {
  console.log("::notice::doc2toon comment skipped: fork PR (read-only token). Verdicts are in the step summary and artifact.");
  process.exit(0);
}

const api = async (method, path, payload) => {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "doc2toon-context-check",
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return res;
};

const existing = await api("GET", `/repos/${repository}/issues/${prNumber}/comments?per_page=100`);
if (existing.status === 403 || existing.status === 404) {
  console.log(`::notice::doc2toon comment skipped: token cannot read PR comments (${existing.status}). Verdicts are in the step summary and artifact.`);
  process.exit(0);
}
if (!existing.ok) {
  console.log(`::error::doc2toon comment step: unexpected ${existing.status} listing comments.`);
  process.exit(1);
}

const comments = await existing.json();
const mine = comments.find((c) => typeof c.body === "string" && c.body.includes(MARKER));

const write = mine
  ? await api("PATCH", `/repos/${repository}/issues/comments/${mine.id}`, { body })
  : await api("POST", `/repos/${repository}/issues/${prNumber}/comments`, { body });

if (write.status === 403 || write.status === 404 || write.status === 422) {
  console.log(`::notice::doc2toon comment skipped: token cannot write PR comments (${write.status}). Grant 'pull-requests: write' to enable; verdicts are in the step summary and artifact.`);
  process.exit(0);
}
if (!write.ok) {
  console.log(`::error::doc2toon comment step: unexpected ${write.status} writing the comment.`);
  process.exit(1);
}
console.log(`doc2toon context check: ${mine ? "updated" : "posted"} the sticky PR comment.`);
