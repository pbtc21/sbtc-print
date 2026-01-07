/**
 * Print Server for Creality K1C (Moonraker/Klipper)
 *
 * This runs on a local computer/Raspberry Pi connected to the same network as the printer.
 * It polls the cloud queue for paid jobs and sends them to the printer.
 *
 * Setup:
 * 1. Find your printer's IP address (from printer screen: Settings → Network)
 * 2. Set PRINTER_IP below
 * 3. Run: bun run print-server/server.ts
 */

const CLOUD_API = "https://print.pbtc21.dev";
const PRINTER_IP = process.env.PRINTER_IP || "192.168.1.100"; // Change to your printer's IP
const MOONRAKER_PORT = 7125;
const POLL_INTERVAL = 10000; // Check every 10 seconds

interface PrintJob {
  id: string;
  shape: {
    type: string;
    dimensions: Record<string, number>;
  };
  status: string;
  paidAt: string;
}

async function moonrakerRequest(endpoint: string, method = "GET", body?: any) {
  const url = `http://${PRINTER_IP}:${MOONRAKER_PORT}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url);
  return response.json();
}

async function getPrinterStatus(): Promise<{ ready: boolean; printing: boolean; error?: string }> {
  try {
    const state = await moonrakerRequest("/printer/info");
    const status = await moonrakerRequest("/printer/objects/query?print_stats");

    const printState = status.result?.status?.print_stats?.state || "unknown";

    return {
      ready: state.result?.state === "ready",
      printing: printState === "printing",
    };
  } catch (error: any) {
    return { ready: false, printing: false, error: error.message };
  }
}

async function uploadGcode(jobId: string, gcodeContent: string): Promise<boolean> {
  try {
    const filename = `jack_${jobId}.gcode`;

    // Upload via Moonraker file upload
    const formData = new FormData();
    formData.append("file", new Blob([gcodeContent], { type: "text/plain" }), filename);

    const response = await fetch(`http://${PRINTER_IP}:${MOONRAKER_PORT}/server/files/upload`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();
    return result.result?.item?.path === filename;
  } catch (error) {
    console.error("Upload failed:", error);
    return false;
  }
}

async function startPrint(jobId: string): Promise<boolean> {
  try {
    const filename = `jack_${jobId}.gcode`;

    const response = await fetch(
      `http://${PRINTER_IP}:${MOONRAKER_PORT}/printer/print/start?filename=${filename}`,
      { method: "POST" }
    );

    const result = await response.json();
    return result.result === "ok";
  } catch (error) {
    console.error("Start print failed:", error);
    return false;
  }
}

async function stlToGcode(stlContent: string, shape: PrintJob["shape"]): Promise<string> {
  // For now, return a simple test gcode
  // In production, you'd use a slicer like PrusaSlicer CLI or CuraEngine

  // This is a placeholder that prints a small calibration square
  const layerHeight = 0.2;
  const size = shape.dimensions.width || shape.dimensions.radius * 2 || 50;
  const height = shape.dimensions.height || size;
  const layers = Math.ceil(height / layerHeight);

  let gcode = `
; Jack's Magical Object Creator
; Shape: ${shape.type}
; Generated: ${new Date().toISOString()}

; Start Gcode for Creality K1C
G28 ; Home all axes
G1 Z5 F3000 ; Lift Z
M104 S200 ; Set hotend temp
M140 S60 ; Set bed temp
M109 S200 ; Wait for hotend
M190 S60 ; Wait for bed
G92 E0 ; Reset extruder
G1 Z0.3 F3000 ; Move to start height
G1 E5 F200 ; Prime extruder

; Print shape (simplified)
`;

  // Generate basic perimeter movements for a cube/square
  const offset = size / 2;
  const centerX = 125; // Center of K1C bed (220mm)
  const centerY = 125;

  for (let layer = 0; layer < Math.min(layers, 50); layer++) {
    const z = (layer + 1) * layerHeight;
    gcode += `\n; Layer ${layer + 1}\n`;
    gcode += `G1 Z${z.toFixed(2)} F1000\n`;

    // Draw square perimeter
    gcode += `G1 X${(centerX - offset).toFixed(1)} Y${(centerY - offset).toFixed(1)} F6000\n`;
    gcode += `G1 X${(centerX + offset).toFixed(1)} Y${(centerY - offset).toFixed(1)} E${(layer * 4 + 1).toFixed(2)} F1500\n`;
    gcode += `G1 X${(centerX + offset).toFixed(1)} Y${(centerY + offset).toFixed(1)} E${(layer * 4 + 2).toFixed(2)} F1500\n`;
    gcode += `G1 X${(centerX - offset).toFixed(1)} Y${(centerY + offset).toFixed(1)} E${(layer * 4 + 3).toFixed(2)} F1500\n`;
    gcode += `G1 X${(centerX - offset).toFixed(1)} Y${(centerY - offset).toFixed(1)} E${(layer * 4 + 4).toFixed(2)} F1500\n`;
  }

  gcode += `
; End Gcode
G1 E-2 F2400 ; Retract
G1 Z50 F3000 ; Raise Z
M104 S0 ; Turn off hotend
M140 S0 ; Turn off bed
G28 X Y ; Home X and Y
M84 ; Disable motors
`;

  return gcode;
}

