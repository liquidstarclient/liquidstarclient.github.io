// Chams On Demand — example JSUA for the Liquid Star Voxiom client.
// Adds a menu switch (in the JSUA Output panel) that drives the client's own
// "Weapon Chams" feature on/off. Demonstrates feat.* + jsua.menu.*.
// Note: Weapon Chams is a Licensed feature — it only turns on if your tier allows it.

jsua.register(
  {
    name: "Chams On Demand",
    author: "you",
    version: "1.0.0",
    description: "Menu switch that drives Weapon Chams",
  },
  function init() {
    jsua.menu.label("Chams On Demand");
    jsua.menu.checkbox("Weapon Chams", false, (v) => {
      feat.weaponchams = v ? on : off;   // 'on'/'off' are true/false constants
      jsua.log("Chams On Demand", "weapon chams " + (v ? "on" : "off"), "info");
    });
  },
  function cleanup() {
    feat.weaponchams = off;              // undo what we turned on
  }
);
