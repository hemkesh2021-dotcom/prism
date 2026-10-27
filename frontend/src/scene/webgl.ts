/**
 * WebGL capability checks, done once before any 3D code is loaded.
 *
 * `failIfMajorPerformanceCaveat` makes the browser refuse a context when it would
 * fall back to slow software rendering, so machines without GPU acceleration get the
 * SVG lens instead of a sluggish page. Automated tests can opt in to the 3D path on
 * software renderers by setting `window.__PRISM_FORCE_WEBGL__ = true` before load.
 */
export function webglForced(): boolean {
  return (window as unknown as { __PRISM_FORCE_WEBGL__?: boolean }).__PRISM_FORCE_WEBGL__ === true;
}

// Renderers that draw on the CPU. Some browsers (for example headless Chrome) do not report
// them as a performance caveat, so the renderer name is checked as well.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function supportsWebGL(): boolean {
  const forced = webglForced();
  try {
    const canvas = document.createElement("canvas");
    const options: WebGLContextAttributes | undefined = forced ? undefined : { failIfMajorPerformanceCaveat: true };
    const context = (canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options)) as WebGLRenderingContext | null;
    if (!context) return false;
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(context.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : context.RENDERER) ?? "");
    // Release the probe context right away.
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return forced || !SOFTWARE_RENDERER.test(renderer);
  } catch {
    return false;
  }
}
