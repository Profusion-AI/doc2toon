# Converter Definitions

## Canonical JSON

Definition: The normalized JSON structure produced before TOON encoding.
Example: A glossary becomes repeated `defs` records with stable fields.
Tags: schema, intermediate, validation

## Lossless Mode

Definition: Conversion mode that keeps the source meaning and text content inside the selected compact schema.
Example: Prose sections keep their paragraph text instead of summarizing it.
Tags: mode, preservation

## Record Mode

Definition: Conversion mode that prefers typed repeated records for definitions, requirements, and table-like content.
Example: A set of terms becomes `defs[N]{id,term,type,def,ex,tags}`.
Tags: mode, structured

## Budget Refusal

Definition: The safety behavior that stops a budget conversion when the requested target cannot be reached losslessly.
Example: A ten-character target fails unless `--allow-lossy` is explicitly passed.
Tags: budget, safety
