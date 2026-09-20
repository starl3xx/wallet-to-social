export const markup = `      <section
        class="graph-shell"
        aria-label="Explore public identities in walletlink"
      >
        <div id="scene" class="scene" aria-describedby="scene-instructions">
          <canvas id="web" aria-hidden="true"></canvas>
          <div class="scene-shading" aria-hidden="true"></div>
          <div class="scene-top">
            <div class="scene-tools">
              <div class="segmented" role="group" aria-label="Graph view">
                <button id="view-wallets" aria-pressed="false">Wallets</button>
                <button id="view-people" aria-pressed="true" aria-label="X profiles">𝕏 profiles</button>
              </div>
              <button
                id="reveal"
                aria-label="Replay the lookup"
                title="Replay the lookup"
              >
                <span data-icon="Play"></span>
              </button>
              <button
                id="motion"
                aria-pressed="false"
                aria-label="Pause animation"
                title="Pause animation"
              >
                <span data-icon="Pause"></span>
              </button>
              <button id="reset" class="reset" hidden>
                <span data-icon="ArrowLeft"></span> All profiles
              </button>
            </div>
            <div class="toolbar-context">
              <p id="scene-instructions">
                Wallets to people, through real indexed connections.
              </p>
              <span id="sample-count" hidden></span>
              <div id="rest-caption" class="rest-caption">
                Hover a profile to explore its wallets.
              </div>
            </div>
          </div>
          <aside id="sample-panel" aria-label="Example wallet list" hidden>
            <div class="sample-eyebrow">
              EXAMPLE WALLET LIST <span id="sample-stage">01 / INPUT</span>
            </div>
            <h2 id="sample-title">Five addresses.<br />Who’s behind them?</h2>
            <p id="sample-description">
              Watch a wallet list turn into people you can reach.
            </p>
            <div id="sample-rows"></div>
            <p id="sample-outcome" role="status" aria-live="polite"></p>
            <p class="sample-disclosure">
              Curated sample · not a coverage estimate.<br />Includes one
              synthetic, unmatched address.
            </p>
            <button id="explore-graph" hidden>
              Explore the connections <span data-icon="ArrowUpRight"></span>
            </button>
          </aside>
          <div id="nodes"></div>
          <div
            id="wallets"
            aria-label="Wallets linked to the selected identity"
          ></div>
          <aside
            id="detail"
            aria-label="Selected public identity"
            hidden
          ></aside>
          <p id="load-error" role="status" hidden>
            The profile snapshot couldn’t load.
            <button id="retry">Try again</button>
          </p>
        </div>
      </section>
`;
export const styles = `


* {
  box-sizing: border-box;
}
:host {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font:
    14px Sohne,
    system-ui,
    sans-serif;
  -webkit-font-smoothing: antialiased;
}
a {
  color: inherit;
  text-decoration: none;
}
button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  border: 0;
  background: none;
}
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--accent-brand);
  outline-offset: 5px;
}
button:active,
.button:active {
  transform: scale(0.98);
}
[hidden] {
  display: none !important;
}
header {
  height: 64px;
  margin: 0 auto;
  padding: 0 48px;
  max-width: 1500px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.8px;
}
.brand img {
  margin-right: 10px;
  border-radius: 9px;
}
.brand > span {
  font-weight: 400;
  color: var(--muted-foreground);
}
.nav-right {
  display: flex;
  align-items: center;
  gap: 24px;
}
.preview-tag {
  color: var(--muted-foreground);
  font-size: 11px;
}
.nav-right button {
  font-size: 12px;
  color: var(--muted-foreground);
}
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 30px;
  white-space: nowrap;
  background: var(--accent-brand);
  color: var(--accent-brand-foreground);
  border-radius: 100px;
  padding: 0 24px;
  height: 48px;
  font-weight: 600;
}
.button.small {
  height: 34px;
  font-size: 12px;
  padding: 0 18px;
}
.intro {
  max-width: 1404px;
  margin: 0 auto;
  padding: 32px 0 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
}
.intro h1 {
  font-size: 42px;
  letter-spacing: -1.9px;
  font-weight: 300;
  line-height: 1.1;
  margin: 0 0 10px;
}
.intro em {
  color: var(--accent-brand);
  font-style: normal;
  font-weight: 600;
}
.intro p {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 16px;
  font-weight: 300;
}
.index-stat {
  text-align: right;
}
.index-stat strong {
  font-weight: 300;
  font-size: 36px;
  letter-spacing: -1.5px;
}
.index-stat span {
  display: block;
  color: var(--muted-foreground);
  font-size: 11px;
  margin-top: 4px;
}
.graph-shell {
  max-width: 1500px;
  margin: auto;
  border-block: 1px solid var(--border);
}
.scene {
  width: 100%;
  position: relative;
  isolation: isolate;
  aspect-ratio: 3/1;
  min-height: 440px;
  background: var(--background);
  overflow: hidden;
}
.scene:before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse at 48% 62%,
    color-mix(in srgb, var(--accent-brand) 14%, transparent),
    transparent 58%
  );
}
#web {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.scene-shading {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background:
    linear-gradient(
      0deg,
      color-mix(in srgb, var(--background) 93%, transparent),
      transparent 19%,
      transparent 78%,
      color-mix(in srgb, var(--background) 65%, transparent)
    ),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--background) 65%, transparent),
      transparent 12%,
      transparent 90%,
      color-mix(in srgb, var(--background) 65%, transparent)
    );
}
.scene-top {
  position: absolute;
  left: 48px;
  right: 48px;
  top: 24px;
  z-index: 7;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
}
.scene-kicker {
  font-size: 12px;
  font-weight: 600;
}
.scene-top p {
  font-size: 11px;
  color: var(--muted-foreground);
  margin: 6px 0;
}
.scene-tools {
  display: flex;
  gap: 15px;
  align-items: flex-start;
  pointer-events: auto;
}
.segmented {
  display: flex;
  background: var(--card);
  border: 1px solid var(--border);
  padding: 3px;
  border-radius: 100px;
  box-shadow: 0 3px 16px color-mix(in srgb, var(--background) 15%, transparent);
}
.segmented button {
  font-size: 11px;
  border-radius: 100px;
  padding: 6px 14px;
  color: var(--muted-foreground);
}
.segmented [aria-pressed='true'] {
  background: var(--accent-brand);
  color: var(--accent-brand-foreground);
}
#motion {
  width: 30px;
  height: 32px;
  font-size: 14px;
  color: var(--muted-foreground);
}
#nodes,
#wallets {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}
.person {
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  will-change: transform;
  pointer-events: none;
}
.person-button {
  position: absolute;
  top: 0;
  left: 0;
  transform: translate(-50%, -50%);
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--accent-brand) 70%, transparent);
  background: var(--card);
  pointer-events: auto;
  box-shadow:
    0 0 0 7px color-mix(in srgb, var(--background) 65%, transparent),
    0 14px 40px color-mix(in srgb, var(--background) 35%, transparent);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.person-button:active {
  transform: translate(-50%, -50%) scale(0.96);
}
.person-button > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  position: relative;
  z-index: 1;
}
.person-button .fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--accent-brand);
  font-size: 17px;
}
.person-button .platform {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  z-index: 2;
}
.platform img {
  width: 13px;
  height: 13px;
}
.person-name {
  position: absolute;
  left: 0;
  top: calc(var(--size) / 2 + 13px);
  transform: translateX(-50%);
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: center;
  pointer-events: none;
}
.person-name strong {
  font-weight: 600;
  font-size: 12px;
  background: color-mix(in srgb, var(--background) 85%, transparent);
  padding: 4px 8px;
  border-radius: 6px;
}
.person-name small {
  font-family: monospace;
  color: var(--muted-foreground);
  font-size: 10px;
}
.person.anchor .person-name strong {
  font-size: 14px;
}
.person.selected .person-button {
  border: 2px solid var(--accent-brand);
  box-shadow:
    0 0 0 8px color-mix(in srgb, var(--accent-brand) 10%, transparent),
    0 0 0 22px color-mix(in srgb, var(--accent-brand) 3.5%, transparent),
    0 0 80px color-mix(in srgb, var(--accent-brand) 20%, transparent);
}
.person.previewed .person-button {
  border-color: var(--accent-brand);
  box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent-brand) 12%, transparent);
}
.person.previewed .identity-label {
  color: var(--accent-brand);
}
.person.selected .person-name strong {
  color: var(--accent-brand);
  font-size: 15px;
}
.person.selected .person-name small {
  display: none;
}
.wallet-node {
  position: absolute;
  top: 0;
  left: 0;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  white-space: nowrap;
  border: 1px solid color-mix(in srgb, var(--accent-brand) 60%, var(--border));
  background: var(--card);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--foreground);
  font: 10px monospace;
  box-shadow: 0 4px 24px color-mix(in srgb, var(--background) 30%, transparent);
  opacity: 0;
  transition:
    opacity 0.7s,
    background 0.2s;
}
.wallet-node.visible {
  opacity: 1;
}
.wallet-node:before {
  content: '';
  display: inline-block;
  vertical-align: middle;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--attested);
  margin-right: 8px;
}
.wallet-node.custody:before {
  background: var(--accent-brand);
}
.wallet-node:hover,
.wallet-node[aria-pressed='true'] {
  background: var(--accent-brand);
  color: var(--accent-brand-foreground);
}
.rest-caption {
  position: absolute;
  bottom: 22px;
  left: 48px;
  z-index: 5;
  pointer-events: none;
}
.rest-caption > span {
  font-size: 18px;
  font-weight: 300;
  letter-spacing: -0.3px;
}
.rest-caption p {
  font-size: 11px;
  color: var(--muted-foreground);
  margin: 6px 0 0;
}
.reset {
  position: absolute;
  left: 48px;
  bottom: 20px;
  z-index: 6;
  color: var(--accent-brand);
  font-size: 12px;
  padding: 7px 0;
}
.graph-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 48px;
  background: var(--background);
  gap: 16px;
}
.sample-count {
  font-size: 11px;
  color: var(--muted-foreground);
  display: flex;
  gap: 16px;
  align-items: center;
}
.sample-count > span:first-child {
  color: var(--foreground);
}
.footer-divider {
  opacity: 0.5;
}
.explore-actions {
  display: flex;
  gap: 24px;
}
.explore-actions button {
  font-size: 11px;
  color: var(--muted-foreground);
  padding: 5px 0;
}
.explore-actions button:hover {
  color: var(--foreground);
}
.explore-actions span {
  color: var(--accent-brand);
  margin-left: 7px;
}
#detail {
  position: absolute;
  right: 48px;
  top: 88px;
  bottom: 34px;
  width: 302px;
  z-index: 6;
  padding: 23px;
  background: var(--card);
  border: 1px solid color-mix(in srgb, var(--accent-brand) 45%, transparent);
  border-radius: 14px;
  box-shadow: 0 24px 80px color-mix(in srgb, var(--background) 30%, transparent);
  backdrop-filter: blur(18px);
  overflow: visible;
  animation: none;
}
.detail-top {
  display: flex;
  align-items: center;
  gap: 9px;
}
.detail-top img {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}
.detail-top > span {
  font-size: 13px;
  font-weight: 600;
}
.detail-top .close {
  margin-left: auto;
  font-size: 19px;
  color: var(--muted-foreground);
}
.detail-headline {
  font-size: 32px;
  line-height: 1.02;
  font-weight: 300;
  letter-spacing: -1px;
  margin: 18px 0 8px;
}
.detail-headline strong {
  font-weight: 600;
  color: var(--accent-brand);
}
.detail-summary {
  font-size: 11px;
  color: var(--muted-foreground);
  line-height: 1.5;
  margin: 0 0 15px;
}
.social-link {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  padding: 9px 0;
  border-top: 1px solid var(--border);
}
.social-link .social-mark {
  display: grid;
  place-items: center;
  width: 19px;
  font-size: 17px;
}
.social-mark img {
  width: 14px;
  height: 14px;
}
.social-link .arrow {
  margin-left: auto;
  color: var(--muted-foreground);
}
.detail-source {
  font-size: 10px;
  line-height: 1.5;
  color: var(--muted-foreground);
  margin: 12px 0 0;
}
.detail-source strong {
  color: var(--attested);
  font-weight: 400;
}
.detail-source .neutral {
  color: var(--muted-foreground);
}
.wallet-info {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  font-size: 10px;
  line-height: 1.5;
}
.wallet-info a {
  color: var(--accent-brand);
  font-family: monospace;
  overflow-wrap: anywhere;
}
.wallet-info span {
  display: block;
  color: var(--muted-foreground);
  margin-top: 4px;
}
.conversion {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 30px;
  max-width: 1404px;
  margin: 26px auto 0;
  padding: 24px 28px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card);
}
.conversion-lead {
  font-size: 21px;
  letter-spacing: -0.5px;
  font-weight: 300;
}
.conversion p {
  font-size: 12px;
  color: var(--muted-foreground);
  margin: 8px 0 0;
}
.provenance {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  max-width: 1404px;
  margin: 12px auto 24px;
  font-size: 10px;
  color: var(--muted-foreground);
  line-height: 1.6;
}
.provenance button {
  font-size: 11px;
  white-space: nowrap;
}
#notes {
  max-width: 1000px;
  margin: 40px auto;
  padding: 0 30px 30px;
  line-height: 1.8;
  color: var(--muted-foreground);
}
#notes h2 {
  font-size: 30px;
  color: var(--foreground);
  font-weight: 300;
}
#notes a {
  color: var(--accent-brand);
  text-decoration: underline;
}
#load-error {
  position: absolute;
  left: 10%;
  right: 10%;
  top: 40%;
  z-index: 9;
  text-align: center;
  background: var(--card);
  padding: 20px;
  border-radius: 14px;
}
#load-error button {
  color: var(--accent-brand);
  text-decoration: underline;
}
@keyframes materialize {
  from {
    opacity: 0;
    transform: translateX(12px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
@container identity-hero (max-width: 1500px) {
  .intro,
  .conversion,
  .provenance {
    margin-left: 48px;
    margin-right: 48px;
  }
}
@container identity-hero (max-width: 1000px) {
  .scene {
    min-height: 440px;
  }
  header {
    padding-inline: 28px;
  }
  .intro,
  .conversion,
  .provenance {
    margin-inline: 28px;
  }
  .scene-top {
    left: 28px;
    right: 28px;
  }
  .graph-footer {
    padding-inline: 28px;
  }
  .sample-count > span:not(:first-child) {
    display: none;
  }
  .rest-caption,
  .reset {
    left: 28px;
  }
  #detail {
    right: 28px;
    width: 280px;
    padding: 20px;
  }
  .explore-actions {
    gap: 18px;
  }
  .intro h1 {
    font-size: 38px;
  }
}
@container identity-hero (max-width: 600px) {
  header {
    height: 60px;
    padding-inline: 20px;
  }
  .brand {
    font-size: 20px;
  }
  .brand > span,
  .preview-tag,
  .button.small {
    display: none;
  }
  .nav-right {
    gap: 0;
  }
  .intro {
    padding: 24px 0;
    margin-inline: 20px;
    gap: 12px;
  }
  .intro h1 {
    font-size: 34px;
  }
  .intro p {
    font-size: 14px;
    max-width: 280px;
    line-height: 1.5;
  }
  .index-stat {
    display: none;
  }
  .scene {
    min-height: 510px;
    aspect-ratio: auto;
  }
  .scene.focused {
    min-height: 760px;
  }
  .scene-top {
    top: 20px;
    left: 20px;
    right: 20px;
  }
  .scene-top p {
    max-width: 150px;
    line-height: 1.5;
  }
  .scene-tools {
    gap: 5px;
  }
  .segmented button {
    padding: 6px 10px;
    font-size: 10px;
  }
  .person.anchor .person-name strong {
    font-size: 12px;
  }
  .person-name strong {
    font-size: 11px;
  }
  .rest-caption,
  .reset {
    left: 20px;
  }
  .rest-caption > span {
    font-size: 17px;
  }
  .rest-caption p {
    font-size: 10px;
    max-width: 260px;
    line-height: 1.5;
  }
  #detail {
    top: auto;
    bottom: 55px;
    left: 20px;
    right: 20px;
    width: auto;
    height: 310px;
    padding: 18px 20px;
  }
  .detail-headline {
    font-size: 28px;
    margin: 12px 0 7px;
  }
  .detail-summary {
    margin-bottom: 10px;
  }
  .detail-source {
    margin-top: 9px;
  }
  .detail-top img {
    width: 24px;
    height: 24px;
  }
  .wallet-node {
    font-size: 9px;
    padding: 7px;
  }
  .graph-footer {
    padding: 14px 20px;
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .explore-actions {
    width: 100%;
    justify-content: space-between;
    gap: 10px;
  }
  .explore-actions button {
    font-size: 10px;
  }
  .conversion {
    margin: 20px 20px 0;
    padding: 22px;
    align-items: stretch;
    flex-direction: column;
    gap: 20px;
  }
  .conversion-lead {
    font-size: 20px;
  }
  .conversion p {
    line-height: 1.6;
  }
  .provenance {
    margin: 10px 20px 24px;
    align-items: flex-start;
  }
  .provenance p {
    margin: 0;
    font-size: 9px;
    max-width: 215px;
  }
  .provenance button {
    font-size: 10px;
  }
  .scene.focused .scene-top p {
    visibility: hidden;
  }
  .wallet-info {
    font-size: 9px;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *:before,
  *:after {
    animation: none !important;
    transition: none !important;
  }
}
@media (prefers-reduced-transparency: reduce) {
  #detail {
    background: var(--card);
    backdrop-filter: none;
  }
}
#detail {
  top: 80px;
  bottom: 20px;
  padding: 18px 20px;
}
.detail-headline {
  font-size: 30px;
  margin: 13px 0 7px;
}
.detail-summary {
  margin-bottom: 11px;
}
.detail-summary a {
  color: var(--accent-brand);
  overflow-wrap: anywhere;
  font: 10px monospace;
}
.detail-summary span {
  display: block;
  font-size: 10px;
  margin-top: 4px;
}
.social-link {
  padding: 8px 0;
}
.detail-source {
  margin-top: 9px;
  font-size: 10px;
  line-height: 1.4;
}
#social-nodes {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}
.social-node {
  position: absolute;
  top: -20px;
  left: -20px;
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: auto;
  font-size: 12px;
  color: var(--accent-brand);
}
.social-orb {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: var(--card);
  border: 1px solid var(--accent-brand);
  border-radius: 50%;
  font-size: 22px;
  box-shadow: 0 0 25px color-mix(in srgb, var(--accent-brand) 12%, transparent);
}
.social-orb > img {
  width: 23px;
  height: 23px;
  object-fit: cover;
  border-radius: 50%;
}
.social-node small {
  display: block;
  font-size: 9px;
  color: var(--muted-foreground);
  margin-top: 5px;
}
.rest-caption {
  bottom: 14px;
}
.person-name small {
  opacity: 0.7;
}
@container identity-hero (max-width: 1049px) {
  #social-nodes {
    display: none;
  }
}
@container identity-hero (max-width: 600px) {
  #detail {
    top: auto;
    bottom: 55px;
    height: 310px;
    padding: 18px 20px;
  }
  .detail-headline {
    font-size: 28px;
    margin: 10px 0 6px;
  }
  .detail-summary {
    margin-bottom: 8px;
  }
  .person-name small {
    display: none;
  }
  .scene.focused .person:not(.selected) {
    visibility: hidden;
  }
}

/* X is the primary identity; Farcaster remains supporting evidence. */
.social-node:first-child {
  font-size: 13px;
  font-weight: 600;
}
.social-node:first-child .social-orb {
  width: 48px;
  height: 48px;
}
.social-node:first-child .social-orb > img {
  width: 40px;
  height: 40px;
}
.social-node:nth-child(2) {
  font-size: 11px;
}
.social-node:nth-child(2) .social-orb {
  width: 32px;
  height: 32px;
}

/* Wallet-to-person choreography: expand, resolve portrait, then name. */
.person-button {
  transition:
    width 1800ms cubic-bezier(0.22, 1, 0.36, 1) var(--reveal-delay),
    height 1800ms cubic-bezier(0.22, 1, 0.36, 1) var(--reveal-delay),
    border-radius 1800ms ease var(--reveal-delay),
    box-shadow 1200ms ease;
}
.person-button > img {
  clip-path: circle(72% at 50% 50%);
  filter: blur(0);
  opacity: 1;
  transform: scale(1);
  transition:
    clip-path 2100ms cubic-bezier(0.65, 0, 0.25, 1)
      calc(var(--reveal-delay) + 200ms),
    filter 2000ms ease calc(var(--reveal-delay) + 200ms),
    transform 2400ms cubic-bezier(0.22, 1, 0.36, 1) var(--reveal-delay),
    opacity 1300ms ease calc(var(--reveal-delay) + 300ms);
}
.wallet-symbol {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 2;
  color: var(--accent-brand);
  opacity: 0;
  transform: scale(1.6);
  filter: blur(8px);
  pointer-events: none;
  transition:
    opacity 900ms ease var(--reveal-delay),
    transform 1300ms ease var(--reveal-delay),
    filter 1100ms ease var(--reveal-delay);
}
.wallet-symbol svg {
  width: 23px;
  height: 23px;
}
.person-button .fallback {
  transition: opacity 1000ms ease calc(var(--reveal-delay) + 900ms);
}
.person-button .platform {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity 700ms ease calc(var(--reveal-delay) + 1600ms),
    transform 900ms cubic-bezier(0.2, 1.5, 0.3, 1)
      calc(var(--reveal-delay) + 1600ms);
}
.person-name {
  display: grid;
  justify-items: center;
  transition: top 1800ms cubic-bezier(0.22, 1, 0.36, 1) var(--reveal-delay);
}
.person-name .identity-label,
.person-name .wallet-label {
  grid-row: 1;
  grid-column: 1;
}
.person-name .identity-label {
  opacity: 1;
  filter: blur(0);
  transform: translateY(0);
  transition:
    opacity 1000ms ease calc(var(--reveal-delay) + 1500ms),
    filter 1200ms ease calc(var(--reveal-delay) + 1500ms),
    transform 1200ms ease calc(var(--reveal-delay) + 1500ms);
}
.person-name .wallet-label {
  opacity: 0;
  font: 11px monospace !important;
  transform: translateY(-8px);
  transition:
    opacity 800ms ease var(--reveal-delay),
    transform 1100ms ease var(--reveal-delay);
}
.person-name small {
  transition: opacity 900ms ease calc(var(--reveal-delay) + 1900ms);
}
.scene.wallet-view .person-button {
  width: 36px;
  height: 36px;
  border-radius: 12px;
}
.scene.wallet-view .person-button > img {
  clip-path: circle(0% at 50% 50%);
  filter: blur(12px);
  opacity: 0;
  transform: scale(1.35);
}
.scene.wallet-view .wallet-symbol {
  opacity: 1;
  transform: scale(1);
  filter: blur(0);
}
.scene.wallet-view .fallback,
.scene.wallet-view .platform {
  opacity: 0;
}
.scene.wallet-view .platform {
  transform: scale(0.4);
}
.scene.wallet-view .person-name {
  top: 29px;
}
.scene.wallet-view .identity-label {
  opacity: 0;
  filter: blur(6px);
  transform: translateY(10px);
}
.scene.wallet-view .wallet-label {
  opacity: 1;
  transform: translateY(0);
}
.scene.wallet-view .person-name small {
  opacity: 0;
}
.scene.wallet-view .person-button,
.scene.wallet-view .person-button *,
.scene.wallet-view .person-name,
.scene.wallet-view .person-name * {
  transition-duration: 450ms;
  transition-delay: 0ms;
}
.person-button::after {
  content: '';
  position: absolute;
  inset: -5px;
  border: 1px solid var(--accent-brand);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
}
.identity-reveal .person-button::after {
  animation: identity-wave 2600ms cubic-bezier(0.16, 1, 0.3, 1)
    var(--reveal-delay) both;
}
@keyframes identity-wave {
  0% {
    opacity: 0;
    transform: scale(0.7);
  }
  20% {
    opacity: 0.8;
  }
  100% {
    opacity: 0;
    transform: scale(1.8);
  }
}
.scene.motion-paused .person *,
.scene.motion-paused .person-button::after {
  transition: none !important;
  animation: none !important;
}
@media (prefers-reduced-motion: reduce) {
  .person *,
  .person-button::after {
    transition: none !important;
    animation: none !important;
  }
}

.person-button:has(img:not([hidden])) .fallback {
  opacity: 0;
}

/* Match production control colors and Phosphor regular icon sizing. */
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.button:hover {
  background: var(--accent-brand-hover);
}
.button,
.explore-actions button,
#reveal,
#reset,
#theme,
#notes-toggle {
  gap: 8px;
}
svg {
  vertical-align: middle;
  flex-shrink: 0;
}
[data-icon] {
  display: inline-flex;
  align-items: center;
}
.wallet-symbol svg {
  width: 23px;
  height: 23px;
}

/* Input → identity → useful output; existing production theme tokens only. */
#sample-panel {
  position: absolute;
  z-index: 6;
  left: 48px;
  top: 88px;
  width: 330px;
  padding: 20px;
  border: 1px solid var(--border);
  background: var(--card);
  border-radius: 16px;
}
.sample-eyebrow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font: 9px monospace;
  color: var(--muted-foreground);
}
#sample-title {
  margin: 16px 0 10px;
  font-size: 25px;
  line-height: 1.15;
  font-weight: 400;
  letter-spacing: -0.6px;
}
#sample-description {
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.5;
  min-height: 36px;
}
.sample-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 41px;
  border-top: 1px solid var(--border);
  font-size: 11px;
}
.sample-addresses {
  display: grid;
  gap: 6px;
  flex: 1;
}
.sample-addresses code {
  font-size: 10px;
}
.sample-arrow {
  color: var(--muted-foreground);
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.sample-arrow svg {
  width: 12px;
  height: 12px;
}
.sample-result {
  min-width: 130px;
}
.sample-result a {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-brand);
}
.sample-result img {
  border-radius: 50%;
}
.sample-result small {
  display: block;
  font-size: 9px;
  margin-top: 3px;
  color: var(--muted-foreground);
}
.sample-row:has(.sample-addresses code + code) {
  padding: 8px 0;
}
.pending-match {
  color: var(--muted-foreground);
}
.unmatched {
  color: var(--muted-foreground);
}
#sample-outcome {
  font-size: 12px;
  color: var(--accent-brand);
  margin: 12px 0;
}
.sample-disclosure {
  font-size: 9px;
  color: var(--muted-foreground);
  line-height: 1.5;
  margin-bottom: 0;
}
#explore-graph {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 15px;
  color: var(--accent-brand);
  font-size: 12px;
  padding: 0;
}
#explore-graph [data-icon] {
  display: inline-flex;
}
#explore-graph svg {
  width: 13px;
  height: 13px;
}
.story-mode {
  min-height: 530px;
}
.story-mode #rest-caption {
  display: none;
}
.story-mode[data-story-stage='input'] #nodes {
  opacity: 0.65;
}
.story-mode #nodes {
  transition: opacity 1.5s;
}
.story-mode #sample-panel {
  animation: sample-enter 850ms ease both;
}
[data-story-stage='results'] .sample-result {
  animation: sample-enter 900ms ease both;
}
@keyframes sample-enter {
  from {
    opacity: 0;
    transform: translateY(9px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@container identity-hero (min-width: 600px) and (max-width: 1000px) {
  #sample-panel {
    left: 25px;
    width: 290px;
    padding: 16px;
  }
  .story-mode .person-name strong {
    font-size: 10px;
  }
}
@container identity-hero (max-width: 599px) {
  .story-mode {
    min-height: 870px;
  }
  #sample-panel {
    left: 20px;
    right: 20px;
    top: 80px;
    width: auto;
    padding: 18px;
  }
}
@media (prefers-reduced-motion: reduce) {
  #sample-panel,
  .sample-result {
    animation: none !important;
  }
}
#sample-panel {
  padding: 16px;
}
#sample-title {
  font-size: 23px;
  margin: 12px 0 8px;
}
#sample-description {
  font-size: 11px;
  min-height: 0;
  margin: 8px 0 12px;
}
.sample-row {
  min-height: 35px;
}
#sample-outcome {
  margin: 10px 0;
}

/* Embedded composition inherits the real landing page's chrome and upload. */
:host :host {
  overflow: hidden;
}
:host header,
:host .intro,
:host .conversion,
:host .provenance,
:host #notes {
  display: none;
}
:host .graph-shell {
  margin: 0;
  border: 0;
}
:host .scene {
  min-height: 440px;
}
:host .scene-top {
  top: 16px;
  left: 24px;
  right: 24px;
}
:host #sample-panel {
  top: 66px;
  left: 24px;
  width: 290px;
  padding: 14px;
}
:host #sample-title {
  font-size: 21px;
  margin: 10px 0 6px;
}
:host #sample-description {
  margin: 6px 0 8px;
}
:host .sample-row {
  min-height: 29px;
}
:host .sample-disclosure {
  font-size: 8px;
}
:host #explore-graph {
  margin-top: 10px;
}
:host .graph-footer {
  padding: 12px 24px;
}
:host .rest-caption {
  left: 24px;
}
@container identity-hero (max-width: 599px) {
  :host .scene.story-mode {
    min-height: 830px;
  }
  :host .scene.focused {
    min-height: 760px;
  }
  :host #sample-panel {
    left: 12px;
    right: 12px;
    width: auto;
  }
  :host .scene-top {
    left: 12px;
    right: 12px;
  }
  :host .graph-footer {
    padding: 12px;
  }
}

/* One compact control cluster, with no footer or floating bottom caption. */
.graph-shell {
  border-radius: 14px;
  overflow: hidden;
}
.scene-top,
:host .scene-top {
  top: 16px;
  left: 24px;
  right: auto;
  max-width: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.scene-tools {
  align-items: center;
  gap: 6px;
}
.scene-tools > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  min-width: 32px;
  border-radius: 999px;
  padding: 6px;
  background: var(--card);
  border: 1px solid var(--border);
}
.scene-tools > button:hover {
  background: var(--muted);
}
.scene-tools .reset {
  position: static;
  padding: 6px 10px;
  font-size: 11px;
  gap: 5px;
}
.toolbar-context {
  padding: 0 6px;
  color: var(--muted-foreground);
  font-size: 10px;
  line-height: 1.4;
}
.scene-top #scene-instructions {
  margin: 0;
  font-size: 10px;
  max-width: none;
}
.scene-top .rest-caption,
:host .scene-top .rest-caption {
  position: static;
  font-size: 10px;
  margin: 0;
}
.scene:not(.story-mode) #scene-instructions {
  display: none;
}
.story-mode #rest-caption {
  display: none;
}
#sample-panel,
:host #sample-panel {
  top: 90px;
}
:host .scene.story-mode {
  min-height: 466px;
}
@container identity-hero (max-width: 599px) {
  .scene-top,
  :host .scene-top {
    left: 12px;
    max-width: calc(100% - 24px);
  }
  .scene-tools {
    gap: 4px;
    flex-wrap: wrap;
  }
  .scene-tools .reset {
    font-size: 10px;
  }
  :host .scene.story-mode {
    min-height: 830px;
  }
  .scene.focused .toolbar-context {
    display: none;
  }
}

:host { container-type: inline-size; container-name: identity-hero; display:block; font:inherit; color:var(--foreground); } .graph-shell {border:0; margin:0;}

/* Sparse, real wallet records share the mesh's existing motion. */
.mesh-wallets { position:absolute; inset:0; z-index:4; pointer-events:none; }
.mesh-wallet {
  position:absolute; left:0; top:0; width:44px; height:44px;
  margin:-22px 0 0 -22px; padding:0; display:grid; place-items:center;
  pointer-events:auto; color:var(--accent-brand);
}
.mesh-wallet-mark {
  display:grid; place-items:center; width:23px; height:23px;
  border-radius:50%; background:color-mix(in srgb,var(--background) 88%,transparent);
  border:1px solid color-mix(in srgb,var(--accent-brand) 28%,transparent);
  opacity:.62; transition:opacity 220ms, border-color 220ms;
}
.mesh-wallet-mark svg { width:13px; height:13px; }
.mesh-wallet:is(:hover,:focus-visible) { z-index:8; }
.mesh-wallet:is(:hover,:focus-visible) .mesh-wallet-mark { opacity:1; border-color:var(--accent-brand); }
.mesh-wallet-hint {
  position:absolute; left:37px; top:8px; white-space:nowrap;
  display:grid; gap:5px; padding:9px 11px; border-radius:var(--radius-lg,14px);
  border:1px solid var(--border); background:var(--card); color:var(--foreground);
  opacity:0; visibility:hidden; pointer-events:none; transition:opacity 180ms;
  text-align:left;
}
.mesh-wallet.hint-left .mesh-wallet-hint { left:auto; right:37px; }
.mesh-wallet-hint code { font-size:11px; }
.mesh-wallet-hint small { display:flex; align-items:center; gap:5px; font-size:10px; color:var(--muted-foreground); }
.mesh-wallet-hint svg { width:12px; height:12px; }
.mesh-wallet:is(:hover,:focus-visible) .mesh-wallet-hint { opacity:1; visibility:visible; }
.wallet-node svg { width:12px; height:12px; flex-shrink:0; }
.wallet-node { display:flex; align-items:center; gap:5px; }
@media (prefers-reduced-motion: reduce) {
  .mesh-wallet-mark, .mesh-wallet-hint { transition:none; }
}

@container identity-hero (max-width: 599px) {
  .wallet-node { font-size:8px; gap:3px; padding:6px; }
}

/* Depth comes from the existing palette, not another light/dark theme. */
.scene { background:color-mix(in srgb,var(--background) 97%,var(--accent-brand)); }
.scene::before {
  background:radial-gradient(ellipse at 62% 52%,color-mix(in srgb,var(--accent-brand) 18%,transparent),transparent 62%);
}
.mesh-wallet-mark { opacity:.78; border-color:color-mix(in srgb,var(--accent-brand) 38%,transparent); }
.discovering-connection .mesh-wallet:not(.tracing) .mesh-wallet-mark { opacity:.25; }
.mesh-wallet.tracing .mesh-wallet-mark { opacity:1; border-color:var(--accent-brand); }
.person.discovery-target .person-button { border-color:var(--accent-brand); }
#sample-panel { transition:background-color 1500ms ease, border-color 1500ms ease; }
.story-mode[data-story-stage='results'] #sample-panel {
  background:color-mix(in srgb,var(--card) 88%,var(--background));
  border-color:color-mix(in srgb,var(--border) 55%,var(--background));
}
@media (prefers-reduced-motion: reduce) {
  #sample-panel { transition:none; }
}

.mesh-wallet { border-radius:50%; }
.mesh-wallet.tracing .mesh-wallet-hint { display:none; }

/* Let identity content set its height; the surrounding hero makes room. */
:host #detail {
  top: 80px;
  bottom: auto;
  height: auto;
  max-height: none;
  overflow: visible;
}
:host .scene.focused {
  min-height: max(440px, calc(var(--identity-card-height, 340px) + 100px));
}
@container identity-hero (max-width: 600px) {
  :host #detail { top: 390px; }
  :host .scene.focused {
    min-height: max(760px, calc(var(--identity-card-height, 340px) + 414px));
  }
}
`;
