# Skill: Review a Markdown document for context-density risks before conversion

Use this skill when reviewing an agent-facing Markdown document for redundancy, vague instructions, long sections, or possible skill split opportunities before converting it with `doc2toon`.

## When To Use

- The input is an agent instruction file, workflow note, policy note, or skill draft.
- The user wants context-density feedback before conversion.
- The document may contain repeated rules, vague guidance, overloaded sections, or procedural detail that should move into an on-demand skill.

## Input Expectations

- Work from the current document text.
- Preserve the user's intended operating meaning.
- Do not assume every sentence deserves always-on context.
- Do not rewrite silently.

## Review Steps

1. Identify the document purpose and intended agent task.
2. Find repeated rules that say the same operational thing more than once.
3. Find vague instructions that consume tokens without telling the agent what to do.
4. Find long sections that combine multiple concerns or exceed the practical scanning budget.
5. Find split candidates where one section contains multiple workflows, policies, or task triggers.
6. Report advisory warnings with evidence and a concrete suggestion.

## Warning Categories

### Possible duplicate rule

Use this when two instructions repeat the same operational requirement or create avoidable context bloat.

Report:

- The repeated instruction.
- Where it appears.
- Whether the duplicate looks exact or semantic.
- A suggestion to consolidate, cross-reference, or keep both only if the distinction matters.

### Possibly vague instruction

Use this when an instruction sounds helpful but lacks an operational handle.

Examples:

- "Be smart."
- "Use good judgment."
- "Make it better."
- "Handle edge cases."

Report the phrase and suggest a concrete trigger, action, constraint, or acceptance criterion.

### Long section

Use this when a section is large enough that it may hide multiple concerns or become hard for an agent to scan.

Report the section heading, rough size, and a suggestion to shorten, structure, or move procedural detail into a skill.

### Possible split candidate

Use this when a section appears to contain two or more distinct workflows, skills, policies, or task triggers.

Report the section heading and the likely split themes. Suggest separating always-on rules from on-demand procedures.

## Preserve Human Judgment

Warnings are advisory signals, not moral judgments. The human decides what nuance matters. If repeated prose supports traceability, review, or task accuracy, say that it may be worth keeping.

## Do Not Overclaim Compression

- Report measured character and token savings only after conversion.
- Do not imply a universal savings percentage.
- Treat budget-mode semantic compression as lossy unless validation proves a lossless target was reached.
- Avoid claiming that `doc2toon` can preserve every rhetorical nuance while also meeting a strict context budget.
