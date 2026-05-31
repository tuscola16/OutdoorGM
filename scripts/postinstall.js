const fs = require('fs');
const path = require('path');

const pluginPath = path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'android', 'ExpoModulesCorePlugin.gradle');

if (fs.existsSync(pluginPath)) {
  let content = fs.readFileSync(pluginPath, 'utf8');
  if (content.includes('from components.release')) {
    content = content.replace(
      /release\(MavenPublication\)\s*\{\s*\n\s*from components\.release\s*\n\s*\}/,
      'if (components.findByName("release") != null) {\n          release(MavenPublication) {\n            from components.release\n          }\n        }'
    );
    fs.writeFileSync(pluginPath, content, 'utf8');
    console.log('[postinstall] Patched ExpoModulesCorePlugin.gradle for Gradle 8.x compat');
  }
}
