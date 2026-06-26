# Liquid Star JSUA Reference

JSUA ("JavaScript User Application") is Liquid Star's scripting layer. A script is one `.js` file placed in the client's `jsua/` folder, loaded from the JSUA tab, and toggled on/off there. This document lists every command available, what each one does, what you pass it, and what you get back.

Use only the API in this document. Scripts run in a sandbox: no Node, no Electron internals, no arbitrary network, no dynamic code generation. Anything outside that is rejected before the script runs.

## STEP 0 — before anything, ask the user's access tier

Before you read further or write a single line, ask the user exactly one thing:

> **"Are you on Guest or Licensed access?"** (A few users are Developer — only treat them so if they say it.)

Ask only this. Nothing else up front. It matters because the features you can switch on through `feat` depend on the user's tier: a Guest physically cannot enable Licensed-only features, and attempts silently do nothing. Once you know the tier, only build with what that tier can use, and if you're unsure whether a feature is in their tier, have them run `feat.list()` (it only ever lists what their account can actually touch) and work from that.

## What you can and cannot do

**You CAN:**
- Read live game state — your position, aim, health, the player list, your weapon.
- Turn the client's own features on/off — but only the ones the user's tier exposes.
- Build menu controls (checkboxes, sliders, buttons) under the script.
- Connect and control 3rd-person guest bots.
- Manipulate your own rotation and movement, and what the server sees you doing (desync).
- Run timers, draw your own on-screen overlays, and read files from the `jsua/` folder.

**You CANNOT:**
- Leave the sandbox — no network (except the `*.voxiom.io` sockets `bot` handles for you), no files outside `jsua/`, no `eval`/`new Function`/workers/Node/Electron.
- Unlock features above the user's tier — `feat` simply does not expose them, so there is no path to them. Do not pretend otherwise.
- Read another loaded script's private variables — every script runs in its own isolated scope.
- See, extract, or reproduce the client's private source code.
- Promise the user won't be warned, restricted, or banned — that is always their risk, not something a script controls.

## Intricacies — read these or you'll trip

- **Nothing exists before spawn.** All live values are `null`/empty on the menu screen. Guard match logic with `if (kit.ready()) { … }`.
- **A feature only appears in `feat.list()` after its menu tab has been opened once this session.** A missing label means either it's above the user's tier, or that tab hasn't been opened yet — ask before assuming it's broken.
- **Angles are radians with Voxiom's yaw offset.** `self.yaw` / `self.rotation.y` is horizontal, `self.pitch` / `self.rotation.x` is vertical (up is positive). Yaw is normalized to `-π..π`, but it is offset: `-π ≈ 0°`, `0 ≈ 180°`, `π ≈ 360°`. Do **not** convert it like normal compass yaw. Bots use the same units (`bot(id).yaw`, `bot(id).pitch`).
- **Menu controls must be created synchronously inside `init`** — never inside a timer or callback, or they won't attach.
- **Bots are separate guest connections** (3rd person), join the user's exact lobby, and keep running until disconnected — always `bot.disconnectAll()` in `cleanup`.
- **`self.fakeCamera()` is experimental** — it overrides the render camera and can fight the client's own viewangles/third-person.
- **Clean up everything** you changed: features on → off, keys pressed → released, bots connected → disconnected, all in `cleanup()`.
- **Never guess a name** — print it with `jsua.log`, `feat.list()`, or `Object.keys(...)` and write from what the console shows.

## For the AI writing this script — read first

You are writing one self-contained JSUA `.js` file for a user. Rules:

1. **Only use the API below.** Reaching for `require`, `fetch`, `XMLHttpRequest`, `eval`, `new Function`, workers, or Electron makes the client refuse to load the file. Rewrite the idea with the API instead.
2. **Never invent names.** If you are not certain a feature label, object key, or value exists, do not guess. Hand the user a small probe snippet (see "Testing on the fly"), ask them to paste the console output, then write the real script from that.
3. **One script, one purpose.** A single behaviour, the controls it needs, and a clean `cleanup`.
4. **Always clean up.** In `cleanup()` turn off every feature you turned on, release every key you pressed, and disconnect every bot you connected. Timers, listeners, and `jsua.menu` controls are removed automatically; features, keys, and bots are not.
5. **Build → test → finalise.** Don't deliver a large script blind. Give a tiny probe first, have the user run it and report the console, then deliver the finished version.

