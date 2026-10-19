/* @ds-bundle: {"format":4,"namespace":"Ogrenmen","components":[{"name":"BrandLockup"},{"name":"Button"},{"name":"Badge"},{"name":"TextField"},{"name":"ProgressBar"},{"name":"ModeToggle"},{"name":"Notice"},{"name":"StatTile"},{"name":"MasteryMeter"},{"name":"EvidenceQuote"},{"name":"MisconceptionItem"},{"name":"LessonCard"},{"name":"FigureFrame"},{"name":"QuizOption"},{"name":"TutorMessage"},{"name":"CitationCard"},{"name":"ExamPriorityRow"},{"name":"AlertRow"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function omit(obj, keys) {
    var out = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) < 0) out[k] = obj[k];
    return out;
  }

  /* BrandLockup — easy işareti + "Öğrenmen" kelime markası */
  function BrandLockup(props) {
    var size = props.size || 'md';
    var showEndorsement = props.endorsement !== false;
    return h('span', { className: cx('og-lockup', 'og-lockup-' + size, props.className) },
      props.markSrc ? h('img', { className: 'og-lockup-mark', src: props.markSrc, alt: '' }) : null,
      h('span', { className: 'og-lockup-words' },
        h('span', { className: 'og-lockup-name' }, 'Öğrenmen'),
        showEndorsement ? h('span', { className: 'og-lockup-by' }, 'by easy') : null
      )
    );
  }

  /* Button */
  function Button(props) {
    var rest = omit(props, ['variant', 'size', 'className', 'children', 'icon', 'block']);
    var variant = props.variant || 'secondary';
    var size = props.size || 'md';
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('og-btn', 'og-btn-' + variant, 'og-btn-' + size, props.block && 'og-btn-block', props.className)
    }), props.icon ? h('span', { className: 'og-btn-icon', 'aria-hidden': 'true' }, props.icon) : null, props.children);
  }

  /* Badge */
  function Badge(props) {
    var tone = props.tone || 'neutral';
    return h('span', { className: cx('og-badge', 'og-badge-' + tone, props.className) }, props.children);
  }

  /* TextField */
  var fieldSeq = 0;
  function TextField(props) {
    var idRef = React.useRef(null);
    if (idRef.current === null) idRef.current = props.id || 'og-field-' + (++fieldSeq);
    var id = idRef.current;
    var rest = omit(props, ['label', 'hint', 'error', 'className', 'id', 'mono']);
    var describedBy = (props.error || props.hint) ? id + '-desc' : undefined;
    return h('div', { className: cx('og-field', props.error && 'og-field-invalid', props.className) },
      props.label ? h('label', { className: 'og-field-label', htmlFor: id }, props.label) : null,
      h('input', Object.assign({}, rest, {
        id: id,
        className: cx('og-field-input', props.mono && 'og-field-mono'),
        'aria-invalid': props.error ? 'true' : undefined,
        'aria-describedby': describedBy
      })),
      (props.error || props.hint) ? h('span', { id: describedBy, className: props.error ? 'og-field-error' : 'og-field-hint' },
        props.error ? '✕ ' + props.error : props.hint) : null
    );
  }

  /* ProgressBar */
  function ProgressBar(props) {
    var max = props.max || 100;
    var value = Math.max(0, Math.min(max, props.value || 0));
    var pct = Math.round((value / max) * 100);
    var tone = props.tone || 'primary';
    return h('div', { className: cx('og-progress', props.className) },
      (props.label || props.showValue !== false) ? h('div', { className: 'og-progress-head' },
        props.label ? h('span', { className: 'og-progress-label' }, props.label) : h('span'),
        props.showValue !== false ? h('span', { className: 'og-progress-value' }, props.valueText || ('%' + pct)) : null
      ) : null,
      h('div', {
        className: 'og-progress-track', role: 'progressbar',
        'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': value,
        'aria-label': props.label || 'İlerleme'
      }, h('div', { className: 'og-progress-fill og-progress-' + tone, style: { width: pct + '%' } }))
    );
  }

  /* ModeToggle — Sokratik / Doğrudan cevap */
  var MODES = [
    { id: 'socratic', label: 'Sokratik', sub: 'İpucuyla kavrat' },
    { id: 'direct', label: 'Doğrudan cevap', sub: 'Çözümü göster' }
  ];
  function ModeToggle(props) {
    var value = props.value || 'socratic';
    return h('div', { className: cx('og-mode', props.className), role: 'radiogroup', 'aria-label': props.label || 'Yanıt modu' },
      MODES.map(function (o) {
        var on = o.id === value;
        return h('button', {
          key: o.id, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', disabled: props.disabled,
          className: cx('og-mode-opt', on && 'og-mode-on'),
          onClick: function () { if (props.onChange && !on) props.onChange(o.id); }
        },
          h('span', { className: 'og-mode-label' }, o.label),
          props.compact ? null : h('span', { className: 'og-mode-sub' }, o.sub));
      }));
  }

  /* Notice — bilgi, uyarı, yasal bildirim, insana yükseltme */
  var NOTICE_TITLE = { handoff: 'Hocana yönlendirildi', legal: 'Bilgilendirme' };
  function Notice(props) {
    var tone = props.tone || 'info';
    var title = props.title || NOTICE_TITLE[tone];
    return h('div', { className: cx('og-notice', 'og-notice-' + tone, props.className), role: tone === 'warning' ? 'alert' : 'status' },
      h('div', { className: 'og-notice-body' },
        title ? h('span', { className: 'og-notice-title' }, title) : null,
        h('span', { className: 'og-notice-text' }, props.children)),
      props.action ? h('div', { className: 'og-notice-action' }, props.action) : null);
  }

  /* StatTile — eğitmen panelindeki tek sayı */
  function StatTile(props) {
    var status = props.status || 'neutral';
    return h('div', { className: cx('og-stat', props.className) },
      h('span', { className: 'og-stat-label' }, props.label),
      h('span', { className: 'og-stat-value' }, props.value, props.unit ? h('span', { className: 'og-stat-unit' }, props.unit) : null),
      (props.hint || props.statusText) ? h('span', { className: 'og-stat-foot' },
        props.statusText ? h(Badge, { tone: status }, props.statusText) : null,
        props.hint ? h('span', null, props.hint) : null) : null);
  }

  /* MasteryMeter — kazanım başına ustalık olasılığı; kanıt azken yüzde yok */
  function MasteryMeter(props) {
    var p = Math.max(0, Math.min(1, typeof props.p === 'number' ? props.p : 0));
    var pct = Math.round(p * 100);
    var evidence = props.evidence || 0;
    var min = props.minEvidence || 5;
    var low = evidence < min;
    var delta = typeof props.delta === 'number' ? Math.round(props.delta * 100) : null;
    var lowText = 'Henüz yeterli kanıt yok';
    var track = low
      ? h('div', { className: 'og-mastery-track', role: 'img', 'aria-label': props.skill + ': ' + lowText })
      : h('div', { className: 'og-mastery-track', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': props.skill + ' ustalığı' },
          h('div', { className: 'og-mastery-fill', style: { width: pct + '%' } }));
    var foot = evidence + ' gözlem' + (low ? ' · en az ' + min + ' gerekir' : '') + (props.period ? ' · ' + props.period : '');
    return h('div', { className: cx('og-mastery', low && 'og-mastery-low', props.className) },
      h('div', { className: 'og-mastery-head' },
        h('span', { className: 'og-mastery-skill' }, props.skill),
        h('span', { className: 'og-mastery-value' }, low ? lowText : '%' + pct)),
      track,
      h('div', { className: 'og-mastery-foot' },
        h('span', null, foot),
        (!low && delta !== null && delta !== 0)
          ? h('span', { className: delta > 0 ? 'og-mastery-up' : 'og-mastery-down' }, (delta > 0 ? '+' : '−') + '%' + Math.abs(delta) + (props.deltaLabel ? ' ' + props.deltaLabel : ''))
          : null));
  }

  /* EvidenceQuote — alıntı + kaynak */
  var EVIDENCE_KIND = { lesson: 'Ders kaydı', quiz: 'Soru', chat: 'Sohbet', instructor: 'Eğitmen notu' };
  function EvidenceQuote(props) {
    var kind = EVIDENCE_KIND[props.kind] || null;
    return h('div', { className: cx('og-evidence', props.className) },
      h('blockquote', { className: 'og-evidence-q' }, '“', props.children, '”'),
      (kind || props.source) ? h('span', { className: 'og-evidence-src' },
        kind ? h('span', { className: 'og-evidence-kind' }, kind) : null,
        props.source ? (props.href ? h('a', { href: props.href }, props.source) : h('span', null, props.source)) : null) : null);
  }

  /* MisconceptionItem — açık ya da çözülmüş kavram yanılgısı, kanıtlarıyla */
  function MisconceptionItem(props) {
    var resolved = !!props.resolved;
    var ev = props.evidence || [];
    return h('div', { className: cx('og-miscon', resolved && 'og-miscon-resolved', props.className) },
      h('div', { className: 'og-miscon-top' },
        props.skill ? h('span', { className: 'og-miscon-skill' }, props.skill) : h('span'),
        h(Badge, { tone: resolved ? 'success' : 'warning' }, resolved ? '✓ Çözüldü' : 'Açık')),
      h('span', { className: 'og-miscon-text' }, props.text),
      ev.length ? h('div', { className: 'og-miscon-ev' }, ev.map(function (e, i) {
        return h(EvidenceQuote, { key: i, kind: e.kind, source: e.source, href: e.href }, e.quote);
      })) : null,
      (props.firstSeen || props.resolvedAt) ? h('span', { className: 'og-miscon-dates' },
        props.firstSeen ? 'İlk görüldü: ' + props.firstSeen : null,
        (props.firstSeen && props.resolvedAt) ? ' · ' : null,
        props.resolvedAt ? 'Çözüldü: ' + props.resolvedAt : null) : null,
      props.children);
  }

  /* LessonCard */
  function LessonCard(props) {
    var status = props.status || 'not-started';
    var statusText = { 'not-started': 'Başlamadın', 'in-progress': 'Devam ediyor', 'done': 'Tamamlandı ✓' }[status];
    var statusTone = { 'not-started': 'neutral', 'in-progress': 'primary', 'done': 'success' }[status];
    var Tag = props.href ? 'a' : (props.onClick ? 'button' : 'div');
    var extra = props.href ? { href: props.href } : (props.onClick ? { type: 'button', onClick: props.onClick } : {});
    return h(Tag, Object.assign({ className: cx('og-lesson', (props.href || props.onClick) && 'og-lesson-interactive', props.ai && 'og-lesson-ai', props.className) }, extra),
      h('div', { className: 'og-lesson-top' },
        props.subject ? h('span', { className: 'og-lesson-subject' }, props.subject) : h('span'),
        h(Badge, { tone: statusTone }, statusText)
      ),
      h('span', { className: 'og-lesson-title' }, props.title),
      props.meta ? h('span', { className: 'og-lesson-meta' }, props.meta) : null,
      typeof props.progress === 'number' ? h(ProgressBar, { value: props.progress, label: 'İlerleme', tone: status === 'done' ? 'gold' : 'primary' }) : null,
      props.ai ? h('span', { className: 'og-lesson-ai-note' }, h('span', { className: 'og-ai-dot', 'aria-hidden': 'true' }), 'Öğrenmen sana göre hazırladı') : null
    );
  }

  /* FigureFrame — koddan üretilmiş şekil, denetim durumuyla */
  function FigureFrame(props) {
    var status = props.status;
    var badge = status === 'verified' ? h(Badge, { tone: 'success' }, '✓ Şekil denetlendi')
      : status === 'pending' ? h(Badge, { tone: 'warning' }, 'Onay bekliyor')
      : status === 'failed' ? h(Badge, { tone: 'danger' }, '✕ Denetimden geçmedi')
      : null;
    return h('figure', { className: cx('og-figure', props.className), style: props.width ? { width: props.width } : undefined },
      h('img', { className: 'og-figure-img', src: props.src, alt: props.alt || '', width: props.imgWidth, height: props.imgHeight }),
      (props.caption || badge || props.source) ? h('figcaption', { className: 'og-figure-cap' },
        props.caption ? h('span', { className: 'og-figure-text' }, props.caption) : null,
        badge,
        props.source ? h('span', null, props.source) : null) : null);
  }

  /* QuizOption */
  function QuizOption(props) {
    var state = props.state || 'idle';
    var rest = omit(props, ['letter', 'state', 'className', 'children', 'feedback']);
    var mark = state === 'correct' ? '✓ Doğru' : (state === 'incorrect' ? '✕ Tekrar dene' : null);
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('og-option', 'og-option-' + state, props.className),
      'aria-pressed': state === 'selected' ? 'true' : 'false',
      disabled: props.disabled || state === 'correct' || state === 'incorrect' ? true : undefined
    }),
      props.letter ? h('span', { className: 'og-option-letter', 'aria-hidden': 'true' }, props.letter) : null,
      h('span', { className: 'og-option-text' }, props.children,
        props.feedback ? h('span', { className: 'og-option-feedback' }, props.feedback) : null),
      mark ? h('span', { className: 'og-option-mark' }, mark) : null
    );
  }

  /* TutorMessage — review: eğitmen denetim satırı (model, maliyet, hafıza, işaretle) */
  function TutorMessage(props) {
    var from = props.from || 'tutor';
    var isTutor = from === 'tutor';
    var avatar = isTutor
      ? h('span', {
          className: 'og-msg-avatar', role: 'img', 'aria-label': (props.name || 'Öğrenmen') + ' avatarı',
          style: props.avatarSrc ? { backgroundImage: 'url("' + props.avatarSrc + '")' } : undefined
        }, props.avatarSrc ? null : 'Ö')
      : null;
    var body = props.typing
      ? h('span', { className: 'og-typing', 'aria-label': 'Öğrenmen yazıyor' }, h('i'), h('i'), h('i'))
      : props.children;
    var r = props.review;
    var review = (isTutor && r) ? h('div', { className: 'og-msg-review' },
      h('span', null, [r.model, r.cost, (typeof r.memory === 'number') ? r.memory + ' hafıza olgusu' : null].filter(Boolean).join(' · ')),
      r.flagged
        ? h(Badge, { tone: 'danger' }, '✕ İşaretlendi')
        : h('button', { type: 'button', className: 'og-btn og-btn-quiet og-btn-sm', onClick: r.onFlag }, 'İşaretle')) : null;
    return h('div', { className: cx('og-msg', 'og-msg-' + from, props.className) },
      avatar,
      h('div', { className: 'og-msg-col' },
        isTutor ? h('span', { className: 'og-msg-name' }, props.name || 'Öğrenmen', h('span', { className: 'og-msg-tag' }, 'AI öğretmen')) : null,
        h('div', { className: 'og-msg-bubble' }, body),
        props.actions ? h('div', { className: 'og-msg-actions' }, props.actions) : null,
        review
      )
    );
  }

  /* CitationCard — yalnızca Crossref'te doğrulanmış DOI ✓ taşır */
  function CitationCard(props) {
    var verified = props.verified !== false;
    var doiUrl = props.doi ? 'https://doi.org/' + props.doi : null;
    return h('div', { className: cx('og-cite', !verified && 'og-cite-unverified', props.className) },
      h('span', { className: 'og-cite-title' }, props.title),
      h('span', { className: 'og-cite-meta' }, [props.authors, props.venue, props.year].filter(Boolean).join(' · ')),
      props.tldr ? h('span', { className: 'og-cite-tldr' }, props.tldr) : null,
      h('div', { className: 'og-cite-doi' },
        props.doi ? (verified ? h('a', { href: doiUrl }, 'doi:' + props.doi) : h('span', null, 'doi:' + props.doi)) : h('span', null, 'DOI yok'),
        verified ? h(Badge, { tone: 'success' }, '✓ Crossref doğruladı') : h(Badge, { tone: 'danger' }, '✕ DOI çözümlenmedi · kaldırılacak')),
      (props.pdfUrl || props.actions) ? h('div', { className: 'og-cite-actions' },
        props.pdfUrl ? h('a', { className: 'og-btn og-btn-quiet og-btn-md', href: props.pdfUrl }, 'Açık erişim PDF') : null,
        props.actions) : null);
  }

  /* ExamPriorityRow — sıklık analizine göre öncelik, tahmin değil */
  function ExamPriorityRow(props) {
    var total = props.years || 5;
    var hit = Math.max(0, Math.min(total, props.hits || 0));
    var pips = [];
    for (var i = 0; i < total; i++) pips.push(h('span', { key: i, className: cx('og-exam-pip', i < hit && 'og-exam-pip-on') }));
    return h('div', { className: cx('og-exam', props.className) },
      h('span', { className: 'og-exam-rank' }, props.rank),
      h('div', { className: 'og-exam-main' },
        h('span', { className: 'og-exam-topic' }, props.topic, props.kind ? h(Badge, null, props.kind) : null),
        props.evidence ? h('span', { className: 'og-exam-ev' }, props.href ? h('a', { href: props.href }, props.evidence) : props.evidence) : null),
      h('div', { className: 'og-exam-freq', 'aria-label': total + ' yılın ' + hit + "'inde çıktı" },
        h('span', { className: 'og-exam-pips', 'aria-hidden': 'true' }, pips),
        h('span', { className: 'og-exam-freq-text' }, hit + '/' + total + ' yıl')),
      props.points ? h('span', { className: 'og-exam-points' }, props.points) : null);
  }

  /* AlertRow — eğitmen takip paneli satırı */
  var ALERT_KIND = { unanswered: 'Cevapsız soru', silent: 'Sessiz öğrenci', morale: 'Moral göstergesi', deadline: 'Yaklaşan teslim', response: 'Yanıt süresi' };
  var SEVERITY = { danger: 'Acil', warning: 'Dikkat', neutral: 'Bilgi' };
  function AlertRow(props) {
    var sev = SEVERITY[props.severity] ? props.severity : 'warning';
    return h('div', { className: cx('og-alert', props.className) },
      h(Badge, { tone: sev }, SEVERITY[sev]),
      h('div', { className: 'og-alert-main' },
        h('span', { className: 'og-alert-kind' }, ALERT_KIND[props.kind] || props.kind),
        h('span', { className: 'og-alert-student' }, props.student),
        props.detail ? h('span', { className: 'og-alert-detail' }, props.detail) : null),
      props.since ? h('span', { className: 'og-alert-since' }, props.since) : null,
      props.action ? h('div', { className: 'og-alert-action' }, props.action) : null);
  }

  var api = {
    BrandLockup: BrandLockup, Button: Button, Badge: Badge, TextField: TextField, ProgressBar: ProgressBar,
    ModeToggle: ModeToggle, Notice: Notice, StatTile: StatTile, MasteryMeter: MasteryMeter, EvidenceQuote: EvidenceQuote,
    MisconceptionItem: MisconceptionItem, LessonCard: LessonCard, FigureFrame: FigureFrame, QuizOption: QuizOption,
    TutorMessage: TutorMessage, CitationCard: CitationCard, ExamPriorityRow: ExamPriorityRow, AlertRow: AlertRow
  };
  window.Ogrenmen = Object.assign(window.Ogrenmen || {}, api);
})();
