// ============================================================
// PHASE 2: templates/script.js
// Reads SCENE_DATA injected by render-ui.js (via data.js)
// Mounts the correct visual element into #visual-area
// and sets the caption in #caption-text
// ============================================================

(async function () {
  // SCENE_DATA is injected by render-ui.js via data.js:
  // window.SCENE_DATA = { type, language, data, caption }

  const scene = window.SCENE_DATA;
  if (!scene) {
    console.error('[script.js] No SCENE_DATA found on window.');
    return;
  }

  const visualArea = document.getElementById('visual-area');
  const captionText = document.getElementById('caption-text');
  const canvas = document.getElementById('canvas');

  if (scene.layout_mode === 'center_text') {
    canvas.classList.add('layout-center-text');
  }

  // ── Set caption ──
  captionText.textContent = scene.caption || '';

  // ── Mount visual element ──
  switch (scene.type) {

    case 'code_snippet': {
      const lang = scene.language || 'javascript';
      const code = scene.data || '';

      const card = document.createElement('div');
      card.className = 'code-card';

      const badge = document.createElement('span');
      badge.className = 'lang-badge';
      badge.textContent = lang;

      const pre = document.createElement('pre');
      pre.className = `language-${lang}`;

      const codeEl = document.createElement('code');
      codeEl.className = `language-${lang}`;
      // Prism escapes HTML itself — pass raw text
      codeEl.textContent = code;

      pre.appendChild(codeEl);
      card.appendChild(badge);
      card.appendChild(pre);
      visualArea.appendChild(card);

      // Trigger Prism highlighting
      Prism.highlightElement(codeEl);
      break;
    }

    case 'architecture_diagram': {
      const diagramSyntax = scene.data || 'graph LR; A-->B;';
      const diagramSteps = scene.diagram_steps || null; // Array<string[]> | null

      const card = document.createElement('div');
      card.className = 'diagram-card';

      const mermaidDiv = document.createElement('div');
      mermaidDiv.className = 'mermaid';
      mermaidDiv.textContent = diagramSyntax;

      card.appendChild(mermaidDiv);
      visualArea.appendChild(card);

      // Initialize Mermaid with dark theme
      mermaid.initialize({
        startOnLoad: false, // We call run() manually so we can await it
        theme: 'dark',
        themeVariables: {
          primaryColor: '#1a1a2e',
          primaryTextColor: '#e0e0ff',
          primaryBorderColor: '#7b5ea7',
          lineColor: '#a78bfa',
          secondaryColor: '#16213e',
          tertiaryColor: '#0f3460'
        },
        flowchart: { curve: 'basis', htmlLabels: true }
      });

      // Await mermaid.run so the SVG is in the DOM before we hide elements
      await mermaid.run({ nodes: [mermaidDiv] });

      // ── Step-by-step animation setup ────────────────────────────────────
      if (diagramSteps && diagramSteps.length > 0) {
        const svg = mermaidDiv.querySelector('svg');
        if (svg) {
          // Track which node IDs are currently visible (for edge revelation)
          const visibleNodeIds = new Set();

          // ── Helper: find an SVG node element by its Mermaid logical ID ──
          // Mermaid renders nodes as <g id="flowchart-<NODE_ID>-<num>" class="node">
          // We match by the id attribute prefix "flowchart-<NODE_ID>-"
          function findNodeElement(nodeId) {
            return svg.querySelector(`[id^="flowchart-${nodeId}-"]`);
          }

          // ── Helper: reveal edges whose both endpoints are visible ──
          function revealConnectedEdges() {
            const edgePaths = svg.querySelectorAll('.edgePath, .edgeLabel');
            edgePaths.forEach(edge => {
              // Mermaid edge IDs follow the pattern: L-<SRC>-<DST>-<num>
              // e.g. id="L-Orig-Copy-0"
              const edgeId = edge.id || edge.getAttribute('id') || '';
              const match = edgeId.match(/^L-([^-]+)-([^-]+)-\d+$/);
              if (match) {
                const src = match[1];
                const dst = match[2];
                if (visibleNodeIds.has(src) && visibleNodeIds.has(dst)) {
                  edge.style.opacity = '1';
                }
              }
            });
          }

          // ── 1. Hide ALL nodes and edges initially ──
          svg.querySelectorAll('.node').forEach(el => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s ease';
          });
          svg.querySelectorAll('.edgePath, .edgeLabel').forEach(el => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s ease';
          });

          // ── 2. Expose the global reveal function for Puppeteer ──
          window.revealDiagramStep = function(stepIndex) {
            if (stepIndex < 0 || stepIndex >= diagramSteps.length) return;
            const nodeIdsToReveal = diagramSteps[stepIndex];

            nodeIdsToReveal.forEach(nodeId => {
              const el = findNodeElement(nodeId);
              if (el) {
                el.style.opacity = '1';
                visibleNodeIds.add(nodeId);
              } else {
                console.warn(`[script.js] Could not find SVG node for ID: ${nodeId}`);
              }
            });

            // After revealing nodes, check all edges
            revealConnectedEdges();
          };
        }
      }

      break;
    }

    case 'text_only':
    default: {
      // No visual overlay — just the caption bar is visible
      // Optionally add a subtle animated text card for the hook/CTA
      if (scene.caption && scene.caption.length > 0) {
        // For text_only we let the caption bar do all the work.
        // visual-area stays empty.
      }
      break;
    }
  }

  // Signal to Puppeteer that rendering is complete
  // (For architecture_diagram: SVG is in DOM, elements hidden, revealDiagramStep is ready)
  window.__RENDER_COMPLETE__ = true;
})();
