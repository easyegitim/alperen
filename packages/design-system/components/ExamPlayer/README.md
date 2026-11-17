# ExamPlayer, Timer, AnswerGrid

Uygulama içi deneme çözme kabuğu. Soru içeriğini ve cevap durumunu uygulama taşır; kabuk yerleşimi, gezinmeyi ve erişilebilirliği sağlar.

- `ExamPlayer`: `mode` (`'practice'` varsayılan, `'exam'`), `title`, `remainingSec`, `questions` (`{ no, status: blank | answered | flagged }`), `current`, `onNavigate`, `onToggleFlag`, `onFinish`, `children` (soru gövdesi: metin, `FigureFrame`, `QuizOption` listesi, karalama tuvali). **Sade test akışı (`mode="practice"`, öneri → Başla):** yalnız başlık, `ProgressStrip` noktaları, soru gövdesi ve "Sonraki" (son soruda `onFinish` varsa "Bitir") görünür; zamanlayıcı, soru ızgarası, Önceki ve Bayrakla yoktur. **Deneme kipi (`mode="exam"`):** `Timer`, "Sınavı bitir", Önceki/Sonraki, Bayrakla ve masaüstünde sağda, mobilde altta `AnswerGrid` görünür.
- `Timer`: `remainingSec`; `role="timer"`, "mm:ss" ya da "h:mm:ss". Süre `warnBelowSec` (varsayılan 5 dk) altına inince "Süre azalıyor", sıfırda "Süre doldu" yazılır (renk tek başına değil).
- `useCountdown(totalSec, { running, onExpire })`: duvar saatine dayalı geri sayım; bitişte `onExpire` bir kez çağrılır.
- `AnswerGrid`: 44px hücreler, durum `aria-label` içinde ("Soru 5, bayraklı"); bayraklı hücre "B" işareti de taşır.
- Süre aşımında cevapları kaydetmek ve notlamak sunucunun işidir (`grade_exam_session`); kabuk yalnızca süreyi gösterir.
