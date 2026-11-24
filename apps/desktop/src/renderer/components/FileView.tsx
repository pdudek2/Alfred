import { useEffect, useRef, useState } from "react";
import { PDF_PATH } from "../../shared/workspace-ipc";
import { getDesktopWorkspaceApi } from "../desktop-api";
import { beforeAfterPartner, pixelDiff } from "../file-compare";
import { fileName, type PanelFile } from "../page-panel-state";

type CompareMode = "slider" | "side" | "diff";
type Loaded = { key: string; url: string | null };

const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
// The Failed colour, which marks what changed.
const CHANGED_MARK: [number, number, number] = [242, 139, 130];

/** A blob URL of the file's bytes, typed by its extension and never by its content; revoked when the file changes. */
function useFileUrl(file: PanelFile | null): string | null | undefined {
  const key = file ? `${file.cwd}\n${file.path}` : "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!file) return;
    let current = true;
    let url: string | null = null;
    const type = TYPES[file.path.split(".").at(-1)!.toLowerCase()];
    void getDesktopWorkspaceApi()?.readFile({ path: file.path, cwd: file.cwd })
      .catch(() => ({ ok: false as const }))
      .then((result) => {
        if (!current) return;
        url = result.ok && type ? URL.createObjectURL(new Blob([result.bytes], { type })) : null;
        setLoaded({ key, url });
      });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the file
  }, [key]);
  if (!file) return null;
  return loaded?.key === key ? loaded.url : undefined;
}

/** An image or PDF a terminal linked to, beside the terminal. Images can be compared with another in their folder. */
export function FileView({ file }: { file: PanelFile }) {
  const url = useFileUrl(file);
  const name = fileName(file.path);
  if (url === undefined) return null;
  if (url === null) return <p className="page-panel-missing" role="status"><strong>{name}</strong> This file is no longer there</p>;
  // The viewer is Chromium's own: pages, thumbnails and zoom.
  if (PDF_PATH.test(file.path)) return <iframe className="file-view-pdf" title={name} src={url} />;
  return <ImageView key={`${file.cwd}\n${file.path}`} file={file} url={url} />;
}

function ImageView({ file, url }: { file: PanelFile; url: string }) {
  const [siblings, setSiblings] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const [mode, setMode] = useState<CompareMode>("slider");
  const [actualSize, setActualSize] = useState(false);
  const name = fileName(file.path);

  useEffect(() => {
    let current = true;
    void getDesktopWorkspaceApi()?.imageSiblings({ path: file.path, cwd: file.cwd })
      .catch(() => ({ ok: false as const }))
      .then((result) => {
        if (current && result.ok) setSiblings(result.images);
      });
    return () => {
      current = false;
    };
  }, [file.cwd, file.path]);

  const self = siblings.find((path) => fileName(path) === name) ?? null;
  const others = siblings.filter((path) => path !== self);
  const pair = self ? beforeAfterPartner(self, siblings) : null;
  const partner = pair ? (pair.before === self ? pair.after : pair.before) : null;
  const chosen = other ?? partner ?? others[0] ?? null;
  // A before/after pair keeps its order; any other image counts as before, this one as after.
  const ordered = chosen === null ? null : pair && chosen === partner ? pair : { before: chosen, after: self ?? file.path };

  return (
    <div className="file-view">
      <div className="file-view-bar">
        <div className="file-view-segmented" role="group" aria-label="Image view">
          <button type="button" aria-pressed={!comparing} onClick={() => setComparing(false)}>Image</button>
          <button type="button" aria-pressed={comparing} disabled={others.length === 0} onClick={() => setComparing(true)}>Compare</button>
        </div>
        {comparing && chosen && (
          <>
            <label className="file-view-select">
              <span>with</span>
              <select aria-label="Compare with" value={chosen} onChange={(event) => setOther(event.target.value)}>
                {others.map((path) => <option key={path} value={path}>{fileName(path)}</option>)}
              </select>
            </label>
            <div className="file-view-segmented" role="group" aria-label="Compare mode">
              {(["slider", "side", "diff"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
                  {value === "slider" ? "Slider" : value === "side" ? "Side by side" : "Diff"}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {comparing && ordered
        ? <Compare before={{ path: ordered.before, cwd: file.cwd }} after={{ path: ordered.after, cwd: file.cwd }} mode={mode} />
        : (
          <button
            type="button"
            className={actualSize ? "file-view-image actual" : "file-view-image"}
            aria-label={actualSize ? `${name}, actual size; click to fit` : `${name}, fitted; click for actual size`}
            onClick={() => setActualSize((value) => !value)}
          >
            <img src={url} alt="" />
          </button>
        )}
    </div>
  );
}

function Compare({ before, after, mode }: { before: PanelFile; after: PanelFile; mode: CompareMode }) {
  const beforeUrl = useFileUrl(before);
  const afterUrl = useFileUrl(after);
  const [divider, setDivider] = useState(50);
  if (!beforeUrl || !afterUrl) return null;
  const labels = (
    <>
      <span className="file-view-tag before">before · {fileName(before.path)}</span>
      <span className="file-view-tag after">after · {fileName(after.path)}</span>
    </>
  );
  if (mode === "side") {
    return (
      <div className="file-view-side">
        <figure><img src={beforeUrl} alt="" /><figcaption>before · {fileName(before.path)}</figcaption></figure>
        <figure><img src={afterUrl} alt="" /><figcaption>after · {fileName(after.path)}</figcaption></figure>
      </div>
    );
  }
  if (mode === "diff") return <Diff beforeUrl={beforeUrl} afterUrl={afterUrl} />;
  return (
    <div className="file-view-slider">
      <div className="file-view-stack">
        <img src={afterUrl} alt="" />
        <img src={beforeUrl} alt="" style={{ clipPath: `inset(0 ${100 - divider}% 0 0)` }} />
        <span className="file-view-divider" style={{ left: `${divider}%` }} aria-hidden="true" />
        {labels}
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={divider}
        aria-label="Before and after divider"
        onChange={(event) => setDivider(Number(event.target.value))}
      />
    </div>
  );
}

function Diff({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [result, setResult] = useState<{ changed: number; total: number; sizes: string | null } | null>(null);
  useEffect(() => {
    let current = true;
    const pixels = async (url: string) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    void Promise.all([pixels(beforeUrl), pixels(afterUrl)]).then(([before, after]) => {
      const canvas = canvasRef.current;
      if (!current || !canvas) return;
      const diff = pixelDiff(before, after, CHANGED_MARK);
      canvas.width = diff.image.width;
      canvas.height = diff.image.height;
      canvas.getContext("2d")?.putImageData(diff.image, 0, 0);
      const sizes = before.width === after.width && before.height === after.height
        ? null : `Sizes differ: ${before.width} × ${before.height} and ${after.width} × ${after.height}, compared from the top left.`;
      setResult({ changed: diff.changed, total: diff.total, sizes });
    }, () => current && setResult(null));
    return () => {
      current = false;
    };
  }, [afterUrl, beforeUrl]);
  return (
    <div className="file-view-diff">
      <p role="status">
        {result === null ? "Comparing…" : result.changed === 0
          ? "The images are identical."
          : `${formatShare(result.changed / result.total)} of pixels differ, shown in red.`}
        {result?.sizes ? ` ${result.sizes}` : ""}
      </p>
      <canvas ref={canvasRef} aria-label="Pixels that differ" role="img" />
    </div>
  );
}

function formatShare(share: number): string {
  return share < 0.001 ? "Under 0.1%" : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}
