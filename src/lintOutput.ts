export function lintOutputArguments(
  textPath: string,
  jsonPath: string
): string[] {
  return [
    `--output.text.path=${textPath}`,
    `--output.json.path=${jsonPath}`
  ];
}
