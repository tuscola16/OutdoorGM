const { withInfoPlist } = require('expo/config-plugins');

/**
 * Strip the `fetch` iOS background mode.
 *
 * `expo-task-manager`'s autolinked config plugin pushes `fetch` into UIBackgroundModes
 * unconditionally, with no option to opt out — it assumes anyone using TaskManager might
 * register a background-fetch task. We only ever register the background *location* task
 * (`hgl-background-location`); nothing in the app calls BackgroundFetch or schedules a
 * BGAppRefreshTask.
 *
 * App Review guideline 2.5.4 rejects apps that declare a background mode they don't
 * exercise, so shipping an unused `fetch` is a needless rejection vector. `location` and
 * `remote-notification` — both genuinely used — are left alone.
 *
 * Must be listed LAST in app.json `plugins` so this Info.plist mod runs after the
 * autolinked one that adds the entry. Verify with:
 *   npx expo config --type introspect --json
 */
module.exports = function withoutBackgroundFetch(config) {
  return withInfoPlist(config, (config) => {
    const modes = config.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      config.modResults.UIBackgroundModes = modes.filter((m) => m !== 'fetch');
    }
    return config;
  });
};
