"""Öğrenmen ders videosu analizi (BLUEPRINT §6.3, M08).

Akış: ``register`` (``register_lesson`` RPC) → ``analyze`` (ffmpeg ses + sahne kareleri → ``transcribe`` zinciri →
``resolve_lesson_labels`` hash'leriyle ad temizliği → ``profile_for_prompt`` seed profili → ``lesson_analysis``
zinciri → ``write_lesson_analysis`` RPC) → 30 gün sonra ``purge`` (``confirm_video_deleted`` RPC).
Gözlem (``observations``) bu paket tarafından hiçbir zaman yazılmaz; onay panelden ``approve_lesson_analysis`` ile.
"""

__version__ = "0.1.0"
