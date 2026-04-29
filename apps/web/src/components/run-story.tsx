import type { RunStoryVM, StoryHighlight } from "../lib/run-story";

type RunStoryProps = {
  vm: RunStoryVM;
  onHighlightClick?: (highlight: StoryHighlight) => void;
};

type StorySegment =
  | { kind: "highlight"; highlight: StoryHighlight; text: string }
  | { kind: "text"; text: string };

export function RunStory({ vm, onHighlightClick }: RunStoryProps) {
  const segments = buildStorySegments(vm);

  return (
    <p className="run-story">
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={`text-${index}`}>{segment.text}</span>;
        }

        return (
          <button
            className={`run-story-highlight run-story-highlight-${segment.highlight.kind}`}
            key={`highlight-${index}`}
            onClick={() => onHighlightClick?.(segment.highlight)}
            type="button"
          >
            {segment.text}
          </button>
        );
      })}
    </p>
  );
}

function buildStorySegments(vm: RunStoryVM): StorySegment[] {
  if (vm.highlights.length === 0) {
    return [{ kind: "text", text: vm.paragraph }];
  }

  const segments: StorySegment[] = [];
  let cursor = 0;

  for (const highlight of [...vm.highlights].sort((left, right) => left.start - right.start)) {
    if (highlight.start < cursor || highlight.end <= highlight.start) {
      continue;
    }

    if (highlight.start > cursor) {
      segments.push({ kind: "text", text: vm.paragraph.slice(cursor, highlight.start) });
    }

    segments.push({
      kind: "highlight",
      highlight,
      text: vm.paragraph.slice(highlight.start, highlight.end),
    });
    cursor = highlight.end;
  }

  if (cursor < vm.paragraph.length) {
    segments.push({ kind: "text", text: vm.paragraph.slice(cursor) });
  }

  return segments;
}
