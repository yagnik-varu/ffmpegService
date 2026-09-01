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
            caption: "Welcome to our futuristic codebase!",
            visual_element: {
                type: "code_snippet",
                language: "javascript",
                data: "function futuristic() {\n  return 'Engaging UI';\n}"
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
