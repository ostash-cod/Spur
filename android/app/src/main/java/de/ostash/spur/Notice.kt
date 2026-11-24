package de.ostash.spur

/**
 * Hinweis nach Art. 13 DSGVO in drei Sprachen. Gleicher Inhalt wie `mitarbeiterhinweis-art13-de.md` und `-uk-ru.md`; die deutsche Fassung gilt.
 * Jeder Eintrag: erste Zeile = Überschrift, danach der Text.
 */
object Notice {
    class Text(val title: String, val items: List<String>, val check: String, val button: String)

    val de = Text(
        "Information zur Zeiterfassung mit der App „Spur“ (nach Art. 13 DSGVO)",
        listOf(
            "Wer ist verantwortlich?\nVolodymyr Ostash, Keltenstraße 31, 82343 Pöcking, ostasch@gmx.de.",
            "Wofür nutzen wir die App?\nZur Erfassung deiner Arbeitszeit, deiner Fahrten und der Kilometer. Damit erstellen wir Stundennachweise, die Lohnabrechnung und die Abrechnung mit Kunden. In den ersten Wochen passen wir die App noch an.",
            "Wie füllst du aus?\nDu füllst deinen Zettel selbst aus. Du hast drei Wege: ganz von Hand, mit Antippen der Baustelle oder mit der GPS-Hilfe. Du entscheidest. Ein Nein zur GPS-Hilfe hat keinen Nachteil. Du kannst auch auf Papier schreiben.",
            "Welche Daten werden gespeichert?\nDatum, Beginn, Ende und Pausen, die Baustelle, Fahrten mit Kilometern, das Fahrzeug und deine Beschreibung der Arbeit. Wenn du sie machst: Notizen, Fotos und Belege. Alle Zeiten werden auf 5 Minuten gerundet. Bei „Privat“ wird nur die Zeit gespeichert, kein Ort.",
            "GPS-Hilfe (freiwillig)\nDie App kann Baustellen erkennen und Zeiten vorschlagen. Das ist nur ein Angebot. Du kannst sie in den Einstellungen ein- und ausschalten. Sie läuft nur zwischen „Tag starten“ und „Tag beenden“. Nach Feierabend ist sie aus. Die genauen Standortpunkte bleiben auf deinem Handy. Sie werden gelöscht, sobald du den Tag abgibst, spätestens 48 Stunden nach „Tag beenden“. Sie gehen nicht zum Server. Es gibt keine Live-Verfolgung und kein Bewegungsprofil.",
            "Wer sieht deine Daten?\nIch als Inhaber, und erst, wenn du deinen Tag abgegeben hast. Vorher sehe ich nichts. Technisch speichert die Firma Hetzner (Deutschland) die Daten auf einem Server in meinem Auftrag. Wenn ich für die Lohnabrechnung einen Steuerberater oder ein Lohnbüro nutze, bekommt dieser nur die Zeiten, die er dafür braucht.",
            "Rechtsgrundlage\nDie Erfassung der Arbeitszeit ist nach dem Arbeitszeitgesetz (§ 16 ArbZG) Pflicht des Arbeitgebers. Die übrigen Angaben auf dem Zettel brauche ich für die Durchführung des Arbeitsverhältnisses (§ 26 BDSG). Die GPS-Hilfe ist ein freiwilliges Angebot.",
            "Wie läuft die Woche?\nDu gibst deinen Tag ab. Solange die Woche nicht bestätigt ist, kannst du deinen Zettel noch korrigieren und neu abgeben. Ich prüfe deine Zettel und schicke dir den Wochenbericht. Du prüfst ihn und bestätigst ihn oder schreibst, was nicht stimmt. Änderungen von mir an deinem Zettel werden festgehalten.",
            "Wie lange werden die Daten gespeichert?\nZeitnachweise mindestens 2 Jahre, wie es das Arbeitszeitgesetz verlangt. Danach werden sie gelöscht, soweit nicht andere gesetzliche Fristen gelten, zum Beispiel für Lohn und Steuer.",
            "Deine Rechte\nDu kannst Auskunft über deine Daten verlangen, Fehler korrigieren lassen, Löschung verlangen (soweit keine Pflicht zur Aufbewahrung besteht) und der Verarbeitung widersprechen. Du kannst dich auch beim Bayerischen Landesamt für Datenschutzaufsicht (BayLDA) beschweren.",
        ),
        "Ich habe diese Information gelesen.",
        "Weiter",
    )

