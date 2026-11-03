# ProgressStrip

Test ilerlemesi: soru başına bir nokta. Sade test akışında `AnswerGrid` yerine kullanılır.

**Sen sağlarsın:** `total`, `current` (1'den başlar), `statuses` (`'todo' | 'answered' | 'flagged'` dizisi; kısaysa kalanlar `todo`).

- Noktalar `aria-hidden`; durum her zaman metinle yazılır: "Soru 3 / 8 · 2 soru cevaplandı". Mevcut soru büyük ve halkalı, bayraklı nokta altın halkalıdır (renk tek başına değil).
- En fazla 60 nokta çizilir. Çok sorulu deneme kipinde `ExamPlayer mode="exam"` ızgarayı kullanır.
