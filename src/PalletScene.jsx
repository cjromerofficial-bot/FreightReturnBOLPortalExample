// Live, to-scale 3D view of the return's pallets inside a 53' trailer.
// It doubles as an error check: a mistyped size (e.g. 480" instead of 48") looks obviously wrong.
// Loaded lazily (three.js is only downloaded when step 2 opens); falls back to a flat SVG drawing.
import React, { useEffect, useRef, useState } from 'react';

const TRAILER = { length: 636, width: 102, height: 110 }; // 53' dry van interior, inches
const GAP = 4;

export const classColor = (c) => {
  const n = Number(c);
  if (!n) return '#9aa4b2';
  if (n <= 60) return '#2e7d5b';
  if (n <= 77.5) return '#2a9d8f';
  if (n <= 100) return '#3d6fd9';
  if (n <= 150) return '#e09f3e';
  return '#d1495b';
};

const sized = (p) => [p.length, p.width, p.height].every((x) => Number(x) > 0);
const tooBig = (p) => Number(p.width) > TRAILER.width || Number(p.height) > TRAILER.height || Number(p.length) > TRAILER.length;

function layout(pallets) {
  let x = 0;
  return pallets.map((p, i) => {
    const pos = { i, p, x, ok: sized(p) };
    if (pos.ok) x += Number(p.length) + GAP;
    return pos;
  });
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function PalletScene({ pallets, weights, active }) {
  const host = useRef(null);
  const api = useRef(null);
  const [mode, setMode] = useState('loading'); // loading | webgl | svg

  // ---- one-time three.js setup
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      let THREE, OrbitControls, renderer;
      try {
        THREE = await import('three');
        ({ OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js'));
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        if (!disposed) setMode('svg');
        return;
      }
      if (disposed) { renderer.dispose(); return; }
      const el = host.current;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(-200, 400, 300);
      scene.add(sun);

      // Trailer: floor + wireframe shell, nose at x=0.
      const floor = new THREE.Mesh(new THREE.BoxGeometry(TRAILER.length, 2, TRAILER.width), new THREE.MeshStandardMaterial({ color: 0xc9ced6 }));
      floor.position.set(TRAILER.length / 2, -1, 0);
      scene.add(floor);
      const shell = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(TRAILER.length, TRAILER.height, TRAILER.width)),
        new THREE.LineBasicMaterial({ color: 0x7a8494, transparent: true, opacity: 0.6 }),
      );
      shell.position.set(TRAILER.length / 2, TRAILER.height / 2, 0);
      scene.add(shell);

      const group = new THREE.Group();
      scene.add(group);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.minDistance = 120;
      controls.maxDistance = 1400;
      controls.autoRotate = !reducedMotion();
      controls.autoRotateSpeed = 0.6;
      controls.addEventListener('start', () => { controls.autoRotate = false; });

      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();

      let raf;
      const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
      tick();

      api.current = {
        update(pallets, weights, active) {
          group.children.slice().forEach((c) => { group.remove(c); c.geometry?.dispose(); c.material?.dispose?.(); });
          let end = 0;
          for (const { i, p, x, ok } of layout(pallets)) {
            if (!ok) continue;
            const [L, W, H] = [p.length, p.width, p.height].map(Number);
            const bad = tooBig(p);
            const dim = active != null && active !== i;
            const deck = Math.min(5, H * 0.15);
            const base = new THREE.Mesh(new THREE.BoxGeometry(L, deck, W), new THREE.MeshStandardMaterial({ color: 0xb08850, transparent: dim, opacity: dim ? 0.35 : 1 }));
            base.position.set(x + L / 2, deck / 2, 0);
            const load = new THREE.Mesh(
              new THREE.BoxGeometry(L, H - deck, W),
              new THREE.MeshStandardMaterial({ color: bad ? 0xd1495b : classColor(p.freightClass), roughness: 0.7, transparent: dim, opacity: dim ? 0.3 : 1, emissive: bad ? 0x550000 : 0x000000 }),
            );
            load.position.set(x + L / 2, deck + (H - deck) / 2, 0);
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(load.geometry), new THREE.LineBasicMaterial({ color: active === i ? 0x111111 : 0x334155 }));
            edges.position.copy(load.position);
            group.add(base, load, edges);
            end = Math.max(end, x + L);
          }
          // Frame the loaded area near the trailer nose (show at least 16 ft of trailer for scale).
          const span = Math.max(end, 192);
          const target = new THREE.Vector3(span / 2, 30, 0);
          controls.target.copy(target);
          if (!api.current.framed || api.current.span !== span) {
            camera.position.set(span / 2 - span * 0.9, span * 0.75 + 80, span * 1.1 + 120);
            api.current.framed = true;
            api.current.span = span;
          }
        },
      };
      api.current.update(pallets, weights, active);
      setMode('webgl');

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- live updates as the rep types
  useEffect(() => { api.current?.update(pallets, weights, active); }, [pallets, weights, active]);

  return (
    <figure className="scene" aria-label="To-scale 3D view of the pallets inside a 53 foot trailer">
      <div ref={host} className="scene-canvas" style={mode === 'svg' ? { display: 'none' } : undefined}>
        {mode === 'loading' && <div className="scene-loading">Loading 3D view…</div>}
      </div>
      {mode === 'svg' && <FlatView pallets={pallets} />}
      <figcaption>
        <ul className="legend">
          {pallets.map((p, i) => (
            <li key={p.id || i} className={active === i ? 'on' : ''}>
              <span className="swatch" style={{ background: sized(p) && tooBig(p) ? '#d1495b' : classColor(p.freightClass) }} />
              <strong>P{i + 1}</strong> {sized(p) ? `${p.length}×${p.width}×${p.height}"` : 'needs size'} · {weights[i] ? `${weights[i]} lb` : '—'} · class {p.freightClass || '—'}
              {sized(p) && tooBig(p) && <em className="bad"> Bigger than a trailer. Check the size.</em>}
            </li>
          ))}
        </ul>
        <span className="hint">{mode === 'webgl' ? 'Drag to turn. ' : ''}Drawn to scale inside a 53′ trailer.</span>
      </figcaption>
    </figure>
  );
}

/** No-WebGL fallback: isometric boxes, to scale. */
function FlatView({ pallets }) {
  const s = 0.9; // px per inch
  const iso = (x, y, z) => [(x - z) * Math.cos(Math.PI / 6) * s, (x + z) * Math.sin(Math.PI / 6) * s - y * s];
  const boxes = layout(pallets).filter((b) => b.ok);
  const polys = boxes.map(({ p, x, i }) => {
    const [L, W, H] = [p.length, p.width, p.height].map(Number);
    const P = (a, b, c) => iso(x + a, b, c).join(',');
    const c = tooBig(p) ? '#d1495b' : classColor(p.freightClass);
    return (
      <g key={i}>
        <polygon points={[P(0, H, 0), P(L, H, 0), P(L, H, W), P(0, H, W)].join(' ')} fill={c} opacity="0.95" />
        <polygon points={[P(0, 0, W), P(L, 0, W), P(L, H, W), P(0, H, W)].join(' ')} fill={c} opacity="0.75" />
        <polygon points={[P(L, 0, 0), P(L, 0, W), P(L, H, W), P(L, H, 0)].join(' ')} fill={c} opacity="0.55" />
      </g>
    );
  });
  return <svg className="scene-flat" viewBox="-200 -260 900 420" role="img" aria-label="Pallet sizes, isometric">{polys}</svg>;
}
