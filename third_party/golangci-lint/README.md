# Bundled golangci-lint

Easy Go Lint stores native `golangci-lint` executables for seven Cursor and
VS Code desktop platform combinations:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-armhf`
- `linux-x64`
- `win32-arm64`
- `win32-x64`

Every executable is built with Go 1.27rc2 and `CGO_ENABLED=0` from the official
Go 1.27 compatibility pull request #6642 at commit
`c4815f06852754c8daa088b684d71fd88589b175`. The reported engine version is
`go1.27-pr6642-c4815f06`.

The extension selects the executable from `process.platform` and
`process.arch`. Public artifacts are packaged per platform so users download
only one executable; the universal development VSIX contains all six. The user
can override the executable with `goLinter.golangciLintPath`.

The exact binary checksums are recorded in `SHA256SUMS` and verified by
`npm run verify:binaries`. This engine is a pinned preview build until the
upstream Go 1.27 support is released.
