# Security Policy

## Reporting a vulnerability

Please do not open a public issue for suspected security vulnerabilities.

Report the issue privately to the repository maintainer or owner using an available private contact channel. Include:

- a short description of the issue
- affected files or commands
- reproduction steps
- potential impact

Please avoid broad public disclosure until the issue has been reviewed and a fix or mitigation plan is in place.

## Scope

Security-sensitive areas in `aiman` include:

- provider CLI process spawning
- workspace file reads and writes
- run logs and trace persistence
- agent prompt loading from local files

Changes in these areas should be reviewed carefully and tested before release.
