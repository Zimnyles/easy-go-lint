import {
  GolangciIssue,
  GolangciTextEdit
} from './model';

export function applySuggestedFixes(
  source: string,
  issues: GolangciIssue[]
): { text: string; fixed: number } {
  const edits = new Map<string, GolangciTextEdit>();
  for (const issue of issues) {
    for (const suggestion of issue.SuggestedFixes ?? []) {
      for (const edit of suggestion.TextEdits ?? []) {
        const newText = edit.NewText ?? '';
        edits.set(`${edit.Pos}:${edit.End}:${newText}`, {
          ...edit,
          NewText: newText
        });
      }
    }
  }
  const sorted = Array.from(edits.values()).sort((left, right) =>
    right.Pos - left.Pos || right.End - left.End
  );
  let bytes = Buffer.from(source, 'utf8');
  let fixed = 0;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (
      edit.Pos < 0 ||
      edit.End < edit.Pos ||
      edit.End > bytes.length ||
      edit.End > lastStart
    ) {
      continue;
    }
    const replacement = Buffer.from(edit.NewText ?? '', 'base64');
    if (edit.Pos === edit.End && replacement.length === 0) {
      continue;
    }
    bytes = Buffer.concat([
      bytes.subarray(0, edit.Pos),
      replacement,
      bytes.subarray(edit.End)
    ]);
    lastStart = edit.Pos;
    fixed += 1;
  }
  return { text: bytes.toString('utf8'), fixed };
}
