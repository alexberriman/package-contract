export type PackageInput =
  | {
      readonly kind: "directory";
      readonly path: string;
    }
  | {
      readonly kind: "tarball";
      readonly path: string;
    };
