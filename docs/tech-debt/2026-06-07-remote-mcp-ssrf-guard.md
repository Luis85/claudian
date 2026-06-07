---
type: tech-debt
title: "Remote MCP connections lack an SSRF blocking guard"
date: 2026-06-07
updated: 2026-06-07
status: open
priority: "1 - high"
severity: high
scope: mcp-security
tags:
  - tech-debt
  - security
  - mcp
  - ssrf
related:
  - "[[remote-mcp-ssrf-blocking-guard]]"
  - "[[unified-in-app-mcp-control-plane]]"
---

# Remote MCP connections lack an SSRF blocking guard

## Summary

The MCP tester resolves secrets and curates stdio environments, but URL-based MCP transports still connect directly to the configured URL without a private-address denylist or DNS-rebinding protection. A vault-supplied remote MCP server can make the plugin test path contact localhost, link-local, or private network services.

## Evidence

- `src/core/mcp/McpTester.ts` builds URL transports with `new URL(config.url)` and `StreamableHTTPClientTransport` / legacy SSE transport.
- `createNodeFetch()` uses Node `http`/`https.request` against the request URL directly.
- There is no denylist for loopback, RFC1918, link-local, IPv6 ULA, or cloud metadata ranges before socket open.
- There is no pinning of the connection to a vetted resolved IP, so a preflight-only check would be DNS-rebinding vulnerable if added naively.
- The issue [[remote-mcp-ssrf-blocking-guard]] remains open and already captures the desired control.

## Why it matters

MCP servers can be vault-defined and therefore untrusted. Testing a server is an outbound network action from the user's machine. SSRF controls need to block before connecting; a warning can be pre-accepted or ignored and does not protect private infrastructure.

## Suggested remediation

1. Add a URL safety module that resolves hosts and denies loopback, link-local, RFC1918, IPv6 ULA, and metadata IPs.
2. Pin HTTP(S) connections to the vetted IP with a custom lookup/agent or equivalent transport control.
3. Show provenance and destination host in the settings UI.
4. Treat remote MCP tool descriptions as untrusted text in the UI and prompt layer.
5. Unit-test denied ranges and DNS-rebinding behavior.

## Acceptance criteria

- [ ] A Test action against `localhost`, `127.0.0.1`, `::1`, RFC1918, or `169.254.169.254` is refused before any socket opens.
- [ ] A hostname that resolves public during preflight but private at connect time cannot bypass the guard.
- [ ] UI labels the server provenance and destination host.
- [ ] Tool descriptions from remote MCP are rendered/demarcated as untrusted content.
