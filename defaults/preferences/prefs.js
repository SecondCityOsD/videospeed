// Video Speed Controller — default preferences (upstream 0.11.1 DEFAULT_SETTINGS)
pref("extensions.videospeed.enabled", true);
pref("extensions.videospeed.lastSpeed", "1.0");
pref("extensions.videospeed.rememberSpeed", false);
pref("extensions.videospeed.exclusiveKeys", false);
pref("extensions.videospeed.audioBoolean", true);
pref("extensions.videospeed.startHidden", false);
pref("extensions.videospeed.controllerOpacity", "0.3");
pref("extensions.videospeed.controllerButtonSize", 14);
pref("extensions.videospeed.customCSS", "");
pref("extensions.videospeed.logLevel", 3);
pref("extensions.videospeed.schemaVersion", 1);
// Empty: the page falls back to the built-in v2 default bindings.
pref("extensions.videospeed.keyBindings", "[]");
pref("extensions.videospeed.siteRules", "[{\"pattern\":\"imgur.com\",\"enabled\":false,\"speed\":null},{\"pattern\":\"teams.microsoft.com\",\"enabled\":false,\"speed\":null},{\"pattern\":\"meet.google.com\",\"enabled\":false,\"speed\":null}]");
// Legacy; consulted only while siteRules is absent (see VSCPrefs.migrateBlacklist).
pref("extensions.videospeed.blacklist", "imgur.com\nteams.microsoft.com\nmeet.google.com");
