import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/*
 * Conversation Lens — three translucent glass ribbons with brushed-graphite rims
 * around a small luminous core. Procedural geometry and generated textures only:
 * no models, image files or HDR downloads. Decorative; it encodes nothing about
 * the meeting.
 *
 * Cost budget: ~40k triangles, one environment map generated once, no post
 * processing, no transmission pass, pixel ratio capped at 1.75. The canvas renders
 * continuously only while the lens moves and is visible; when paused it settles
 * (eases to a stop) and then renders on demand.
 */

interface LensProps {
  paused: boolean;
  focus: boolean;
  parallax: boolean;
  /** Called when the context is lost or frames are consistently too slow; the stage then shows the SVG lens. */
  onUnavailable: () => void;
  /** Skip the frame-time watchdog (automated tests on software renderers). */
  disableWatchdog?: boolean;
}

interface BandSpec {
  radius: number;
  height: number;
  arc: number;
  color: string;
  opacity: number;
  /** Resting tilt (radians), the scattered tilt it converges from, and the aligned tilt while analysing. */
  tilt: [number, number, number];
  scatter: [number, number, number];
  focusTilt: [number, number, number];
  speed: number;
  bottomRim: boolean;
}

const BANDS: BandSpec[] = [
  { radius: 1.0, height: 0.4, arc: Math.PI * 1.62, color: "#8fd4be", opacity: 0.52, tilt: [0.92, 0.22, -0.52], scatter: [0.1, 1.2, -1.5], focusTilt: [1.5, 0, -0.06], speed: 0.16, bottomRim: true },
  { radius: 1.3, height: 0.27, arc: Math.PI * 1.74, color: "#3a9a89", opacity: 0.34, tilt: [0.38, -0.72, 0.62], scatter: [-1.3, 0.5, 1.7], focusTilt: [1.47, -0.05, 0.06], speed: -0.11, bottomRim: false },
  { radius: 1.58, height: 0.2, arc: Math.PI * 1.46, color: "#bfe9da", opacity: 0.56, tilt: [1.3, 0.5, 1.02], scatter: [2.3, -1.1, 0.3], focusTilt: [1.53, 0.05, 0.14], speed: 0.07, bottomRim: false },
];

const BAND_SECONDS = 0.72;
const STAGGER_SECONDS = 0.08;
const lerp = THREE.MathUtils.lerp;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
/** Ease-out with a small overshoot, so the ribbons settle into place rather than stop dead. */
const easeOutBack = (t: number) => {
  const s = 1.15;
  return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
};

/** Grayscale data texture for alpha maps (three reads the green channel). */
function alphaTexture(width: number, height: number, alpha: (u: number, v: number) => number) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.round(clamp01(alpha(x / (width - 1), y / (height - 1))) * 255);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function glowTexture(stops: [number, string][]) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [offset, color] of stops) g.addColorStop(offset, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function useLensTextures() {
  const textures = useMemo(
    () => ({
      // Ribbons fade out at their ends and are slightly denser at the edges, where glass catches light.
      band: alphaTexture(256, 32, (u, v) => smoothstep(0, 0.2, u) * smoothstep(1, 0.8, u) * (0.58 + 0.42 * Math.abs(2 * v - 1) ** 2.2)),
      // Rims fade out along their length so their tapered ends never break into sub-pixel dots.
      rim: alphaTexture(256, 4, (u) => smoothstep(0, 0.12, u) * smoothstep(1, 0.88, u)),
      shadow: alphaTexture(64, 64, (u, v) => {
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        return (1 - smoothstep(0, 1, d)) ** 1.6;
      }),
      coreGlow: glowTexture([
        [0, "rgba(244,255,251,1)"],
        [0.28, "rgba(164,234,211,0.62)"],
        [1, "rgba(185,230,214,0)"],
      ]),
      ambientGlow: glowTexture([
        [0, "rgba(185,230,214,0.5)"],
        [0.45, "rgba(185,230,214,0.16)"],
        [1, "rgba(185,230,214,0)"],
      ]),
    }),
    [],
  );
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);
  return textures;
}

