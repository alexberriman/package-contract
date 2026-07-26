# Library API

`package-contract` exports three runtime functions. All inputs are validated,
all returned profiles and reports are immutable, and package checks operate on
local directories or `.tgz` files only.

## `defineConsumer`

```ts
function defineConsumer(
  profile: ConsumerProfileInput | ConsumerProfile,
): ConsumerProfile;
```

A profile selects one runtime executable, module loading mechanism, optional
TypeScript resolution mode, and one or more package subpaths.

```ts
const profile = defineConsumer({
  moduleSystem: "esm",
  runtime: {
    executable: process.execPath,
    version: process.versions.node,
  },
  subpaths: [".", "./feature"],
  typescriptResolution: "nodenext",
});
```

`moduleSystem` is `esm` or `cjs`. `typescriptResolution` is `node16`,
`nodenext`, `bundler`, or `null`; Bundler is valid only for ESM. Versions use
one to three numeric parts. Subpaths default to `["."]`, are deduplicated and
sorted, and cannot be empty. Passing an already normalized `ConsumerProfile`
is supported.

## `testPackage`

```ts
function testPackage(
  input: PackageInput,
  options?: TestPackageOptions,
): Promise<PackageReport>;
```

`PackageInput` is one of:

```ts
{ kind: "directory"; path: string }
{ kind: "tarball"; path: string }
```

Directory inputs are packed with npm first. Tarball inputs must be local `.tgz`
files. Registry URLs, Git URLs, and package specifiers are not accepted.

`TestPackageOptions` supports:

| Option | Meaning |
| --- | --- |
| `actions` | Explicit named-export, function-call, or exported-file contracts |
| `bins` | Declared package executables and arguments to run |
| `concurrency` | Bounded profile concurrency from 1 through 16 |
| `includeExplained` | Include failures causally explained by an incumbent |
| `invokingDirectory` | Project from which TypeScript is resolved |
| `npmCachePath` | Explicit cache used by synthetic npm consumers |
| `offline` | Pass npm strict offline mode |
| `profiles` | Raw or normalized consumer profiles |
| `runtimeExecutable` | Runtime used for environment detection and npm |
| `typescriptPath` | Local TypeScript package directory or `package.json` |

Omitting `profiles` selects the documented default matrix. An explicit profile
matrix tests only its requested subpaths plus subpaths named by actions.

Each result is exactly one of `pass`, `fail`, or `not-evaluated`.
`not-evaluated` includes a stable reason such as an inapplicable profile,
missing compiler, unavailable runtime, cache miss, unsafe wildcard, or resource
limit. It is never evidence of compatibility.

## `comparePackages`

```ts
function comparePackages(
  before: PackageInput,
  after: PackageInput,
  options?: ComparePackagesOptions,
): Promise<ComparisonReport>;
```

The before artifact populates a private npm cache. The after artifact installs
offline from that captured state. Diagnostics are classified by stable ID as
regressions, fixes, or unchanged.

A comparison is conclusive only when both dependency graph digests exist and
match, and both sides evaluated the same profile and subpath coverage.
`inconclusiveReason` distinguishes unavailable dependency graphs, dependency
graph drift, and evaluation coverage drift. `beforeResults` and `afterResults`
retain the underlying three-state matrix for audit.

`ComparePackagesOptions` accepts every `TestPackageOptions` field except
`npmCachePath`, which comparison owns.

## Exported types

The root entrypoint exports the input, profile, action, result, diagnostic,
report, comparison, package, and incumbent-finding types used by these three
functions. Internal subprocess, archive, compiler-adapter, reporter, and
reproduction helpers are not part of the public API.
