---
name: Conversion accuracy report
about: Report incorrect, lossy, or misleading conversion behavior
title: "Accuracy: "
labels: conversion-accuracy
assignees: ""
---

## Summary

What conversion result seems wrong?

## Source type

- [ ] `.md`
- [ ] `.txt`
- [ ] stdin

## Mode

- [ ] lossless
- [ ] record
- [ ] budget without `--allow-lossy`
- [ ] budget with `--allow-lossy`

## Command

```bash
doc2toon ...
```

## Minimal input

```text

```

## Expected output

What structure or content did you expect?

## Actual output

Paste the relevant TOON or decoded JSON:

```text

```

## Validation result

Did this pass `doc2toon validate`?

## Metrics

Paste the metrics output:

```text

```

## Why it matters

Does this lose meaning, misclassify document structure, misreport savings, or produce invalid TOON?
