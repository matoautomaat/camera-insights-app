import { isLoggedIn } from "@/lib/auth";
import { liveInterval, NEXT_HEADER } from "@/lib/camera-pace";
import { DEMO, getCamera, rememberNoFullHd } from "@/lib/data";
import { CameraBusyError, sharedSnapshot } from "@/lib/unifi";

// A photo of this moment from one camera, for whoever is logged in. Under /api so nothing caches it; never stored.

const noStore = { "Cache-Control": "no-store, private" };

/** Made up, for CI_DEMO only: a picture saying which camera and when. */
function demoPhoto(name: string) {
  const time = new Date().toLocaleTimeString("nl-BE", { timeZone: "Europe/Brussels" });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><rect x="430" y="150" width="420" height="440" rx="24" fill="#0b1018" opacity=".55"/><text x="640" y="380" font-family="system-ui,sans-serif" font-size="44" fill="#fff" text-anchor="middle">${name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text><text x="40" y="690" font-family="ui-monospace,monospace" font-size="28" fill="#fff">DEMO ${time}</text></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", [NEXT_HEADER]: "3000", ...noStore } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return new Response("Not logged in", { status: 401, headers: noStore });
  const { id } = await params;
  const camera = await getCamera(id);
  if (!camera) return new Response("No such camera", { status: 404, headers: noStore });
  if (DEMO) return demoPhoto(camera.name);
  try {
    const { value: shot, shared } = await sharedSnapshot({ consoleId: camera.consoleId, cameraId: camera.cameraId, fullHd: camera.fullHd });
    if (shot.noFullHd && !shared) await rememberNoFullHd(camera.consoleId, camera.cameraId);
    return new Response(shot.image.slice(0), {
      headers: {
        "Content-Type": shot.type,
        [NEXT_HEADER]: String(liveInterval(shot.used)),
        "Server-Timing": `unifi;dur=${shot.ms};desc="${shared ? "shared" : shot.sharp ? "full HD" : "usual"}"`,
        ...noStore,
      },
    });
  } catch (error) {
    if (error instanceof CameraBusyError) {
      return new Response("UniFi is busy", { status: 429, headers: { "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)), ...noStore } });
    }
    return new Response("No photo", { status: 502, headers: noStore });
  }
}
