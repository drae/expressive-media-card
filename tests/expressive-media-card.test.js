const { JSDOM } = require("jsdom");
const fs = require("fs");
const dom = new JSDOM(`<!doctype html><body></body>`, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.eval(`customElements.define("ha-card", class extends HTMLElement {});
customElements.define("ha-icon", class extends HTMLElement { set icon(v){this._i=v} get icon(){return this._i} });
customElements.define("expressive-slider-card", class extends HTMLElement {
  setConfig(c){ this.config = c } set hass(h){ this._hass = h; this.hassSets = (this.hassSets ?? 0) + 1 } });`);
const CHANNELS = { channels: [
  { uuid: "u1", number: 101, name: "BBC ONE Lon HD", logo: "u1.png" },
  { uuid: "u2", number: 102, name: "BBC TWO HD", logo: "u2.png" },
  { uuid: "u3", number: 52, name: "Great! Christmas", logo: null },
] };
w.fetch = (url) => Promise.resolve({ ok: url.endsWith("/local/tv-logos/channels.json"), json: () => Promise.resolve(CHANNELS) });
const later = () => new Promise((r) => setTimeout(r, 0));
w.eval(fs.readFileSync(process.argv[2] ?? `${__dirname}/../expressive-media-card.js`, "utf8"));

const ok = (c, m) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
const calls = [];
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const TV = "media_player.tv", PLEX = "media_player.plex", ATV = "media_player.atv";
const base = () => ({
  [TV]: { state: "on", attributes: { source: "Apple TV", volume_level: 0.1, friendly_name: "TV" } },
  [PLEX]: { state: "unavailable", attributes: {} },
  "sensor.guide": { state: "ok", attributes: {} },
  "image.logo": { state: "2026-10-16", attributes: { entity_picture: "/api/image_proxy/image.logo?token=a" } },
  "image.backdrop": { state: "2026-10-16", attributes: { entity_picture: "/api/image_proxy/image.backdrop?token=b" } },
});
let states = base();
const hass = () => ({ states: { ...states }, callService: (d, s, data) => calls.push([d, s, data]) });
const cfg = { entity: TV, plex: PLEX, guide: "sensor.guide", guide_next: "sensor.next", backdrop: "image.backdrop", volume: { max: 25 } };
const mk = (c = cfg) => { const el = w.document.createElement("expressive-media-card"); el.setConfig(c); el.hass = hass(); w.document.body.append(el); return el; };
const $ = (el, s) => el.shadowRoot.querySelector(s);
const text = (el, s) => $(el, s).textContent;
const press = (el, n) => $(el, `.disc[data-n="${n}"]`).dispatchEvent(new w.Event("click", { bubbles: true }));
const last = () => JSON.stringify(calls.at(-1));

try { w.document.createElement("expressive-media-card").setConfig({ entity: "light.x" }); ok(false, "should throw"); }
catch (e) { ok(/media_player/.test(e.message), "rejects a non-media_player entity"); }

// TV off / unavailable: the card hides itself
states[TV] = { state: "off", attributes: {} };
let c = mk();
ok(c.hidden && c.style.display === "none", "hidden while the TV is off");
states[TV] = { state: "unavailable", attributes: {} };
c.hass = hass();
ok(c.hidden, "hidden while the TV is unavailable");

// nested slider: TV volume, max 25, taps that can't switch the TV off
const s = $(c, ".volume expressive-slider-card");
ok(s && s.config.entity === TV && s.config.max === 25, "slider for the TV's volume with max 25");
ok(s.config.tap_action.action === "none" && s.config.double_tap_action.action === "none", "slider tap and double tap do nothing");
ok(s.config.styles.header.display === "none" && s.config.styles.card.background === "transparent", "slider header hidden, card transparent");
ok(s.config.styles.track.color === "rgb(201, 126, 11)", "slider keeps the default amber");

// Plex film playing behind the Apple TV input
states = base();
states[PLEX] = { state: "playing", attributes: {
  media_content_type: "movie", media_title: "Coyote vs. Acme (2026)", media_content_rating: "gb/PG",
  media_duration: 6175, media_position: 915, media_position_updated_at: iso(60000),
  entity_picture: "/api/media_player_proxy/media_player.plex?token=p" } };
c = mk();
ok(!c.hidden, "shown while the TV is on");
ok(text(c, ".title") === "Coyote vs. Acme" && text(c, ".sub") === "Film · 2026", "film: title without the year, Film · year: " + text(c, ".sub"));
ok($(c, ".badge").src.endsWith("/local/ratings/BBFC_PG.svg") && !$(c, ".badge").hidden, "gb/PG → BBFC_PG.svg badge");
ok($(c, ".backdrop").style.backgroundImage.includes("image.backdrop") && !$(c, ".backdrop").classList.contains("poster"), "Plex backdrop image used");
ok(text(c, ".t0") === "16:15" && text(c, ".t1") === "1:42:55", "position moves on from the last report: " + text(c, ".t0"));
ok($(c, ".disc ha-icon").icon === "mdi:pause", "pause disc while playing");
press(c, 0);
ok(last() === JSON.stringify(["media_player", "media_pause", { entity_id: TV }]), "pause goes to the TV (CEC) " + last());

// render discipline: an unrelated state change leaves the DOM alone
const disc = $(c, ".disc");
states["sensor.other"] = { state: "1", attributes: {} };
c.hass = hass();
ok($(c, ".disc") === disc, "unrelated update does not repaint");
ok($(c, ".volume expressive-slider-card").hassSets >= 2, "slider gets every hass update");

// no backdrop image: the Plex poster, cropped
states["image.backdrop"] = { state: "unavailable", attributes: {} };
c.hass = hass();
ok($(c, ".backdrop").style.backgroundImage.includes("media_player.plex") && $(c, ".backdrop").classList.contains("poster"), "poster when there's no backdrop");

// Plex episode paused, US rating
states = base();
states[PLEX] = { state: "paused", attributes: {
  media_content_type: "tvshow", media_title: "Theseus", media_series_title: "VisionQuest", media_season: 1, media_episode: 2,
  media_content_rating: "TV-14", media_duration: 2706, media_position: 1212, media_position_updated_at: iso(600000) } };
c = mk();
ok(text(c, ".title") === "VisionQuest" && text(c, ".sub") === "S1 E2 · Theseus", "episode: series, S E · episode");
ok($(c, ".badge").src.endsWith("/TV-14.svg"), "TV-14 badge");
ok(text(c, ".t0") === "20:12", "paused position does not move: " + text(c, ".t0"));
press(c, 0);
ok(last() === JSON.stringify(["media_player", "media_play", { entity_id: TV }]), "play goes to the TV " + last());

// ratings: off, and one with no symbol
c = mk({ ...cfg, ratings: false });
ok($(c, ".badge").hidden, "ratings: false hides the badge");
states[PLEX].attributes.media_content_rating = "NR";
c = mk();
ok($(c, ".badge").hidden, "a rating with no symbol shows no badge");

// Live TV with the guide for this channel
const t = Math.floor(now / 1000);
states = base();
states[TV] = { state: "on", attributes: { source: "Live TV", media_title: "BBC ONE Lon HD", media_content_type: "channel" } };
states["sensor.guide"] = { state: "The Graham Norton Show", attributes: {
  channelName: "BBC ONE Lon HD", title: "The Graham Norton Show", start: t - 600, stop: t + 2400 } };
states["sensor.next"] = { state: "RuPaul's Drag Race UK", attributes: { title: "RuPaul's Drag Race UK", start: t + 2400 } };
c = mk();
ok(text(c, ".title") === "The Graham Norton Show", "live: programme title");
ok(text(c, ".sub").startsWith("Next: RuPaul's Drag Race UK · "), "live: Next line under the title");
ok(/^\d\d:\d\d$/.test(text(c, ".t0")) && /^\d\d:\d\d$/.test(text(c, ".t1")), "live: start and end clock times");
ok(Math.abs(parseFloat($(c, ".progress i").style.width) - 20) < 1, "live: progress through the programme: " + $(c, ".progress i").style.width);
ok($(c, ".badge").hidden, "live: no rating badge");
press(c, 1);
ok(last() === JSON.stringify(["media_player", "media_next_track", { entity_id: TV }]), "channel up = next track " + last());
press(c, 0);
ok(last() === JSON.stringify(["media_player", "media_previous_track", { entity_id: TV }]), "channel down = previous track");

// guide for another channel, or out of date: channel name only
states["sensor.guide"].attributes.channelName = "BBC TWO HD";
c = mk();
ok(text(c, ".title") === "BBC ONE Lon HD" && $(c, ".prog-wrap").hidden && $(c, ".sub").hidden, "guide for another channel: channel name, no progress");
states["sensor.guide"].attributes.channelName = "BBC ONE Lon HD";
states["sensor.next"].attributes.start = t - 7200;
c = mk();
ok(text(c, ".title") === "The Graham Norton Show" && $(c, ".sub").hidden, "a next entry from before this programme is ignored");
states["sensor.guide"].attributes.stop = t - 10;
c = mk();
ok(text(c, ".title") === "BBC ONE Lon HD", "ended programme: channel name until the guide updates");

// a TV app: its icon as a tile, play/pause toggled on the TV
states = base();
states[TV] = { state: "on", attributes: { source: "YouTube", entity_picture: "/api/media_player_proxy/media_player.tv?token=y" } };
c = mk();
ok(text(c, ".title") === "YouTube" && $(c, ".sub").hidden, "app: source as the title");
ok($(c, ".logo").classList.contains("tile") && $(c, ".logo").style.backgroundImage.includes("media_player.tv"), "app: icon as a tile");
ok($(c, ".disc ha-icon").icon === "mdi:play-pause", "app: play-pause icon when the state is unknown");
press(c, 0);
ok(last() === JSON.stringify(["media_player", "media_play_pause", { entity_id: TV }]), "app: play_pause on the TV");

// Apple TV input with nothing readable behind it
states = base();
c = mk();
ok(text(c, ".title") === "Apple TV" && !$(c, ".logo").style.backgroundImage, "Apple TV input, nothing playing through Plex: plain title");

// Apple TV entity: its own metadata, seek and pause
states = base();
states[ATV] = { state: "playing", attributes: { media_title: "Sleepytime", media_series_title: "Bluey", media_season: 3, media_episode: 12,
  app_name: "Disney+", media_duration: 427, media_position: 100, media_position_updated_at: iso(0),
  entity_picture: "/api/media_player_proxy/media_player.atv?token=x" } };
c = mk({ ...cfg, apple_tv: ATV });
ok(text(c, ".title") === "Bluey" && text(c, ".sub") === "S3 E12 · Sleepytime", "Apple TV: series and episode");
ok([...c.shadowRoot.querySelectorAll(".disc ha-icon")].map((i) => i.icon).join() === "mdi:rewind-10,mdi:pause,mdi:fast-forward-30", "Apple TV: back, pause, forward");
press(c, 2);
const sk = calls.at(-1);
ok(sk[1] === "media_seek" && sk[2].entity_id === ATV && Math.abs(sk[2].media_position - 130) <= 1, "forward 30 seeks the Apple TV " + JSON.stringify(sk));
press(c, 1);
ok(last() === JSON.stringify(["media_player", "media_pause", { entity_id: ATV }]), "pause goes to the Apple TV");

// Plex details win, Apple TV transport when both are there
states[PLEX] = { state: "playing", attributes: { media_content_type: "movie", media_title: "Coyote vs. Acme (2026)", media_duration: 6175, media_position: 1, media_position_updated_at: iso(0) } };
c = mk({ ...cfg, apple_tv: ATV });
ok(text(c, ".title") === "Coyote vs. Acme" && c.shadowRoot.querySelectorAll(".disc").length === 3, "Plex details with Apple TV transport");

// styles
c = mk({ ...cfg, styles: { title: { size: 15 }, blur: { blur: 20, zoom: 2, strength: 70 } } });
ok(/\.title \{ font-size: 15px; \}/.test(text(c, "#user")) && !/blur/.test(text(c, "#user")), "styles.title as CSS, blur not CSS: " + text(c, "#user"));
const hero = $(c, ".hero");
ok(hero.style.getPropertyValue("--emc-blur") === "20px" && hero.style.getPropertyValue("--emc-zoom") === "112px" && hero.style.getPropertyValue("--emc-strength") === "0.7", "styles.blur sets the blur variables");
c = mk();
ok($(c, ".hero").style.getPropertyValue("--emc-blur") === "40px" && $(c, ".hero").style.getPropertyValue("--emc-zoom") === "168px", "blur defaults 40px, 3x");

(async () => {
  await later(); await later();
  // live logo from the logos folder, by the TV's channel name
  states = base();
  states[TV] = { state: "on", attributes: { source: "Live TV", media_title: "BBC ONE Lon HD", media_content_type: "channel" } };
  c = mk();
  await later();
  ok($(c, ".logo").style.backgroundImage.includes("/local/tv-logos/u1.png") && $(c, ".blurred").style.backgroundImage.includes("u1.png"), "live: sharp and blurred logo from the folder");
  ok(!$(c, ".logo").classList.contains("tile"), "live: logo is not a tile");
  ok(text(c, ".title") === "BBC ONE Lon HD", "no guide: channel name, logo still shown");
  states[TV].attributes.media_title = "BBC TWO HD";
  c.hass = hass();
  ok($(c, ".logo").style.backgroundImage.includes("u2.png"), "logo follows a channel change at once");
  ok($(c, ".heading").hidden, "no heading without name");

  // heading and channel list
  const epgCalls = [];
  const t = Math.floor(Date.now() / 1000);
  const ENTRIES = [
    { channelName: "BBC ONE Lon HD", title: "News", start: t - 600, stop: t + 600 },
    { channelName: "BBC ONE Lon HD", title: "Weather", start: t + 600, stop: t + 900 },
    { channelName: "BBC TWO HD", title: "Film", start: t - 60, stop: t + 3600 },
  ];
  const H = () => ({ ...hass(), callWS: (m) => { epgCalls.push(m); return Promise.resolve({ response: { content: { entries: ENTRIES } } }); } });
  const ch = w.document.createElement("expressive-media-card");
  ch.setConfig({ ...cfg, name: "TV", channels: { epg: "rest_command.tvheadend_epg" } });
  ch.hass = H(); w.document.body.append(ch);
  await later();
  ok(!$(ch, ".heading").hidden && text(ch, ".heading .name") === "TV" && text(ch, ".heading .source") === "Live TV", "heading: name and source");
  ok(!$(ch, ".heading .tog").hidden && $(ch, ".channels").hidden, "Channels toggle shown, list closed");
  ok(epgCalls.length === 0, "guide not fetched while closed");
  $(ch, ".heading .tog").click();
  await later(); await later();
  ok(!$(ch, ".channels").hidden && $(ch, ".heading .tog").getAttribute("aria-expanded") === "true", "toggle opens the list");
  ok(epgCalls.length === 1 && epgCalls[0].domain === "rest_command" && epgCalls[0].service === "tvheadend_epg" && epgCalls[0].return_response, "guide fetched with a response");
  const rows = ch.shadowRoot.querySelectorAll(".ch");
  ok(rows.length === 3, "one row per channel in channels.json order");
  ok(rows[0].querySelector(".title").textContent === "News" && rows[0].querySelector(".sub").textContent.startsWith("Next: Weather · "), "row: now and next");
  ok(rows[1].classList.contains("cur") && !rows[0].classList.contains("cur"), "the tuned channel is highlighted");
  ok(rows[2].querySelector(".num").textContent === "52" && rows[2].querySelector(".title").textContent === "Great! Christmas", "no logo or guide: number and name");
  ok(w.localStorage.getItem("expressive-media-card:channels:" + TV) === "1", "open state remembered on this device");
  rows[0].click();
  ok(last() === JSON.stringify(["media_player", "play_media", { entity_id: TV, media_content_type: "channel", media_content_id: "BBC ONE Lon HD" }]), "tap tunes by name " + last());

  // tuning from another input switches to live TV first
  states[TV] = { state: "on", attributes: { source: "Apple TV" } };
  ch.hass = H();
  const n0 = calls.length;
  ch.shadowRoot.querySelectorAll(".ch")[1].click();
  ok(JSON.stringify(calls[n0]) === JSON.stringify(["media_player", "select_source", { entity_id: TV, source: "Live TV" }]) && calls.length === n0 + 1, "other input: select_source first");
  await new Promise((r) => setTimeout(r, 2600));
  ok(last() === JSON.stringify(["media_player", "play_media", { entity_id: TV, media_content_type: "channel", media_content_id: "BBC TWO HD" }]), "then play_media after a pause");

  $(ch, ".heading .tog").click();
  ok($(ch, ".channels").hidden && w.localStorage.getItem("expressive-media-card:channels:" + TV) === "0", "toggle closes and remembers");

  // opens as left on this device; a failed fetch says so
  w.localStorage.setItem("expressive-media-card:channels:" + TV, "1");
  states = base();
  states[TV] = { state: "on", attributes: { source: "Live TV", media_title: "BBC ONE Lon HD", media_content_type: "channel" } };
  const bad = w.document.createElement("expressive-media-card");
  bad.setConfig({ ...cfg, name: "TV", channels: { epg: "rest_command.x" } });
  bad.hass = { ...hass(), callWS: () => Promise.reject(new Error("nope")) };
  w.document.body.append(bad);
  await later(); await later();
  ok(!$(bad, ".channels").hidden && /Couldn't load the guide/.test(text(bad, ".channels")), "reopens from the device setting; fetch error shown");

  c.remove(); ch.remove(); bad.remove();
  ok(true, "disconnect without error");
  setTimeout(() => process.exit(), 0);
})();
