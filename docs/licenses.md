# Üçüncü taraf lisansları

| Bileşen | Lisans | Dağıtım notu |
| --- | --- | --- |
| `@mediapipe/tasks-vision` (WASM çalışma zamanı) | Apache-2.0 | `public/mediapipe/wasm` altında kendi alan adımızdan sunulur; `pnpm mediapipe:setup` kopyalar. Git'e konmaz. |
| `face_landmarker.task` (Face Landmarker, float16 v1) | Apache-2.0 (Google, MediaPipe Models) | Google'ın yayınladığı dosya; `public/mediapipe/` altına indirilir. Model kartı: https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf ve Face Mesh model kartı. Yayından önce kart ve lisans koşulları teyit edilir. |
| `selfie_multiclass_256x256.tflite` (Image Segmenter, float32) | Apache-2.0 (Google, MediaPipe Models) | 16,4 MB. Yalnız saç çizgisi uyarısı ve deneme maskesi için; landmarker'dan sonra tembel yüklenir. |
| shadcn/ui bileşen kaynakları | MIT | Kaynak koda kopyalandı (`components/ui`). |
| radix-ui, lucide-react, sonner, next-themes, react-markdown, remark-gfm | MIT | npm bağımlılığı |

Model dosyalarının dağıtım koşulları ve "Google tarafından sağlanmıştır" ibaresi gerekip gerekmediği yayından önce (SPEC 7.1) kontrol edilir.
