/*
 * expressive-media-card
 * Copyright (c) 2026 Paul Owen
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * A "now playing" card for a TV that has other players behind its inputs. It merges the TV
 * (e.g. LG webOS), a Plex player on one of its inputs (e.g. Infuse on an Apple TV), an optional
 * Apple TV entity and an optional TV guide sensor into one view: artwork or a blurred channel
 * logo behind the title, a progress line, transport discs and volume on expressive-slider-card.
 *
 *   type: custom:expressive-media-card
 *   entity: media_player.lg_tv          # the TV: volume, power state, source, channel
 *   plex: media_player.plex_infuse      # optional Plex player behind `plex_source`
 *   plex_source: Apple TV               # the TV source the Plex player sits behind
 *   apple_tv: media_player.apple_tv     # optional; used while the TV is on `apple_tv_source`
 *   apple_tv_source: Apple TV           # default: plex_source
 *   live_source: Live TV                # the TV source that means broadcast TV
 *   guide: sensor.tv_guide_now          # optional programme on now, as a TVHeadend EPG entry:
 *                                       #   attributes channelName, title, start, stop (epoch seconds)
 *   guide_next: sensor.tv_guide_next    # optional programme after it: attributes title, start
 *   logo: image.tv_logo                 # optional channel logo for the guide's channel
 *   backdrop: image.tv_backdrop         # optional wide artwork for the Plex item; the Plex poster otherwise
 *   ratings: /local/ratings/            # folder of age-rating symbols: BBFC_PG.svg, TV-14.svg ...; false = none
 *   volume:                             # merged into the expressive-slider-card config for the TV
 *     max: 25
 *   styles:                             # one block per element, as in expressive-slider-card
 *     title:
 *       size: 14
 *     blur:
 *       blur: 40                        # px
 *       zoom: 3                         # logo size behind, as a multiple of the sharp logo
 *       strength: 50                    # % opacity
 *
 * Elements: card, hero, backdrop, logo, tile, badge, title, subtitle, progress, bar, times, controls, disc, volume.
 * Properties are CSS names; size, weight and colour are short for font-size, font-weight and color.
 * Bare numbers become px. Each block can also be a list of single properties.
 *
 * The card hides itself while the TV is off or unavailable.
 */

