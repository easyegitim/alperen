// Yerel Expo modülü (SPEC-MOBILE M8): çekilen selfie dosyasını MediaPipe ImageSegmenter ile bölütler ve
// yalnız kategori maskesini (0 arka plan, 1 saç, 2 vücut cildi, 3 yüz cildi, 4 giysi, 5 diğer) base64 olarak döner.
// Görüntü bellekte işlenir; diske/loga/ağa yazılmaz. Model dosyası uygulama paketine gömülüdür (plugins/withMediapipeModels.js).
import ExpoModulesCore
import MediaPipeTasksVision
import UIKit

public class AuraSegmenterModule: Module {
  private var segmenter: ImageSegmenter?
  private var loadedModel: String?

  public func definition() -> ModuleDefinition {
    Name("AuraSegmenter")

    AsyncFunction("segmentImage") { (path: String, modelName: String) throws -> [String: Any] in
      let segmenter = try self.ensureSegmenter(modelName)
      let image = try loadImage(path)
      let mpImage = try MPImage(uiImage: image)
      let result = try segmenter.segment(image: mpImage)
      guard let mask = result.categoryMask else {
        throw SegmentationFailedException()
      }
      let count = mask.width * mask.height
      let data = Data(bytes: mask.uint8Data, count: count)
      return [
        "width": mask.width,
        "height": mask.height,
        "maskBase64": data.base64EncodedString(),
      ]
    }

    AsyncFunction("release") {
      self.segmenter = nil
      self.loadedModel = nil
    }

    OnDestroy {
      self.segmenter = nil
    }
  }

  private func ensureSegmenter(_ modelName: String) throws -> ImageSegmenter {
    if let existing = segmenter, loadedModel == modelName {
      return existing
    }
    let url = URL(fileURLWithPath: modelName)
    guard let modelPath = Bundle.main.path(forResource: url.deletingPathExtension().lastPathComponent, ofType: url.pathExtension) else {
      throw ModelNotFoundException(modelName)
    }
    let options = ImageSegmenterOptions()
    options.baseOptions.modelAssetPath = modelPath
    options.runningMode = .image
    options.shouldOutputCategoryMask = true
    options.shouldOutputConfidenceMasks = false
    let created = try ImageSegmenter(options: options)
    segmenter = created
    loadedModel = modelName
    return created
  }
}

private func loadImage(_ path: String) throws -> UIImage {
  let urlString = path.hasPrefix("file://") ? path : "file://" + path
  guard let url = URL(string: urlString), let data = try? Data(contentsOf: url), let image = UIImage(data: data) else {
    throw ImageLoadException(path)
  }
  return image
}

private final class ModelNotFoundException: GenericException<String> {
  override var reason: String { "Segmenter modeli pakette yok: \(param)" }
}

private final class ImageLoadException: GenericException<String> {
  override var reason: String { "Görüntü okunamadı" }
}

private final class SegmentationFailedException: Exception {
  override var reason: String { "Bölütleme sonucu boş" }
}
