# EE Provider Bundle lifecycle v1

Date: 2026-11-20. Authority: ADR-0024. Phase: D4A COMPLETE / D4B NOT STARTED. Local developer verification only; not independent acceptance or production qualification.

## Contract Boundary

C61 remains registration, C62 remains a short-lived process-local health observation (HEALTHY is its existing spelling), C63 remains the unique request-time authority route, C65 remains discovery/availability, never authorization. New C66 `pc.provider-bundle/1` describes the lifecycle boundary because the existing strict schemas cannot express a bundle version and generation. C66 READY maps to C62 HEALTHY; existing contracts are not silently redefined. C65 references the bundle generation and registration revision through evidence_refs and retains its catalog_revision and stable reason_codes.

Minimum descriptor: provider_id, bundle_version, registration_revision, compatibility_status, catalog_revision, configuration_digest, bundle_generation, bundle_state, reason_codes, observed_at, expires_at. A generation includes a fresh process epoch, so API restart cannot make an old Connector current. The configuration digest covers only nonsecret configuration: sanitized endpoint identity, tenant and configuration flags, never URL userinfo/query/fragment, tokens or shared-secret bytes. Credentials are private inputs, never descriptor/diagnostic values. Every reload creates a new generation even if only a secret changed.

## Lifecycle And Fault Matrix

States: UNCONFIGURED, STARTING, READY, DEGRADED, UNAVAILABLE, DISABLED. PC Core is unaffected by every EE failure below. D4A has no independently executable degraded port: DEGRADED permits diagnostics only, all five EE ports fail closed. No health/availability observation creates Authorization Allow.

| Failure/event | State / stable category | Automatic probe | Human intervention | Retain readonly metadata | Execute EE |
| --- | --- | --- | --- | --- | --- |
| Entirely absent | UNCONFIGURED / UNCONFIGURED | No | Configure to enable | Previous descriptors only | No |
| Partial/invalid configuration | UNAVAILABLE / CONFIGURATION | No | Fix configuration, explicit retry | Yes | No |
| Compatibility mismatch | UNAVAILABLE / COMPATIBILITY | No | Supported adapter/configuration, explicit retry | Yes | No |
| Adapter authentication failure | UNAVAILABLE / AUTHENTICATION | No | Fix credentials, explicit retry | Yes | No |
| Network/5xx | UNAVAILABLE / TRANSPORT | Bounded explicit probe, backoff, single-flight | If persistent | Yes | No |
| Timeout | UNAVAILABLE / TIMEOUT | Same bounded probe policy | If persistent | Yes | No |
| Invalid JSON/protocol/contract | UNAVAILABLE / PROTOCOL | No | Fix contract, explicit retry | Yes | No |
| Catalog/configuration revision change | STARTING, then READY or failure | Only explicit reload | Review failure if any | Previous descriptor only during build | Only after whole candidate published |
| EE business DENY | READY unchanged | No recovery needed | Business owner if denial disputed | Current metadata | Denied request never executes |
| Authority/revocation signal | DISABLED / AUTHORITY_CHANGED | No | Fresh authorization and explicit reload | Yes | No |
| Health expired | UNAVAILABLE / HEALTH_EXPIRED | Bounded reload | If persistent | Yes | No |

Business calls cannot recover an unavailable bundle. Startup and the existing retry endpoint may run lifecycle probes; no background timer or administrative console is introduced. Manual retry does not bypass the bounded transport backoff, compatibility checks, current authentication or request-time authorization. Unknown assembly failures are protocol failures, not generic HTTP500 or optimistic readiness.

## Atomic Publication And Safety

One lifecycle owner holds Identity, Authorization, Directory, Capability and Projection plus Catalog, Profiles and Connector. Configuration/compatibility/discovery/immutable release publication/Connector registration/Workbench construction occur in a nonexecutable candidate. Publication is a synchronous single-reference swap after complete validation. Reload immediately closes the previous executable generation; failed candidates never replace it. Historical descriptor/tool descriptions may remain for diagnosis without executable Port/Connector/credential access.

Concurrent reloads are single-flight: callers join the same complete candidate, and a subsequent reload is required to apply configuration arriving during the flight. Per-generation guards reject retained references and late results. Connector registration keys include the process epoch/generation, avoiding startup resurrection of old Binding/Lease identities. Gateway credential issue, dispatch and reconciliation require the current generation's Connector. Already-dispatched unknown writes are not replayed; D4A adds no compensation/distributed recovery.

An immutable per-generation Workbench is selected per public method; its asynchronous work keeps the same Catalog/Profile/Connector references. A persistent PC-only Workbench remains available while EE is starting/failed. No Object.assign mutation of live Workbench options is allowed. Staged immutable Tool/Profile/Connector records may remain orphaned after failure; they are not active capabilities and have no current executable Connector. No repository cleanup or schema change is required.

Whole project-Workbench results are fenced after asynchronous completion as well as at the individual ports. Personal create/prepare/run/conversation/cancel/projection calls always select the persistent Core Workbench, preserving its in-flight turn/admission state across EE reload. Router attempts from an older registration update a detached Health record; a late success/failure cannot poison the newly published generation. Runtime Tool callbacks still verify the connector-specific Principal Envelope audience, so an older generation's context cannot become a new generation's executable binding.

EE-connected identity still performs EE session validation per request; a provider outage does not silently turn an EE session into a local session. The local PC identity and PC-only policy/admission remain independent. An EE business DENY is not an aggregate revocation signal: it remains the current request's authorization result. Only an explicit authority-change/revocation error disables the Bundle. Revocation fan-out is deferred to D4B.

The D3 Authority Router and PC Policy intersection remain unchanged. The registered authorization facade obtains only the current bundle port. PC-only routes do not touch any EE port, including while reloading. `approval.decide` continues to deny without a trusted Operation Authority Resolver. No EE permission copy or offline authorization cache is introduced.

## Scope

Only single-process aggregate lifecycle and local developer verification. D4-2 port-level health/cross-instance coordination, D4-3 Operation Resolver, D4-4 revocation fan-out, D4-5 administrative operation/UI and D4-6 independent fault acceptance remain outside D4A. MEMORY-01B remains paused. Test fakes establish state/fencing only; real loopback HTTP smoke tests are labeled as such and do not claim a real EE business integration.

## Verification

`../product/docs/decoupling-d4a-verification.md` records the complete test matrix, actual startup smoke, browser compatibility screenshots and gate results. C66 has strict generated schema/fixtures; C61/C62/C63/C65 keep their v1 semantics. D4A does not introduce a second authority router or a new authorization source.