    val uk = Text(
        "Інформація про облік робочого часу в застосунку «Spur» (згідно зі ст. 13 GDPR / DSGVO)",
        listOf(
            "Хто відповідальний?\nВолодимир Осташ (Volodymyr Ostash), Keltenstraße 31, 82343 Pöcking, ostasch@gmx.de.",
            "Для чого ми використовуємо застосунок?\nДля обліку твого робочого часу, поїздок і кілометрів. На цій основі ми складаємо табелі, нараховуємо зарплату та виставляємо рахунки клієнтам. У перші тижні ми ще підлаштовуємо застосунок.",
            "Як ти заповнюєш?\nТи сам заповнюєш свій листок. Є три способи: повністю вручну, натисканням на об'єкт або за допомогою GPS-підказки. Ти вирішуєш сам. Якщо ти не користуєшся GPS-підказкою, жодних невигод для тебе немає. Можна також писати на папері.",
            "Які дані зберігаються?\nДата, початок, кінець і перерви, об'єкт, поїздки з кілометрами, автомобіль та твій опис виконаної роботи. Якщо ти їх робиш: нотатки, фото та чеки. Увесь час округлюється до 5 хвилин. Для позначки «Privat» (приватне) зберігається лише час, без місця.",
            "GPS-підказка (добровільно)\nЗастосунок може розпізнавати об'єкти й пропонувати час. Це лише пропозиція. Ти можеш вмикати й вимикати її в налаштуваннях. Вона працює тільки між «Tag starten» (почати день) і «Tag beenden» (закінчити день). Після закінчення роботи вона вимкнена. Точні точки місцезнаходження залишаються на твоєму телефоні. Вони видаляються, щойно ти здаєш день, і щонайпізніше через 48 годин після «Tag beenden». На сервер вони не потрапляють. Стеження в реальному часі немає, профілю пересувань теж.",
            "Хто бачить твої дані?\nЯ як власник, і лише після того, як ти здав день. До цього я нічого не бачу. Технічно дані зберігає фірма Hetzner (Німеччина) на сервері за моїм дорученням. Якщо для зарплати я користуюся податковим консультантом або бюро із зарплат, він отримує лише ті дані про час, які йому потрібні для цього.",
            "Правова підстава\nОблік робочого часу — обов'язок роботодавця за законом про робочий час (§ 16 ArbZG). Решту даних у листку мені потрібно для виконання трудових відносин (§ 26 BDSG). GPS-підказка — добровільна пропозиція.",
            "Як проходить тиждень?\nТи здаєш день. Поки тиждень не підтверджено, ти можеш виправити листок і здати його знову. Я перевіряю твої листки й надсилаю тобі тижневий звіт. Ти перевіряєш його й підтверджуєш або пишеш, що не так. Мої зміни у твоєму листку фіксуються.",
            "Як довго зберігаються дані?\nОблікові дані про робочий час — щонайменше 2 роки, як вимагає закон про робочий час (Arbeitszeitgesetz). Після цього вони видаляються, якщо не діють інші законні строки, наприклад для зарплати й податків.",
            "Твої права\nТи можеш вимагати інформацію про свої дані, вимагати виправлення помилок, вимагати видалення (якщо немає обов'язку зберігати) і заперечувати проти обробки. Ти також можеш подати скаргу до Баварського відомства з нагляду за захистом даних (BayLDA).",
        ),
        "Я прочитав цю інформацію.",
        "Далі",
    )

    val ru = Text(
        "Информация об учёте рабочего времени в приложении «Spur» (согласно ст. 13 GDPR / DSGVO)",
        listOf(
            "Кто отвечает за данные?\nВладимир Осташ (Volodymyr Ostash), Keltenstraße 31, 82343 Pöcking, ostasch@gmx.de.",
            "Для чего мы используем приложение?\nДля учёта твоего рабочего времени, поездок и километров. На этой основе мы составляем табели, считаем зарплату и выставляем счета клиентам. В первые недели мы ещё донастраиваем приложение.",
            "Как ты заполняешь?\nТы сам заполняешь свой листок. Есть три способа: полностью вручную, нажатием на объект или с помощью GPS-подсказки. Решаешь ты. Если ты не пользуешься GPS-подсказкой, никаких неудобств для тебя нет. Можно также писать на бумаге.",
            "Какие данные сохраняются?\nДата, начало, конец и перерывы, объект, поездки с километрами, автомобиль и твоё описание работы. Если ты их делаешь: заметки, фото и чеки. Всё время округляется до 5 минут. При пометке «Privat» (личное) сохраняется только время, без места.",
            "GPS-подсказка (добровольно)\nПриложение может распознавать объекты и предлагать время. Это только предложение. Ты можешь включать и выключать её в настройках. Она работает лишь между «Tag starten» (начать день) и «Tag beenden» (закончить день). После окончания работы она выключена. Точные точки местоположения остаются на твоём телефоне. Они удаляются, как только ты сдаёшь день, и самое позднее через 48 часов после «Tag beenden». На сервер они не попадают. Слежения в реальном времени нет, профиля передвижений тоже.",
            "Кто видит твои данные?\nЯ как владелец, и только после того, как ты сдал день. До этого я ничего не вижу. Технически данные хранит фирма Hetzner (Германия) на сервере по моему поручению. Если для зарплаты я пользуюсь налоговым консультантом или бюро по зарплате, он получает только те данные о времени, которые ему для этого нужны.",
            "Правовое основание\nУчёт рабочего времени — обязанность работодателя по закону о рабочем времени (§ 16 ArbZG). Остальные данные в листке мне нужны для исполнения трудовых отношений (§ 26 BDSG). GPS-подсказка — добровольное предложение.",
            "Как проходит неделя?\nТы сдаёшь день. Пока неделя не подтверждена, ты можешь исправить листок и сдать его снова. Я проверяю твои листки и отправляю тебе недельный отчёт. Ты проверяешь его и подтверждаешь или пишешь, что не так. Мои изменения в твоём листке фиксируются.",
            "Как долго хранятся данные?\nДанные об учёте рабочего времени — минимум 2 года, как требует закон о рабочем времени (Arbeitszeitgesetz). После этого они удаляются, если не действуют другие законные сроки, например для зарплаты и налогов.",
            "Твои права\nТы можешь запросить информацию о своих данных, потребовать исправления ошибок, потребовать удаления (если нет обязанности хранить) и возразить против обработки. Ты также можешь подать жалобу в Баварское ведомство по надзору за защитой данных (BayLDA).",
        ),
        "Я прочитал эту информацию.",
        "Далее",
    )

    fun of(lang: String) = when (lang) { "uk" -> uk; "ru" -> ru; else -> de }
}
