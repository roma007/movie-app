require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoDlnaCast'
  s.version        = package['version']
  s.summary        = package['description']
  s.homepage       = 'https://github.com/movie-app/expo-dlna-cast'
  s.license        = 'MIT'
  s.author         = 'movie-app'
  s.source         = { git: '' }

  s.platform       = :ios, '15.0'
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.swift'

  # TODO: Add SwiftUPnP SPM dependency
  # s.dependency 'SwiftUPnP'
end
