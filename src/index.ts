import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  PRINT_QUEUE: KVNamespace;
  PAYMENT_ADDRESS: string;
  SBTC_PRICE_SATS: string;
}

interface PrintJob {
  id: string;
  prompt: string;
  shape: ShapeConfig;
  stlData: string;
  status: 'pending_payment' | 'paid' | 'printing' | 'completed' | 'failed';
  paymentTxId?: string;
  createdAt: string;
  paidAt?: string;
  printedAt?: string;
}

interface ShapeConfig {
  type: 'cube' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'text' | 'custom';
  dimensions: {
    width?: number;
    height?: number;
    depth?: number;
    radius?: number;
    text?: string;
  };
  units: 'mm';
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Parse natural language prompt into shape config
function parsePrompt(prompt: string): ShapeConfig {
  const lower = prompt.toLowerCase();

  // Extract dimensions from prompt
  const dimMatch = lower.match(/(\d+)\s*(?:mm|millimeter)?(?:\s*x\s*|\s*by\s*)(\d+)(?:\s*(?:mm|millimeter)?(?:\s*x\s*|\s*by\s*)(\d+))?/);
  const radiusMatch = lower.match(/(\d+)\s*(?:mm|millimeter)?\s*radius/);
  const sizeMatch = lower.match(/(\d+)\s*(?:mm|millimeter)/);

  let width = 50, height = 50, depth = 50, radius = 25;

  if (dimMatch) {
    width = parseInt(dimMatch[1]);
    height = parseInt(dimMatch[2]);
    depth = dimMatch[3] ? parseInt(dimMatch[3]) : width;
  } else if (radiusMatch) {
    radius = parseInt(radiusMatch[1]);
    width = height = depth = radius * 2;
  } else if (sizeMatch) {
    width = height = depth = parseInt(sizeMatch[1]);
    radius = width / 2;
  }

  // Detect shape type
  if (lower.includes('sphere') || lower.includes('ball') || lower.includes('orb')) {
    return { type: 'sphere', dimensions: { radius }, units: 'mm' };
  }
  if (lower.includes('cylinder') || lower.includes('tube') || lower.includes('pipe') || lower.includes('rod')) {
    return { type: 'cylinder', dimensions: { radius: radius || width/2, height }, units: 'mm' };
  }
  if (lower.includes('cone') || lower.includes('pyramid')) {
    return { type: 'cone', dimensions: { radius: radius || width/2, height }, units: 'mm' };
  }
  if (lower.includes('donut') || lower.includes('torus') || lower.includes('ring')) {
    return { type: 'torus', dimensions: { radius: radius || 30, width: 10 }, units: 'mm' };
  }
  if (lower.includes('cube') || lower.includes('box') || lower.includes('block') || lower.includes('square')) {
    return { type: 'cube', dimensions: { width, height, depth }, units: 'mm' };
  }

  // Default to cube
  return { type: 'cube', dimensions: { width, height, depth }, units: 'mm' };
}

// Generate simple STL for shape (ASCII format)
function generateSTL(shape: ShapeConfig): string {
  const triangles: string[] = [];

  function addTriangle(v1: number[], v2: number[], v3: number[], normal: number[]) {
    triangles.push(`  facet normal ${normal[0]} ${normal[1]} ${normal[2]}`);
    triangles.push('    outer loop');
    triangles.push(`      vertex ${v1[0]} ${v1[1]} ${v1[2]}`);
    triangles.push(`      vertex ${v2[0]} ${v2[1]} ${v2[2]}`);
    triangles.push(`      vertex ${v3[0]} ${v3[1]} ${v3[2]}`);
    triangles.push('    endloop');
    triangles.push('  endfacet');
  }

  if (shape.type === 'cube') {
    const w = (shape.dimensions.width || 50) / 2;
    const h = (shape.dimensions.height || 50) / 2;
    const d = (shape.dimensions.depth || 50) / 2;

    // Bottom face
    addTriangle([-w, -h, -d], [w, -h, -d], [w, -h, d], [0, -1, 0]);
    addTriangle([-w, -h, -d], [w, -h, d], [-w, -h, d], [0, -1, 0]);
    // Top face
    addTriangle([-w, h, -d], [w, h, d], [w, h, -d], [0, 1, 0]);
    addTriangle([-w, h, -d], [-w, h, d], [w, h, d], [0, 1, 0]);
    // Front face
    addTriangle([-w, -h, d], [w, -h, d], [w, h, d], [0, 0, 1]);
    addTriangle([-w, -h, d], [w, h, d], [-w, h, d], [0, 0, 1]);
    // Back face
    addTriangle([-w, -h, -d], [w, h, -d], [w, -h, -d], [0, 0, -1]);
    addTriangle([-w, -h, -d], [-w, h, -d], [w, h, -d], [0, 0, -1]);
    // Right face
    addTriangle([w, -h, -d], [w, h, -d], [w, h, d], [1, 0, 0]);
    addTriangle([w, -h, -d], [w, h, d], [w, -h, d], [1, 0, 0]);
    // Left face
    addTriangle([-w, -h, -d], [-w, h, d], [-w, h, -d], [-1, 0, 0]);
    addTriangle([-w, -h, -d], [-w, -h, d], [-w, h, d], [-1, 0, 0]);
  } else if (shape.type === 'cylinder') {
    const r = shape.dimensions.radius || 25;
    const h = (shape.dimensions.height || 50) / 2;
    const segments = 24;

    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      const x2 = Math.cos(a2) * r, z2 = Math.sin(a2) * r;

      // Side
      addTriangle([x1, -h, z1], [x2, -h, z2], [x2, h, z2], [Math.cos(a1), 0, Math.sin(a1)]);
      addTriangle([x1, -h, z1], [x2, h, z2], [x1, h, z1], [Math.cos(a1), 0, Math.sin(a1)]);
      // Top
      addTriangle([0, h, 0], [x1, h, z1], [x2, h, z2], [0, 1, 0]);
      // Bottom
      addTriangle([0, -h, 0], [x2, -h, z2], [x1, -h, z1], [0, -1, 0]);
    }
  } else if (shape.type === 'sphere') {
    const r = shape.dimensions.radius || 25;
    const segments = 16;
    const rings = 12;

    for (let i = 0; i < rings; i++) {
      const phi1 = (i / rings) * Math.PI;
      const phi2 = ((i + 1) / rings) * Math.PI;

      for (let j = 0; j < segments; j++) {
        const theta1 = (j / segments) * Math.PI * 2;
        const theta2 = ((j + 1) / segments) * Math.PI * 2;

        const p1 = [Math.sin(phi1) * Math.cos(theta1) * r, Math.cos(phi1) * r, Math.sin(phi1) * Math.sin(theta1) * r];
        const p2 = [Math.sin(phi1) * Math.cos(theta2) * r, Math.cos(phi1) * r, Math.sin(phi1) * Math.sin(theta2) * r];
        const p3 = [Math.sin(phi2) * Math.cos(theta2) * r, Math.cos(phi2) * r, Math.sin(phi2) * Math.sin(theta2) * r];
        const p4 = [Math.sin(phi2) * Math.cos(theta1) * r, Math.cos(phi2) * r, Math.sin(phi2) * Math.sin(theta1) * r];

        const n1 = [p1[0]/r, p1[1]/r, p1[2]/r];

        if (i > 0) addTriangle(p1, p2, p3, n1);
        if (i < rings - 1) addTriangle(p1, p3, p4, n1);
      }
    }
  } else if (shape.type === 'cone') {
    const r = shape.dimensions.radius || 25;
    const h = shape.dimensions.height || 50;
    const segments = 24;

    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      const x2 = Math.cos(a2) * r, z2 = Math.sin(a2) * r;

      // Side
      addTriangle([x1, 0, z1], [x2, 0, z2], [0, h, 0], [Math.cos(a1), 0.5, Math.sin(a1)]);
      // Bottom
      addTriangle([0, 0, 0], [x2, 0, z2], [x1, 0, z1], [0, -1, 0]);
    }
  } else if (shape.type === 'torus') {
    const R = shape.dimensions.radius || 30;
    const r = (shape.dimensions.width || 10) / 2;
    const segments = 24;
    const rings = 16;

    for (let i = 0; i < rings; i++) {
      const u1 = (i / rings) * Math.PI * 2;
      const u2 = ((i + 1) / rings) * Math.PI * 2;

      for (let j = 0; j < segments; j++) {
        const v1 = (j / segments) * Math.PI * 2;
        const v2 = ((j + 1) / segments) * Math.PI * 2;

        const getPoint = (u: number, v: number) => [
          (R + r * Math.cos(v)) * Math.cos(u),
          r * Math.sin(v),
          (R + r * Math.cos(v)) * Math.sin(u)
        ];

        const p1 = getPoint(u1, v1);
        const p2 = getPoint(u2, v1);
        const p3 = getPoint(u2, v2);
        const p4 = getPoint(u1, v2);

        addTriangle(p1, p2, p3, [Math.cos(u1), 0, Math.sin(u1)]);
        addTriangle(p1, p3, p4, [Math.cos(u1), 0, Math.sin(u1)]);
      }
    }
  }

  return `solid model\n${triangles.join('\n')}\nendsolid model`;
}

