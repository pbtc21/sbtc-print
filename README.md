# Jack's Magical Object Creator 🧙‍♂️

A fun 3D print service where anyone can describe an object, pay $1 in sBTC, and have it printed on a Creality K1C!

**Live:** https://sbtc-print.p-d07.workers.dev/

## How It Works

1. **User describes an object** (e.g., "A 50mm cube", "A sphere 30mm radius")
2. **AI parses the prompt** and generates a 3D preview
3. **User pays $1 in sBTC** via x402 protocol
4. **Print server picks up the job** and sends it to the Creality K1C
5. **Object is printed!**

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Web Browser   │────▶│  Cloudflare KV   │────▶│  Print Server   │
│   (Three.js)    │     │  (Job Queue)     │     │  (Local/RPi)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                         │
                               │                         ▼
                               │                 ┌─────────────────┐
                               │                 │  Creality K1C   │
                               │                 │  (Moonraker)    │
                               └─────────────────┴─────────────────┘
```

## Components

### Cloud Worker (`src/index.ts`)
- Serves the web UI
- Parses natural language prompts into shapes
- Generates STL files
- Handles x402 sBTC payments
- Manages the print queue (Cloudflare KV)

### Print Server (`print-server/server.ts`)
- Runs locally near the printer
- Polls the cloud for paid jobs
- Converts STL to Gcode
- Sends prints to Creality K1C via Moonraker API

## Setup

### 1. Deploy the Cloud Worker

Already deployed at https://sbtc-print.p-d07.workers.dev/

To redeploy:
```bash
bun install
bun wrangler deploy
```

### 2. Set Up the Print Server

On a computer/Raspberry Pi on the same network as the printer:

```bash
cd print-server

# Set your printer's IP (find it on the printer screen: Settings → Network)
export PRINTER_IP="192.168.1.100"

# Run the server
bun run server.ts
```

### 3. Connect the Creality K1C

1. Turn on the printer
2. Connect to WiFi (Settings → Network)
3. Note the IP address
4. The printer runs Moonraker on port 7125 by default

## Supported Shapes

- **Cube** - "A 50mm cube", "A box 40x60x30mm"
- **Cylinder** - "A cylinder 25mm radius, 80mm tall"
- **Sphere** - "A 30mm sphere", "A ball 40mm"
- **Cone** - "A cone 40mm wide, 60mm tall"
- **Torus** - "A donut ring 35mm radius"

## Payment

- **Price:** $1 USD in sBTC (~100,000 sats at $100k BTC)
- **Payment Address:** SP2QXPFF4M72QYZWXE7S5321XJDJ2DD32DGEMN5QA
- **Protocol:** x402 (HTTP 402 Payment Required)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web UI |
| `/api/preview` | POST | Generate shape preview |
| `/api/order` | POST | Create order (returns 402) |
| `/api/order/:id` | GET | Get order status |
| `/api/order/:id/stl` | GET | Download STL file |
| `/api/order/:id/confirm` | POST | Confirm payment |
| `/api/queue` | GET | Get print queue |

## Tech Stack

- **Frontend:** Three.js, vanilla JS
- **Backend:** Hono, Cloudflare Workers
- **Storage:** Cloudflare KV
- **Payments:** sBTC via x402
- **Printer:** Creality K1C with Moonraker/Klipper
