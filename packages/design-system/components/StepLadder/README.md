# StepLadder

Teşhis sonucunun çekirdeği: öğrencinin adımları ile beklenen (bağımsız çözülen) adımlar yan yana; ilk bozulan adım vurgulanır.

**Sen sağlarsın:** `studentSteps`, `expectedSteps` (`{ no, text, note? }`; `text` içinde `$…$` formülleri KaTeX ile çizilir), `failingStepNo` (`solution_analyses.failing_step_no`), `cause` (`concept` · `procedure` · `careless` · `reading` · `time`).

- Bozulan adım `danger-soft` zemin, "✕ Burada bozuldu" kelimesi ve `aria-current="step"` taşır; karşısındaki beklenen adım `primary-soft` ve "Beklenen" yazar. Öncesi "✓ Doğru", sonrası soluk (yargılanmaz).
- Üstte "✕ N. adımda bozuldu" ve neden çipi ("İşlem hatası"). Neden etiketleri `ERROR_CAUSE_LABELS` içindedir.
- Dar ekranda iki sütun alt alta iner. `failingStepNo` verilmezse hiçbir adım vurgulanmaz.