// Main page
app.get('/', (c) => {
  const priceUsd = 1;
  const priceSats = c.env.SBTC_PRICE_SATS;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jack's Magical Object Creator</title>
  <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Fredoka+One&family=Press+Start+2P&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <style>
    :root {
      --magic-purple: #9b59b6;
      --electric-blue: #00f5ff;
      --hot-pink: #ff1493;
      --slime-green: #39ff14;
      --gold: #ffd700;
      --dark-space: #0a0a1f;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Fredoka One', cursive;
      background: var(--dark-space);
      color: #fff;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Animated stars background */
    .stars {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      background-image:
        radial-gradient(2px 2px at 20px 30px, #fff, transparent),
        radial-gradient(2px 2px at 40px 70px, rgba(255,255,255,0.8), transparent),
        radial-gradient(1px 1px at 90px 40px, #fff, transparent),
        radial-gradient(2px 2px at 160px 120px, rgba(255,255,255,0.9), transparent),
        radial-gradient(1px 1px at 230px 80px, #fff, transparent),
        radial-gradient(2px 2px at 300px 150px, rgba(255,255,255,0.7), transparent);
      background-size: 350px 200px;
      animation: twinkle 5s ease-in-out infinite;
    }

    @keyframes twinkle {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      position: relative;
      z-index: 1;
    }

    header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .logo-icon {
      font-size: 4rem;
      animation: bounce 1s ease infinite;
      display: inline-block;
    }

    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }

    h1 {
      font-family: 'Bangers', cursive;
      font-size: 3.5rem;
      letter-spacing: 0.1em;
      background: linear-gradient(135deg, var(--hot-pink), var(--electric-blue), var(--slime-green), var(--gold));
      background-size: 300% 300%;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: rainbow 3s ease infinite;
      text-shadow: 4px 4px 0 rgba(0,0,0,0.3);
      margin-bottom: 0.5rem;
    }

    @keyframes rainbow {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .subtitle {
      font-family: 'Press Start 2P', monospace;
      color: var(--electric-blue);
      font-size: 0.8rem;
      text-shadow: 0 0 10px var(--electric-blue);
      animation: pulse 2s ease infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .price-badge {
      display: inline-block;
      background: linear-gradient(135deg, var(--gold), #ffaa00);
      color: #000;
      padding: 0.8rem 1.5rem;
      border-radius: 30px;
      font-weight: bold;
      margin-top: 1rem;
      font-size: 1.2rem;
      box-shadow: 0 5px 20px rgba(255, 215, 0, 0.5);
      animation: glow 2s ease-in-out infinite;
    }

    @keyframes glow {
      0%, 100% { box-shadow: 0 5px 20px rgba(255, 215, 0, 0.5); }
      50% { box-shadow: 0 5px 40px rgba(255, 215, 0, 0.8); }
    }

    .main-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
    }

    @media (max-width: 800px) {
      .main-grid { grid-template-columns: 1fr; }
      h1 { font-size: 2rem; }
    }

    .panel {
      background: linear-gradient(135deg, rgba(155, 89, 182, 0.2), rgba(0, 245, 255, 0.1));
      border-radius: 20px;
      padding: 1.5rem;
      border: 3px solid var(--magic-purple);
      box-shadow: 0 0 30px rgba(155, 89, 182, 0.3);
    }

    .panel h2 {
      font-family: 'Bangers', cursive;
      color: var(--slime-green);
      margin-bottom: 1rem;
      font-size: 1.5rem;
      letter-spacing: 0.05em;
      text-shadow: 0 0 10px var(--slime-green);
    }

    .step-number {
      display: inline-block;
      background: var(--hot-pink);
      color: #fff;
      width: 35px;
      height: 35px;
      border-radius: 50%;
      text-align: center;
      line-height: 35px;
      margin-right: 0.5rem;
      font-family: 'Press Start 2P', monospace;
      font-size: 0.8rem;
    }

    textarea {
      width: 100%;
      height: 120px;
      background: rgba(0, 0, 0, 0.5);
      border: 3px solid var(--electric-blue);
      border-radius: 15px;
      color: #fff;
      padding: 1rem;
      font-size: 1.1rem;
      resize: none;
      font-family: 'Fredoka One', cursive;
    }

    textarea::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }

    textarea:focus {
      outline: none;
      border-color: var(--slime-green);
      box-shadow: 0 0 20px rgba(57, 255, 20, 0.5);
    }

    .btn {
      background: linear-gradient(135deg, var(--hot-pink), var(--magic-purple));
      color: #fff;
      border: none;
      padding: 1.2rem 2rem;
      font-size: 1.2rem;
      font-family: 'Bangers', cursive;
      letter-spacing: 0.1em;
      border-radius: 15px;
      cursor: pointer;
      width: 100%;
      margin-top: 1rem;
      transition: transform 0.2s, box-shadow 0.2s;
      text-transform: uppercase;
    }

    .btn:hover {
      transform: translateY(-5px) scale(1.02);
      box-shadow: 0 15px 40px rgba(255, 20, 147, 0.5);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .btn-pay {
      background: linear-gradient(135deg, var(--slime-green), #00cc00);
      color: #000;
      animation: megaPulse 1.5s ease infinite;
    }

    @keyframes megaPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.03); }
    }

    #preview {
      width: 100%;
      height: 350px;
      background: radial-gradient(circle at center, #1a1a3a, #0a0a1f);
      border-radius: 15px;
      overflow: hidden;
      border: 3px solid var(--electric-blue);
    }

    .dimensions {
      margin-top: 1rem;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 12px;
      border: 2px solid var(--gold);
    }

    .dim-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(255, 215, 0, 0.3);
    }

    .dim-row:last-child { border-bottom: none; }

    .dim-label { color: var(--gold); }
    .dim-value {
      color: var(--electric-blue);
      font-family: 'Press Start 2P', monospace;
      font-size: 0.7rem;
    }

    .examples {
      margin-top: 1rem;
      font-size: 1rem;
    }

    .examples-label {
      color: var(--hot-pink);
      margin-bottom: 0.5rem;
    }

    .examples span {
      display: inline-block;
      background: linear-gradient(135deg, var(--magic-purple), var(--hot-pink));
      padding: 0.5rem 1rem;
      border-radius: 20px;
      margin: 0.3rem;
      cursor: pointer;
      transition: all 0.3s;
      font-size: 0.9rem;
    }

    .examples span:hover {
      transform: scale(1.1);
      box-shadow: 0 5px 20px rgba(255, 20, 147, 0.5);
    }

    .status {
      text-align: center;
      padding: 2rem;
      display: none;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 20px;
      margin-top: 2rem;
      border: 3px solid var(--gold);
    }

    .status.show { display: block; }

    .status-icon {
      font-size: 5rem;
      margin-bottom: 1rem;
      animation: bounce 1s ease infinite;
    }

    .queue-info {
      margin-top: 2rem;
      text-align: center;
      color: var(--electric-blue);
      font-size: 1rem;
      padding: 1rem;
      background: rgba(0, 245, 255, 0.1);
      border-radius: 15px;
    }

    footer {
      text-align: center;
      margin-top: 2rem;
      color: #666;
      font-size: 0.9rem;
    }

    footer a { color: var(--gold); text-decoration: none; }
  </style>
</head>
<body>
  <div class="stars"></div>
  <div class="container">
    <header>
      <div class="logo-icon">🧙‍♂️</div>
      <h1>Jack's Magical Object Creator</h1>
      <p class="subtitle">IMAGINE IT. CREATE IT. PRINT IT!</p>
      <div class="price-badge">🪙 Only $${priceUsd} per creation!</div>
    </header>

    <div class="main-grid">
      <div class="panel">
        <h2><span class="step-number">1</span> Describe Your Creation!</h2>
        <textarea id="prompt" placeholder="What awesome thing do you want to create?

Try: A 50mm cube
Or: A big cylinder 30mm wide
Or: A cool sphere ball 40mm"></textarea>

        <div class="examples">
          <div class="examples-label">⚡ Quick Creations:</div>
          <span onclick="setPrompt('A 50mm cube')">🎲 Cube</span>
          <span onclick="setPrompt('A cylinder 25mm radius, 80mm tall')">🥤 Cylinder</span>
          <span onclick="setPrompt('A 30mm sphere')">🔮 Sphere</span>
          <span onclick="setPrompt('A cone 40mm radius, 60mm tall')">🍦 Cone</span>
          <span onclick="setPrompt('A donut ring 35mm radius')">🍩 Donut</span>
        </div>

        <button class="btn" onclick="generatePreview()">✨ CREATE MAGIC! ✨</button>
      </div>

      <div class="panel">
        <h2><span class="step-number">2</span> See Your Creation!</h2>
        <div id="preview"></div>
        <div class="dimensions" id="dimensions" style="display: none;">
          <div class="dim-row">
            <span class="dim-label">🎨 Shape:</span>
            <span class="dim-value" id="dim-shape">-</span>
          </div>
          <div class="dim-row">
            <span class="dim-label">📏 Size:</span>
            <span class="dim-value" id="dim-size">-</span>
          </div>
          <div class="dim-row">
            <span class="dim-label">📦 Volume:</span>
            <span class="dim-value" id="dim-volume">-</span>
          </div>
          <div class="dim-row">
            <span class="dim-label">⏱️ Print Time:</span>
            <span class="dim-value" id="dim-time">-</span>
          </div>
        </div>

        <button class="btn btn-pay" id="payBtn" onclick="submitOrder()" disabled>
          🚀 PRINT IT FOR REAL! 🚀
        </button>
      </div>
    </div>

    <div class="status" id="status">
      <div class="status-icon" id="status-icon">⏳</div>
      <h2 id="status-title">Processing...</h2>
      <p id="status-message">Please wait</p>
    </div>

    <div class="queue-info">
      <p>🎮 Your creation will be printed and ready for pickup! 🎮</p>
    </div>

    <footer>
      <p>Powered by Bitcoin Magic ⚡ | Built with <a href="https://stx402.com">x402</a></p>
    </footer>
  </div>

  <script>
    let scene, camera, renderer, mesh;
    let currentShape = null;

    function initThree() {
      const container = document.getElementById('preview');
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a15);

      camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
      camera.position.set(100, 100, 100);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);

      // Lights
      const ambient = new THREE.AmbientLight(0x404040, 0.5);
      scene.add(ambient);

      const light1 = new THREE.DirectionalLight(0xffffff, 1);
      light1.position.set(50, 100, 50);
      scene.add(light1);

      const light2 = new THREE.DirectionalLight(0x00d4ff, 0.5);
      light2.position.set(-50, -50, -50);
      scene.add(light2);

      // Grid
      const grid = new THREE.GridHelper(200, 20, 0x333333, 0x222222);
      scene.add(grid);

      animate();
    }

    function animate() {
      requestAnimationFrame(animate);
      if (mesh) {
        mesh.rotation.y += 0.005;
      }
      renderer.render(scene, camera);
    }

    function setPrompt(text) {
      document.getElementById('prompt').value = text;
      generatePreview();
    }

    async function generatePreview() {
      const prompt = document.getElementById('prompt').value;
      if (!prompt.trim()) return;

      // Call API to parse and generate
      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      const data = await response.json();
      currentShape = data.shape;

      // Update dimensions display
      document.getElementById('dimensions').style.display = 'block';
      document.getElementById('dim-shape').textContent = data.shape.type.toUpperCase();

      const dims = data.shape.dimensions;
      let sizeText = '';
      if (dims.width && dims.height && dims.depth) {
        sizeText = dims.width + ' x ' + dims.height + ' x ' + dims.depth + ' mm';
      } else if (dims.radius && dims.height) {
        sizeText = 'R' + dims.radius + ' x H' + dims.height + ' mm';
      } else if (dims.radius) {
        sizeText = 'R' + dims.radius + ' mm';
      }
      document.getElementById('dim-size').textContent = sizeText;
      document.getElementById('dim-volume').textContent = data.volumeCm3.toFixed(1) + ' cm³';
      document.getElementById('dim-time').textContent = data.estimatedMinutes + ' min';

      // Enable pay button
      document.getElementById('payBtn').disabled = false;

      // Update 3D preview
      updateMesh(data.shape);
    }

    function updateMesh(shape) {
      if (mesh) scene.remove(mesh);

      let geometry;
      const dims = shape.dimensions;

      switch (shape.type) {
        case 'cube':
          geometry = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          break;
        case 'cylinder':
          geometry = new THREE.CylinderGeometry(dims.radius, dims.radius, dims.height, 32);
          break;
        case 'sphere':
          geometry = new THREE.SphereGeometry(dims.radius, 32, 24);
          break;
        case 'cone':
          geometry = new THREE.ConeGeometry(dims.radius, dims.height, 32);
          break;
        case 'torus':
          geometry = new THREE.TorusGeometry(dims.radius, dims.width / 2, 16, 32);
          break;
        default:
          geometry = new THREE.BoxGeometry(50, 50, 50);
      }

      const material = new THREE.MeshPhongMaterial({
        color: 0xf7931a,
        specular: 0x444444,
        shininess: 30
      });

      mesh = new THREE.Mesh(geometry, material);
      if (shape.type !== 'torus') {
        mesh.position.y = (dims.height || dims.radius * 2 || dims.width) / 2;
      }
      scene.add(mesh);
    }

    async function submitOrder() {
      const prompt = document.getElementById('prompt').value;
      if (!prompt.trim() || !currentShape) return;

      const statusDiv = document.getElementById('status');
      const icon = document.getElementById('status-icon');
      const title = document.getElementById('status-title');
      const msg = document.getElementById('status-message');

      statusDiv.classList.add('show');
      icon.textContent = '⏳';
      title.textContent = 'Creating Order...';
      msg.textContent = 'Generating print file';

      try {
        // Create order (will return 402 for payment)
        const response = await fetch('/api/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });

        if (response.status === 402) {
          const paymentInfo = await response.json();
          icon.textContent = '💳';
          title.textContent = 'Payment Required';
          msg.innerHTML = 'Send <strong>' + paymentInfo.amount + ' sats sBTC</strong> to:<br><code style="word-break: break-all;">' + paymentInfo.payTo + '</code><br><br>Order ID: ' + paymentInfo.orderId;

          // In production, integrate with Stacks wallet
          // For now, show payment instructions
        } else {
          const data = await response.json();
          icon.textContent = '✅';
          title.textContent = 'Order Submitted!';
          msg.textContent = 'Your print job is in the queue. Order ID: ' + data.orderId;
        }
      } catch (error) {
        icon.textContent = '❌';
        title.textContent = 'Error';
        msg.textContent = error.message;
      }
    }

    // Initialize
    initThree();
  </script>
</body>
</html>`);
});

// Preview endpoint
app.post('/api/preview', async (c) => {
  const { prompt } = await c.req.json();
  const shape = parsePrompt(prompt);

  // Calculate volume in cm³
  let volumeCm3 = 0;
  const dims = shape.dimensions;

  switch (shape.type) {
    case 'cube':
      volumeCm3 = ((dims.width || 50) * (dims.height || 50) * (dims.depth || 50)) / 1000;
      break;
    case 'cylinder':
      volumeCm3 = (Math.PI * Math.pow(dims.radius || 25, 2) * (dims.height || 50)) / 1000;
      break;
    case 'sphere':
      volumeCm3 = ((4/3) * Math.PI * Math.pow(dims.radius || 25, 3)) / 1000;
      break;
    case 'cone':
      volumeCm3 = ((1/3) * Math.PI * Math.pow(dims.radius || 25, 2) * (dims.height || 50)) / 1000;
      break;
    case 'torus':
      volumeCm3 = (2 * Math.PI * Math.PI * (dims.radius || 30) * Math.pow((dims.width || 10) / 2, 2)) / 1000;
      break;
  }

  // Estimate print time (rough: ~10 min per 10 cm³ at high speed)
  const estimatedMinutes = Math.max(5, Math.round(volumeCm3 * 1.5));

  return c.json({
    shape,
    volumeCm3,
    estimatedMinutes,
  });
});

// Create order (x402 payment required)
app.post('/api/order', async (c) => {
  const { prompt } = await c.req.json();
  const shape = parsePrompt(prompt);
  const stl = generateSTL(shape);

  const orderId = crypto.randomUUID().slice(0, 8);

  const job: PrintJob = {
    id: orderId,
    prompt,
    shape,
    stlData: stl,
    status: 'pending_payment',
    createdAt: new Date().toISOString(),
  };

  // Store job
  await c.env.PRINT_QUEUE.put(`job:${orderId}`, JSON.stringify(job), {
    expirationTtl: 86400 * 7, // 7 days
  });

  // Return 402 for payment
  return c.json({
    orderId,
    amount: c.env.SBTC_PRICE_SATS,
    payTo: c.env.PAYMENT_ADDRESS,
    tokenType: 'sBTC',
    network: 'mainnet',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }, 402);
});

// Confirm payment (called after payment detected)
app.post('/api/order/:id/confirm', async (c) => {
  const orderId = c.req.param('id');
  const { txId } = await c.req.json();

  const jobData = await c.env.PRINT_QUEUE.get(`job:${orderId}`);
  if (!jobData) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const job: PrintJob = JSON.parse(jobData);
  job.status = 'paid';
  job.paymentTxId = txId;
  job.paidAt = new Date().toISOString();

  await c.env.PRINT_QUEUE.put(`job:${orderId}`, JSON.stringify(job));

  // Add to print queue
  const queue = JSON.parse(await c.env.PRINT_QUEUE.get('queue') || '[]');
  queue.push(orderId);
  await c.env.PRINT_QUEUE.put('queue', JSON.stringify(queue));

  return c.json({ success: true, status: 'paid', position: queue.length });
});

// Get order status
app.get('/api/order/:id', async (c) => {
  const orderId = c.req.param('id');
  const jobData = await c.env.PRINT_QUEUE.get(`job:${orderId}`);

  if (!jobData) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const job: PrintJob = JSON.parse(jobData);
  return c.json({
    id: job.id,
    status: job.status,
    shape: job.shape,
    createdAt: job.createdAt,
    paidAt: job.paidAt,
    printedAt: job.printedAt,
  });
});

// Download STL (for print server)
app.get('/api/order/:id/stl', async (c) => {
  const orderId = c.req.param('id');
  const jobData = await c.env.PRINT_QUEUE.get(`job:${orderId}`);

  if (!jobData) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const job: PrintJob = JSON.parse(jobData);

  return new Response(job.stlData, {
    headers: {
      'Content-Type': 'application/sla',
      'Content-Disposition': `attachment; filename="${orderId}.stl"`,
    },
  });
});

// Print queue for print server
app.get('/api/queue', async (c) => {
  const queue = JSON.parse(await c.env.PRINT_QUEUE.get('queue') || '[]');
  const jobs = [];

  for (const id of queue) {
    const jobData = await c.env.PRINT_QUEUE.get(`job:${id}`);
    if (jobData) {
      const job: PrintJob = JSON.parse(jobData);
      if (job.status === 'paid') {
        jobs.push({
          id: job.id,
          shape: job.shape,
          status: job.status,
          paidAt: job.paidAt,
        });
      }
    }
  }

  return c.json({ jobs });
});

// Mark job as printing
app.post('/api/order/:id/printing', async (c) => {
  const orderId = c.req.param('id');
  const jobData = await c.env.PRINT_QUEUE.get(`job:${orderId}`);

  if (!jobData) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const job: PrintJob = JSON.parse(jobData);
  job.status = 'printing';
  await c.env.PRINT_QUEUE.put(`job:${orderId}`, JSON.stringify(job));

  return c.json({ success: true });
});

// Mark job as completed
app.post('/api/order/:id/complete', async (c) => {
  const orderId = c.req.param('id');
  const jobData = await c.env.PRINT_QUEUE.get(`job:${orderId}`);

  if (!jobData) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const job: PrintJob = JSON.parse(jobData);
  job.status = 'completed';
  job.printedAt = new Date().toISOString();
  await c.env.PRINT_QUEUE.put(`job:${orderId}`, JSON.stringify(job));

  // Remove from queue
  const queue = JSON.parse(await c.env.PRINT_QUEUE.get('queue') || '[]');
  const newQueue = queue.filter((id: string) => id !== orderId);
  await c.env.PRINT_QUEUE.put('queue', JSON.stringify(newQueue));

  return c.json({ success: true });
});

export default app;
