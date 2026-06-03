---
type: issue
id: issue-20260603-remote-mcp-ssrf
title: Block SSRF for remote MCP before connecting + add transport hygiene (provenance, untrusted descriptions)
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (SEC-D)"
scope: mcp-transport-safety
tags:
  - security
  - mcp
  - ssrf
---

# Remote-MCP SSRF blocking guard + transport hygiene

## Problem

Remote (SSE/HTTP) MCP servers are connected with **no SSRF guard**: `McpTester` hands vault-supplied URLs
directly to `new URL(...)` and the SDK transport with a custom Node fetch. Pressing **Test** on a
vault-supplied URL server can make the user's machine contact `169.254.169.254` (cloud metadata),
localhost, or other private services. There are also no provenance/risk labels, no plaintext-`http://`
warning, and tool descriptions are treated as fully trusted.

## Evidence

- `src/core/mcp/McpTester.ts:50-113` (raw `http`/`https` fetch, no host allow/deny), `:253` (`new URL`, no scheme/host check).
- MCP UI files: no warning/provenance/risk surfaces.

## Proposed change (block, don't just warn)

A warning a malicious vault can pre-acknowledge is not a control. **Before opening the socket** in
`McpTester`/the SDK transport:

- Resolve the target host and **deny** link-local (`169.254.0.0/16`, incl. metadata `169.254.169.254`),
  loopback, RFC1918/IPv6-ULA private ranges, and internal-only hosts.
- **Pin the connection to the vetted IP** — a preflight resolve + separate connect is *still*
  DNS-rebinding-vulnerable (TOCTOU): Node/the MCP SDK's `http.request` performs its **own** lookup when it
  opens the socket, so a hostname can pass the guard with a public answer and then rebind to a private
  address for the real connection. Enforce the vetted IP via a custom `lookup` on the agent/transport (or
  connect directly to the checked IP while preserving `Host`/SNI), so the IP that was checked is the IP that
  receives the socket.
- This deny is mandatory for vault-provenance servers.

Then layer UX on top: non-loopback `http://` warning, destination host + provenance (vault vs user-added),
untrusted-tool-description framing.

## Acceptance criteria

- A Test against a link-local/loopback/private host is **refused before any socket opens** (with a clear message).
- Provenance + destination host shown in the enable/test UI; tool descriptions rendered as untrusted.
- Unit tests cover the deny ranges incl. a DNS-rebinding (hostname→private IP) case, asserting the socket
  connects to the **vetted** IP (not a re-resolved one).
- **Not done while the Test path can still reach private services.**
