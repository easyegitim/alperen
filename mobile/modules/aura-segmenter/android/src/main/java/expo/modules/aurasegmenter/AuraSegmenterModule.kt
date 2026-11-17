// Yerel Expo modülü (SPEC-MOBILE M8): çekilen selfie dosyasını MediaPipe ImageSegmenter ile bölütler ve yalnız
// kategori maskesini (0 arka plan, 1 saç, 2 vücut cildi, 3 yüz cildi, 4 giysi, 5 diğer) base64 olarak döner.
// Görüntü bellekte işlenir; diske/loga/ağa yazılmaz. Model dosyası app/src/main/assets içindedir (plugins/withMediapipeModels.js).
package expo.modules.aurasegmenter

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AuraSegmenterModule : Module() {
  private var segmenter: ImageSegmenter? = null
  private var loadedModel: String? = null

  override fun definition() = ModuleDefinition {
    Name("AuraSegmenter")

    AsyncFunction("segmentImage") { path: String, modelName: String ->
      val seg = ensureSegmenter(modelName)
      val decoded = BitmapFactory.decodeFile(stripFileScheme(path)) ?: throw ImageLoadException()
      val bitmap = if (decoded.config == Bitmap.Config.ARGB_8888) decoded else decoded.copy(Bitmap.Config.ARGB_8888, false)
      val result = seg.segment(BitmapImageBuilder(bitmap).build())
      val mask = result.categoryMask().orElse(null) ?: throw SegmentationFailedException()
      val buffer = ByteBufferExtractor.extract(mask)
      buffer.rewind()
      val bytes = ByteArray(buffer.remaining())
      buffer.get(bytes)
      mapOf(
        "width" to mask.width,
        "height" to mask.height,
        "maskBase64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
      )
    }

    AsyncFunction("release") {
      closeSegmenter()
    }

    OnDestroy {
      closeSegmenter()
    }
  }

  private fun ensureSegmenter(modelName: String): ImageSegmenter {
    segmenter?.let { if (loadedModel == modelName) return it }
    closeSegmenter()
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val options = ImageSegmenter.ImageSegmenterOptions.builder()
      .setBaseOptions(BaseOptions.builder().setModelAssetPath(modelName).setDelegate(Delegate.CPU).build())
      .setRunningMode(RunningMode.IMAGE)
      .setOutputCategoryMask(true)
      .setOutputConfidenceMasks(false)
      .build()
    val created = ImageSegmenter.createFromOptions(context, options)
    segmenter = created
    loadedModel = modelName
    return created
  }

  private fun closeSegmenter() {
    segmenter?.close()
    segmenter = null
    loadedModel = null
  }

  private fun stripFileScheme(path: String): String = if (path.startsWith("file://")) path.substring(7) else path
}

private class ImageLoadException : CodedException("Görüntü okunamadı")

private class SegmentationFailedException : CodedException("Bölütleme sonucu boş")
