# Expressive Media Card

A "now playing" card for a TV that has other players behind its inputs. It shows one view whatever the source:

- **Plex** (for example Infuse on an Apple TV): title, film year or season and episode, the wide backdrop, the age-rating symbol and progress.
- **An Apple TV entity**, if you have one: its titles and artwork for other apps, plus skip back and forward.
- **Live TV**: the programme now and next from a guide sensor such as TVHeadend, with the channel logo blurred behind it and progress through the programme.
- **A channel list** (optional): every channel's programme now and next, opened from "Channels" in the card's heading. Tap a channel to tune the TV to it.
- **The TV's own apps**: the app's icon.

Volume uses [expressive-slider-card](https://github.com/drae/expressive-slider-card), which must be loaded too. It stays out of the way: a speaker disc at the right of the controls swaps the discs for a thin volume line, and the discs come back on a second tap or after 10 seconds without use. The card hides itself while the TV is off or unavailable.

It is a single plain JavaScript file with no dependencies.

## Installation

1. Load `expressive-slider-card.js` and `expressive-media-card.js` as dashboard resources of type **JavaScript module**.
2. For channel logos, put the PNGs in a folder under `/config/www` (default `/local/tv-logos/`) with a `channels.json` that lists every TV channel: `{"channels": [{"uuid": "…", "number": 101, "name": "BBC ONE Lon HD", "logo": "….png"}]}`. The names must match the TV's channel names. Channels with `"logo": null` show their number.
3. For rating symbols, put the SVGs in a folder under `/config/www` (default `/local/ratings/`), named `BBFC_U.svg`, `BBFC_PG.svg`, `BBFC_12A.svg`, `BBFC_12.svg`, `BBFC_15.svg`, `BBFC_18.svg`, `TV-Y.svg`, `TV-Y7.svg`, `TV-G.svg`, `TV-PG.svg`, `TV-14.svg` and `TV-MA.svg`. Wikipedia has public-domain versions of all of them.

## Example

```yaml
type: custom:expressive-media-card
entity: media_player.lg_webos_tv_oled55c9pla
plex: media_player.plex_infuse_direct_apple_tv
plex_source: Apple TV
guide: sensor.lounge_tv_guide_now
guide_next: sensor.lounge_tv_guide_next
backdrop: image.lounge_tv_backdrop
name: TV
channels:
  epg: rest_command.tvheadend_epg
volume:
  max: 25
```

## Options

| Key | Default | Description |
| --- | --- | --- |
| `entity` | required | The TV's `media_player`: volume, power, source and channel. |
| `plex` | none | A Plex player that sits behind one of the TV's inputs. |
| `plex_source` | `Apple TV` | The TV source the Plex player is behind. |
| `apple_tv` | none | An Apple TV `media_player`. Used while the TV is on `apple_tv_source` and the Apple TV is playing or paused. |
| `apple_tv_source` | `plex_source` | The TV source the Apple TV is on. |
| `live_source` | `Live TV` | The TV source that means broadcast TV. |
| `guide` | none | A sensor for the programme on now. Its attributes follow a TVHeadend EPG entry: `channelName`, `title`, `start`, `stop` (epoch seconds). It's used only when `channelName` matches the TV's channel and the times cover now. |
| `guide_next` | none | A sensor for the programme after it, with `title` and `start`. |
| `name` | none | A heading above the card, in the style of a section heading: the name, a **Channels** toggle when `channels` is set, and the TV's current source on the right. |
| `logos` | `/local/tv-logos/` | The folder with `channels.json` and the logos. `false` shows no logos. |
| `channels` | none | The channel list. `epg` is a `rest_command` (or any service that returns a response) giving TVHeadend's `/api/epg/events/grid` JSON from now to a few hours ahead; `rows` (default `4`) is how many rows show before the list scrolls. The guide is fetched only while the list is open, and refreshed every minute. Whether it's open is remembered per device. |
| `backdrop` | none | An `image` entity with wide artwork for the Plex item. Without it the Plex poster is cropped to fit. |
| `ratings` | `/local/ratings/` | The folder of rating symbols. `false` hides the badge. |
| `volume` | | Merged into the slider's config. The defaults hide its header and icon, make its card transparent, draw an 8px amber track, and make tap and double tap do nothing, so a stray tap can't switch the TV off. |
| `volume_idle` | `10` | Seconds without use before the volume line gives way to the discs again. `0` keeps it open until the speaker disc is tapped. |
| `styles` | | See [Styles](#styles). |

## What shows when

| The TV is on | Title | Second line | Artwork | Controls |
| --- | --- | --- | --- | --- |
| `plex_source`, Plex playing or paused | Film title, or the series | `Film · 2026`, or `S1 E2 · Episode` | Backdrop, else the poster | Play or pause, sent to the TV (HDMI-CEC). With an active Apple TV, its back / play-pause / forward. |
| `apple_tv_source`, Apple TV playing or paused | Its title, or the series | Its episode, artist or app | Its artwork | Back 10 s, play or pause, forward 30 s |
| `live_source` with a matching guide | Programme | `Next: Programme · 23:30` | Channel logo over a blurred, enlarged copy | Channel down, channel up |
| `live_source` without one | Channel name | | | Channel down, channel up |
| Any other source | Source name | | The TV's icon for the app, as a tile | Play-pause on the TV |

## Channel list

Tapping a channel calls `media_player.play_media` on the TV with `media_content_type: channel` and the channel's name. If the TV is on another source it is switched to `live_source` first, and the channel is picked 2.5 s later.

A `rest_command` for TVHeadend:

```yaml
rest_command:
  tvheadend_epg:
    url: >-
      https://tvheadend.example/api/epg/events/grid?limit=2000&filter={{
      [{'type': 'numeric', 'field': 'stop', 'comparison': 'gt', 'value': now().timestamp() | int},
       {'type': 'numeric', 'field': 'start', 'comparison': 'lt', 'value': (now().timestamp() | int) + 10800}]
      | to_json | urlencode }}
    method: get
```

## Styles

`styles:` takes one block per element: `heading`, `name`, `toggle`, `source`, `channels`, `channel`, `card`, `hero`, `backdrop`, `logo`, `tile`, `badge`, `title`, `subtitle`, `progress`, `bar`, `times`, `controls`, `disc`, `speaker` (the volume disc) and `volume`. Properties are CSS names. `size`, `weight` and `colour` are short for `font-size`, `font-weight` and `color`, and bare numbers become px. A block can also be a list of single properties.

`styles.blur` sets the blurred logo instead of a CSS rule:

| Key | Default | Description |
| --- | --- | --- |
| `blur` | `40` | Blur in px. |
| `zoom` | `3` | The blurred logo's size, as a multiple of the sharp one. |
| `strength` | `50` | Opacity in %. |

## Tests

```
npm install
npm test
```

## Licence

BSD 3-Clause. See [LICENSE](LICENSE).
