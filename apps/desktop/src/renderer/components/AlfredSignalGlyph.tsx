type AlfredSignalGlyphProps = {
  className?: string;
};

export function AlfredSignalGlyph({ className }: AlfredSignalGlyphProps) {
  return (
    <svg
      className={`alfred-signal-glyph${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
    >
      <path
        d="M8 1.5c.5 3.8 2.7 6 6.5 6.5C10.7 8.5 8.5 10.7 8 14.5 7.5 10.7 5.3 8.5 1.5 8 5.3 7.5 7.5 5.3 8 1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