## Testing on the fly (the loop that replaces guessing)

The user can enable the script and read the **JSUA Console** immediately, so verify reality before committing to names:

- `jsua.log(name, value)` — print any value into the JSUA Console.
- `feat.list()` — every feature label and current value this account can touch right now.
- `Object.keys(obj)` — the real property names on `game.self`, `weapon.raw`, a player, etc.

Hand the user a probe like this, then rewrite from what they paste back:

```js
jsua.register({ name: "Probe" }, function init() {
  jsua.menu.button("Print features", function () { jsua.log("features", feat.list()); });
  jsua.menu.button("Print self keys", function () { jsua.log("self", Object.keys(game.self || {}).join(", ")); });
  jsua.menu.button("Print weapon", function () { jsua.log("weapon", JSON.stringify(weapon.raw || weapon).slice(0, 800)); });
}, function cleanup() {});
```

After any edit the user must **disable then re-enable** the script so `init` runs fresh.

## Quick template

```js
jsua.register(
  { name: "My Script", author: "you", version: "1.0.0", description: "What it does" },
  function init() {
    jsua.notify("Enabled", "success");
  },
  function cleanup() {
    jsua.notify("Disabled", "info");
  }
);
```

Reserved injected names (already defined for you — never redeclare with `let`/`const`): `jsua`, `game`, `self`, `players`, `weapon`, `feat`, `calc`, `kit`, `bot`, `on`, `off`, `stream`, `step`.
`on` is `true`, `off` is `false`; `stream` and `step` are bot packet-rule constants.

## Lifecycle — `jsua.register(metadata, init, cleanup)`

Registers the script. Call it exactly once, at the top level of the file.

- `metadata` — object. `name` (string, required) is shown in the JSUA list and console. `author`, `version`, `description` are optional strings.
- `init` — function. Runs **once** the moment the script is enabled. Build your menu, start your loops, connect your bots here.
- `cleanup` — function. Runs **once** the moment the script is disabled. Undo anything that does not clean itself up.
- Auto-cleaned for you on disable: every `setInterval`/`setTimeout`/`requestAnimationFrame`, every `addEventListener`, and every `jsua.menu.*` control.
- NOT auto-cleaned: client features you switched on, keys you pressed, and bots you connected — undo those yourself in `cleanup`.

## Reading yourself — `self` / `game.self`

`self` is the local player (you). All values are live (always current) and are `null`/empty until you spawn into a match — guard with `kit.ready()`.

| Access | What it gives you |
| --- | --- |
| `self.pos` / `self.position` | Your body/world position as `{x, y, z}` numbers. |
| `self.eye` / `self.aimPosition` | Your aim/eye point. Use this when another bot should look at your head instead of your feet. |
| `self.yaw` | Horizontal facing angle, radians. Normalized to `-π..π`: `-π` ≈ 0°, `0` ≈ 180°, `π` ≈ 360°. **Settable** — assign to turn (`self.yaw = 1.2`). Do not remap this like compass degrees. |
| `self.pitch` | Vertical facing angle, radians (up is positive). Normal range is `-π/2..π/2`. **Settable**. |
| `self.rotation` | Your live rotation object — set `self.rotation.x` (pitch) / `self.rotation.y` (yaw) directly. |
| `self.health` | Your current health, a number. |
| `self.team` | Your team number — compare with other players to tell friend from foe. |
| `self.weapon` | The item you are currently holding. |
| `self.raw` | The underlying player object, for `Object.keys()` discovery. |
| `self.serverRotation` | Read-only `{ yaw, pitch }` the **server** currently sees — reflects any manipulation below. |
| `self.ssp` | Read-only server-side position — where the **server** thinks you are (`game.player.serverPosition`), which lags your live `self.pos`. |
| `self.ssld` | Read-only server-side look direction — the unit aim vector `{x, y, z}` the **server** currently sees (from your last outgoing input). |

