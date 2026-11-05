"""Öğrenmen ders medya servisi (P5; docs/PLAN-v2.md §9).

v2 hattı: eğitmen kaydı 'lessons' kovasına yükler → ``register_lesson`` (supabase 0040) → apps/worker ``lesson.*``
işleri bu paketin HTTP servisini (``service.py``: ffmpeg ses + sahne kareleri, Groq Whisper STT) çağırır;
konuşmacı etiketleme, ad temizliği, ders analizi ve iddiaların uygulanması worker'dadır. Paket yalnız standart
kitaplığı kullanır; ``python3 -I`` ile çalışır.
"""

__version__ = "2.0.0"
