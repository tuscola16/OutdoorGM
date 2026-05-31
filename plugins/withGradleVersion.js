const { withGradleProperties } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withGradleVersion(config) {
  return withGradleProperties(config, (config) => {
    const projectRoot = config.modRequest.platformProjectRoot;

    // Downgrade Gradle wrapper to 8.3 (SDK 51 compatible)
    const wrapperPath = path.join(projectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    if (fs.existsSync(wrapperPath)) {
      let content = fs.readFileSync(wrapperPath, 'utf8');
      content = content.replace(/gradle-8\.\d+-all/g, 'gradle-8.3-all');
      fs.writeFileSync(wrapperPath, content, 'utf8');
    }

    // Patch ExpoModulesCorePlugin.gradle to fix components.release error
    const pluginPath = path.join(
      config.modRequest.projectRoot,
      'node_modules', 'expo-modules-core', 'android', 'ExpoModulesCorePlugin.gradle'
    );
    if (fs.existsSync(pluginPath)) {
      let content = fs.readFileSync(pluginPath, 'utf8');
      content = content.replace(
        'from components.release',
        'if (components.findByName("release")) { from components.release }'
      );
      fs.writeFileSync(pluginPath, content, 'utf8');
    }

    return config;
  });
};
