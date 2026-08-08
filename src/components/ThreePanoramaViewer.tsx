import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

interface ThreePanoramaViewerProps {
  panoramaUrl: string;
  onPositionChange?: (pos: { yaw: number; pitch: number; fov: number }) => void;
  className?: string;
}

const DEFAULT_PANORAMA = 'https://pannellum.org/images/alma.jpg';

const getAngleDiff = (a: number, b: number) => {
  let diff = a - b;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
};

export const ThreePanoramaViewer: React.FC<ThreePanoramaViewerProps> = ({
  panoramaUrl,
  onPositionChange,
  className = 'w-full h-full'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshCurrentRef = useRef<THREE.Mesh | null>(null);
  const materialCurrentRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  // Camera angles state
  const cameraAngleRef = useRef({
    yaw: 0,
    pitch: 0,
    fov: 75,
    targetYaw: 0,
    targetPitch: 0,
    targetFov: 75
  });

  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Update camera matrix (YXZ Euler order)
  const applyCameraMatrix = useCallback(() => {
    if (!cameraRef.current) return;
    const angles = cameraAngleRef.current;

    const pitchRad = THREE.MathUtils.degToRad(angles.pitch);
    const yawRad = THREE.MathUtils.degToRad(-angles.yaw);

    const euler = new THREE.Euler(pitchRad, yawRad, 0, 'YXZ');
    cameraRef.current.quaternion.setFromEuler(euler);
    cameraRef.current.fov = angles.fov;
    cameraRef.current.updateProjectionMatrix();

    if (onPositionChange) {
      onPositionChange({
        yaw: Math.round(angles.yaw),
        pitch: Math.round(angles.pitch),
        fov: Math.round(angles.fov)
      });
    }
  }, [onPositionChange]);

  // Load panorama texture
  const loadTexture = useCallback((url: string) => {
    setIsLoading(true);
    setHasError(false);

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;

        if (materialCurrentRef.current) {
          if (materialCurrentRef.current.map) {
            materialCurrentRef.current.map.dispose();
          }
          materialCurrentRef.current.map = texture;
          materialCurrentRef.current.needsUpdate = true;
        }
        setIsLoading(false);
      },
      undefined,
      (err) => {
        console.warn('ThreePanoramaViewer: Texture load failed for URL:', url, err);
        if (url !== DEFAULT_PANORAMA) {
          loadTexture(DEFAULT_PANORAMA);
        } else {
          setIsLoading(false);
          setHasError(true);
        }
      }
    );
  }, []);

  // Mouse & Touch Drag Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    const factor = cameraAngleRef.current.fov / 500;
    cameraAngleRef.current.targetYaw += deltaX * factor;
    cameraAngleRef.current.targetPitch += deltaY * factor;
    cameraAngleRef.current.targetPitch = Math.max(-85, Math.min(85, cameraAngleRef.current.targetPitch));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 3 : -3;
    cameraAngleRef.current.targetFov = Math.max(30, Math.min(110, cameraAngleRef.current.targetFov + zoomFactor));
  };

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 200;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    container.appendChild(renderer.domElement);

    // 360 Sphere Geometry (scaled -1 on X for inside viewing)
    const sphereGeo = new THREE.SphereGeometry(500, 60, 40);
    sphereGeo.scale(-1, 1, 1);

    const matCurrent = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 1.0 });
    materialCurrentRef.current = matCurrent;

    const mesh = new THREE.Mesh(sphereGeo, matCurrent);
    scene.add(mesh);
    meshCurrentRef.current = mesh;

    // 60FPS Damping Animation Loop
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);

      const angles = cameraAngleRef.current;
      const dampingFactor = 0.18;

      const yawDiff = getAngleDiff(angles.targetYaw, angles.yaw);
      angles.yaw += yawDiff * dampingFactor;
      angles.pitch += (angles.targetPitch - angles.pitch) * dampingFactor;
      angles.fov += (angles.targetFov - angles.fov) * dampingFactor;

      applyCameraMatrix();

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      resizeObserver.disconnect();
      if (rendererRef.current && rendererRef.current.domElement) {
        container.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
      sphereGeo.dispose();
      matCurrent.dispose();
    };
  }, [applyCameraMatrix]);

  // Trigger texture load when URL changes
  useEffect(() => {
    loadTexture(panoramaUrl || DEFAULT_PANORAMA);
  }, [panoramaUrl, loadTexture]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-slate-950 cursor-grab active:cursor-grabbing select-none ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      <div ref={containerRef} className="w-full h-full min-h-[160px]" />

      {isLoading && (
        <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center pointer-events-none z-10">
          <div className="flex items-center gap-2 text-sky-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            Loading 360° Sphere...
          </div>
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4 text-center z-20">
          <span className="text-xs text-amber-400 font-medium">
            360° Panorama Image Unavailable
          </span>
        </div>
      )}
    </div>
  );
};

export default ThreePanoramaViewer;
