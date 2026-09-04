const { renderUIOverlay } = require('./src/render-ui');
const path = require('path');
const fs = require('fs');

async function runTest() {
    const workDir = path.join(__dirname, 'test_output_workspace');
    if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
    }

    const testScenes = [
        {
            duration_seconds: 3,
            caption: "Welcome to our futuristic codebase with a huge block of code!",
            visual_element: {
                type: "code_snippet",
                language: "javascript",
                data: `function initializeFuturisticSystem(config) {
  console.log('Booting up sequence...');
  
  const systemModules = [
    'UI Engine',
    'Data Pipeline',
    'AI Core',
    'Quantum Storage'
  ];

  for(let i = 0; i < systemModules.length; i++) {
    console.log('Loading ' + systemModules[i]);
    // Simulating delay
    let start = Date.now();
    while (Date.now() - start < 100) {}
  }

  const status = {
    modulesLoaded: systemModules.length,
    active: true,
    timestamp: new Date().toISOString()
  };

  if (config.debugMode) {
    console.log('System Status:', status);
  }

  return {
    status: status,
    engage: () => console.log('System engaged!')
  };
}`
            }
        },
        {
            duration_seconds: 3,
            caption: "Here is how it works under the hood.",
            visual_element: {
                type: "architecture_diagram",
                data: "graph LR;\n  A[Frontend] --> B[Backend];\n  B --> C[Database];"
            }
        },
        {
            duration_seconds: 2,
            caption: "This is a text-only hook!",
            visual_element: {
                type: "text_only",
                data: ""
            }
        }
    ];

    try {
        console.log("Starting test run of renderUIOverlay...");
        const overlayPath = await renderUIOverlay(testScenes, workDir);
        console.log(`\n✅ Test completed successfully!`);
        console.log(`Output saved at: ${overlayPath}`);
    } catch (err) {
        console.error("❌ Test failed:", err);
    }
}

runTest();