`self` also acts on you:

| Call | What it does |
| --- | --- |
| `self.press(key)` | Holds a movement key down (keeps holding until released). |
| `self.unpress(key)` | Releases a key you pressed. Always pair it with a press, including in `cleanup`. |
| `self.lookAt(target)` | Smoothly rotates your view toward a player, a point `{x,y,z}`, or a 3D object. Player objects aim at head/eye; plain points are literal. |
| `self.lookAt(target, { from })` | Same, but aim as if your eye were at `from` instead of your real position. |
| `self.lookAt(target, { predict })` | Lead a moving target — aim where it's heading. `predict` is `true` (default lead) or a tick count (e.g. `{ predict: 3 }`). |

LookAt rule: pass a player object when you mean "aim at that player"; pass a point when you mean "aim at this exact coordinate." `self.pos`/`self.position` is a body point, but bot lookAt treats that specific local body point as `self.eye` so bots do not aim at your feet.
Angle rule for AI/code generators: yaw is not `0 = north` and not `0 = 0°`. Liquid Star/Voxiom uses `-π ≈ 0°`, `0 ≈ 180°`, `π ≈ 360°`. Keep yaw normalized with wraparound into `-π..π`; never "fix" it by shifting `0` back to 0°. Pitch uses the same radians idea but only from `-π/2` to `π/2`.

`key` is a name — `"w" "a" "s" "d" "space" "ctrl" "shift" "crouch" "jump"` — or a raw key code number like `68`.

### Desync (advanced) — separate what you *see*, what the *server* sees, and where you *walk*

These let a script split your visual view, your server-reported angle, and your movement direction apart — the building blocks behind viewangles and silent aim. Angles are radians.

