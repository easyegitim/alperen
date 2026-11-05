# Tree ve TreeNode

Konu haritası ve müfredat ağacı düğümü (öğrenci "Konu haritası", eğitmen "Müfredatlar").

**Sen sağlarsın:** `<Tree>` kabı içinde iç içe `<TreeNode label level …>`. `p` + `evidence` (ustalık ve gözlem sayısı; eşik altında "Henüz yeterli kanıt yok"), `styleCount` (soru tarzı noktaları), `prerequisiteHint` ("Ön koşul: Bölme"), `selected` + `onSelect`, `expanded` / `defaultExpanded` + `onExpandedChange`, `trailing`.

- Düz iç içe `ul`/`li`; açma düğmesi `aria-expanded` + `aria-controls` taşır; ARIA tree rolü kullanılmaz. Açma düğmesi ve ad ayrı düğmelerdir, ikisi de 44px.
- Alt düğüm verilmeyen düğüm yaprak sayılır. Girinti `level` ile 16px adımlarla.
- Bilinen boşluk: ok tuşlu gezinme (roving tabindex) yok; her düğüm Tab ile erişilir.
