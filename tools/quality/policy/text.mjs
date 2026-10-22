export function addTextFindings(source, add) {
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (/[\t ]+$/.test(line))
      add(
        index + 1,
        'ERROR',
        'trailing-whitespace',
        'Trailing whitespace is present.',
        'Remove trailing spaces or tabs without changing source semantics.',
      );
    if (/^(?:<{7}(?:\s|$)|={7}$|>{7}(?:\s|$)|\|{7}(?:\s|$))/.test(line))
      add(
        index + 1,
        'ERROR',
        'conflict-marker',
        'An unresolved merge-conflict marker is present.',
        'Resolve the conflict and test the resulting source.',
      );
  }
}

export function checkComments(comments, fixture, add) {
  for (const comment of comments) {
    if (!fixture && /\b(?:TODO|FIXME|HACK)\b/i.test(comment.value))
      add(
        comment.loc.start.line,
        'ERROR',
        'unfinished-comment',
        'A code comment marks unfinished implementation.',
        'Complete the implementation or move the explicitly deferred requirement to a tracked issue.',
      );
    if (
      /\b(?:eslint(?:-disable|-enable|-env)?|jshint|jslint)\b|@ts-(?:ignore|nocheck)\b|istanbul\s+ignore|c8\s+ignore/i.test(
        comment.value,
      )
    )
      add(
        comment.loc.start.line,
        'ERROR',
        'inline-suppression',
        'A source comment can disable static or coverage checks.',
        'Remove the inline suppression; document a necessary, narrowly scoped exception in the reviewed gate configuration.',
      );
  }
}
