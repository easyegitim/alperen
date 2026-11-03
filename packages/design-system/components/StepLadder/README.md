# StepLadder

Teşhis sonucunun çekirdeği: öğrencinin adımları ile beklenen (bağımsız çözülen) adımlar yan yana; ilk bozulan adım vurgulanır.

**Sen sağlarsın:** `studentSteps`, `expectedSteps` (`{ no, text, note? }`; `text` içinde `$…$` formülleri KaTeX ile çizilir), `failingStepNo` (`solution_analyses.failing_step_no`), `cause` (`concept` · `procedure` · `careless` · `reading` · `time`), `skills` (kazanım çipleri), `actions`.

**Katlanır (varsayılan):** `collapsible` (varsayılan `true`), `defaultOpen` (varsayılan `false`), `summary` (tek cümle teşhis). Kapalıyken yalnız `summary` cümlesi ve bozulan adım satırı ("✕ 2. adımda bozuldu" + adım metni) görünür; altındaki gerçek `Detay` düğmesi (`aria-expanded` + `aria-controls`) açınca iki sütunlu merdiven, kazanım çipleri ("Kazanımlar" listesi) ve neden rozeti görünür. Kapalıyken bunlar `hidden` olduğundan erişilebilirlik ağacında da yoktur. `collapsible={false}` ile her şey açık çizilir (ör. `OneLineResult` zaten kendi Detay'ını taşıyorsa). `actions` her zaman görünür.

- Bozulan adım `danger-soft` zemin, "✕ Burada bozuldu" kelimesi ve `aria-current="step"` taşır; karşısındaki beklenen adım `primary-soft` ve "Beklenen" yazar. Öncesi "✓ Doğru", sonrası soluk (yargılanmaz).
- Açıkken "✕ N. adımda bozuldu" ve neden çipi ("İşlem hatası"). Neden etiketleri `ERROR_CAUSE_LABELS` içindedir.
- Dar ekranda iki sütun alt alta iner. `failingStepNo` verilmezse hiçbir adım vurgulanmaz.
