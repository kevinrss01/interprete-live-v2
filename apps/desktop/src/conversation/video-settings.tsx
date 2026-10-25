import { useEffect, useState } from "react";
import { Camera, Captions, RefreshCw, Video } from "lucide-react";
import { CallSelect } from "../components/call-select";
import {
  TEST_PATTERN,
  VIRTUAL_CAMERA_NAME,
  relayPreview,
  type CameraDevices,
  type VideoState,
} from "../lib/video-captions";

// The composed video, refreshed while someone looks at it.
function useVideoPreview(active: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let current: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const jpeg = await relayPreview();
        if (stopped) return;
        if (jpeg.byteLength) {
          const next = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
          setUrl(next);
          if (current) URL.revokeObjectURL(current);
          current = next;
        }
      } catch {}
      if (!stopped) timer = setTimeout(() => void tick(), 125);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (current) URL.revokeObjectURL(current);
      setUrl(null);
    };
  }, [active]);
  return url;
}

// Camera choice, virtual camera setup, and a preview of what the others see.
export function VideoSettings({
  native,
  devices,
  camera,
  video,
  busy,
  testing,
  onCamera,
  onAllow,
  onRefresh,
  onPreview,
  onTest,
}: {
  native: boolean;
  devices: CameraDevices | null;
  camera: string;
  video: VideoState;
  // A translation session is running; the sample captions would replace its words.
  busy: boolean;
  testing: boolean;
  onCamera: (id: string) => void;
  onAllow: () => void;
  onRefresh: () => void;
  onPreview: () => void;
  onTest: () => void;
}) {
  const [open, setOpen] = useState(false);
  const running = video.sessionId !== null;
  const preview = useVideoPreview(open && running && !video.starting);
  const virtual = devices?.virtualCamera;
  const blocked = devices?.authorization === "denied" || devices?.authorization === "restricted";
  const options = [
    ...(devices?.cameras ?? []).map((device) => ({ value: device.id, label: device.name })),
    ...(import.meta.env.DEV ? [{ value: TEST_PATTERN, label: "Test pattern · development" }] : []),
  ];
  return (
    <details
      className="call-advanced call-video"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Camera and video preview</summary>
      {!native ? (
        <p className="note">Captions on your video need the macOS app.</p>
      ) : (
        <>
          <div className="call-devices">
            <CallSelect
              id="call-camera"
              label="Camera"
              value={camera}
              placeholder={devices && !options.length ? "No camera found" : "Choose a camera…"}
              disabled={running}
              options={options}
              onChange={onCamera}
            />
          </div>
          {blocked && camera !== TEST_PATTERN && (
            <p className="call-error">
              Camera access is off. Allow Interprète in System Settings › Privacy &amp;
              Security › Camera.
            </p>
          )}
          {virtual && !virtual.ready && (
            <div className="call-setup">
              {virtual.installed ? (
                <p>
                  Open OBS once and click <strong>Start Virtual Camera</strong>, then
                  allow its extension in System Settings › General › Login Items &amp;
                  Extensions.
                </p>
              ) : (
                <>
                  <p>Install OBS Studio, which provides the virtual camera:</p>
                  <code>brew install --cask obs</code>
                  <p className="note">
                    Then open OBS once, click Start Virtual Camera, and allow its
                    extension when macOS asks.
                  </p>
                </>
              )}
              <p className="note">OBS can stay closed afterwards.</p>
            </div>
          )}
          {running && (
            <figure className="call-video-preview">
              {preview ? (
                <img src={preview} alt="Your video with captions, as the others see it" />
              ) : (
                <figcaption>{video.starting ? "Opening the camera…" : "Loading the preview…"}</figcaption>
              )}
            </figure>
          )}
          <p className="note">
            In the call app, choose <strong>{VIRTUAL_CAMERA_NAME}</strong> as the
            camera. Your own preview there may be mirrored; the others read the
            captions normally.
          </p>
          <div className="call-device-actions">
            {!running && (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={!camera || (virtual && !virtual.ready)}
                onClick={onPreview}
              >
                <Video size={15} aria-hidden="true" />
                Preview video
              </button>
            )}
            <button
              type="button"
              className="btn btn-quiet"
              disabled={!running || video.starting || testing || busy}
              onClick={onTest}
            >
              <Captions size={15} aria-hidden="true" />
              Test the captions
            </button>
            {devices?.authorization === "notDetermined" && camera !== TEST_PATTERN && (
              <button type="button" className="btn btn-quiet" onClick={onAllow}>
                <Camera size={15} aria-hidden="true" />
                Allow camera access
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={onRefresh}>
              <RefreshCw size={14} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </>
      )}
    </details>
  );
}