/** A tube that follows a ribbon edge exactly and tapers to a point at both ends. */
function rimGeometry(radius: number, y: number, arc: number, tube: number) {
  const points = Array.from({ length: 97 }, (_, i) => {
    const theta = (i / 96) * arc; // same parametrisation as CylinderGeometry: x = r·sinθ, z = r·cosθ
    return new THREE.Vector3(radius * Math.sin(theta), y, radius * Math.cos(theta));
  });
  const curve = new THREE.CatmullRomCurve3(points);
  const tubular = 240;
  const radial = 10;
  const geometry = new THREE.TubeGeometry(curve, tubular, tube, radial, false);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const centre = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    const taper = 0.3 + 0.7 * smoothstep(0, 0.16, u) * smoothstep(1, 0.84, u);
    curve.getPointAt(u, centre);
    for (let j = 0; j <= radial; j++) {
      const index = i * (radial + 1) + j;
      vertex.fromBufferAttribute(position, index).sub(centre).multiplyScalar(taper).add(centre);
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function useMaterials(bandAlpha: THREE.Texture, rimAlpha: THREE.Texture) {
  const materials = useMemo(() => {
    const hub = new THREE.MeshPhysicalMaterial({
      color: "#4b5754",
      metalness: 1,
      roughness: 0.26,
      clearcoat: 0.5,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.55,
    });
    const graphite = new THREE.MeshPhysicalMaterial({
      color: "#4b5754",
      metalness: 1,
      roughness: 0.26,
      anisotropy: 0.8,
      clearcoat: 0.5,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.55,
      transparent: true,
      alphaMap: rimAlpha,
    });
    const bands = BANDS.map((spec) => {
      const material = new THREE.MeshPhysicalMaterial({
        color: spec.color,
        transparent: true,
        opacity: spec.opacity,
        alphaMap: bandAlpha,
        roughness: 0.14,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        emissive: "#2f8f80",
        emissiveIntensity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        envMapIntensity: 1.3,
      });
      // Glass reads as glass at grazing angles: brighten and densify the ribbon where it turns away.
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uLensRim = { value: new THREE.Color("#dcfff2") };
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uLensRim;")
          .replace(
            "#include <opaque_fragment>",
            [
              "float lensFresnel = pow( 1.0 - saturate( abs( dot( normal, geometryViewDir ) ) ), 2.2 );",
              "outgoingLight += uLensRim * lensFresnel * 0.5;",
              "diffuseColor.a = saturate( diffuseColor.a * ( 1.0 + lensFresnel * 1.5 ) );",
              "#include <opaque_fragment>",
            ].join("\n"),
          );
      };
      material.customProgramCacheKey = () => "prism-lens-band";
      return material;
    });
    return { graphite, hub, bands };
  }, [bandAlpha, rimAlpha]);
  useEffect(
    () => () => {
      materials.graphite.dispose();
      materials.hub.dispose();
      materials.bands.forEach((m) => m.dispose());
    },
    [materials],
  );
  return materials;
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      room.dispose?.();
    };
  }, [gl, scene]);
  return null;
}