(() => {
  const VERSION = "0.1.1";
  const OFF = new Set(["off", "unavailable", "unknown", "standby"]);
  const ACTIVE = new Set(["playing", "paused"]);
  const BBFC = new Set(["U", "PG", "12A", "12", "15", "18", "R18"]);
  const US_TV = new Set(["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"]);
  const BLUR_DEFAULTS = { blur: 40, zoom: 3, strength: 50 };
  const LOGO_PX = 56;

  const VOLUME_DEFAULTS = {
    icon: "mdi:volume-high",
    glow: false,
    bubble: "drag",
    tap_action: { action: "none" },
    hold_action: { action: "more-info" },
    double_tap_action: { action: "none" },
    styles: { card: { background: "transparent" }, header: { display: "none" }, track: { color: "rgb(201, 126, 11)" } },
  };

  const TARGETS = {
    card: "ha-card", hero: ".hero", backdrop: ".backdrop", logo: ".logo", tile: ".logo.tile", badge: ".badge",
    title: ".title", subtitle: ".sub", progress: ".progress", bar: ".progress i", times: ".times",
    controls: ".controls", disc: ".disc", volume: ".volume",
  };
  const ALIASES = { size: "font-size", weight: "font-weight", colour: "color" };
  const UNITLESS = new Set(["font-weight", "opacity", "z-index", "line-height", "flex", "flex-grow", "flex-shrink", "order"]);

  const flat = (b) => (Array.isArray(b) ? Object.assign({}, ...b) : b && typeof b === "object" ? b : {});
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b ?? {})) out[k] = isObj(v) && isObj(a?.[k]) ? merge(a[k], v) : v;
    return out;
  };

  const userCss = (styles) =>
    Object.entries(styles ?? {})
      .filter(([el]) => TARGETS[el])
      .map(([el, block]) => {
        if (typeof block === "string") return `${TARGETS[el]} { ${block} }`;
        const decls = Object.entries(flat(block)).map(([k, v]) => {
          const prop = ALIASES[k] ?? k;
          return `${prop}: ${typeof v === "number" && !UNITLESS.has(prop) ? `${v}px` : v};`;
        });
        return decls.length ? `${TARGETS[el]} { ${decls.join(" ")} }` : "";
      })
      .filter(Boolean)
      .join("\n");

  const clock = (s) => {
    const d = new Date(s * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const duration = (s) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`;
  };
  const picture = (s) => (s && !OFF.has(s.state) ? s.attributes.entity_picture ?? null : null);
  // An image entity keeps the same picture URL when its image changes; its state is the change time.
  const imageUrl = (s) => {
    const u = picture(s);
    return u ? `${u}${u.includes("?") ? "&" : "?"}state=${encodeURIComponent(s.state)}` : null;
  };

  // Plex gives "gb/PG"; the symbol files are BBFC_PG.svg and TV-14.svg.
  const ratingKey = (r) => (typeof r === "string" && r ? r.replace(/^[a-z]{2}\//i, "").trim() : null);
  const ratingFile = (r) => (BBFC.has(r) ? `BBFC_${r}.svg` : US_TV.has(r) ? `${r}.svg` : null);

  // Position of a player now, from its last report.
  const position = (a, playing, now) => {
    if (a.media_position == null) return null;
    const at = Date.parse(a.media_position_updated_at ?? "");
    return a.media_position + (playing && !Number.isNaN(at) ? (now - at) / 1000 : 0);
  };

  const episodeLine = (a) => {
    const se = a.media_season != null && a.media_episode != null ? `S${a.media_season} E${a.media_episode}` : null;
    return [se, a.media_title].filter(Boolean).join(" · ");
  };

  class ExpressiveMediaCard extends HTMLElement {
    setConfig(config) {
      if (!config?.entity) throw new Error("Set entity: to the TV's media_player");
      if (config.entity.split(".")[0] !== "media_player") throw new Error("entity must be a media_player");
      this._config = {
        plex_source: "Apple TV",
        live_source: "Live TV",
        ratings: "/local/ratings/",
        ...config,
      };
      this._config.apple_tv_source ??= this._config.plex_source;
      this._blur = { ...BLUR_DEFAULTS, ...flat(config.styles?.blur) };
      this._volumeConfig = merge(merge(VOLUME_DEFAULTS, { entity: config.entity }), config.volume ?? {});
      this._key = null;
      if (this.shadowRoot) this._applyConfig();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this.shadowRoot) this._build();
      if (this._slider) this._slider.hass = hass;
      this._render();
    }

    getCardSize() {
      return 4;
    }

    getGridOptions() {
      return { columns: 12, rows: "auto", min_columns: 6 };
    }

    connectedCallback() {
      if (this._model?.progress) this._startTimer();
    }

    disconnectedCallback() {
      this._stopTimer();
    }

    _build() {
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>${CSS}</style><style id="user"></style>
        <ha-card>
          <div class="hero">
            <div class="backdrop"></div>
            <div class="blurred"></div>
            <div class="logo"></div>
            <img class="badge" alt="" hidden>
            <div class="text">
              <div class="title"></div>
              <div class="sub"></div>
              <div class="prog-wrap">
                <div class="progress"><i></i></div>
                <div class="times"><span class="t0"></span><span class="t1"></span></div>
              </div>
            </div>
          </div>
          <div class="row">
            <div class="controls"></div>
            <div class="volume"></div>
          </div>
        </ha-card>`;
      const $ = (s) => root.querySelector(s);
      this._el = {
        backdrop: $(".backdrop"), blurred: $(".blurred"), logo: $(".logo"), badge: $(".badge"),
        title: $(".title"), sub: $(".sub"), progWrap: $(".prog-wrap"), bar: $(".progress i"),
        t0: $(".t0"), t1: $(".t1"), controls: $(".controls"), volume: $(".volume"),
      };
      this._el.controls.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-n]");
        if (b) this._press(Number(b.dataset.n));
      });
      this._applyConfig();
      this._mountSlider();
    }

    _applyConfig() {
      this.shadowRoot.querySelector("#user").textContent = userCss(this._config.styles);
      const h = this.shadowRoot.querySelector(".hero");
      h.style.setProperty("--emc-blur", `${this._blur.blur}px`);
      h.style.setProperty("--emc-zoom", `${LOGO_PX * this._blur.zoom}px`);
      h.style.setProperty("--emc-strength", this._blur.strength / 100);
      if (this._slider) this._slider.setConfig(this._volumeConfig);
      this._key = null;
    }

    // The slider is its own card; wait for it if it loads after this one.
    _mountSlider() {
      const make = () => {
        const s = document.createElement("expressive-slider-card");
        s.setConfig(this._volumeConfig);
        if (this._hass) s.hass = this._hass;
        this._el.volume.replaceChildren(s);
        this._slider = s;
      };
      if (customElements.get("expressive-slider-card")) make();
      else customElements.whenDefined("expressive-slider-card").then(make);
    }

    _state(id) {
      return id ? this._hass?.states[id] : undefined;
    }

    // Everything the card shows, from the TV and whatever sits behind its current input.
    _merge(now) {
      const c = this._config;
      const tv = this._state(c.entity);
      if (!tv || OFF.has(tv.state)) return null;
      const src = tv.attributes.source;
      const plex = this._state(c.plex);
      const atv = this._state(c.apple_tv);
      const atvActive = src === c.apple_tv_source && atv && ACTIVE.has(atv.state);

      if (src === c.plex_source && plex && ACTIVE.has(plex.state)) {
        const a = plex.attributes;
        const playing = plex.state === "playing";
        const show = a.media_content_type === "tvshow" || a.media_content_type === "episode";
        const m = (a.media_title ?? "").match(/^(.*?)\s*\((\d{4})\)$/);
        const title = show ? a.media_series_title ?? a.media_title : m ? m[1] : a.media_title;
        const sub = show ? episodeLine(a) : a.media_content_type === "movie" ? ["Film", m?.[2]].filter(Boolean).join(" · ") : a.media_artist ?? "";
        const backdrop = imageUrl(this._state(c.backdrop));
        const pos = position(a, playing, now);
        return {
          title, sub, rating: ratingKey(a.media_content_rating),
          art: backdrop ? { kind: "backdrop", url: backdrop } : picture(plex) ? { kind: "poster", url: picture(plex) } : null,
          progress: a.media_duration ? { pos, dur: a.media_duration, live: playing } : null,
          controls: atvActive ? this._atvControls(atv) : [this._playPause(playing, plex.state === "paused")],
        };
      }

      if (atvActive) {
        const a = atv.attributes;
        const playing = atv.state === "playing";
        const show = a.media_series_title || a.media_episode != null;
        return {
          title: show ? a.media_series_title ?? a.media_title : a.media_title ?? a.app_name ?? src,
          sub: show ? episodeLine(a) : a.media_artist ?? a.app_name ?? "",
          rating: null,
          art: picture(atv) ? { kind: "poster", url: picture(atv) } : null,
          progress: a.media_duration ? { pos: position(a, playing, now), dur: a.media_duration, live: playing } : null,
          controls: this._atvControls(atv),
        };
      }

      if (src === c.live_source || tv.attributes.media_content_type === "channel") {
        const channel = tv.attributes.media_title ?? src;
        const g = this._guide(channel, now);
        const logo = g && this._fresh(c.logo, c.guide) ? imageUrl(this._state(c.logo)) : null;
        const chans = [
          { icon: "mdi:chevron-down", label: "Channel down", call: [c.entity, "media_previous_track"] },
          { icon: "mdi:chevron-up", label: "Channel up", call: [c.entity, "media_next_track"] },
        ];
        if (!g) return { title: channel, sub: "", rating: null, art: null, progress: null, controls: chans };
        return {
          title: g.title,
          sub: g.next ? `Next: ${g.next} · ${clock(g.nextStart)}` : "",
          rating: null,
          art: logo ? { kind: "logo", url: logo } : null,
          progress: { pos: now / 1000 - g.start, dur: g.stop - g.start, live: true, clock: [clock(g.start), clock(g.stop)] },
          controls: chans,
        };
      }

      // A TV app (its icon), or an input with nothing behind it that we can read.
      const icon = src === c.apple_tv_source ? null : picture(tv);
      const playing = tv.state === "playing", paused = tv.state === "paused";
      return {
        title: src ?? tv.attributes.friendly_name,
        sub: "",
        rating: null,
        art: icon ? { kind: "tile", url: icon } : null,
        progress: null,
        controls: [{ ...this._playPause(playing, paused, true), call: [c.entity, "media_play_pause"] }],
      };
    }

    // The logo image updates just after the guide; until it has, it still holds the last channel's logo.
    _fresh(image, after) {
      const i = this._state(image), g = this._state(after);
      const ti = Date.parse(i?.last_updated ?? ""), tg = Date.parse(g?.last_updated ?? "");
      return Number.isNaN(ti) || Number.isNaN(tg) || ti >= tg;
    }

    // Now and next from the guide sensors, when they describe the channel on screen and the times fit.
    _guide(channel, now) {
      const g = this._state(this._config.guide);
      if (!g || OFF.has(g.state)) return null;
      const a = g.attributes;
      const t = now / 1000;
      if (a.channelName !== channel || !(a.start <= t && t < a.stop)) return null;
      const n = this._state(this._config.guide_next)?.attributes;
      const next = n && n.start >= a.stop && n.title ? n : null;
      return { title: a.title, start: a.start, stop: a.stop, next: next?.title, nextStart: next?.start };
    }

    // Plex is driven through the TV's remote keys (HDMI-CEC), so pick play or pause from the Plex state.
    _playPause(playing, paused, unknown = false) {
      const tv = this._config.entity;
      if (playing) return { icon: "mdi:pause", label: "Pause", call: [tv, "media_pause"] };
      if (paused) return { icon: "mdi:play", label: "Play", call: [tv, "media_play"] };
      return { icon: unknown ? "mdi:play-pause" : "mdi:play", label: "Play or pause", call: [tv, "media_play"] };
    }

    _atvControls(atv) {
      const id = this._config.apple_tv;
      const pos = position(atv.attributes, atv.state === "playing", Date.now());
      const seek = (d) => (pos == null ? null : { media_position: Math.max(0, Math.round(pos + d)) });
      const out = [];
      if (seek(0)) out.push({ icon: "mdi:rewind-10", label: "Back 10 seconds", call: [id, "media_seek", () => seek(-10)] });
      out.push(atv.state === "playing"
        ? { icon: "mdi:pause", label: "Pause", call: [id, "media_pause"] }
        : { icon: "mdi:play", label: "Play", call: [id, "media_play"] });
      if (seek(0)) out.push({ icon: "mdi:fast-forward-30", label: "Forward 30 seconds", call: [id, "media_seek", () => seek(30)] });
      return out;
    }

    _press(n) {
      const c = this._model?.controls[n];
      if (!c) return;
      const [entity_id, service, data] = c.call;
      this._hass.callService("media_player", service, { entity_id, ...(typeof data === "function" ? data() : data ?? {}) });
    }

    _render() {
      if (!this._config || !this.shadowRoot) return;
      const at = Date.now();
      const m = this._merge(at);
      if (m) m.at = at;
      this.toggleAttribute("hidden", !m);
      this.style.display = m ? "" : "none";
      this._model = m;
      if (!m) return this._stopTimer();

      // Only touch the DOM when something visible changed, so images don't reload on every state update.
      const key = JSON.stringify([m.title, m.sub, m.rating, m.art, m.progress?.dur, m.progress?.live, m.progress?.clock,
        m.controls.map((x) => [x.icon, x.label])]);
      if (key !== this._key) {
        this._key = key;
        this._paint(m);
      }
      this._tick();
      if (m.progress?.live) this._startTimer();
      else this._stopTimer();
    }

    _paint(m) {
      const e = this._el;
      const a = m.art;
      const url = (u) => `url("${u}")`;
      e.backdrop.style.backgroundImage = a && (a.kind === "backdrop" || a.kind === "poster") ? url(a.url) : "";
      e.backdrop.classList.toggle("poster", a?.kind === "poster");
      e.blurred.style.backgroundImage = a && (a.kind === "logo" || a.kind === "tile") ? url(a.url) : "";
      e.logo.style.backgroundImage = a && (a.kind === "logo" || a.kind === "tile") ? url(a.url) : "";
      e.logo.classList.toggle("tile", a?.kind === "tile");

      const file = this._config.ratings && m.rating ? ratingFile(m.rating) : null;
      e.badge.hidden = !file;
      if (file) {
        e.badge.src = `${this._config.ratings.replace(/\/?$/, "/")}${file}`;
        e.badge.alt = `Rated ${m.rating}`;
      }

      e.title.textContent = m.title ?? "";
      e.sub.textContent = m.sub ?? "";
      e.sub.hidden = !m.sub;
      e.progWrap.hidden = !m.progress;

      e.controls.replaceChildren(...m.controls.map((c, n) => {
        const b = document.createElement("button");
        b.className = "disc";
        b.type = "button";
        b.dataset.n = n;
        b.setAttribute("aria-label", c.label);
        b.title = c.label;
        const i = document.createElement("ha-icon");
        i.icon = c.icon;
        i.setAttribute("icon", c.icon);
        b.append(i);
        return b;
      }));
    }

    // Progress only: the bar and the two times. A playing item moves on from when it was merged.
    _tick() {
      const p = this._model?.progress;
      if (!p) return;
      const pos = p.pos == null ? null : p.pos + (p.live ? (Date.now() - this._model.at) / 1000 : 0);
      const frac = p.dur > 0 && pos != null ? Math.min(1, Math.max(0, pos / p.dur)) : 0;
      this._el.bar.style.width = `${frac * 100}%`;
      this._el.t0.textContent = p.clock ? p.clock[0] : pos != null ? duration(Math.min(pos, p.dur)) : "";
      this._el.t1.textContent = p.clock ? p.clock[1] : duration(p.dur);
    }

    _startTimer() {
      if (this._timer) return;
      this._timer = setInterval(() => {
        // A broadcast re-merges so the next programme takes over on time.
        if (this._model?.progress?.clock) this._render();
        else this._tick();
      }, 1000);
    }

    _stopTimer() {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  const CSS = `
    :host { display: block; }
    ha-card {
      background: var(--popupBG, var(--secondary-background-color));
      border: none; box-shadow: none; border-radius: 16px; overflow: hidden;
      display: grid; gap: 16px; padding-bottom: 16px;
    }
    .hero {
      position: relative; height: 160px; padding: 0 16px; overflow: hidden;
      display: flex; flex-direction: column; justify-content: flex-end;
    }
    .backdrop, .blurred, .logo { position: absolute; background-repeat: no-repeat; pointer-events: none; }
    .backdrop { inset: 0; background-size: cover; background-position: center; }
    .backdrop.poster { background-position: center 25%; }
    .blurred {
      inset: -25%; background-position: center 40%; background-size: auto var(--emc-zoom);
      filter: blur(var(--emc-blur)) saturate(1.4); opacity: var(--emc-strength);
    }
    .logo { inset: 0; background-position: center 20%; background-size: auto ${LOGO_PX}px; }
    .logo.tile {
      inset: auto; top: 16px; left: calc(50% - 32px); width: 64px; height: 64px;
      border-radius: 16px; background-size: cover; background-position: center;
    }
    .hero::after {
      content: ""; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(to bottom, transparent 30%, var(--popupBG, var(--secondary-background-color)) 100%);
    }
    .badge { position: absolute; z-index: 2; top: 16px; right: 16px; height: 32px; width: auto; }
    .text { position: relative; z-index: 1; min-width: 0; }
    .title { font-size: 14px; font-weight: 600; color: var(--primary-text-color);
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); margin-top: 2px;
           white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .prog-wrap { margin-top: 8px; }
    .progress { height: 4px; border-radius: 2px; background: var(--gray100, rgba(127, 127, 127, 0.25)); overflow: hidden; }
    .progress i { display: block; height: 100%; width: 0; border-radius: 2px; background: var(--primary-text-color); }
    .times { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px;
             font-size: 11px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
    [hidden] { display: none !important; }
    .row { display: flex; align-items: center; gap: 8px; padding: 0 16px; }
    .controls { display: flex; gap: 8px; flex: none; }
    .controls:empty { display: none; }
    .disc {
      width: 40px; height: 40px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
      display: grid; place-items: center;
      background: var(--gray100, var(--card-background-color)); color: var(--primary-text-color);
      --mdc-icon-size: 24px;
    }
    .disc:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
    .volume { flex: 1; min-width: 0; }
  `;

  if (!customElements.get("expressive-media-card")) {
    console.info(`%c EXPRESSIVE-MEDIA-CARD %c ${VERSION} `, "background:#c97e0b;color:#fff;font-weight:600", "background:#28282a;color:#fff");
    customElements.define("expressive-media-card", ExpressiveMediaCard);
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "expressive-media-card",
      name: "Expressive media",
      description: "Now playing for a TV and the players behind its inputs, with volume on expressive-slider-card",
    });
  }
})();
