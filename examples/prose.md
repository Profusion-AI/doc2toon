# Field Note

AI-assisted document work moves quickly, while the useful record often spreads across prompts, drafts, comments, and approvals. A reviewer needs a compact way to see what changed, what evidence was used, and where a human made the final call.

The converter keeps ordinary prose readable while still producing valid TOON. For prose-heavy files, lossless mode groups text by section instead of turning each paragraph into a verbose block record.

This example is intentionally prose-heavy. It shows the important boundary in the project: lossless conversion keeps exact wording, while record and budget modes are for higher context density. If the source is mostly retained prose, TOON can carry the structure cleanly, but the output may be similar in size or larger than the original document.

doc2toon is not trying to preserve every rhetorical aside forever. Humans decide which nuance matters. The tool prepares compact, structured, measurable context so an LLM can consume the source more efficiently.

## Review Boundary

The source document remains the durable reference. TOON output carries structured model context for retrieval and review, but it does not replace the original file.

Reviewers treat metrics as evidence, not decoration. A character or token reduction is useful only when the retained content still supports the intended task. If a budget target requires dropping context, the output labels semantic compression and keeps coverage notes so the user can see what was represented.

## Practical Use

Use this example when checking that narrative Markdown converts without losing headings or paragraph content. It profiles as raw prose and emits a `doc` record plus compact `sections`.

This file also exercises the refusal path. A very small target fails without `--allow-lossy`, because the converter does not pretend that a detailed note can become a tiny lossless representation. With `--allow-lossy`, the same input can become a shorter semantic coverage map for LLM context preparation.
