# Kalite kapısı ve skor kalibrasyonu

## Faz 4 — Kalite eşikleri (`lib/face/quality.ts` → `QUALITY_CONFIG`)

Başlangıç değerleri SPEC 7.3'tür. 20–30 gönüllü fotoğrafıyla (yalnız şifreli yerel diskte; depoya konmaz) her ölçüm için
dağılım çıkarılır ve eşikler aşağıdaki tabloya işlenir. `/debug/landmarks` sayfası canlı değerleri gösterir.

| Ölçüm | Başlangıç | Kalibre | Not |
| --- | --- | --- | --- |
| Yüz genişliği / görüntü genişliği | 0,35–0,75 | — | |
| Merkez sapması | < 0,12 | — | |
| Yaw / pitch / roll | 8° / 10° / 6° | — | İşaretler debug sayfasında doğrulanacak |
| Parlaklık (0–255) | 80–200 | — | 256 px kopyada yüz kutusu ortalaması |
| Sol/sağ yanak farkı | < 35 | — | |
| Laplace varyansı (128×128) | > 60 | — | Kamera kalitesine duyarlı; düşük segment Android'de ölçülmeli |
| eyeBlink | < 0,4 | — | |
| mouthSmile / jawOpen | < 0,4 / < 0,15 | — | |

### Cihaz testleri (Faz 4 çıkış kriteri)

| Cihaz | Tarayıcı | Model yükleme (4G) | Önizleme kare/sn | Tek kare analiz | Delegate | Sonuç |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone | Safari | | | | | |
| Orta segment Android 1 | Chrome | | | | | |
| Orta segment Android 2 | Chrome | | | | | |
| Düşük bellekli Android | Chrome | | | | | |

Bilinen risk: `selfie_multiclass_256x256.tflite` 16,4 MB; landmarker'dan sonra tembel yüklenir ve yalnız saç uyarısı/deneme maskesi için kullanılır.

## Faz 6 — Skor kalibrasyonu (`lib/score/calibration.ts`)

v0: `RAW_MEAN = 6.5`, `SCALE = 1.4` (SPEC 8.4). `pnpm calibrate` ile 50 rızalı fotoğraftan güncellenir; sonuç buraya yazılır.
