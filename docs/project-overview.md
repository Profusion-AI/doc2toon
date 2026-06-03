# Project Overview

`doc2toon` is a context-preparation and token-efficiency tool for LLM workflows. It turns Markdown, plain text, pasted content, definitions, rules, requirements, tables, and other structured documents into measured TOON output when TOON is a good fit.

The first practical target is long agent instruction files such as `CLAUDE.md`, `AGENTS.md`, and `SKILL.md`: documents that often mix durable rules, repeated warnings, vague preferences, tool instructions, and task-specific context in one expensive prompt surface.

The project optimizes for useful context density, not maximum prose fidelity. It should preserve operational meaning, useful structure, retrievability, important cross-references, and task-relevant context while reducing redundancy and avoidable token overhead.

## Philosophy

`doc2toon` helps prepare documents for LLM context windows by increasing useful context density.

It is not designed to preserve every flourish, repeated idea, or rhetorical aside from the source document. Humans remain responsible for deciding which nuance matters. `doc2toon` focuses on preserving structure, meaning, references, definitions, rules, and task-relevant context while reducing redundancy and avoidable token overhead.

When exact wording matters, use lossless mode.
When repeated knowledge matters, use record mode.
When a strict context budget matters, use budget mode and treat the result as lossy unless validation says otherwise.

## Operating Rules

- Do not preserve redundancy unless it supports cross-reference, traceability, or task accuracy.
- Do not preserve overwritten or duplicate ideas as separate payload unless the distinction is meaningful to the user or downstream LLM task.
- Do not preserve purple prose, decorative padding, or rhetorical flourish merely because it exists in the source document.
- Report measured character and token savings. Avoid fixed-percentage savings claims unless the specific conversion proves them.
- Make lossy semantic compression explicit.

## Product Direction

CheapAgent is the separate hosted app direction for practical context compression, token utilization, and LLM-ready document preparation. The controlled alpha is live at `https://cheapagent.ai/`. CheapAgent should help humans and LLMs work with context more efficiently, not replace human editorial judgment.

The human decides what nuance matters. The LLM can help elaborate or restore rhetorical context when needed. `doc2toon` provides the technical intermediary that makes source context more compact, structured, measurable, and easier for an LLM to consume.
