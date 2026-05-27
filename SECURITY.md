# Security Policy

## Supported versions

Security fixes are considered for the latest public release.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please do not open a public issue for vulnerabilities.

Use GitHub private vulnerability reporting if it is enabled for this repository. If it is not enabled, contact the maintainer privately before publishing details.

Include:

- affected version
- operating system and Node.js version
- exact command or API path involved
- minimal input needed to reproduce
- expected impact
- whether the issue can expose local files, secrets, shell execution, or untrusted TOON/JSON parsing behavior

## Scope

In scope:

- unsafe file handling
- unexpected shell execution
- dependency vulnerabilities with a realistic project impact
- denial-of-service behavior from malformed local input
- parsing or validation behavior that can mislead users about lossy output

Out of scope:

- compression-quality complaints without a security impact
- social engineering
- attacks requiring prior full local machine compromise
- issues in third-party packages that do not affect this project in practice

`doc2toon` is a local developer tool. Do not process secrets or private documents unless you are comfortable with the local machine and dependency environment.
