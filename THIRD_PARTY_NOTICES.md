# Third-party notices

## golangci-lint

Easy Go Lint includes `golangci-lint go1.27-pr6642-c4815f06` for
`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-armhf`, `linux-x64`,
`win32-arm64`, and `win32-x64`, built from the official Go 1.27 compatibility PR with
`go1.27rc2` and `CGO_ENABLED=0`.

- Project: https://github.com/golangci/golangci-lint
- Pull request: https://github.com/golangci/golangci-lint/pull/6642
- Source commit:
  https://github.com/golangci/golangci-lint/tree/c4815f06852754c8daa088b684d71fd88589b175
- License: GPL-3.0, copied to
  `third_party/golangci-lint/LICENSE`.
- Bundled binary SHA-256:
  - `darwin-arm64`: `79412adbd02585c2ca6371d1152e2a5e11d907222403361008a523b500b65051`
  - `darwin-x64`: `8aad8c6ac38902372041651e79b59d5c439921583eb72f9294e48817a45bd529`
  - `linux-arm64`: `5a6981e12fde5dedc57db3d4fc3d97c543a39050e6f7f493a752cd5450570751`
  - `linux-armhf`: `7e74ae25b3f07cfe8037952c737d20cc045bf3752d11b302cff14696e93d01bd`
  - `linux-x64`: `539b4c8ae61a8417b67741e8c67037f44a2b45dfe19c42e1cbfac653bd54bc79`
  - `win32-arm64`: `e3c4be9262f3209cdf63ab087cf1cb78818c09404464e1c85be0106056f12a57`
  - `win32-x64`: `9a6547b26f67b12c5e617ccecbd2eda2f6d3318adff83b7bc38658a50dbccd5c`
- Build command:
  `CGO_ENABLED=0 GOOS=<os> GOARCH=<arch> GOTOOLCHAIN=go1.27rc2
  go build -trimpath -ldflags "-s -w
  -X main.version=go1.27-pr6642-c4815f06
  -X main.commit=c4815f06852754c8daa088b684d71fd88589b175" ./cmd/golangci-lint`

## yaml

Easy Go Lint uses the `yaml` npm package, version 2.8.3.

- Project: https://github.com/eemeli/yaml
- License: ISC, copied to `node_modules/yaml/LICENSE`.
