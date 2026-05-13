export function shortLabelForWorkspace(label: string): string {
  const words = label.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((word) => word[0]).join("") : label.slice(0, 3);
  return (letters || "W").slice(0, 3).toUpperCase();
}
