# Easy Go Lint

[English](#easy-go-lint) · [Русский](#easy-go-lint-на-русском)

Easy Go Lint brings visual `golangci-lint` v2 profiles, file and project
checks, and Quick Fix actions to Visual Studio Code and Cursor.

The extension ships with a compatible `golangci-lint` binary for every
supported desktop platform. Install the extension, select a profile, and lint
Go code without configuring a separate linter executable.

## Installation

Open the Extensions view in Visual Studio Code or Cursor, search for
**Easy Go Lint**, and select **Install**.

To install a development build:

1. Open the Command Palette.
2. Run **Extensions: Install from VSIX...**.
3. Select the VSIX that matches your operating system and architecture.

Go must be installed on the machine where the extension host runs. A separate
installation of `golangci-lint` is not required.

## Getting started

1. Select **Easy Go Lint** in the Activity Bar.
2. Create a visual profile or import an existing `*.golangci.yml` file.
3. Select **Make active** on the profile.
4. Open a Go file.
5. Use **Lint** or **Quick Fix** in the editor title bar.

To check every package in the current workspace, select **Lint Project** in
the Easy Go Lint view or run **Go Linter: Lint Project** from the Command
Palette.

## Overview of the extension features

### Visual `golangci-lint` profiles

Create and edit `golangci-lint` v2 configurations without memorizing every
linter name. The profile editor supports:

- explicit linter and formatter selection;
- commonly used settings such as cyclomatic complexity and line length;
- a full YAML editor for advanced configuration;
- validation with `golangci-lint config verify` before saving.

Easy Go Lint uses standard YAML. Profiles can be reviewed, exported, and used
outside the extension:

```yaml
version: "2"
run:
  tests: false
linters:
  default: none
  enable:
    - errcheck
    - errorlint
    - gosec
    - govet
    - staticcheck
    - unused
  settings:
    cyclop:
      max-complexity: 20
    lll:
      line-length: 150
formatters:
  enable:
    - gci
    - gofmt
    - gofumpt
    - goimports
```

### Global and project profiles

Profiles created or imported by the user are stored globally and remain
available when switching workspaces.

If the current workspace contains `.golangci.yml` or `.golangci.yaml` in its
root, Easy Go Lint adds it as a **Project** profile. A project profile is
available only while that workspace is open and is never overwritten or
deleted by the extension.

| Profile | Availability | Managed by Easy Go Lint |
| --- | --- | --- |
| Created or imported | Every workspace | Yes |
| `.golangci.yml` from the workspace root | Current workspace only | Read-only |

### Lint the current file

Select **Lint** in the Go editor title bar to check the active file. The
extension loads the containing Go package because Go analyzers require package
context, but only issues belonging to the selected file are published.

Results can be shown in:

- the **Problems** panel and as editor diagnostics;
- **Output → Go Linter**;
- the report inside the Easy Go Lint view.

The Output and in-view reports are independent and can be enabled together or
separately.

### Lint the whole project

**Lint Project** runs:

```text
golangci-lint run ./...
```

from the root of the active workspace folder. Diagnostics are published for
all Go files reported by `golangci-lint`.

Unsaved Go documents in that workspace are saved before the project check so
the report matches the code on disk.

### Quick Fix

Select **Quick Fix** in the editor title bar to apply safe suggested fixes and
enabled formatters to the current Go file.

Quick Fix does not edit neighboring files. After applying changes, Easy Go
Lint checks the file again and publishes the remaining issues.

### Progress, cancellation, and cache status

A result card appears as soon as a check starts. Easy Go Lint also writes a
start message to **Output → Go Linter** and shows cancellable progress in the
editor.

The first run for a package and profile can take longer while Go and
`golangci-lint` caches are being populated. The extension identifies a cold
cache in both the view and Output. Subsequent checks reuse the warmed caches.

Only one lint or Quick Fix operation runs at a time. Every operation has a
configurable timeout and can be cancelled from the progress notification.

### Diagnostics and reports

Easy Go Lint reports errors, warnings, and informational findings through the
native diagnostics API. Select an issue in Problems or the report to navigate
to its source location.

Select **Reset report** to clear:

- the current result card;
- Easy Go Lint entries in Problems;
- Easy Go Lint underlines in open Go editors.

### Russian and English interface

Use the **RU / EN** switch in the Easy Go Lint view to change the interface,
progress messages, and reports. The selected language is stored globally.

## Commands

| Command | Description |
| --- | --- |
| `Go Linter: Open` | Open the Easy Go Lint dashboard |
| `Go Linter: Lint Current File` | Check the active Go file |
| `Go Linter: Lint Project` | Check all packages in the active workspace |
| `Go Linter: Fix Current File` | Apply fixes and formatters to the active Go file |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `goLinter.language` | `ru` | Interface and message language: `ru` or `en` |
| `goLinter.showResultsInOutput` | `true` | Write the final report to Output |
| `goLinter.showResultsInDashboard` | `false` | Show the final report in the Easy Go Lint view |
| `goLinter.timeoutSeconds` | `300` | Maximum duration of one linter process |
| `goLinter.goToolchain` | `auto` | Value passed as `GOTOOLCHAIN` |
| `goLinter.golangciLintPath` | empty | Optional path overriding the bundled binary |

## Requirements and supported platforms

- A local or remote workspace with a filesystem.
- A trusted workspace.
- Go installed and available to the extension host.

Platform-specific packages are built for:

- macOS on Apple Silicon and Intel;
- Linux on ARM64, ARMv7, and x64;
- Alpine Linux on ARM64 and x64;
- Windows on ARM64 and x64.

Easy Go Lint currently includes `golangci-lint`
`go1.27-pr6642-c4815f06`, built with Go 1.27 RC from the pinned upstream
compatibility work. The bundled binary is selected automatically.

## How linting works

File checks run `golangci-lint` against the containing package and filter the
JSON result to the active file. Project checks run against `./...`. Quick Fix
applies suggested replacements and then runs enabled formatters through
`golangci-lint fmt --stdin`.

Large JSON reports are written to temporary files instead of being accumulated
in the extension process. The Go build cache is shared with the installed Go
toolchain, while the `golangci-lint` cache is isolated inside the extension.

If Go type checking cannot load the package or one of its dependencies, Easy
Go Lint reports the blocking error instead of showing an incorrect
“0 problems” result.

For compatibility with `golangci-lint` v2, imported profiles using the
deprecated `wsl` linter are converted to `wsl_v5` only in the temporary
configuration used for execution. The original profile is not modified.

## Isolation from terminal commands

Easy Go Lint does not change `PATH`, shell configuration, `go.mod`, project
configuration, or a user-installed `golangci-lint`.

The bundled executable is started as a child process only after an explicit
Lint or Quick Fix command. Running `golangci-lint` directly in a terminal
continues to use the user's normal environment and installation.

## Troubleshooting

### The first check is slow

The first run needs to load the Go package graph and populate caches. Wait for
the cold-cache run to finish; subsequent checks of the same package and
profile should be faster.

### No output is visible

Enable `goLinter.showResultsInOutput`, open the Output panel, and select
**Go Linter** from the channel list.

### A project profile disappeared

Profiles discovered from `.golangci.yml` or `.golangci.yaml` belong to the
current workspace. Created and imported profiles are global and remain
available in every project.

### A command is not found after updating

Run **Developer: Reload Window** once so the editor starts the newly installed
extension version.

## Telemetry

Easy Go Lint does not collect or transmit telemetry.

## Contributing and development

```sh
npm install
npm test
npm run package
npm run package:platforms
```

`npm run package` creates a universal VSIX for manual distribution.
`npm run package:platforms` creates the smaller platform-specific packages
used by extension marketplaces.

To rebuild the bundled linter from the pinned source:

```sh
GOLANGCI_LINT_SOURCE=/path/to/golangci-lint npm run build:golangci
```

CI runs native integration tests on macOS, Linux, and Windows, verifies the
SHA-256 checksum of every bundled binary, and performs a runtime smoke test on
every generated VSIX.

## License

The Easy Go Lint extension is licensed under the MIT License. See `LICENSE`.

The bundled `golangci-lint` executable is licensed under GPL-3.0. Exact source
revision, build details, third-party licenses, and binary checksums are listed
in `THIRD_PARTY_NOTICES.md`.

---

# Easy Go Lint на русском

Easy Go Lint добавляет в Visual Studio Code и Cursor визуальные профили
`golangci-lint` v2, проверку текущего файла и всего проекта, а также Quick Fix.

Расширение поставляется с готовым бинарником `golangci-lint` для каждой
поддерживаемой desktop-платформы. Пользователю не нужно отдельно устанавливать
или настраивать линтер.

## Установка

Откройте Extensions в Visual Studio Code или Cursor, найдите
**Easy Go Lint** и нажмите **Install**.

Для установки тестовой сборки выполните
**Extensions: Install from VSIX...** и выберите пакет для своей платформы.

На компьютере должен быть установлен Go. Отдельная установка
`golangci-lint` не требуется.

## Быстрый старт

1. Откройте **Easy Go Lint** через Activity Bar.
2. Создайте визуальный профиль или импортируйте `*.golangci.yml`.
3. Нажмите **Сделать активным**.
4. Откройте Go-файл.
5. Используйте **Lint** или **Quick Fix** рядом с кнопкой Split Editor.

Чтобы проверить все пакеты workspace, нажмите **Проверить весь проект** в
окне расширения или запустите команду **Go Linter: Lint Project**.

## Возможности

### Визуальные профили

В редакторе профиля можно выбирать линтеры и форматтеры, менять основные
параметры и редактировать YAML вручную. Перед сохранением конфигурация
проверяется через `golangci-lint config verify`.

Созданные и импортированные профили хранятся глобально и доступны во всех
проектах.

Если в корне workspace есть `.golangci.yml` или `.golangci.yaml`, расширение
автоматически добавляет его с пометкой **Проект**. Такой профиль доступен
только в текущем workspace и не изменяется расширением.

### Проверка текущего файла

Кнопка **Lint** проверяет активный Go-файл. `golangci-lint` загружает весь
пакет как обязательный контекст для Go-анализаторов, но расширение показывает
только проблемы выбранного файла.

Результаты публикуются в Problems и могут одновременно выводиться в:

- **Output → Go Linter**;
- отчёт внутри Easy Go Lint.

### Проверка проекта

Команда **Lint Project** запускает `golangci-lint run ./...` из корня
активной папки workspace и публикует найденные проблемы для всех Go-файлов.

### Quick Fix

Quick Fix применяет предложенные `golangci-lint` исправления и включённые
форматтеры только к текущему файлу. После сохранения расширение повторно
проверяет файл и показывает оставшиеся проблемы.

### Прогресс и кэш

Сразу после запуска появляется карточка со статусом выполнения, запись в
Output и отменяемый индикатор прогресса.

Первый запуск для новой пары «пакет + профиль» может выполняться дольше из-за
прогрева Go-кэша и кэша `golangci-lint`. Расширение сообщает о холодном кэше;
следующие проверки используют уже подготовленные данные.

Одновременно выполняется только одна операция. Линт можно отменить через
индикатор прогресса, а максимальная длительность задаётся в настройках.

### Сброс отчёта

Кнопка **Сбросить отчёт** очищает карточку результата, записи Easy Go Lint в
Problems и подчёркивания в открытых Go-файлах.

### Язык интерфейса

Переключатель **RU / EN** меняет язык интерфейса, прогресса и отчётов.
Выбранный язык сохраняется глобально.

## Команды

| Команда | Назначение |
| --- | --- |
| `Go Linter: Open` | Открыть Easy Go Lint |
| `Go Linter: Lint Current File` | Проверить активный Go-файл |
| `Go Linter: Lint Project` | Проверить все пакеты workspace |
| `Go Linter: Fix Current File` | Исправить и отформатировать активный Go-файл |

## Настройки

| Настройка | По умолчанию | Назначение |
| --- | --- | --- |
| `goLinter.language` | `ru` | Язык интерфейса: `ru` или `en` |
| `goLinter.showResultsInOutput` | `true` | Выводить итоговый отчёт в Output |
| `goLinter.showResultsInDashboard` | `false` | Показывать отчёт внутри Easy Go Lint |
| `goLinter.timeoutSeconds` | `300` | Максимальная длительность одного запуска |
| `goLinter.goToolchain` | `auto` | Значение переменной `GOTOOLCHAIN` |
| `goLinter.golangciLintPath` | пусто | Необязательный путь вместо встроенного бинарника |

## Поддерживаемые платформы

- macOS Apple Silicon и Intel;
- Linux ARM64, ARMv7 и x64;
- Alpine Linux ARM64 и x64;
- Windows ARM64 и x64.

Go должен быть установлен там, где работает Extension Host. Workspace должен
быть доверенным и иметь локальную или удалённую файловую систему.

## Независимость от терминала

Расширение не меняет `PATH`, настройки shell, `go.mod`, конфигурацию проекта
или пользовательскую установку `golangci-lint`.

Встроенный бинарник запускается только после явной команды Lint или Quick Fix.
Обычные команды `golangci-lint` в терминале продолжают работать независимо от
расширения.

## Если что-то не работает

- Первый запуск долгий — дождитесь прогрева кэша; следующие проверки будут
  быстрее.
- Output пуст — включите `goLinter.showResultsInOutput` и выберите канал
  **Go Linter**.
- Проектный профиль пропал — он связан с текущим workspace; пользовательские
  профили остаются глобальными.
- После обновления команда не найдена — один раз выполните
  **Developer: Reload Window**.

## Телеметрия

Easy Go Lint не собирает и не отправляет телеметрию.

## Разработка

```sh
npm install
npm test
npm run package
npm run package:platforms
```

CI проверяет нативные бинарники на macOS, Linux и Windows, сверяет SHA-256 и
запускает runtime smoke-test для каждого VSIX.

## Лицензия

Код Easy Go Lint распространяется по лицензии MIT. Текст находится в
`LICENSE`.

Встроенный `golangci-lint` распространяется по GPL-3.0. Точная ревизия
исходного кода, команды сборки, лицензии зависимостей и SHA-256 находятся в
`THIRD_PARTY_NOTICES.md`.
