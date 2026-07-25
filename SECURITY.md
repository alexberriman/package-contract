# Security policy

## Supported versions

Security fixes are provided for the latest published major version.
Before v1, fixes are provided for the latest published prerelease.
Unpublished development snapshots are not supported.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Please do
not open a public issue for a suspected vulnerability.

Include the affected version, impact, reproduction steps, and any suggested
mitigation. You should receive an acknowledgement within five business days.

## Trust boundary

package-contract is designed to pack and execute trusted local package code.
It is not a sandbox or malware scanner. Package lifecycle scripts may run while
creating a tarball, and runtime probes deliberately evaluate package code.

Run it only for code you trust, in a job without production credentials.
Consumer install scripts are disabled by default, but that does not make
packing or runtime execution safe for untrusted packages.
