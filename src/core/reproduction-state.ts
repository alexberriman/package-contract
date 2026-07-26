import type { PackageReport } from "./report.js";

const lockfiles = new WeakMap<PackageReport, string>();

export function registerReproductionLockfile(
  report: PackageReport,
  lockfile: string | null,
): void {
  if (lockfile !== null) {
    lockfiles.set(report, lockfile);
  }
}

export function reproductionLockfile(report: PackageReport): string | null {
  return lockfiles.get(report) ?? null;
}
