// Low Ammo Warner — example JSUA for the Liquid Star Voxiom client.
// Drop this file in the client's jsua/ folder, then Load it from the JSUA tab.
// Notifies you when your current weapon's ammo gets low.

jsua.register(
  {
    name: "Low Ammo Warner",
    author: "you",
    version: "1.0.0",
    description: "Notifies when ammo is low",
  },
  function init() {
    let warned = false;
    this._timer = setInterval(() => {
      const a = weapon.ammo;              // friendly read over the obfuscated key
      if (typeof a !== "number") return;  // null before you're in a game
      if (a <= 2 && !warned) {
        jsua.notify("Low ammo: " + a, "warning");
        warned = true;
      }
      if (a > 2) warned = false;
    }, 250);
  },
  function cleanup() {
    clearInterval(this._timer);
  }
);
