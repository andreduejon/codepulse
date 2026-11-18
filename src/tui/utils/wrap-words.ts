/** Text cut into lines of at most `width` columns at spaces; a word longer than a line is split. */
export function wrapWords(value: string, width: number): string[] {
  if (value.length <= width) return [value];
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.flatMap(entry => {
    if (entry.length <= width) return [entry];
    const chunks: string[] = [];
    for (let offset = 0; offset < entry.length; offset += width) chunks.push(entry.slice(offset, offset + width));
    return chunks;
  });
}
