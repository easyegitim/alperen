"""Ders boru hattına özgü hata kodları (``OGR-DERS-NNN``; RPC hataları ``OGR-LESSON-*`` olarak DB'den gelir).

* ``OGR-DERS-001`` — girdi dosyası ya da dizini yok, okunamıyor (video, ses, kare dizini, ``--video-dir``)
* ``OGR-DERS-002`` — ders bulunamadı ya da kayıt/öğrenci bağı eksik
* ``OGR-DERS-003`` — ad temizliği doğrulanamadı: öğrencinin ad hash'i yok ya da modele gidecek metinde (ya da son
  analizde) hâlâ ad tokenı var (gönderilmez / yazılmaz)
* ``OGR-DERS-004`` — ffmpeg/ffprobe yok, başarısız ya da zaman aşımına uğradı
* ``OGR-DERS-005`` — analiz çıktısı sözleşmeye ya da ders bağlamına uymuyor (onarımdan sonra da)
* ``OGR-DERS-006`` — yerel transkript motoru (whisper.cpp) yapılandırması eksik, başarısız ya da zaman aşımı
* ``OGR-DERS-007`` — geçersiz komut girdisi (süre, kimlik, tarih biçimi, ``--video-dir`` eksik ya da video dışında,
  korunan durumdaki derste ``--force`` olmadan yeniden analiz)
"""

from __future__ import annotations

from ogrenmen_common.errors import OgrError


class DersError(OgrError):
    """Ders boru hattı hatası; mesaj ``OGR-DERS-NNN`` ile başlar."""
