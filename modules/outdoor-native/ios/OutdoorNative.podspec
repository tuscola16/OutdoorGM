Pod::Spec.new do |s|
  s.name           = 'OutdoorNative'
  s.version        = '0.1.0'
  s.summary        = 'Outdoor GM native shims (#82): step-counter polling and a partial wake lock.'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Bagel Run Technologies'
  s.homepage       = 'https://github.com/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
