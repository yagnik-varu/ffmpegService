// ============================================================
// PHASE 2: templates/script.js
// Reads SCENE_DATA injected by render-ui.js (via data.js)
// Mounts the correct visual element into #visual-area
// and sets the caption in #caption-text
// ============================================================

(function () {
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

      const card = document.createElement('div');
      card.className = 'diagram-card';

      const mermaidDiv = document.createElement('div');
      mermaidDiv.className = 'mermaid';
      mermaidDiv.textContent = diagramSyntax;

      card.appendChild(mermaidDiv);
      visualArea.appendChild(card);

      // Initialize Mermaid
      mermaid.initialize({
        startOnLoad: true,
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

      mermaid.run({ nodes: [mermaidDiv] });
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
  window.__RENDER_COMPLETE__ = true;
})();