function Lens({ paused, focus, parallax }: Pick<LensProps, "paused" | "focus" | "parallax">) {
  const assembly = useRef<THREE.Group>(null);
  const bandRefs = useRef<(THREE.Group | null)[]>([]);
  const core = useRef<THREE.Mesh>(null);
  const coreMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const glow = useRef<THREE.Sprite>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const spin = useRef(BANDS.map(() => 0));
  // intro: real time since mount (the entrance is skipped if the lens starts paused);
  // phase: time scaled by the eased speed, so floating and breathing slow down with the spin.
  const clock = useRef({ intro: paused ? 10 : 0, phase: 0, speed: paused ? 0 : 1, focus: focus ? 1 : 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const textures = useLensTextures();
  const materials = useMaterials(textures.band, textures.rim);
  const geometries = useMemo(
    () =>
      BANDS.map((spec) => ({
        band: new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, 192, 1, true, 0, spec.arc),
        top: rimGeometry(spec.radius, spec.height / 2, spec.arc, 0.0115),
        bottom: spec.bottomRim ? rimGeometry(spec.radius, -spec.height / 2, spec.arc, 0.007) : null,
      })),
    [],
  );
  useEffect(() => () => geometries.forEach((g) => [g.band, g.top, g.bottom].forEach((x) => x?.dispose())), [geometries]);
  const { invalidate } = useThree();
  const tiltWithPointer = parallax && !paused;

  useEffect(() => {
    if (!tiltWithPointer) return;
    const onMove = (event: PointerEvent) => {
      pointer.current = { x: (event.clientX / window.innerWidth) * 2 - 1, y: (event.clientY / window.innerHeight) * 2 - 1 };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [tiltWithPointer]);

  // On-demand frames (while paused) still need to reflect focus changes.
  useEffect(() => {
    invalidate();
  }, [paused, focus, invalidate]);

  useFrame((_state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const c = clock.current;
    // Ease the rotation speed to a stop (or back up) instead of freezing mid-motion.
    c.speed = lerp(c.speed, paused ? 0 : 1, 1 - Math.exp(-dt * 6));
    c.intro += dt;
    c.phase += dt * c.speed;
    // While paused, frames are drawn on demand only, so jump straight to the target alignment.
    c.focus = paused ? (focus ? 1 : 0) : lerp(c.focus, focus ? 1 : 0, 1 - Math.exp(-dt * 3));
    const f = c.focus;
    if (!tiltWithPointer) {
      pointer.current.x *= 0.9;
      pointer.current.y *= 0.9;
    }

    BANDS.forEach((spec, i) => {
      const group = bandRefs.current[i];
      if (!group) return;
      const t = clamp01((c.intro - i * STAGGER_SECONDS) / BAND_SECONDS);
      const settle = easeOutBack(t);
      spin.current[i] += spec.speed * dt * c.speed * (1 + f * 0.8);
      const target = spec.tilt.map((v, axis) => lerp(v, spec.focusTilt[axis], f));
      group.rotation.set(
        lerp(spec.scatter[0], target[0], settle),
        lerp(spec.scatter[1], target[1], settle) + spin.current[i],
        lerp(spec.scatter[2], target[2], settle),
      );
      group.scale.setScalar(lerp(0.84, 1, easeOutCubic(t)));
      materials.bands[i].opacity = spec.opacity * smoothstep(0, 0.35, t);
    });

    const coreIn = easeOutCubic(clamp01(c.intro / 0.6));
    const breathe = 1 + 0.035 * Math.sin(c.phase * (1.4 + f * 0.8));
    core.current?.scale.setScalar(lerp(0.6, 1, coreIn) * (1 + f * 0.08));
    if (coreMaterial.current) coreMaterial.current.emissiveIntensity = 1.45 + f * 0.6;
    if (glow.current) {
      glow.current.scale.setScalar(1.55 * coreIn * breathe * (1 + f * 0.12));
      (glow.current.material as THREE.SpriteMaterial).opacity = 0.85 * coreIn;
    }
    if (shadow.current) (shadow.current.material as THREE.MeshBasicMaterial).opacity = 0.22 * easeOutCubic(clamp01(c.intro / 0.8));

    if (assembly.current) {
      // Very small pointer parallax (about 4° by 6°) and a slow float.
      const k = 1 - Math.exp(-dt * 4);
      assembly.current.rotation.x = lerp(assembly.current.rotation.x, pointer.current.y * 0.07, k);
      assembly.current.rotation.y = lerp(assembly.current.rotation.y, pointer.current.x * 0.1, k);
      assembly.current.position.y = 0.04 * Math.sin(c.phase * 0.55);
    }
  });

  return (
    <>
      <mesh ref={shadow} position={[0, -1.62, -0.2]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <planeGeometry args={[3, 3]} />
        <meshBasicMaterial color="#4c422e" transparent opacity={0} alphaMap={textures.shadow} depthWrite={false} />
      </mesh>
      <sprite scale={[3.6, 3.6, 1]} position={[0, 0, -1.2]} renderOrder={-1}>
        <spriteMaterial map={textures.ambientGlow} transparent depthWrite={false} opacity={0.55} />
      </sprite>
      <group ref={assembly}>
        {geometries.map((geometry, i) => (
          <group key={i} ref={(node) => void (bandRefs.current[i] = node)}>
            <mesh geometry={geometry.band} material={materials.bands[i]} />
            <mesh geometry={geometry.top} material={materials.graphite} />
            {geometry.bottom && <mesh geometry={geometry.bottom} material={materials.graphite} />}
          </group>
        ))}
        <mesh ref={core}>
          <sphereGeometry args={[0.13, 48, 48]} />
          <meshStandardMaterial ref={coreMaterial} color="#f2fffa" emissive="#6fdcbc" emissiveIntensity={1.45} roughness={0.2} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.2, 48, 48]} />
          <meshPhysicalMaterial color="#e3f8f0" transparent opacity={0.28} roughness={0.04} clearcoat={1} depthWrite={false} envMapIntensity={1.6} />
        </mesh>
        <mesh rotation={[0.18, 0, 0]} material={materials.hub}>
          <torusGeometry args={[0.31, 0.0065, 10, 128]} />
        </mesh>
        <sprite ref={glow} scale={[1.55, 1.55, 1]}>
          <spriteMaterial map={textures.coreGlow} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.85} />
        </sprite>
      </group>
    </>
  );
}

/**
 * Falls back to the SVG lens when animation runs below ~22 fps (median of 40 frames,
 * after warm-up). Decorative motion must never make the page itself feel slow.
 */
function FrameWatchdog({ active, onSlow }: { active: boolean; onSlow: () => void }) {
  const samples = useRef<number[]>([]);
  const skipped = useRef(0);
  const done = useRef(false);
  useFrame((_state, delta) => {
    if (!active || done.current) return;
    if (skipped.current < 10) {
      skipped.current += 1; // shader compilation and first uploads
      return;
    }
    samples.current.push(delta);
    if (samples.current.length < 40) return;
    done.current = true;
    const sorted = [...samples.current].sort((a, b) => a - b);
    if (sorted[Math.floor(sorted.length / 2)] > 0.045) onSlow();
  });
  return null;
}

type Frameloop = "always" | "demand" | "never";
const SETTLE_MS = 900;

export default function ConversationLens({ paused, focus, parallax, onUnavailable, disableWatchdog = false }: LensProps) {
  const container = useRef<HTMLDivElement>(null);
  const onScreen = useRef(true);
  const tabVisible = useRef(typeof document === "undefined" ? true : !document.hidden);
  const settling = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const frameloopSetter = useRef<((mode: Frameloop) => void) | null>(null);

  // Render continuously only while moving and visible; after a pause, keep rendering until the
  // ribbons have eased to a stop, then render on demand; stop entirely when offscreen or hidden.
  const applyFrameloop = useRef(() => {
    const visible = onScreen.current && tabVisible.current;
    const mode: Frameloop = !visible ? "never" : pausedRef.current && !settling.current ? "demand" : "always";
    frameloopSetter.current?.(mode);
  }).current;

  useEffect(() => {
    settling.current = paused;
    applyFrameloop();
    if (!paused) return;
    const id = window.setTimeout(() => {
      settling.current = false;
      applyFrameloop();
    }, SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [paused, applyFrameloop]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      onScreen.current = entry.isIntersecting;
      applyFrameloop();
    });
    observer.observe(element);
    const onVisibility = () => {
      tabVisible.current = !document.hidden;
      applyFrameloop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyFrameloop]);

  return (
    <div ref={container} className="h-full w-full" aria-hidden>
      <Canvas
        frameloop="always"
        dpr={[1, 1.75]}
        camera={{ position: [0, 0.15, 6.0], fov: 36 }}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power", failIfMajorPerformanceCaveat: !disableWatchdog }}
        onCreated={({ gl, setFrameloop }) => {
          frameloopSetter.current = setFrameloop;
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.toneMappingExposure = 1.0;
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            onUnavailable();
          });
          applyFrameloop();
        }}
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 4.5, 5]} intensity={2.0} color="#fff4e2" />
        <directionalLight position={[-4, -1.5, -3]} intensity={0.9} color="#b9e6d6" />
        <pointLight position={[0, 0, 0.6]} intensity={2.6} distance={3.2} decay={2} color="#3fc9a8" />
        <Environment />
        <Lens paused={paused} focus={focus} parallax={parallax} />
        <FrameWatchdog active={!paused && !disableWatchdog} onSlow={onUnavailable} />
      </Canvas>
    </div>
  );
}
