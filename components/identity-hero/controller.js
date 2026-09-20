import { icon } from './icons.js';
export function mountGraph(root, data) {
  const lifetime = new AbortController();
  let disposed = false;
  const on = (target, event, fn) =>
    target.addEventListener(event, fn, { signal: lifetime.signal });
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
  // Same-origin public snapshot. No database credentials or social API calls in the browser.

  const $ = (selector) => root.querySelector(selector);
  const scene = $('#scene'),
    canvas = $('#web'),
    ctx = canvas.getContext('2d'),
    detail = $('#detail');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const short = (address) => address.slice(0, 6) + '…' + address.slice(-4);
  const esc = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  const fc =
    '<img src="/hero/farcaster-current.png" width="14" height="14" alt="Farcaster">';
  let sample = null;
  let storyMode = false;
  let storyPhase = 'input';
  let storyStart = 0;
  let accounts = [];
  accounts = structuredClone(data.accounts);
  sample = data.sample;
  $('#retry').onclick = () => location.reload();
  const sampleTotal = accounts.reduce(
    (total, p) => total + p.wallets.length,
    0
  );
  $('#sample-count').textContent =
    `Full graph: ${accounts.length} people · ${sampleTotal} wallets`;
  const placements = {
    jesse: [0.3, 0.46, 78, 1],
    vitalik: [0.6, 0.57, 70, 0.9],
    dan: [0.79, 0.3, 50, 0.55],
    varun: [0.79, 0.72, 44, 0.3],
    linda: [0.13, 0.69, 54, 0.7],
    jacob: [0.5, 0.26, 46, 0.35],
    ted: [0.92, 0.56, 46, 0.5],
    seneca: [0.105, 0.3, 42, 0.25],
    coop: [0.79, 0.72, 48, 0.4],
    tim: [0.5, 0.26, 46, 0.35],
    balaji: [0.105, 0.3, 48, 0.5],
  };
  const mobileIds = ['jesse', 'vitalik', 'linda', 'dan'];
  let w = 0,
    h = 0,
    dpr = 1,
    active = -1,
    pinned = false,
    focus = 0,
    targetFocus = 0,
    px = 0,
    py = 0,
    tx = 0,
    ty = 0,
    clock = 0,
    last = 0,
    delta = 16,
    revealStart = 0,
    frame = 0,
    visible = true,
    paused = reduced.matches,
    walletView = true,
    light = false,
    ink = '',
    line = '',
    demoTimers = [];
  const walletElements = [];
  let preview = -1;
  function previewPerson(index) {
    preview = active < 0 && !connectionReveal ? index : -1;
    accounts.forEach((p, i) =>
      p.el.classList.toggle('previewed', i === preview)
    );
    requestDraw();
  }
  let connectionReveal = null;
  const socialNodes = document.createElement('div');
  socialNodes.id = 'social-nodes';
  socialNodes.hidden = true;
  scene.append(socialNodes);
  function fallbackImages(root) {
    root.querySelectorAll('img[data-portrait]').forEach((img) => {
      const fail = () => {
        img.hidden = true;
      };
      img.addEventListener('error', fail, { once: true });
      if (img.complete && !img.naturalWidth) fail();
    });
  }
  accounts.forEach((p, i) => {
    p.layout = placements[p.id];
    p.position = null;
    p.xPhoto =
      /^(?:data:image\/webp;base64,[A-Za-z0-9+/=]+|\/hero\/[a-z0-9-]+\.webp)$/.test(
        p.xPhoto || ''
      )
        ? p.xPhoto
        : null;
    const el = document.createElement('div');
    el.className = 'person' + (i < 2 ? ' anchor' : '');
    el.style.setProperty('--size', p.layout[2] + 'px');
    el.style.setProperty(
      '--reveal-delay',
      Math.round(p.layout[0] * 650) + 'ms'
    );
    el.innerHTML = `<button class="person-button" aria-label="Explore ${esc(p.name)}, ${p.wallets.length} indexed wallets" aria-expanded="false" aria-controls="detail"><span class="fallback" aria-hidden="true">${esc(
      p.name
        .split(' ')
        .map((n) => n[0])
        .join('')
    )}</span><span class="wallet-symbol" aria-hidden="true">${icon('Wallet')}</span>${p.xPhoto ? `<img data-portrait src="${p.xPhoto}" alt="" width="80" height="80">` : ''}<span class="platform" aria-label="X">${icon('XLogo')}</span></button><span class="person-name"><strong class="identity-label">@${esc(p.handle)}</strong><strong class="wallet-label">${short(p.wallet)}</strong><small>${short(p.wallet)}</small></span>`;
    p.el = el;
    p.button = el.querySelector('button');
    p.button.title = `${p.name} · Click to explore`;
    fallbackImages(el);
    $('#nodes').append(el);
    p.button.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') previewPerson(i);
    });
    p.button.addEventListener('pointerleave', () => {
      if (!p.button.matches(':focus-visible')) previewPerson(-1);
    });
    p.button.addEventListener('focus', () => {
      previewPerson(i);
    });
    p.button.addEventListener('blur', () => {
      if (!p.button.matches(':hover')) previewPerson(-1);
    });
    p.button.addEventListener('click', () => {
      previewPerson(-1);
      stopDemo();
      if (pinned && active === i) reset();
      else select(i, true);
    });
  });
  function personPosition(p) {
    if (storyMode) {
      const index = ['jesse', 'vitalik', 'dan'].indexOf(p.id);
      if (w < 600)
        return {
          x: w * [0.27, 0.72, 0.5][Math.max(0, index)],
          y: h * [0.65, 0.72, 0.87][Math.max(0, index)],
        };
      return {
        x: w * [0.55, 0.77, 0.88][Math.max(0, index)],
        y: h * [0.46, 0.65, 0.3][Math.max(0, index)],
      };
    }
    const mobile = w < 600;
    let [x, y, , z] = p.layout;
    if (mobile) {
      const k = mobileIds.indexOf(p.id);
      x = [0.29, 0.72, 0.25, 0.75][Math.max(0, k)];
      y = [0.38, 0.59, 0.72, 0.3][Math.max(0, k)];
    }
    const base = {
      x: x * w + px * 38 * z,
      y: Math.max(145, y * h + py * 22 * z),
    };
    if (accounts[active] === p) {
      const cx = mobile ? w * 0.5 : w * 0.32,
        cy = mobile ? h * 0.3 : h * 0.52;
      return {
        x: base.x + (cx - base.x) * focus,
        y: base.y + (cy - base.y) * focus,
      };
    }
    return base;
  }
  function select(i, pin = false) {
    previewPerson(-1);
    cancelConnection();
    if (i < 0 || !accounts[i]) return;
    if (w < 600 && !mobileIds.includes(accounts[i].id)) return;
    exitStory();
    const changed = active !== i;
    active = i;
    pinned = pin;
    targetFocus = 1;
    walletView = false;
    updateViewButtons();
    scene.classList.add('focused');
    $('#reset').hidden = false;
    $('#rest-caption').hidden = true;
    accounts.forEach((p, j) => {
      p.el.classList.toggle('selected', i === j);
      p.button.setAttribute('aria-expanded', String(i === j));
    });
    if (changed || detail.hidden) {
      revealStart = clock;
      const p = accounts[i];
      detail.innerHTML = `<div class="detail-top">${p.xPhoto ? `<img data-portrait src="${p.xPhoto}" alt="" width="28" height="28">` : `<span class="social-mark">${icon('XLogo')}</span>`}<span>${esc(p.name)}</span><button class="close" aria-label="Close identity">${icon('X')}</button></div><h2 class="detail-headline">One person.<br><strong>${p.wallets.length} wallets.</strong></h2><p class="detail-summary">Linked in walletlink’s index.<br>Select an address to inspect its evidence.</p><a class="social-link" href="https://x.com/${p.handle}" target="_blank" rel="noreferrer"><span class="social-mark">${icon('XLogo')}</span>@${p.handle}<span class="arrow">${icon('ArrowUpRight')}</span></a><a class="social-link" href="https://farcaster.xyz/${p.fc}" target="_blank" rel="noreferrer"><span class="social-mark">${fc}</span>/${p.fc}<span class="arrow">${icon('ArrowUpRight')}</span></a><p class="detail-source"><strong>${p.wallets.length} indexed addresses</strong><br>${p.xVerified ? '𝕏 link verified in Walletlink’s index.' : '𝕏 profile curated; wallet links indexed via Farcaster.'}<br>Snapshot ${p.checkedAt.slice(0, 10)}<br>${p.xPhoto ? '𝕏 portrait · ' : ''}Farcaster FID ${p.fid}</p><div id="wallet-info" class="wallet-info" hidden></div>`;
      fallbackImages(detail);
      detail.querySelector('.close').onclick = () => {
        const origin = p.button;
        reset();
        origin.focus({ preventScroll: true });
        reset();
      };
      $('#wallets').replaceChildren();
      walletElements.length = 0;
      p.wallets.forEach((a) => {
        const button = document.createElement('button');
        button.className =
          'wallet-node' +
          (a.evidence === 'Farcaster custody' ? ' custody' : '');
        button.innerHTML = `${icon('Wallet')}<span>${short(a.address)}</span>`;
        button.title = a.address + ' · ' + a.evidence;
        button.setAttribute('aria-label', `${a.address}, ${a.evidence}`);
        button.setAttribute('aria-pressed', 'false');
        button.onclick = () => {
          pinned = true;
          walletElements.forEach((b) =>
            b.setAttribute('aria-pressed', String(b === button))
          );
          const info = detail.querySelector('.detail-summary');
          info.innerHTML = `<a href="https://etherscan.io/address/${a.address}" target="_blank" rel="noreferrer">${a.address} ${icon('ArrowUpRight')}</a><span>${esc(a.evidence)} · Checked ${p.checkedAt.slice(0, 10)}</span>`;
          detail.scrollTop = 0;
        };
        $('#wallets').append(button);
        walletElements.push(button);
      });
    }
    socialNodes.hidden = false;
    const person = accounts[i];
    socialNodes.innerHTML = `<a class="social-node" href="https://x.com/${person.handle}" target="_blank" rel="noreferrer" aria-label="${esc(person.name)} on X${person.xVerified ? '' : ' (curated link)'}"><span class="social-orb">${person.xPhoto ? `<img src="${person.xPhoto}" alt="">` : icon('XLogo')}</span><span>@${person.handle}<small>${person.xVerified ? 'Indexed 𝕏 link' : 'Curated 𝕏 link'}</small></span></a><a class="social-node" href="https://farcaster.xyz/${person.fc}" target="_blank" rel="noreferrer" aria-label="${esc(person.name)} on Farcaster"><span class="social-orb">${fc}</span><span>/${person.fc}<small>Farcaster · FID ${person.fid}</small></span></a>`;
    detail.scrollTop = 0;
    detail.hidden = false;
    if (changed && !paused && !reduced.matches) {
      detail.getAnimations().forEach((animation) => animation.cancel());
      detail.animate(
        [
          { opacity: 0, transform: 'translateY(18px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        {
          duration: 1100,
          delay: 500,
          easing: 'cubic-bezier(.22,1,.36,1)',
          fill: 'both',
        }
      );
    }
    if (paused || reduced.matches) focus = 1;
    resize();
    requestDraw();
  }
  function reset() {
    previewPerson(-1);
    cancelConnection();
    active = -1;
    pinned = false;
    targetFocus = 0;
    if (paused || reduced.matches) focus = 0;
    scene.classList.remove('focused');
    detail.hidden = true;
    socialNodes.hidden = true;
    $('#wallets').replaceChildren();
    walletElements.length = 0;
    $('#reset').hidden = true;
    $('#rest-caption').hidden = false;
    accounts.forEach((p) => {
      p.el.classList.remove('selected');
      p.button.setAttribute('aria-expanded', 'false');
    });
    resize();
    requestDraw();
  }
  function stopDemo() {
    demoTimers.forEach(clearTimeout);
    demoTimers = [];
    $('#reveal').innerHTML = icon('Play');
    $('#reveal').setAttribute('aria-label', 'Replay the lookup');
    $('#reveal').title = 'Replay the lookup';
    if (storyMode && storyPhase !== 'results') finishStory();
  }
  $('#reset').onclick = () => {
    stopDemo();
    reset();
  };
  root.querySelectorAll('[data-explore]').forEach(
    (b) =>
      (b.onclick = () => {
        stopDemo();
        select(
          accounts.findIndex((p) => p.id === b.dataset.explore),
          true
        );
        if (w < 600)
          scene.scrollIntoView({ block: 'start', behavior: 'instant' });
      })
  );
  function updateViewButtons() {
    const wasWallet = scene.classList.contains('wallet-view');
    scene.classList.toggle('wallet-view', walletView);
    if (walletView) scene.classList.remove('identity-reveal');
    else if (wasWallet) scene.classList.add('identity-reveal');
    $('#view-wallets').setAttribute('aria-pressed', String(walletView));
    $('#view-people').setAttribute('aria-pressed', String(!walletView));
    accounts.forEach((p) => {
      p.el
        .querySelector('.person-name small')
        .setAttribute('aria-hidden', String(walletView));
      p.el
        .querySelector('.platform')
        .setAttribute('aria-hidden', String(walletView));
      p.el
        .querySelector('.identity-label')
        .setAttribute('aria-hidden', String(walletView));
      p.el
        .querySelector('.wallet-label')
        .setAttribute('aria-hidden', String(!walletView));
    });
  }
  $('#view-wallets').onclick = () => {
    stopDemo();
    exitStory();
    reset();
    walletView = true;
    updateViewButtons();
    requestDraw();
  };
  $('#view-people').onclick = () => {
    cancelConnection();
    stopDemo();
    exitStory();
    walletView = false;
    updateViewButtons();
    requestDraw();
  };
  function renderSample(resolved = false) {
    if (!sample) return;
    const groups = resolved
      ? [...new Set(sample.rows.map((r) => r.handle))].map((handle) =>
          sample.rows.filter((r) => r.handle === handle)
        )
      : sample.rows.map((row) => [row]);
    $('#sample-rows').innerHTML = groups
      .map((rows) => {
        const handle = rows[0].handle;
        const person = accounts.find((p) => p.handle === handle);
        return `<div data-handle="${esc(handle || '')}" class="sample-row ${resolved && !handle ? 'unmatched' : ''}">
      <div class="sample-addresses">${rows.map((r) => `<code title="${esc(r.address)}">${short(r.address)}</code>`).join('')}</div>
      <span class="sample-arrow">${icon('ArrowUpRight')}</span>
      <div class="sample-result">${resolved ? (handle ? `<a href="https://x.com/${esc(handle)}" target="_blank" rel="noreferrer">${person?.xPhoto ? `<img src="${person.xPhoto}" alt="" width="23" height="23">` : icon('XLogo')}<span>@${esc(handle)}${rows.length > 1 ? `<small>${rows.length} wallets · one person</small>` : ''}</span></a>` : '<span>No 𝕏 match<small>Synthetic example</small></span>') : '<span class="pending-match">—</span>'}</div>
    </div>`;
      })
      .join('');
  }
  function finishStory() {
    if (!storyMode) return;
    storyPhase = 'results';
    walletView = false;
    updateViewButtons();
    scene.dataset.storyStage = 'results';
    renderSample(true);
    const matches = sample.rows.filter((r) => r.handle).length;
    const people = new Set(
      sample.rows.filter((r) => r.handle).map((r) => r.handle)
    ).size;
    $('#sample-stage').textContent = '03 / PEOPLE';
    $('#sample-title').innerHTML =
      `${sample.rows.length} wallets.<br>${people} people you can reach.`;
    $('#sample-description').textContent =
      'Wallets matched to 𝕏. People grouped.';
    $('#sample-outcome').textContent =
      `${matches} 𝕏 matches · ${sample.rows.length - matches} unmatched`;
    $('#explore-graph').hidden = false;
    $('#reveal').innerHTML = icon('Play');
    $('#reveal').setAttribute('aria-label', 'Replay the lookup');
    $('#reveal').title = 'Replay the lookup';
    requestDraw();
  }
  function exitStory() {
    storyMode = false;
    scene.classList.remove('story-mode');
    $('#sample-panel').hidden = true;
  }
  function startStory() {
    stopDemo();
    reset();
    if (!sample?.rows?.length) {
      walletView = false;
      updateViewButtons();
      return;
    }
    storyMode = true;
    storyStart = clock;
    storyPhase = 'input';
    scene.classList.add('story-mode');
    scene.dataset.storyStage = 'input';
    $('#sample-panel').hidden = false;
    $('#explore-graph').hidden = true;
    $('#sample-stage').textContent = '01 / INPUT';
    $('#sample-title').innerHTML = 'Five addresses.<br>Who’s behind them?';
    $('#sample-description').textContent =
      'Watch a wallet list turn into people you can reach.';
    $('#sample-outcome').textContent = '';
    walletView = true;
    updateViewButtons();
    renderSample();
    resize();
    if (reduced.matches || paused) {
      finishStory();
      return;
    }
    $('#reveal').innerHTML = icon('ArrowUpRight');
    $('#reveal').setAttribute('aria-label', 'Skip to results');
    $('#reveal').title = 'Skip to results';
    demoTimers.push(
      setTimeout(() => {
        storyPhase = 'resolving';
        scene.dataset.storyStage = 'resolving';
        $('#sample-stage').textContent = '02 / RESOLVING';
        $('#sample-description').textContent =
          'Connecting the addresses to their indexed 𝕏 profiles…';
        walletView = false;
        updateViewButtons();
      }, 2400),
      setTimeout(() => {
        finishStory();
        demoTimers = [];
      }, 6200)
    );
  }
  $('#reveal').onclick = () => {
    if (demoTimers.length) {
      stopDemo();
      return;
    }
    startStory();
  };
  function dismissSample() {
    stopDemo();
    exitStory();
    reset();
  }
  $('#explore-graph').onclick = dismissSample;
  // Capture before node/control handlers so the same click can still explore.
  // composedPath preserves the actual target across the hero's shadow root.
  document.addEventListener(
    'click',
    (event) => {
      const path = event.composedPath();
      // Skip/replay owns its story transition; do not clear its timers first.
      if (
        storyMode &&
        !path.includes($('#sample-panel')) &&
        !path.includes($('#reveal'))
      )
        dismissSample();
    },
    { capture: true, signal: lifetime.signal }
  );
  scene.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (storyMode) {
        dismissSample();
        $('#reveal').focus({ preventScroll: true });
        return;
      }
      stopDemo();
      const origin = accounts[active]?.button;
      reset();
      origin?.focus({ preventScroll: true });
      reset();
    }
  });
  scene.addEventListener('pointermove', (e) => {
    if (paused || reduced.matches) return;
    const r = scene.getBoundingClientRect();
    tx = (e.clientX - r.left) / w - 0.5;
    ty = (e.clientY - r.top) / h - 0.5;
    requestDraw();
  });
  scene.addEventListener('pointerleave', () => {
    tx = ty = 0;
  });
  canvas.addEventListener('click', () => {
    if (storyMode) return;
    stopDemo();
    reset();
  });
  $('.scene-shading').addEventListener('click', () => {
    if (storyMode) return;
    stopDemo();
    reset();
  });
  // A volumetric ribbon with several dense pockets, not a uniform planar mesh.
  let seed = 72491;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const particles = Array.from({ length: 1900 }, () => {
    const t = random() * Math.PI * 2,
      rad = 0.4 + random() * 0.6;
    let x = (random() - 0.5) * 1.2;
    const center = Math.sin(x * 7) * 0.19;
    return {
      x,
      y: center + Math.sin(t) * rad * 0.29,
      z: Math.cos(t) * rad * 0.7,
      phase: random() * 6.28,
      size: 0.3 + random() * 1.1,
    };
  });
  // Spatial buckets replace an all-pairs scan during startup. Preserve the same
  // distance metric and three nearest forward neighbors as the original mesh.
  const edges = [];
  const cellSize = Math.sqrt(0.003);
  const buckets = new Map();
  const cellKey = (x, y, z) => (x + 32) * 4096 + (y + 32) * 64 + (z + 32);
  const cells = particles.map((p) => [
    Math.floor(p.x / cellSize),
    Math.floor((p.y * 0.47) / cellSize),
    Math.floor((p.z * 0.1) / cellSize),
  ]);
  cells.forEach((cell, i) => {
    const key = cellKey(...cell);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  });
  particles.forEach((a, i) => {
    const cell = cells[i],
      near = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const candidates =
            buckets.get(cellKey(cell[0] + x, cell[1] + y, cell[2] + z)) || [];
          for (const j of candidates) {
            if (j <= i) continue;
            const b = particles[j];
            const d =
              (a.x - b.x) ** 2 +
              ((a.y - b.y) * 0.47) ** 2 +
              ((a.z - b.z) * 0.1) ** 2;
            if (d < 0.003) near.push([j, d]);
          }
        }
    near.sort((a, b) => a[1] - b[1]);
    for (const [j] of near.slice(0, 3)) edges.push([i, j]);
  });
  // A handful of real records inhabit existing mesh vertices. The other
  // vertices remain illustrative; no requests or extra animation loop are needed.
  const meshWallets = [];
  const meshLayer = document.createElement('div');
  meshLayer.className = 'mesh-wallets';
  meshLayer.setAttribute(
    'aria-label',
    'Explore indexed wallets in the network'
  );
  scene.append(meshLayer);
  accounts.forEach((person, accountIndex) => {
    person.wallets.slice(0, 2).forEach((wallet, walletIndex) => {
      const button = document.createElement('button');
      button.className = 'mesh-wallet';
      button.setAttribute(
        'aria-label',
        `Reveal the profile linked to wallet ${wallet.address}`
      );
      button.setAttribute('aria-controls', 'detail');
      button.innerHTML = `<span class="mesh-wallet-mark" aria-hidden="true">${icon('Wallet')}</span><span class="mesh-wallet-hint" aria-hidden="true"><code>${short(wallet.address)}</code><small>Reveal linked profile ${icon('ArrowUpRight')}</small></span>`;
      const node = { person, button, vertex: -1 };
      button.onclick = () => {
        stopDemo();
        cancelConnection();
        const point = project(particles[node.vertex]);
        connectionReveal = {
          accountIndex,
          walletIndex,
          button,
          start: clock,
          from: { x: point.x / w, y: point.y / h },
        };
        pinned = true;
        scene.classList.add('discovering-connection');
        button.classList.add('tracing');
        person.el.classList.add('discovery-target');
        walletView = false;
        updateViewButtons();
        if (storyMode && !['jesse', 'vitalik', 'dan'].includes(person.id))
          exitStory();
        if (paused || reduced.matches) finishConnection();
        else requestDraw();
      };
      meshLayer.append(button);
      meshWallets.push(node);
    });
  });
  function cancelConnection() {
    if (!connectionReveal) return;
    connectionReveal.button.classList.remove('tracing');
    accounts[connectionReveal.accountIndex].el.classList.remove(
      'discovery-target'
    );
    connectionReveal = null;
    pinned = active >= 0;
    scene.classList.remove('discovering-connection');
  }
  function finishConnection() {
    if (!connectionReveal) return;
    const { accountIndex, walletIndex, button } = connectionReveal;
    const moveFocus = root.activeElement === button;
    cancelConnection();
    select(accountIndex, true);
    walletElements[walletIndex]?.click();
    if (moveFocus)
      detail.querySelector('.close')?.focus({ preventScroll: true });
  }
  function drawConnection() {
    if (!connectionReveal) return;
    const reveal = connectionReveal;
    const from = { x: reveal.from.x * w, y: reveal.from.y * h };
    const to = accounts[reveal.accountIndex].position;
    if (!to) return;
    const elapsed = clock - reveal.start;
    const progress = Math.min(1, elapsed / 1250);
    const bend = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2 - Math.min(55, Math.abs(from.x - to.x) * 0.18),
    };
    const at = (t) => ({
      x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * bend.x + t * t * to.x,
      y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * bend.y + t * t * to.y,
    });
    // This arc represents the selected wallet's indexed identity link only.
    ctx.strokeStyle = tint(ink, 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(bend.x, bend.y, to.x, to.y);
    ctx.stroke();
    const end = progress * progress * (3 - 2 * progress);
    ctx.strokeStyle = tint(ink, 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    for (let j = 1; j <= 32; j++) {
      const point = at((end * j) / 32);
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
    const head = at(end);
    ctx.fillStyle = tint(ink, 0.12);
    ctx.beginPath();
    ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tint(ink, 0.95);
    ctx.beginPath();
    ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (progress === 1) {
      const arrival = Math.min(1, (elapsed - 1250) / 350);
      ctx.strokeStyle = tint(ink, 0.45 * (1 - arrival));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        to.x,
        to.y,
        accounts[reveal.accountIndex].layout[2] / 2 + 6 + arrival * 12,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  }
  let meshLayoutKey = '';
  function placeMeshWallets(points) {
    const key = `${w}:${h}:${storyMode}`;
    if (key === meshLayoutKey) return;
    meshLayoutKey = key;
    const mobile = w < 600;
    const sceneBox = scene.getBoundingClientRect();
    const sampleBox = storyMode
      ? $('#sample-panel').getBoundingClientRect()
      : null;
    const used = [];
    let shown = 0;
    meshWallets.forEach((node) => {
      node.vertex = -1;
      if (mobile && (!mobileIds.includes(node.person.id) || shown >= 4)) return;
      const targets = mobile
        ? [
            [0.17, 0.57],
            [0.83, 0.57],
            [0.16, 0.82],
            [0.84, 0.9],
          ]
        : [
            [0.4, 0.32],
            [0.49, 0.78],
            [0.65, 0.28],
            [0.69, 0.85],
            [0.9, 0.48],
            [0.94, 0.78],
            [0.4, 0.91],
            [0.57, 0.37],
            [0.81, 0.86],
            [0.48, 0.54],
            [0.71, 0.4],
            [0.9, 0.18],
            [0.15, 0.86],
            [0.12, 0.43],
          ];
      const [nx, ny] = targets[shown % targets.length];
      let best = Infinity;
      points.forEach((point, index) => {
        if (
          point.x < 27 ||
          point.x > w - 27 ||
          point.y < 115 ||
          point.y > h - 30
        )
          return;
        if (
          sampleBox &&
          point.x < sampleBox.right - sceneBox.left + 28 &&
          point.y < sampleBox.bottom - sceneBox.top + 28
        )
          return;
        if (
          used.some(
            (p) => Math.hypot(p.x - point.x, p.y - point.y) < (mobile ? 60 : 68)
          )
        )
          return;
        if (
          accounts.some((p) => {
            if (storyMode && !['jesse', 'vitalik', 'dan'].includes(p.id))
              return false;
            if (mobile && !mobileIds.includes(p.id)) return false;
            const pos = personPosition(p);
            return (
              Math.hypot(pos.x - point.x, (pos.y + 15 - point.y) * 0.85) <
              p.layout[2] / 2 + 43
            );
          })
        )
          return;
        const score = (point.x - nx * w) ** 2 + (point.y - ny * h) ** 2;
        if (score < best) {
          best = score;
          node.vertex = index;
        }
      });
      if (node.vertex >= 0) {
        used.push(points[node.vertex]);
        shown++;
      }
    });
  }
  function project(p) {
    // A shared flow field keeps nearby points moving together, like a suspended
    // fabric. Long, unequal periods avoid a visible synchronized breathing loop.
    // All motion uses the existing clock, so pause/offscreen state freezes it.
    const time = reduced.matches ? 0 : clock / 1000;
    const flow = Math.sin(time * 0.19 + p.x * 4.2 + p.z * 1.3);
    const crossflow = Math.sin(time * 0.13 - p.y * 3.5 + p.x * 2.1);
    const quiet = 1 - focus * 0.6;
    const driftX = (flow * 1.1 + crossflow * 0.4) * quiet;
    const driftY =
      (crossflow * 1.2 + Math.sin(time * 0.27 + p.x * 5) * 0.4) * quiet;
    const yaw = px * 0.08,
      tilt = py * 0.055;
    const depth = p.z + flow * 0.018 * quiet;
    const x = p.x * Math.cos(yaw) + depth * 0.18 * Math.sin(yaw),
      z = depth * Math.cos(yaw) - p.x * Math.sin(yaw),
      y = p.y * Math.cos(tilt) - z * 0.2 * Math.sin(tilt);
    // A soft ~6-second throb, with a slight phase offset across the web.
    // Modulate existing geometry/ink, not extra glow layers or flashing nodes.
    const pulse = reduced.matches
      ? 0
      : Math.sin((time * Math.PI) / 3 - p.x * 0.65);
    const breath = 1 + pulse * 0.006 * quiet;
    const perspective = breath / (1 + z * 0.25);
    const amplitude = Math.min(1, w / 900);
    return {
      x: w * 0.5 + x * w * perspective + driftX * amplitude,
      y: h * 0.51 + y * h * perspective + driftY * amplitude,
      scale: perspective,
      depth: (z + 1) * 0.5,
      shimmer: 1 + pulse * 0.16 * quiet,
    };
  }
  function walletPosition(j, total) {
    const center = accounts[active].position;
    if (w < 600) {
      // Two quiet columns leave the portrait clear and keep address pills inside
      // narrow cards, including accounts with many indexed wallets.
      const column = j % 2;
      const count = Math.ceil((total - column) / 2);
      const row = Math.floor(j / 2);
      const span = Math.min(200, Math.max(100, (count - 1) * 48));
      return {
        x: w * (column ? 0.81 : 0.19),
        y: center.y + (count === 1 ? 0 : (row / (count - 1) - 0.5) * span),
      };
    }
    const angle = -Math.PI / 2 + (j * Math.PI * 2) / total;
    const rx = w < 600 ? Math.min(w * 0.345, 140) : Math.min(w * 0.2, 255);
    const ry = w < 600 ? 105 : Math.min(h * 0.285, 155);
    return {
      x: center.x + Math.cos(angle) * rx,
      y: center.y + Math.sin(angle) * ry,
    };
  }
  function revealProgress(delay, duration) {
    if (paused || reduced.matches) return 1;
    const t = Math.max(
      0,
      Math.min(1, (clock - revealStart - delay) / duration)
    );
    return t * t * (3 - 2 * t);
  }
  const tint = (color, opacity) =>
    `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
  function draw() {
    ctx.clearRect(0, 0, w, h);
    const points = particles.map(project),
      dim = (1 - focus * 0.68) * (connectionReveal ? 0.72 : 1);
    const pulseInk = reduced.matches
      ? 1
      : 1 + 0.16 * (1 - focus * 0.6) * Math.sin((clock * Math.PI) / 3000);
    // Batch the ambient mesh into a handful of opacity bands instead of
    // thousands of canvas strokes and CSS color parses per frame.
    const edgeBands = Array.from({ length: 12 }, () => []);
    for (const edge of edges) {
      const p = points[edge[0]],
        q = points[edge[1]];
      const near = Math.max(0, Math.min(1, 1 - (p.depth + q.depth) / 2));
      const alpha = (light ? 0.24 : 0.21) * (0.2 + 1.2 * near ** 1.7) * dim;
      edgeBands[Math.min(11, Math.max(0, Math.round(alpha * 30)))].push(edge);
    }
    edgeBands.forEach((band, index) => {
      if (!band.length) return;
      ctx.strokeStyle = tint(line, (index / 30) * pulseInk);
      ctx.lineWidth = 0.35 + index * 0.035;
      ctx.beginPath();
      for (const [a, b] of band) {
        ctx.moveTo(points[a].x, points[a].y);
        ctx.lineTo(points[b].x, points[b].y);
      }
      ctx.stroke();
    });
    const pointBands = Array.from({ length: 16 }, () => []);
    points.forEach((p, i) =>
      pointBands[
        Math.min(
          15,
          Math.max(
            0,
            Math.round(
              (0.12 + 0.72 * Math.max(0, 1 - p.depth) ** 1.4) * dim * 20
            )
          )
        )
      ].push(i)
    );
    pointBands.forEach((band, index) => {
      if (!band.length) return;
      ctx.fillStyle = tint(ink, (index / 20) * pulseInk);
      ctx.beginPath();
      for (const i of band) {
        const p = points[i],
          radius = particles[i].size * p.scale;
        ctx.moveTo(p.x + radius, p.y);
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    });
    if (!paused && !reduced.matches) {
      for (let i = 0; i < 12; i++) {
        const edge = edges[(i * 131) % edges.length],
          a = points[edge[0]],
          b = points[edge[1]],
          t = (clock * 0.000055 + i * 0.231) % 1;
        ctx.fillStyle = tint(ink, 0.55 * dim * Math.sin(Math.PI * t) ** 2);
        ctx.beginPath();
        ctx.arc(
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          1.3,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
    placeMeshWallets(points);
    meshLayer.hidden = active >= 0;
    meshWallets.forEach(({ button, vertex }) => {
      button.hidden = vertex < 0;
      if (vertex < 0) return;
      const point =
        connectionReveal?.button === button
          ? { x: connectionReveal.from.x * w, y: connectionReveal.from.y * h }
          : points[vertex];
      button.style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
      button.classList.toggle('hint-left', point.x > w - 170);
    });
    accounts.forEach((p, i) => {
      const hidden = storyMode
        ? !['jesse', 'vitalik', 'dan'].includes(p.id)
        : w < 600 && !mobileIds.includes(p.id);
      p.el.hidden = hidden;
      if (hidden) return;
      const goal = personPosition(p);
      const ease = paused || reduced.matches ? 1 : 1 - Math.exp(-delta / 320);
      const pos = p.position || { ...goal };
      pos.x += (goal.x - pos.x) * ease;
      pos.y += (goal.y - pos.y) * ease;
      p.position = pos;
      const selected = i === active,
        scale = selected ? 1 + focus * 0.1 : 1 - focus * 0.12;
      const opacity = selected
        ? 1
        : (1 - focus * 0.79) *
          (connectionReveal && connectionReveal.accountIndex !== i ? 0.5 : 1);
      p.el.style.transform = `translate3d(${pos.x}px,${pos.y}px,0) scale(${scale})`;
      p.el.style.opacity = opacity;
      p.el.style.zIndex = selected ? 5 : Math.round(p.layout[3] * 3);
      p.button.tabIndex = hidden ? -1 : 0;
      if (!selected) {
        ctx.strokeStyle = tint(line, (i === preview ? 0.55 : 0.3) * dim);
        ctx.lineWidth = i === preview ? 1 : 0.7;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, p.layout[2] * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        const m = p.wallets.length;
        for (let j = 0; j < m; j++) {
          const a = (j / m) * Math.PI * 2 + 0.3,
            rx = p.layout[2] * 1.0,
            ry = p.layout[2] * 0.7;
          const ex = pos.x + Math.cos(a) * rx,
            ey = pos.y + Math.sin(a) * ry;
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.fillStyle = tint(ink, 0.65 * dim);
          ctx.beginPath();
          ctx.arc(ex, ey, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    drawConnection();
    if (storyMode && storyPhase !== 'input' && !connectionReveal) {
      const bounds = scene.getBoundingClientRect();
      const elapsed = Math.max(0, clock - storyStart - 2400);
      const progress =
        reduced.matches || paused || storyPhase === 'results'
          ? 1
          : Math.min(1, elapsed / 2100);
      root.querySelectorAll('.sample-row[data-handle]').forEach((row) => {
        const person = accounts.find((p) => p.handle === row.dataset.handle);
        if (!person?.position) return;
        const box = row.getBoundingClientRect();
        const from =
          w < 600
            ? {
                x: box.left - bounds.left + box.width * 0.5,
                y: box.bottom - bounds.top,
              }
            : {
                x: box.right - bounds.left + 20,
                y: box.top - bounds.top + box.height / 2,
              };
        const to = person.position;
        ctx.strokeStyle = tint(ink, 0.45);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        for (let step = 1; step <= 40; step++) {
          const t = (step / 40) * progress;
          const x =
            (1 - t) ** 3 * from.x +
            3 * (1 - t) ** 2 * t * (from.x + 70) +
            3 * (1 - t) * t * t * (to.x - 90) +
            t ** 3 * to.x;
          const y =
            (1 - t) ** 3 * from.y +
            3 * (1 - t) ** 2 * t * from.y +
            3 * (1 - t) * t * t * to.y +
            t ** 3 * to.y;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    }
    if (active >= 0) {
      const p = accounts[active],
        center = p.position;
      walletElements.forEach((el, j) => {
        const goal = walletPosition(j, p.wallets.length);
        const amount =
          reduced.matches || paused ? 1 : revealProgress(450 + j * 140, 1500);
        const ex = center.x + (goal.x - center.x) * amount,
          ey = center.y + (goal.y - center.y) * amount;
        el.style.left = ex + 'px';
        el.style.top = ey + 'px';
        el.classList.toggle('visible', amount > 0.65);
        el.style.pointerEvents = amount > 0.65 ? 'auto' : 'none';
        ctx.strokeStyle = tint(ink, 0.6 * amount);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.quadraticCurveTo(center.x + (ex - center.x) * 0.35, ey, ex, ey);
        ctx.stroke();
        if (!paused && !reduced.matches) {
          const t = (clock * 0.00024 + j * 0.13) % 1;
          const x =
              (1 - t) ** 2 * center.x +
              2 * (1 - t) * t * (center.x + (ex - center.x) * 0.35) +
              t * t * ex,
            y = (1 - t) ** 2 * center.y + 2 * (1 - t) * t * ey + t * t * ey;
          ctx.fillStyle = tint(ink, amount);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      if (w >= 1050) {
        socialNodes.querySelectorAll('.social-node').forEach((el, k) => {
          const sx = center.x + Math.min(w * 0.2, 255) + 105,
            sy = center.y + (k === 0 ? -52 : 52);
          el.style.transform = `translate3d(${sx}px,${sy}px,0)`;
          const progress = revealProgress(k === 0 ? 600 : 1600, 1200);
          el.style.opacity = progress * (k === 0 ? 1 : 0.65);
          el.style.pointerEvents = progress > 0.65 ? 'auto' : 'none';
          ctx.strokeStyle = tint(ink, (k === 0 ? 0.65 : 0.25) * progress);
          ctx.setLineDash(k === 0 && !p.xVerified ? [4, 5] : []);
          ctx.beginPath();
          ctx.moveTo(center.x, center.y);
          ctx.bezierCurveTo(
            center.x + 120,
            center.y - 50,
            sx - 120,
            sy,
            sx,
            sy
          );
          ctx.stroke();
          ctx.setLineDash([]);
        });
      }
      // One quiet focus halo, physically tied to the selected identity.
      ctx.strokeStyle = tint(ink, 0.18 * focus);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(
        center.x,
        center.y,
        w < 600 ? 95 : 125,
        w < 600 ? 72 : 86,
        -0.2,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  }
  function tick(time) {
    frame = 0;
    if (!visible || document.hidden) return;
    if (!paused && !reduced.matches && last && time - last < 32) {
      frame = requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(time - (last || time), 64);
    last = time;
    delta = dt;
    const moving = !paused && !reduced.matches;
    if (moving) {
      clock += dt;
      px += (tx - px) * 0.045;
      py += (ty - py) * 0.045;
      focus += (targetFocus - focus) * (1 - Math.exp(-dt / 520));
    } else focus = targetFocus;
    if (
      connectionReveal &&
      (paused || reduced.matches || clock - connectionReveal.start >= 1600)
    )
      finishConnection();
    draw();
    if (moving) frame = requestAnimationFrame(tick);
  }
  function requestDraw() {
    if (!disposed && !frame && visible && !document.hidden)
      frame = requestAnimationFrame(tick);
  }
  function resize() {
    w = scene.clientWidth;
    h = scene.clientHeight;
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Paint the initial layout even when Safari defers animation frames in a background tab.
    if (w && h) draw();
    requestDraw();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(scene);
  const detailObserver = new ResizeObserver(() => {
    if (!detail.hidden)
      scene.style.setProperty(
        '--identity-card-height',
        `${detail.offsetHeight}px`
      );
  });
  detailObserver.observe(detail);
  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      if (visible) {
        last = 0;
        requestDraw();
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    { threshold: 0.05 }
  );
  intersectionObserver.observe(scene);
  on(document, 'visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      stopDemo();
    } else {
      last = 0;
      requestDraw();
    }
  });
  function theme() {
    const style = getComputedStyle(root.host);
    light = !root.host.closest('.dark');
    ink = style.getPropertyValue('--accent-brand');
    line = style.getPropertyValue('--accent-brand');
    requestDraw();
  }
  function motionLabel() {
    scene.classList.toggle('motion-paused', paused);
    $('#motion').innerHTML = icon(paused ? 'Play' : 'Pause');
    $('#motion').setAttribute(
      'aria-label',
      paused ? 'Resume animation' : 'Pause animation'
    );
    $('#motion').setAttribute('aria-pressed', String(paused));
    $('#motion').title = paused ? 'Resume animation' : 'Pause animation';
    $('#motion').disabled = reduced.matches;
  }
  $('#motion').onclick = () => {
    paused = !paused;
    if (paused)
      detail.getAnimations().forEach((animation) => animation.finish());
    stopDemo();
    motionLabel();
    requestDraw();
  };
  on(reduced, 'change', () => {
    paused = reduced.matches;
    if (paused)
      detail.getAnimations().forEach((animation) => animation.finish());
    px = py = tx = ty = 0;
    stopDemo();
    motionLabel();
    requestDraw();
  });
  updateViewButtons();
  motionLabel();
  theme();
  resize();

  $('#scene-instructions').textContent =
    'Wallet icons are real indexed records · Background web illustrative';
  $('#rest-caption').textContent =
    'Explore a wallet or 𝕏 profile to see its connections.';
  startStory();

  const themeObserver = new MutationObserver(theme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
  return () => {
    disposed = true;
    lifetime.abort();
    cancelAnimationFrame(frame);
    demoTimers.forEach(clearTimeout);
    resizeObserver.disconnect();
    detailObserver.disconnect();
    intersectionObserver.disconnect();
    themeObserver.disconnect();
    root
      .querySelectorAll('*')
      .forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    root.replaceChildren();
  };
}
