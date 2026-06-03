# CheapAgent MVP

CheapAgent is the branded hosted-app follow-through for `doc2toon`: a browser-side workbench for measuring agent-context waste and preparing tighter LLM-ready documents.

First launch wedge: agent instruction files. CheapAgent's first public job is to inspect bloated `CLAUDE.md`, `AGENTS.md`, and `SKILL.md` files, show measurable context waste, flag risky instructions, and produce a smaller reviewable output.

## Product Rule

Measure before claiming savings. Savings depend on structure. Definitions, rules, tables, and repeated agent instructions benefit most. Pure prose may not shrink losslessly.

Optimize for useful context density, not maximum prose fidelity. The product should not preserve redundancy unless it supports cross-reference, traceability, or task accuracy. It should not keep overwritten duplicate ideas, decorative padding, or rhetorical flourish merely because they exist in the source document.

## Philosophy

`doc2toon` helps prepare documents for LLM context windows by increasing useful context density.

It is not designed to preserve every flourish, repeated idea, or rhetorical aside from the source document. Humans remain responsible for deciding which nuance matters. `doc2toon` focuses on preserving structure, meaning, references, definitions, rules, and task-relevant context while reducing redundancy and avoidable token overhead.

When exact wording matters, use lossless mode.
When repeated knowledge matters, use record mode.
When a strict context budget matters, use budget mode and treat the result as lossy unless validation says otherwise.

## CheapAgent Alpha Scope

The alpha should be a static-first web app that imports the browser-safe `doc2toon` package boundary through `doc2toon/browser`.

- Pasted text input.
- `.txt` and `.md` browser-side file upload.
- Four first modes: optimize `CLAUDE.md`, optimize `AGENTS.md`, optimize `SKILL.md`, convert document to TOON.
- Anonymous 1000 character limit.
- Before/after character counts and estimated tokens.
- Warnings for duplicate rules, vague rules, overlong sections, and split candidates.
- Copy and download output actions.
- Privacy note near the input.

## Non-Goals

- No hosted LLM API dependency.
- No server-side conversion in alpha.
- No document body storage by default.
- No PDF, DOCX, OCR, accounts, billing, dashboards, or paid tiers in alpha.
- No universal compression percentage claims.
- No magical summarizer positioning.
- No claim that CheapAgent replaces human editorial judgment.

## Privacy Default

Process document bodies in the browser when possible. If a later beta adds accounts, store only account metadata and usage counts unless a user explicitly opts into storage.

## CheapAgent Copy

Hero: Paste your bloated agent file and see the waste.

Subhero: CheapAgent measures context overhead, flags duplicate or vague instructions, and prepares structured agent docs for LLM context windows when compression is actually a fit.

Avoid: every document gets the same savings percentage.

Avoid: a magical summarizer that preserves every nuance automatically.

Say instead: savings depend on structure. Definitions, rules, tables, and repeated agent instructions benefit most.

Say instead: the human decides what nuance matters; CheapAgent makes the useful context more compact, structured, measurable, and easier for an LLM to consume.

## Domain Status

CheapAgent is live as a controlled alpha at `https://cheapagent.ai/`. The `www.cheapagent.ai` hostname redirects to apex. Do not describe `cheapagent.netlify.app` as staging until the separate Netlify staging site exists.
