#!/usr/bin/env node

import { parseArgs } from "node:util";

const HELP = `package-contract

Test the npm package your users actually install.

Usage:
  package-contract --help
  package-contract --version

The check and compare commands are not available in this development build.
`;

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    help: { short: "h", type: "boolean" },
    version: { short: "v", type: "boolean" },
  },
  strict: true,
});

if (values.version) {
  process.stdout.write("0.0.0\n");
} else {
  process.stdout.write(HELP);
}