async function processJob(job: PrintJob): Promise<boolean> {
  console.log(`\n🎨 Processing job: ${job.id}`);
  console.log(`   Shape: ${job.shape.type}`);
  console.log(`   Dimensions:`, job.shape.dimensions);

  try {
    // 1. Download STL from cloud
    console.log("   📥 Downloading STL...");
    const stlResponse = await fetch(`${CLOUD_API}/api/order/${job.id}/stl`);
    const stlContent = await stlResponse.text();

    // 2. Convert to Gcode (simplified)
    console.log("   ⚙️ Converting to Gcode...");
    const gcode = await stlToGcode(stlContent, job.shape);

    // 3. Upload to printer
    console.log("   📤 Uploading to printer...");
    const uploaded = await uploadGcode(job.id, gcode);
    if (!uploaded) {
      console.log("   ❌ Upload failed");
      return false;
    }

    // 4. Mark as printing in cloud
    await fetch(`${CLOUD_API}/api/order/${job.id}/printing`, { method: "POST" });

    // 5. Start print
    console.log("   🖨️ Starting print...");
    const started = await startPrint(job.id);
    if (!started) {
      console.log("   ❌ Failed to start print");
      return false;
    }

    console.log("   ✅ Print started!");
    return true;

  } catch (error) {
    console.error("   ❌ Error:", error);
    return false;
  }
}

async function pollQueue() {
  try {
    const response = await fetch(`${CLOUD_API}/api/queue`);
    const data = await response.json();

    if (data.jobs && data.jobs.length > 0) {
      console.log(`\n📋 Found ${data.jobs.length} job(s) in queue`);

      // Check printer status
      const status = await getPrinterStatus();

      if (status.error) {
        console.log(`⚠️ Printer not reachable: ${status.error}`);
        return;
      }

      if (status.printing) {
        console.log("🖨️ Printer is busy, waiting...");
        return;
      }

      if (!status.ready) {
        console.log("⚠️ Printer not ready");
        return;
      }

      // Process first job in queue
      const job = data.jobs[0];
      const success = await processJob(job);

      if (success) {
        // In a real implementation, we'd monitor print progress
        // and mark complete when done
        console.log(`\n✨ Job ${job.id} is printing!`);
      }
    }
  } catch (error) {
    console.error("Poll error:", error);
  }
}

// Monitor for print completion
async function monitorPrints() {
  try {
    const status = await getPrinterStatus();

    if (!status.printing) {
      // Check if we have a job that was printing
      // In production, track the current job ID
    }
  } catch (error) {
    // Printer not reachable
  }
}

// Main loop
console.log("🧙‍♂️ Jack's Magical Print Server");
console.log("================================");
console.log(`Printer IP: ${PRINTER_IP}`);
console.log(`Cloud API: ${CLOUD_API}`);
console.log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
console.log("\nWaiting for print jobs...\n");

// Check printer connection on start
getPrinterStatus().then(status => {
  if (status.error) {
    console.log(`⚠️ Warning: Could not connect to printer at ${PRINTER_IP}`);
    console.log(`   Error: ${status.error}`);
    console.log(`   Make sure PRINTER_IP is correct and printer is on the same network.\n`);
  } else {
    console.log(`✅ Connected to printer!`);
    console.log(`   Ready: ${status.ready}`);
    console.log(`   Printing: ${status.printing}\n`);
  }
});

// Start polling
setInterval(pollQueue, POLL_INTERVAL);
pollQueue();
