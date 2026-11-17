# AppShell

Uygulama kabuğu: mobilde alt gezinme (+ ortada "+ Yükle" düğmesi), masaüstünde (md ve üstü) kenar çubuğu.

**Sen sağlarsın:** `items` (`{ id, label, href, icon?, active?, badge? }`), `brand` (`BrandLockup`), `fab` (`{ label, onClick | href, icon }`), `footer`, `renderLink` (Next `Link` gibi), `navLabel`, `children`.

- Öğrenci: Bugün · Koç · Gelişim (+ Yükle). Veli: Özet · Sohbet. Eğitmen konsolu: kenar çubuğu (bkz. `egitmen-konsolu.md`).
- Aynı öğeler iki yerleşimde çizilir, CSS ile yalnızca biri görünür (gizli olan erişilebilirlik ağacında yoktur). Etkin sayfa `aria-current="page"` alır.
- İkonlar her zaman metin etiketiyle birlikte; alt çubukta etiket 12px. Hedefler en az 44px, alt çubuk `safe-area-inset-bottom` bırakır.
- Ana içerik `<main id="icerik">`; içeriğin alt çubuğun altında kalmaması için mobilde alt dolgu vardır.
