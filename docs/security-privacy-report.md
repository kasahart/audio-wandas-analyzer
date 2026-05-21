# Security / Privacy Report (2026-05-21)

## Scope
- Repository source and config files (tracked files under version control)
- Dependency vulnerability scan (`npm audit --audit-level=moderate`)
- Basic secret / PII pattern scan over tracked text files

## Methodology
- **Dependency audit**: ran `npm audit --audit-level=moderate` against the committed `package-lock.json` and recorded the summary line verbatim.
- **Secret scan**: regex-based search across tracked text files for common credential patterns —
  - API key / token shapes (`AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{36,}`, `xox[abpr]-[A-Za-z0-9-]+`, generic `(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{8,}`)
  - Private key headers (`-----BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY-----`)
  - `.env`-style assignments containing high-entropy values
- **PII scan**: regex-based search for email addresses, Japanese phone-number patterns, and personal-name conventions; results were reviewed manually to distinguish public maintainer metadata from private data.
- **Known blind spots**: binary assets (e.g. `.wav`, image files) and generated artifacts under `out/`, `dist/`, and `node_modules/` were not scanned. The scan is pattern-based and cannot detect obfuscated or encoded secrets, nor PII embedded inside binary media.

## Findings
1. **Dependency vulnerabilities**: `npm audit --audit-level=moderate` reported `found 0 vulnerabilities` (exact output).
2. **Hardcoded secrets**: No API keys, private keys, or token-like strings were detected by the patterns above in tracked text files.
3. **Personal information**: No private personal data was detected. Public repository metadata (for example GitHub account / repository URLs and the maintainer's public commit email) is present as expected.

## Notes
- `package-lock.json` includes a `deprecated` message for an older `glob` version pulled in transitively. This is a **deprecation notice**, not a vulnerability finding — `npm audit --audit-level=moderate` did not report it as an active vulnerability (see Finding 1).

## Recommendation
- Keep running `npm audit` and secret scanning in CI to catch future dependency or credential risks early.
