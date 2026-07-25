# package-contract

Test the npm package your users actually install.

`package-contract` is under active development and is not ready for use yet.
The first release will pack a library, install the tarball into clean consumer
projects, and exercise real Node.js and TypeScript resolution.

It is designed to complement
[publint](https://publint.dev/) and
[Are the Types Wrong](https://arethetypeswrong.github.io/), reporting only
reproduced failures those tools do not already explain.

## Status

The feasibility gate passed with six distinct runtime or consumer-compilation
failures that were not explained by the incumbent tools. The public API and CLI
are now being built against that evidence.

## Security

Package testing executes trusted package code. Read
[SECURITY.md](./SECURITY.md) before integrating it into CI.

## License

[MIT](./LICENSE) © 2026 Alex Berriman
