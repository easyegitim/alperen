# Yerel Expo modülü (SPEC-MOBILE M8): MediaPipe Image Segmenter (selfie multiclass) ile saç çizgisi maskesi.
# MediaPipeTasksVision sürümü react-native-mediapipe ile aynı tutulur (CocoaPods tek sürüm çözer).
Pod::Spec.new do |s|
  s.name           = 'AuraSegmenter'
  s.version        = '0.1.0'
  s.summary        = 'Aura: on-device selfie segmentation for hairline detection'
  s.description    = 'Local Expo module wrapping MediaPipe ImageSegmenter (category mask only).'
  s.license        = 'MIT'
  s.author         = 'Aura'
  s.homepage       = 'https://github.com/easyegitim/aura'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MediaPipeTasksVision', '0.10.12'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
