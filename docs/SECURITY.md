# Security controls

## P3 hardening (2026-08-03)

The scorecard API is an availability envelope: clients render a scorecard only
when `available: true` and the nested scorecard passes the same complete schema
validator used for Redis cache reads (including every benchmark field and each
category type). All third-party scorecard links are treated as untrusted data
and are restricted to credential-free `https:` URLs before rendering.

Every upstream retry waits with the caller's `AbortSignal`. Consequently an
upstream `Retry-After` cannot extend work beyond the source deadline enforced
by the refresh service; expiry fails the source closed.

The merger rejects malformed model names one record at a time. It builds the
complete stable-ID alias table before merging primary sources, so an
unambiguous name-only primary row joins its stable model regardless of source
order. A name collision across stable IDs is never joined; the name-only
primary record remains separate and secondary enrichment is dropped.

Credentialed PR-model review is deliberately tombstoned: there is no such
workflow in `.github/workflows`, and the regression test rejects restoring one
or `pull_request_target`. Do not re-enable it until its separate tool boundary,
credential scope, untrusted-PR isolation, and immutable action revisions have
been reviewed and tested.
