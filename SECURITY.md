# Security policy

## Supported versions

Security fixes go into the latest minor release of the current major version. The packages `datakable`, `@datakable/core` and `@datakable/react` are released together, with the same version number.

| Version | Supported |
| ------- | --------- |
| 2.0.x   | yes       |
| < 2.0   | no        |

## Reporting a vulnerability

Do not open a public issue, pull request or discussion for a security problem.

Report it privately through GitHub instead: open the repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/Ink01101011/datakable/security/advisories/new)). The report goes to the maintainer only.

Please include:

- the affected package or packages and their versions;
- whether it affects development builds, production builds or both (much of DataKable's diagnostic output exists only in development);
- a minimal reproduction or proof of concept, and what it shows;
- the impact as you see it: what an attacker controls and what they gain.

## What happens next

1. The maintainer acknowledges the report and confirms whether it reproduces. This is a one-person project, so allow a few days.
2. A confirmed issue is fixed in a private advisory fork, or on a branch that does not describe the vulnerability, and released as a patch.
3. The GitHub Security Advisory is published, with a CVE where GitHub assigns one, once the fixed version is on npm. Reporters are credited unless they prefer otherwise.

Past advisories are listed under [Security advisories](https://github.com/Ink01101011/datakable/security/advisories).

## Scope

In scope: code in this repository that ships in the npm packages, such as table state handling, diagnostics and redaction, the React components and the build output.

Some things are documented as the application's responsibility and are not vulnerabilities in DataKable by themselves:

- **Server mode.** `FetchParams` (sort, filters, page) come from state that can be restored from a URL or from storage. The backend must treat them as untrusted input: validate sort ids against an allow-list, cap the page size and encode URL parameters. See [server mode](docs/how-to-use/server-mode.md).
- **Diagnostics.** Columns marked `sensitive: true` are redacted in diagnostics. Values that are not marked are not. `onDiagnostic` and custom sinks receive data the application then forwards. See [diagnostics](docs/how-to-use/diagnostics.md).

Vulnerabilities in dependencies are reported upstream to that project. A report here is still welcome when DataKable's use of the dependency makes the problem exploitable.
