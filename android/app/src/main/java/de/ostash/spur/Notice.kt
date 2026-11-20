package de.ostash.spur

/** Kurzer Hinweis zur Testphase in drei Sprachen. Gleicher Inhalt wie `mitarbeiterhinweis-testphase.md`; die deutsche Fassung gilt. */
object Notice {
    class Text(val title: String, val items: List<String>, val check: String, val button: String)

    val de = Text(
        "Spur – Test der Zeiterfassung",
        listOf(
            "Verantwortlich: Volodymyr Ostash, Keltenstraße 31, 82343 Pöcking, ostasch@gmx.de.",
            "Zweck: Wir testen, ob die App deine Arbeitszeit, Fahrten und Kilometer richtig aufschreibt. Es ist ein Test.",
            "Zwei Wege: Du füllst deinen Zettel selbst aus oder du nutzt die Stoppuhr. Du kannst beides probieren.",
            "GPS-Hilfe ist freiwillig. Sie läuft nur zwischen „Tag starten“ und „Tag beenden“. Wenn du sie nicht willst, schalte sie aus. Das hat keinen Nachteil.",
            "Die genauen Standortpunkte bleiben auf deinem Handy. Sie werden gelöscht, wenn du den Tag abgibst, spätestens 48 Stunden nach „Tag beenden“.",
            "Der Chef sieht nur den fertigen Zettel: Baustelle, Beginn, Ende, Pause, Kilometer, deine Beschreibung. Zeiten sind auf 5 Minuten gerundet. Es gibt keine Live-Verfolgung.",
            "Die Daten liegen auf einem Server bei Hetzner in Deutschland, im Auftrag des Chefs.",
            "Alle Testdaten werden nach dem Test gelöscht. Wenn du es früher willst, sag es dem Chef.",
            "Deine Rechte: Auskunft, Korrektur, Löschung und Widerspruch. Du kannst dich auch beim Bayerischen Landesamt für Datenschutzaufsicht (BayLDA) beschweren.",
        ),
        "Ich habe diese Information gelesen.",
        "Weiter",
    )

    val uk = Text(
        "Spur – тест обліку робочого часу",
        listOf(
            "Відповідальний: Володимир Осташ (Volodymyr Ostash), Keltenstraße 31, 82343 Pöcking, ostasch@gmx.de.",
            "Мета: Ми перевіряємо, чи застосунок правильно записує твій робочий час, поїздки та кілометри. Це тест.",
            "Два способи: Ти сам заповнюєш листок або користуєшся секундоміром. Можна спробувати обидва.",
            "GPS-підказка добровільна. Вона працює лише між «Tag starten» і «Tag beenden». Якщо не хочеш, вимкни її. Жодних невигод для тебе немає.",
            "Точні точки місцезнаходження залишаються на твоєму телефоні. Вони видаляються, коли ти здаєш день, щонайпізніше через 48 годин після «Tag beenden».",
            "Керівник бачить лише готовий листок: об'єкт, початок, кінець, перерва, кілометри, твій опис. Час округлено до 5 хвилин. Стеження в реальному часі немає.",
            "Дані зберігаються на сервері Hetzner у Німеччині, за дорученням керівника.",
            "Усі тестові дані будуть видалені після тесту. Якщо хочеш раніше, скажи керівнику.",
            "Твої права: інформація, виправлення, видалення та заперечення. Ти також можеш подати скаргу до Баварського відомства з нагляду за захистом даних (BayLDA).",
        ),
        "Я прочитав цю інформацію.",
        "Далі",
    )

    val ru = Text(
        "Spur – тест учёта рабочего времени",
        listOf(
            "Ответственный: Владимир Осташ (Volodymyr Ostash), Keltenstraße 31, 82343 Pöcking, ostasch@gmx.de.",
            "Цель: Мы проверяем, правильно ли приложение записывает твоё рабочее время, поездки и километры. Это тест.",
            "Два способа: Ты сам заполняешь листок или пользуешься секундомером. Можно попробовать оба.",
            "GPS-подсказка добровольная. Она работает только между «Tag starten» и «Tag beenden». Если не хочешь, выключи её. Никаких неудобств для тебя нет.",
            "Точные точки местоположения остаются на твоём телефоне. Они удаляются, когда ты сдаёшь день, самое позднее через 48 часов после «Tag beenden».",
            "Руководитель видит только готовый листок: объект, начало, конец, перерыв, километры, твоё описание. Время округлено до 5 минут. Слежения в реальном времени нет.",
            "Данные хранятся на сервере Hetzner в Германии, по поручению руководителя.",
            "Все тестовые данные будут удалены после теста. Если хочешь раньше, скажи руководителю.",
            "Твои права: информация, исправление, удаление и возражение. Ты также можешь подать жалобу в Баварское ведомство по надзору за защитой данных (BayLDA).",
        ),
        "Я прочитал эту информацию.",
        "Далее",
    )

    fun of(lang: String) = when (lang) { "uk" -> uk; "ru" -> ru; else -> de }
}