| Call | What it does |
| --- | --- |
| `self.setServerRotation(yaw, pitch)` | Make the **server** see a fixed angle while your screen keeps your real aim (a held, silent-aim-style spoof). Pass `null` to stop. |
| `self.clearServerRotation()` | Stop the server-rotation spoof. |
| `self.compMovement(true / false)` | While a server rotation is set, rotate your WASD so you still **walk where you actually look** instead of toward the spoofed angle. |
| `self.serverRotation` | Read the `{ yaw, pitch }` the server is currently being sent. |
| `self.fakeCamera()` | **Creates** a mouse-driven fake view camera and returns a live `{ yaw, pitch, sens }`. Your mouse now moves this on-screen view; your real/server angle no longer follows the mouse, so you steer it yourself with `self.rotation` / `self.lookAt`. Call `self.fakeCamera(false)` to remove it. (Experimental — overrides the render camera; can fight the client's own viewangles/third-person if those are on.) |

```js
jsua.register({ name: "Spin Desync" }, function init() {
  let a = 0;
  self.compMovement(true);                 // keep walking where I look
  kit.every(50, function () {
    a += 0.3;
    self.setServerRotation(a, 0);           // server sees me spinning
  });
}, function cleanup() {
  self.setServerRotation(null);             // always undo it
  self.compMovement(false);
});
```

## Other players — `players` / `game.players`

`players` is the live list of everyone in the match **except you**. It behaves like an array (`players.length`, `players[0]`, `for (const p of players)`) and offers filters and nearest-lookups. Each entry is a player object you can read positions from or pass to `self.lookAt` / `kit.distance`.

| Access | What it gives you |
| --- | --- |
| `players` / `players.all` / `players.list()` | Every other player. |
| `players.enemy` | Only players on other teams. |
| `players.friendly` (alias `players.fiendly`) | Only your teammates. |
| `players.closest(origin?)` | The single nearest player of any team. `origin` is a player/point to measure from; defaults to you. Returns `null` if none. |
| `players.closestEnemy(origin?)` | The nearest enemy. The usual aim target. |
| `players.closestFriendly(origin?)` | The nearest teammate. |

## Your weapon & aim — `weapon` and `calc`

| Access | What it gives you |
| --- | --- |
| `weapon.ammo` | Rounds left in the current weapon, a number. |
| `weapon.reloading` | `true` while a reload is in progress. |
| `weapon.shotDelay` | The cooldown between shots for this weapon. |
| `weapon.raw` | The raw current-item object, for discovery. |
| `calc.lookYaw` / `calc.lookPitch` | Your current aim angles, ready to reuse. |
| `calc.lookDir` | The direction you are looking as a unit vector `{x, y, z}`. |
| `calc.predict(target, lead?)` | Predicted future position `{x, y, z}` of a moving player/point. `lead` is in 50 ms server ticks (default 3). Call it each frame — velocity is tracked for you. |
| `calc.velocity(target)` | A target's current velocity as `{x, y, z}` units per second. |

## Driving client features — `feat`

`feat` reads and sets the client's own features — the exact toggles and sliders in the menu, addressed by their on-screen **label**. It always obeys your account tier: features above your tier never appear, so a script can never unlock something you do not own. Labels are case- and space-insensitive.

| Call | What it does |
| --- | --- |
| `feat.list()` | Returns an array of `{ label, name, type, value }` for every feature you can currently touch. Use it to discover exact labels. |
| `feat.get(label)` | Reads a feature's current value (boolean for toggles, number for sliders). |
| `feat.set(label, value)` | Sets a feature — `true`/`false` for a toggle, a number for a slider. |
| `feat.has(label)` | `true` if that label resolves to a real feature. |
| `feat.<label> = on` | Assignment shortcut, e.g. `feat.weaponchams = on`, `feat.thirdperson = off`. |

If a feature is missing from `feat.list()`, its menu tab has not been opened yet this session — open that tab once in the client, then list again.

```js
feat.weaponchams = on;
feat.set("Third Person", true);
let chams = feat.get("Weapon Chams");
```

## Your own menu controls — `jsua.menu`

Build a small control panel under your script. Create controls **synchronously inside `init`** (not inside a timer). Each control returns a handle `{ el, getValue(), setValue(v) }`, and all of them disappear automatically when the script is disabled.

| Call | What it creates |
| --- | --- |
| `jsua.menu.label(text)` | A small heading to group controls. |
| `jsua.menu.checkbox(label, default, onChange)` | A toggle. `default` is the starting boolean; `onChange(value)` fires when it changes. |
| `jsua.menu.slider(label, min, max, step, default, onChange, suffix?)` | A number dial with a live readout. `onChange(value)` fires as it moves; `suffix` is an optional unit label like `"x"`. |
| `jsua.menu.button(label, onClick)` | A button that runs `onClick()` when pressed. |
| `jsua.menu.custom(element)` | Mounts a DOM element you built yourself. |

```js
function init() {
  jsua.menu.label("Settings");
  const speed = jsua.menu.slider("Speed", 0, 10, 0.1, 1, function (v) { jsua.log("Speed", v); }, "x");
  jsua.menu.button("Reset", function () { speed.setValue(1); });
}
```

## Shortcut layer — `kit`

`kit` packs common patterns into single calls. It adds convenience only, never new capability.

| Call | What it does |
| --- | --- |
| `kit.ready()` | `true` once the match and your player exist. Guard all match logic with it. |
| `kit.feature(label)` | Read one feature (same as `feat.get`). |
| `kit.feature(label, value)` | Set one feature (same as `feat.set`). |
| `kit.features({ label: value, ... })` (alias `kit.loadout`) | Apply a whole preset of features in one call. |
| `kit.on(labels)` / `kit.off(labels)` | Turn one label, or an array of labels, on/off. `kit.off([...])` is the usual cleanup line. |
| `kit.toggle(label)` / `kit.toggle(label, force)` | Flip a feature, or force it on/off with a boolean. |
| `kit.menuFeature(label, featureLabel, default?)` (aliases `kit.menu.feature` / `kit.menu.toggle`) | Creates a checkbox already wired to a client feature. |
| `kit.every(ms, fn)` | Runs `fn` repeatedly every `ms`. Returns a function that cancels it. |
| `kit.after(ms, fn)` | Runs `fn` once after `ms`. Returns a function that cancels it. |
| `kit.key(key, onDown, onUp?)` | Binds a keyboard key; returns a function that unbinds it. |
| `kit.pos(value)` | Pulls a clean `{x, y, z}` out of a player, point, or 3D object. |
| `kit.distance(a, b)` | Distance between two players/points. |
| `kit.clamp(value, min, max)` | Keeps a number inside a range. |
| `kit.lerp(a, b, t)` | Blends between `a` and `b` by `t` (0–1). |

```js
jsua.register({ name: "One Button Loadout" }, function init() {
  kit.menuFeature("Visuals", "Weapon Chams");
  jsua.menu.button("Pack on", function () {
    kit.loadout({ "Weapon Chams": true, "Third Person": true, "Hit Sound": true });
  });
  kit.key("v", function () { kit.toggle("Weapon Chams"); });
}, function cleanup() {
  kit.off(["Weapon Chams", "Third Person", "Hit Sound"]);
});
```

## Bots — `bot`

`bot` connects and controls extra players ("bots") in your current lobby. Each bot is a **separate guest connection**, not your logged-in account, so you can run several at once. Bots are a shared resource and keep running until stopped — always `bot.disconnectAll()` in `cleanup`.

Every bot is addressed by a **custom id you choose**. Connect it under an id, then grab it any time with `bot(id)` — there are no numeric handles to track. `bot.connect("tank")` joins the lobby you are in (and returns that bot's controller); `bot("tank")` returns the same controller later.

| Top-level call | What it does |
| --- | --- |
| `bot.connect(id?, options?)` | Connects a bot under your `id` (any string/number) and returns its controller. `options`: `{ slot, tickMs, url }` — all optional; `url` defaults to your current lobby, `slot` is the starting weapon slot. Omit `id` and one is auto-assigned (`"bot1"`, `"bot2"`, …). |
| `bot(id)` | The controller for the bot connected under `id` (re-grab it any time). If no such bot exists it warns and returns a safe no-op. |
| `bot.has(id)` / `bot.get(id)` | Whether an id exists / its controller (or `null`). |
| `bot.ids()` | An array of every connected bot id. |
| `bot.list()` | An array of every live controller handle. |
| `bot.count` | How many bots are connected. |
| `bot.disconnect(id)` | Disconnects the one bot with that id. |
| `bot.disconnectAll()` (alias `bot.disconnect()` with no id) | Disconnects every bot. |

**Drive every bot at once.** Use any controller member directly on `bot` *without* an id and it fans out to **all** connected bots: `bot.yaw = 0`, `bot.press("w")`, `bot.shoot(on)`, `bot.lookAt(target)`. With an id — `bot("tank").press("w")` — it targets just that one.

Everything below is a member of a bot controller — call it as `bot(id).member` for one bot, or `bot.member` for all:

| Handle member | What it does |
| --- | --- |
| `.connected` | Read-only `true` while this bot's connection is live. |
| `.press(key)` / `.unpress(key)` | Holds/releases `"w" "a" "s" "d" "space"/"jump" "shoot"/"fire" "aim"`. Movement and an action can be active at the same time. |
| `.tap(key, ms?)` | Presses a key, then releases it after `ms` (default 120). |
| `.yaw` / `.pitch` | Get/set the bot's view angles in radians. Yaw is normalized to `-π..π` with the same offset (`-π≈0°`, `0≈180°`, `π≈360°`); pitch is clamped to `-π/2..π/2`. Use `.lookAt(...)` or normalized radians, not compass yaw. |
| `.rotation` | Get/set `{ yaw, pitch }` at once. `.setRotation(yaw, pitch)` does the same. |
| `.angles()` | Debug helper returning `{ yaw, pitch, packetYaw, packetPitch, lastAim }`. `yaw/pitch` are JSUA logical angles; `packetYaw/packetPitch` are what the guest socket receives; `lastAim` shows origin/target/delta from the last `.lookAt`. |
| `.lookAt(target, from?)` | Points the bot at a player/point/object/function, aiming from the **bot's eye**. Player targets use head/eye; plain points stay exact, except `self.pos`/`self.position` maps to `self.eye`. If the target resolves to the bot itself, it skips to another nearby player. `from` (or `.origin`) overrides the point it aims from. |
| `.locate()` | Force the bot to re-find its own body in the world (handy right after a respawn). Normally automatic. |
| `.rule(mode)` | Sets packet behaviour. `stream` (default) sends continuous movement; `step` only sends when input changes, mimicking the old gravity-only/stepped behaviour. Called with no argument, returns the current mode. |
| `.ruleMode` | Get/set the current packet rule (`stream` or `step`). |
| `.slot(n)` | Switches the bot to weapon slot 0–9. |
| `.shoot(on)` | Holds (`true`) or releases (`false`) the bot's fire. |
| `.shootOnce()` | Fires a single shot. |
| `.jump()` | Makes the bot jump once. |
| `.respawn()` | Respawns the bot. |
| `.origin` | An optional world point treated as this bot's eye for `.lookAt`. |
| `.raw` | The bot's underlying connection, for advanced use. |
| `.disconnect()` | Disconnects just this bot. |

```js
jsua.register({ name: "Follow Bot" }, function init() {
  bot.connect("buddy");
  bot("buddy").slot(1);
  kit.every(80, function () {
    const enemy = players.closestEnemy();
    if (enemy) { bot("buddy").lookAt(enemy); bot("buddy").shoot(on); }
    else bot("buddy").shoot(off);
    bot("buddy").press("w");
  });
}, function cleanup() {
  bot.disconnectAll();
});
```

Note: `.lookAt` aims from the bot's own eye (located automatically once it joins). To aim from somewhere else instead — e.g. your own position — set the bot's `.origin` or pass a `from` point. If you want the old stepped packet style on purpose, call `bot(id).rule(step)`.

## Utilities — `jsua.*`

| Call | What it does |
| --- | --- |
| `jsua.notify(message, type)` | Shows an on-screen toast. `type`: `"success" "info" "warning" "error"`. |
| `jsua.log(name, value, level?)` | Writes a line to the JSUA Console (and the on-screen log). `name` is a tag, `value` is anything. Your main debugging tool. |
| `jsua.readFile(path)` | Reads a text file from the `jsua/` folder. Paths that escape the folder are refused. |
| `jsua.readFileB64(path)` | Reads a `jsua/` file as base64 (for images/binaries). |
| `jsua.listFiles(subdir?)` | Lists files inside a `jsua/` subfolder. |
| `jsua.on(event, fn)` / `jsua.off(event, fn)` | Subscribe/unsubscribe to game render events. |

## Debugging — print, don't guess

When a name or value is unclear, never assume it — print it and read the truth.

- `jsua.log(name, value)` puts any value in the console.
- `feat.list()` reveals exact feature labels, types, and values.
- `Object.keys(game.self)` (or any object) reveals the real property names.
- Use throwaway debug buttons while testing, then delete the noisy logs from the final script.
- If the AI cannot know a name from this document, it should tell the user which probe to run and ask for the output — not invent internals.

## Sandbox rules

A script is rejected on load if its source contains, for example:

- Node/Electron: `require(`, `__dirname`, `__filename`, `ipcRenderer`, `process.env`, `process.versions`, `remote.`
- Network: `fetch(`, `window.fetch`, `XMLHttpRequest`, `EventSource`, `RTCPeerConnection`, `sendBeacon`, `importScripts`
- Dynamic code: `eval(`, `new Function`, `import(`, `new Worker`, `new SharedWorker`, `createElement('script')`
- Internals: `globalThis`

Allowed: normal JavaScript, timers and listeners, DOM overlays, sandboxed `jsua/` file reads, and bot connections (handled for you by `bot`).

## AI prompt starter

Paste this whole document into your AI assistant and say:

"First, before writing anything, ask me whether I'm on Guest or Licensed access — and ask only that. Then, using only the Liquid Star JSUA API in this document, write one JSUA script that fits my tier. It must call `jsua.register`, build any menu controls inside `init`, and in `cleanup` turn off every feature it changed, release every key it pressed, and disconnect every bot it connected. Do not use blocked sandbox APIs. Keep it to one clear behaviour. If you need a feature or value name that is not clearly listed here, do not guess — give me a small probe using `jsua.log`, `feat.list()`, or `Object.keys(...)` and ask me to paste the JSUA Console output back."
